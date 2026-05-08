// MINI engine adapter for mini-PSF style formats.
// Uses Wothke's HighlyExperimental backend (backend_psx.js), which can
// decode PSF-family containers such as mini2sf/minigsf/miniusf/minissf.
import { clamp01, loadScript, resolveExt } from '../shared.js';

const MINI_STDLIB_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/chiptune-collection@master/blaster/stdlib/scriptprocessor_player.min.js';
const MINI_PSX_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/chiptune-collection@master/blaster/backend_psx.js';
const MINI_LIB_STDLIB_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/chiptune-collection@master/library/scriptprocessor_player.min.js';
const MINI_GSF_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/chiptune-collection@master/library/JS/backend_gsf.js';
const MINI_EXTS = new Set(['mini2sf', 'minigsf', 'minipsf', 'miniusf', 'minipsf2', 'minissf']);
const MINI_EXTS_SUPPORTED = new Set(['minipsf', 'minipsf2', 'minigsf']);

const BACKEND_PSX = {
  key: 'psx',
  stdlibUrl: MINI_STDLIB_JS_URL,
  backendUrl: MINI_PSX_JS_URL,
  stateKeys: ['spp_backend_state_PSX'],
  adapterCtor: 'PSXBackendAdapter',
  adapterArgs: [false, true],
};

const BACKEND_GSF = {
  key: 'gsf',
  stdlibUrl: MINI_LIB_STDLIB_JS_URL,
  backendUrl: MINI_GSF_JS_URL,
  stateKeys: ['spp_backend_state_gsf', 'spp_backend_state_GSF'],
  adapterCtor: 'GSFBackendAdapter',
  // Enable backend filename remapping used for Modland-style files.
  adapterArgs: [true],
};

let _onEnd = null;
let _volume = 1;
let _loadGen = 0;

let _adapter = null;
let _mod = null;
let _modReady = false;
let _modPromise = null;
let _pendingBackendKey = null;
let _activeBackend = null;
let _ctx = null;
let _gain = null;
let _node = null;
let _playing = false;
let _duration = 0;
let _sr = 44100;
let _framePos = 0;
let _chunk = null;
let _chunkFrames = 0;
let _chunkPos = 0;
let _registeredFiles = new Set();
let _registeredFileData = new Map();
let _currentLoadExt = '';
let _requestDebugCount = 0;

function backendUsesMilliseconds() {
  return _activeBackend?.key === 'gsf';
}

const _warmup = (async () => {
  try {
    await Promise.all([
      loadScript(MINI_STDLIB_JS_URL),
      loadScript(MINI_PSX_JS_URL),
      loadScript(MINI_LIB_STDLIB_JS_URL),
      loadScript(MINI_GSF_JS_URL),
    ]);
  } catch (_) {}
})();

function backendForExt(ext) {
  if (ext === 'minipsf' || ext === 'minipsf2') return BACKEND_PSX;
  if (ext === 'minigsf') return BACKEND_GSF;
  return null;
}

function isMiniExt(ext) {
  return MINI_EXTS.has(String(ext || '').toLowerCase());
}

function fsHandle(mod) {
  return (
    mod?.FS ??
    window.backend_PSX?.FS ??
    window.spp_backend_state_PSX?.FS ??
    window.backend_gsf?.FS ??
    window.spp_backend_state_gsf?.FS ??
    window.spp_backend_state_GSF?.FS ??
    window.FS ??
    null
  );
}

function fsCreateDataFile(mod, dir, name, data, canRead, canWrite, canOwn) {
  const fs = fsHandle(mod);
  if (fs?.createDataFile) {
    return fs.createDataFile(dir, name, data, canRead, canWrite, canOwn);
  }
  const fn = mod?.FS_createDataFile ??
    window.backend_PSX?.FS_createDataFile ??
    window.spp_backend_state_PSX?.FS_createDataFile;
  if (typeof fn === 'function') {
    return fn(dir, name, data, canRead, canWrite, canOwn);
  }
  throw new Error('[mini] createDataFile API unavailable');
}

function fsUnlink(mod, path) {
  const fs = fsHandle(mod);
  if (fs?.unlink) return fs.unlink(path);
  const fn = mod?.FS_unlink ??
    window.backend_PSX?.FS_unlink ??
    window.spp_backend_state_PSX?.FS_unlink;
  if (typeof fn === 'function') return fn(path);
}

function normalizeVfsPath(pathLike) {
  const raw = String(pathLike || '').split('?')[0].split('#')[0].replace(/\\/g, '/');
  const parts = [];
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

function ensureVfsDir(mod, absDir) {
  const fs = fsHandle(mod);
  const norm = absDir.startsWith('/') ? absDir : ('/' + absDir);
  if (norm === '/') return;

  try {
    if (typeof fs?.mkdirTree === 'function') {
      fs.mkdirTree(norm);
      return;
    }
  } catch (_) {}

  try {
    if (typeof mod?.FS_createPath === 'function') {
      mod.FS_createPath('/', norm.slice(1), true, true);
      return;
    }
  } catch (_) {}

  let cur = '';
  for (const seg of norm.split('/').filter(Boolean)) {
    cur += '/' + seg;
    try {
      if (typeof fs?.mkdir === 'function') fs.mkdir(cur);
    } catch (_) {}
  }
}

function registerVfsFile(mod, virtualPath, data) {
  const rel = normalizeVfsPath(virtualPath);
  if (!rel) throw new Error('[mini] empty virtual path');

  const slash = rel.lastIndexOf('/');
  const dir = slash >= 0 ? ('/' + rel.substring(0, slash)) : '/';
  const name = slash >= 0 ? rel.substring(slash + 1) : rel;
  const abs = dir === '/' ? '/' + name : dir + '/' + name;

  ensureVfsDir(mod, dir);
  try { fsUnlink(mod, abs); } catch (_) {}
  fsCreateDataFile(mod, dir, name, data, true, true, true);
  _registeredFiles.add(abs);
  _registeredFileData.set(abs, data instanceof Uint8Array ? data : new Uint8Array(data));
  return rel;
}

function clearRegisteredVfsFiles(mod) {
  for (const p of _registeredFiles) {
    try { fsUnlink(mod, p); } catch (_) {}
  }
  _registeredFiles.clear();
  _registeredFileData.clear();
}

function registeredPathFor(absPath) {
  const want = String(absPath || '').toLowerCase();
  for (const p of _registeredFiles) {
    if (p.toLowerCase() === want) return p;
  }
  return '';
}

function ensureRegisteredFilePresent(mod, absPath) {
  const hit = registeredPathFor(absPath);
  if (!hit) return false;
  const bytes = _registeredFileData.get(hit);
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return false;
  const slash = hit.lastIndexOf('/');
  const dir = slash >= 0 ? hit.substring(0, slash) : '/';
  const name = slash >= 0 ? hit.substring(slash + 1) : hit;
  ensureVfsDir(mod, dir || '/');
  try { fsUnlink(mod, hit); } catch (_) {}
  fsCreateDataFile(mod, dir || '/', name, bytes, true, true, true);
  return true;
}

function readCStringFromPtr(mod, ptr) {
  const p = Number(ptr) >>> 0;
  if (!p) return '';
  const heap = mod?.HEAPU8;
  if (!heap || p >= heap.length) return '';
  let end = p;
  while (end < heap.length && heap[end] !== 0) end++;
  return new TextDecoder('utf-8').decode(heap.subarray(p, end));
}

function vfsExists(mod, absPath) {
  if (registeredPathFor(absPath)) {
    // Best effort: if the path is tracked but missing in FS, restore it.
    try { ensureRegisteredFilePresent(mod, absPath); } catch (_) {}
  }
  const fs = fsHandle(mod);
  try {
    if (typeof fs?.analyzePath === 'function') return !!fs.analyzePath(absPath).exists;
  } catch (_) {}
  try {
    if (typeof mod?.FS_analyzePath === 'function') return !!mod.FS_analyzePath(absPath).exists;
  } catch (_) {}
  try {
    if (typeof fs?.lookupPath === 'function') {
      fs.lookupPath(absPath);
      return true;
    }
  } catch (_) {}
  if (registeredPathFor(absPath)) return true;
  return false;
}

function ensureAliasForRequestedFile(mod, requestedAbsPath) {
  if (vfsExists(mod, requestedAbsPath)) return true;
  if (ensureRegisteredFilePresent(mod, requestedAbsPath)) return true;
  const fs = fsHandle(mod);
  const reqLower = requestedAbsPath.toLowerCase();
  const reqBase = requestedAbsPath.substring(requestedAbsPath.lastIndexOf('/') + 1).toLowerCase();

  const exact = [..._registeredFiles].find((p) => p.toLowerCase() === reqLower);
  const fallback = exact || [..._registeredFiles].find((p) => p.substring(p.lastIndexOf('/') + 1).toLowerCase() === reqBase);
  if (!fallback) return false;

  try {
    const data = fs?.readFile
      ? fs.readFile(fallback, { encoding: 'binary' })
      : null;
    if (!data) return false;
    const slash = requestedAbsPath.lastIndexOf('/');
    const dir = slash >= 0 ? requestedAbsPath.substring(0, slash) : '/';
    const name = slash >= 0 ? requestedAbsPath.substring(slash + 1) : requestedAbsPath;
    ensureVfsDir(mod, dir);
    try { fsUnlink(mod, requestedAbsPath); } catch (_) {}
    fsCreateDataFile(mod, dir, name, data, true, true, true);
    _registeredFiles.add(requestedAbsPath);
    return true;
  } catch (_) {
    return false;
  }
}

function installFileRequestCallback(mod) {
  window.fileRequestCallback = function (ptr) {
    try {
      const raw = readCStringFromPtr(mod, ptr);
      const rel = normalizeVfsPath(raw);
      if (!rel) return -1;
      const abs = rel.startsWith('/') ? rel : ('/' + rel);
      const ok = vfsExists(mod, abs) || ensureAliasForRequestedFile(mod, abs);
      if (!ok && _currentLoadExt === 'minigsf' && _requestDebugCount < 30) {
        _requestDebugCount += 1;
        console.warn('[mini] gsf requested missing file:', raw, '| normalized:', abs);
      }
      if (ok) return 0;
      return -1;
    } catch (_) {
      return -1;
    }
  };
}

function parsePsfLibRefs(data) {
  if (!(data instanceof Uint8Array) || data.length < 16) return [];
  if (!(data[0] === 0x50 && data[1] === 0x53 && data[2] === 0x46)) return [];

  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const reservedSize = dv.getUint32(4, true);
  const compressedSize = dv.getUint32(8, true);
  const tagOffset = 16 + reservedSize + compressedSize;
  if (tagOffset >= data.length) return [];

  const tags = new TextDecoder('utf-8').decode(data.subarray(tagOffset));
  const tagPos = tags.indexOf('[TAG]');
  if (tagPos < 0) return [];

  const out = [];
  const seen = new Set();
  const lines = tags.substring(tagPos + 5).split(/\r?\n/);
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.substring(0, eq).trim().toLowerCase();
    if (!/^_lib\d*$/.test(key)) continue;
    const val = line.substring(eq + 1).trim();
    const norm = normalizeVfsPath(val);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function sanitizeUrlRef(ref) {
  return String(ref || '').replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
}

function resolveLibUrl(ref, base) {
  const cleanRef = sanitizeUrlRef(ref);
  try {
    return new URL(cleanRef).href;
  } catch (_) {}

  const baseStr = String(base || '').trim() || window.location.href;

  try {
    return new URL(cleanRef, baseStr).href;
  } catch (_) {}

  let parsedBase;
  try {
    parsedBase = new URL(baseStr, window.location.href);
  } catch (_) {
    parsedBase = new URL(window.location.href);
  }

  const baseDir = parsedBase.pathname.replace(/[^/]*$/, '');
  const merged = cleanRef.startsWith('/') ? cleanRef : (baseDir + cleanRef);
  const normalized = normalizeVfsPath(merged);
  const encodedPath = '/' + normalized.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return parsedBase.origin + encodedPath;
}

async function preloadMiniLibraries(mainUrl, mainData, mod, gen) {
  const visited = new Set();
  const missing = [];

  const rootAbsUrl = resolveLibUrl(mainUrl, window.location.href);

  const walk = async (fileUrl, fileData, fallbackBaseUrl = rootAbsUrl) => {
    if (gen !== _loadGen) throw new Error('load superseded');
    const libs = parsePsfLibRefs(fileData);
    for (const libPath of libs) {
      const libUrl = resolveLibUrl(libPath, fileUrl || fallbackBaseUrl);
      if (visited.has(libUrl)) continue;
      visited.add(libUrl);

      let res;
      try {
        res = await fetch(libUrl);
      } catch (e) {
        const reason = e && e.message ? e.message : 'fetch failed';
        missing.push(`${libPath} (${reason})`);
        continue;
      }
      if (!res.ok) {
        missing.push(`${libPath} (HTTP ${res.status})`);
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      registerVfsFile(mod, libPath, bytes);
      await walk(libUrl, bytes, fallbackBaseUrl);
    }
  };

  await walk(rootAbsUrl, mainData, rootAbsUrl);
  return { missing };
}

async function preloadGuessedGsfLibs(mainUrl, mainData, mainName, mod, gen) {
  if (gen !== _loadGen) throw new Error('load superseded');

  const candidates = new Set();
  const add = (s) => {
    const norm = normalizeVfsPath(s);
    if (!norm) return;
    candidates.add(norm);
  };

  // Most miniGSF sets expose _lib=*.gsflib in tags; parse and prioritize those.
  for (const ref of parsePsfLibRefs(mainData)) {
    if (/\.gsflib$/i.test(ref)) add(ref);
  }

  const base = String(mainName || '').trim();
  const lower = base.toLowerCase();
  if (lower.endsWith('.minigsf')) {
    const noExt = base.slice(0, -'.minigsf'.length);
    add(`${noExt}.gsflib`);
    add(noExt.replace(/\.[^.]+$/, '') + '.gsflib');
    add(base.replace(/\.minigsf$/i, '.gsflib'));
  }

  for (const libPath of candidates) {
    const abs = '/' + normalizeVfsPath(libPath);
    if (vfsExists(mod, abs)) continue;
    const libUrl = resolveLibUrl(libPath, mainUrl);
    if (_currentLoadExt === 'minigsf') {
      console.log('[mini] gsf prefetch candidate:', libPath, '->', libUrl);
    }
    let res;
    try {
      res = await fetch(libUrl);
      if (_currentLoadExt === 'minigsf') {
        console.log('[mini] gsf prefetch status:', libPath, res.status, res.ok);
      }
    } catch (_) {
      if (_currentLoadExt === 'minigsf') {
        console.warn('[mini] gsf prefetch failed:', libPath, '(fetch threw)');
      }
      continue;
    }
    if (!res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    registerVfsFile(mod, libPath, bytes);
    if (_currentLoadExt === 'minigsf') {
      console.log('[mini] gsf prefetch registered:', libPath, '| bytes:', bytes.length);
    }
  }
}

function getBackendState(cfg) {
  for (const key of cfg.stateKeys) {
    if (window[key]) return window[key];
  }
  return null;
}

function resetActiveBackend() {
  if (_adapter) {
    try { _adapter.teardown?.(); } catch (_) {}
  }
  if (_mod) clearRegisteredVfsFiles(_mod);
  _adapter = null;
  _mod = null;
  _modReady = false;
  _activeBackend = null;
}

async function ensureModule(ext) {
  const cfg = backendForExt(ext);
  if (!cfg) {
    throw new Error(`[mini] .${ext} is not supported by current mini backend (supports: minipsf, minipsf2, minigsf)`);
  }

  if (_modReady && _activeBackend?.key === cfg.key) return;
  if (_modPromise && _pendingBackendKey === cfg.key) return _modPromise;

  if (_modReady && _activeBackend?.key !== cfg.key) {
    resetActiveBackend();
  }

  _pendingBackendKey = cfg.key;

  _modPromise = (async () => {
    await _warmup;
    await loadScript(cfg.stdlibUrl);
    await loadScript(cfg.backendUrl);

    const state = getBackendState(cfg);
    if (!state) {
      throw new Error(`[mini] backend state not found for ${cfg.key}`);
    }
    if (state.notReady) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('[mini] module init timeout')), 25000);
        const origCb = state.adapterCallback;
        state.adapterCallback = function () {
          clearTimeout(t);
          if (typeof origCb === 'function') origCb.call(this);
          resolve();
        };
      });
    }

    const Ctor = window[cfg.adapterCtor];
    if (typeof Ctor !== 'function') {
      throw new Error(`[mini] ${cfg.adapterCtor} not defined`);
    }

    try {
      _adapter = new Ctor(...cfg.adapterArgs);
    } catch (_) {
      _adapter = new Ctor();
    }

    _mod = _adapter.Module;
    if (!_mod) throw new Error('[mini] adapter module missing');

    if (typeof _mod.FS_createDataFile !== 'function' && typeof _mod.FS?.createDataFile === 'function') {
      _mod.FS_createDataFile = _mod.FS.createDataFile.bind(_mod.FS);
    }

    installFileRequestCallback(_mod);

    _activeBackend = cfg;
    _modReady = true;
  })();

  try {
    await _modPromise;
  } finally {
    _pendingBackendKey = null;
    _modPromise = null;
  }
}

function teardownNode() {
  if (_node) {
    _node.onaudioprocess = null;
    try { _node.disconnect(); } catch (_) {}
    _node = null;
  }
}

function ensureAudioCtx() {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext({ sampleRate: 44100 });
    _gain = _ctx.createGain();
    _gain.gain.value = clamp01(_volume);
    _gain.connect(_ctx.destination);
  }
}

function buildNode() {
  teardownNode();
  const M = _mod;
  const node = _ctx.createScriptProcessor(8192, 0, 2);

  function fetchChunk() {
    const status = _adapter.computeAudioSamples();
    const ptr = _adapter.getAudioBuffer();
    const len = _adapter.getAudioBufferLength();

    if (status !== 0) return { status, frames: 0, chunk: null };

    const base = ptr;
    const frames = len;
    if (frames <= 0) return { status, frames: 0, chunk: null };

    const heap = M.HEAP16;
    const end = base + frames * 2;
    if (base < 0 || end > heap.length) return { status, frames: 0, chunk: null };

    const out = new Float32Array(frames * 2);
    for (let i = 0; i < frames * 2; i++) {
      out[i] = heap[base + i] / 32768;
    }
    return { status, frames, chunk: out };
  }

  node.onaudioprocess = (e) => {
    const L = e.outputBuffer.getChannelData(0);
    const R = e.outputBuffer.getChannelData(1);
    if (!_playing) { L.fill(0); R.fill(0); return; }

    let filled = 0;
    while (filled < L.length) {
      if (!_chunk || _chunkPos >= _chunkFrames) {
        const fetched = fetchChunk();
        if (!fetched.chunk) {
          if (fetched.status !== 0) {
            _playing = false;
            for (let i = filled; i < L.length; i++) { L[i] = 0; R[i] = 0; }
            if (fetched.status > 0) _onEnd?.();
            return;
          }
          for (let i = filled; i < L.length; i++) { L[i] = 0; R[i] = 0; }
          break;
        }
        _chunk = fetched.chunk;
        _chunkFrames = fetched.frames;
        _chunkPos = 0;
      }

      const avail = _chunkFrames - _chunkPos;
      const take = Math.min(avail, L.length - filled);
      const base = _chunkPos * 2;
      for (let i = 0; i < take; i++) {
        L[filled + i] = _chunk[base + i * 2];
        R[filled + i] = _chunk[base + i * 2 + 1];
      }
      _chunkPos += take;
      _framePos += take;
      filled += take;
    }
  };

  node.connect(_gain);
  _node = node;
}

async function loadMini(url, sourceUrl, ext, gen) {
  await ensureModule(ext);
  if (gen !== _loadGen) throw new Error('load superseded');
  _currentLoadExt = ext;
  _requestDebugCount = 0;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`[mini] fetch failed: HTTP ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (gen !== _loadGen) throw new Error('load superseded');

  clearRegisteredVfsFiles(_mod);

  const preload = await preloadMiniLibraries(sourceUrl || url, data, _mod, gen);
  if (gen !== _loadGen) throw new Error('load superseded');

  let fname = `track.${ext}`;
  try {
    const srcHref = new URL(sourceUrl || url, window.location.href).href;
    const srcPath = normalizeVfsPath(new URL(srcHref).pathname);
    const srcBase = srcPath.split('/').pop() || '';
    if (srcBase) fname = srcBase;
  } catch (_) {}

  registerVfsFile(_mod, fname, data);

  if (ext === 'minigsf') {
    await preloadGuessedGsfLibs(sourceUrl || url, data, fname, _mod, gen);
    if (gen !== _loadGen) throw new Error('load superseded');
  }

  const sr = Math.round(_ctx.sampleRate) || 44100;
  _sr = sr;
  let loadRet = _adapter.loadMusicData(sr, '/', fname, data, {});
  const gsfAttempts = [];

  // Some GSF builds are sensitive to path and extension conventions.
  if (loadRet !== 0 && ext === 'minigsf') {
    const candidates = [];
    const gsfName = fname.toLowerCase().endsWith('.minigsf')
      ? fname.slice(0, -'.minigsf'.length) + '.gsf'
      : fname;

    if (gsfName !== fname) {
      registerVfsFile(_mod, gsfName, data);
      candidates.push(['/', gsfName]);
      candidates.push(['', gsfName]);
    }
    candidates.push(['', fname]);

    for (const [path, file] of candidates) {
      const ret = _adapter.loadMusicData(sr, path, file, data, {});
      gsfAttempts.push(`${path || '(empty)'}/${file}`);
      console.log('[mini] loadMusicData fallback:', ret, '| path:', path || '(empty)', '| file:', file);
      if (ret === 0) {
        loadRet = 0;
        fname = file;
        break;
      }
      loadRet = ret;
    }
  }

  console.log('[mini] loadMusicData returned:', loadRet, '| data.length:', data.length, '| sr:', sr);
  if (loadRet !== 0) {
    const suffix = preload?.missing?.length
      ? `; missing libs: ${preload.missing.join(', ')}`
      : '';
    if (ext === 'minigsf' && !preload?.missing?.length) {
      const attempts = gsfAttempts.length ? `; tried: ${gsfAttempts.join(', ')}` : '';
      throw new Error(`[mini] emu_init failed (${loadRet}) for ${fname}; backend_gsf rejected this minigsf sample (or variant not supported)${attempts}`);
    }
    throw new Error(`[mini] emu_init failed (${loadRet}) for ${fname}${suffix}`);
  }

  try {
    if (typeof _adapter.evalTrackOptions === 'function') {
      const optRet = _adapter.evalTrackOptions({});
      if (optRet < 0) throw new Error(`[mini] evalTrackOptions failed (${optRet})`);
    }
  } catch (e) {
    throw new Error(e?.message || String(e));
  }

  _framePos = 0;
  _chunk = null;
  _chunkFrames = 0;
  _chunkPos = 0;

  const maxPos = Number(_adapter.getMaxPlaybackPosition?.()) || 0;
  _duration = maxPos > 0
    ? (backendUsesMilliseconds() ? maxPos / 1000 : maxPos / _sr)
    : 300;

  if (_ctx.state === 'suspended') {
    try { await _ctx.resume(); } catch (_) {}
  }

  buildNode();
  _playing = true;

  return {
    fields: [
      { label: 'Engine', value: 'MINI' },
      { label: 'Title', value: '—' },
      { label: 'Type', value: ext.toUpperCase() },
      { label: 'Tracker', value: 'HighlyExperimental' },
    ],
    duration: _duration,
  };
}

export async function init() {
  // Warmup runs at module load time; avoid pinning to a single backend here.
}

export async function load(url, entry) {
  const ext = resolveExt(url, entry);
  if (!isMiniExt(ext)) {
    throw new Error(`Unsupported extension for mini engine: .${ext || 'unknown'}`);
  }
  if (!MINI_EXTS_SUPPORTED.has(ext)) {
    throw new Error(`[mini] .${ext} is not supported by current mini backend (supports: minipsf, minipsf2, minigsf)`);
  }

  const gen = ++_loadGen;
  ensureAudioCtx();
  const sourceUrl = entry?.url || url;
  const result = await loadMini(url, sourceUrl, ext, gen);
  if (gen !== _loadGen) throw new Error('load superseded');
  return result;
}

export function pause() {
  _playing = false;
}

export function resume() {
  if (_ctx?.state === 'suspended') _ctx.resume().catch(() => {});
  _playing = true;
}

export function seekTo(sec) {
  const t = Math.max(0, Number(sec) || 0);
  if (!_adapter) return;
  _framePos = Math.max(0, Math.round(t * _sr));
  const pos = backendUsesMilliseconds()
    ? Math.round(t * 1000)
    : Math.round(t * _sr);
  try { _adapter.seekPlaybackPosition(pos); } catch (_) {}
}

export function getTime() {
  if (!_adapter) return 0;
  try {
    const backendPos = Number(_adapter.getPlaybackPosition()) || 0;
    const backendSec = backendUsesMilliseconds()
      ? backendPos / 1000
      : backendPos / _sr;
    return Math.max(backendSec, _framePos / _sr);
  } catch (_) {
    return _framePos / _sr;
  }
}

export function setVolume(v) {
  _volume = clamp01(v);
  if (_gain) _gain.gain.value = _volume;
}

export function isEnded() {
  return false;
}

export function onEnd(cb) {
  _onEnd = cb;
}

export function destroy() {
  teardownNode();
  if (_adapter) {
    try { _adapter.teardown?.(); } catch (_) {}
  }
  if (_mod) clearRegisteredVfsFiles(_mod);
  _playing = false;
  _framePos = 0;
  _chunk = null;
  _chunkFrames = 0;
  _chunkPos = 0;
}

export function isContextSuspended() {
  return _ctx?.state === 'suspended';
}

export async function attemptContextResume() {
  if (_ctx?.state === 'suspended') {
    try { await _ctx.resume(); } catch (_) {}
  }
}
