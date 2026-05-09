// MINI engine adapter for mini-PSF style formats.
// Uses Wothke's HighlyExperimental backend (backend_psx.js), which can
// decode PSF-family containers such as mini2sf/minigsf/miniusf/minissf.
import { clamp01, loadScript, resolveExt } from '../shared.js';

const MINI_STDLIB_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/chiptune-collection@master/blaster/stdlib/scriptprocessor_player.min.js';
const MINI_PSX_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/chiptune-collection@master/blaster/backend_psx.js';
const MINI_LIB_STDLIB_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/chiptune-collection@master/library/scriptprocessor_player.min.js';
const MINI_GSF_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/chiptune-collection@master/library/JS/backend_gsf.js';
const MINI_NEZ_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/chiptune-collection@master/library/JS/backend_nez.js';
const MINI_N64_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/chiptune-collection@master/library/JS/backend_n64.js';
const MINI_SEGA_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/chiptune-collection@master/library/JS/backend_sega.js';
const MINI_EXTS = new Set(['mini2sf', 'minigsf', 'minipsf', 'miniusf', 'minipsf2', 'minissf']);

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

const BACKEND_NEZ = {
  key: 'nez',
  stdlibUrl: MINI_LIB_STDLIB_JS_URL,
  backendUrl: MINI_NEZ_JS_URL,
  stateKeys: ['spp_backend_state_NEZ'],
  adapterCtor: 'NEZBackendAdapter',
  adapterArgs: [true],
};

const BACKEND_N64 = {
  key: 'n64',
  stdlibUrl: MINI_LIB_STDLIB_JS_URL,
  backendUrl: MINI_N64_JS_URL,
  stateKeys: ['spp_backend_state_N64'],
  adapterCtor: 'N64BackendAdapter',
  adapterArgs: [true],
};

const BACKEND_SEGA = {
  key: 'sega',
  stdlibUrl: MINI_LIB_STDLIB_JS_URL,
  backendUrl: MINI_SEGA_JS_URL,
  stateKeys: ['spp_backend_state_SEGA'],
  adapterCtor: 'SEGABackendAdapter',
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
let _fallbackEngine = null;
let _fallbackActive = false;
let _timeUnit = 'samples';
let _unitsPerSecond = 44100;
let _loadedTrackName = '';
let _loadedTrackData = null;
let _seekGraceUntil = 0;
let _framesSinceSeek = 0;
let _seekTargetUnits = -1;

function backendUsesMilliseconds() {
  return _timeUnit === 'ms';
}

async function getVgmFallbackEngine() {
  if (_fallbackEngine) return _fallbackEngine;
  const mod = await import('../vgm/engine.js');
  await mod.init();
  mod.setVolume(_volume);
  if (typeof _onEnd === 'function') mod.onEnd(_onEnd);
  _fallbackEngine = mod;
  return _fallbackEngine;
}

const _warmup = (async () => {
  try {
    await Promise.all([
      loadScript(MINI_STDLIB_JS_URL),
      loadScript(MINI_PSX_JS_URL),
      loadScript(MINI_LIB_STDLIB_JS_URL),
      loadScript(MINI_GSF_JS_URL),
      loadScript(MINI_NEZ_JS_URL),
      loadScript(MINI_N64_JS_URL),
      loadScript(MINI_SEGA_JS_URL),
    ]);
  } catch (_) {}
})();

function backendForExt(ext) {
  if (ext === 'minipsf' || ext === 'minipsf2') return BACKEND_PSX;
  if (ext === 'minigsf') return BACKEND_GSF;
  if (ext === 'mini2sf') return BACKEND_NEZ;
  if (ext === 'miniusf') return BACKEND_N64;
  if (ext === 'minissf') return BACKEND_SEGA;
  return null;
}

function backendCandidatesForExt(ext) {
  if (ext === 'minipsf' || ext === 'minipsf2') return [BACKEND_PSX];
  if (ext === 'minigsf') return [BACKEND_GSF];
  // mini2sf = Nintendo DS Sound Format. chiptune-collection has no 2sf/vio2sf
  // backend; NEZ is NES (8-bit Famicom) and is not interchangeable. Return
  // empty so load() reports a clear unsupported-format error.
  if (ext === 'mini2sf') return [];
  if (ext === 'miniusf') return [BACKEND_N64];
  if (ext === 'minissf') return [BACKEND_SEGA];
  return [];
}

function parseTagDurations(data) {
  const out = { length: 0, fade: 0 };
  if (!(data instanceof Uint8Array) || data.length < 16) return out;
  if (!(data[0] === 0x50 && data[1] === 0x53 && data[2] === 0x46)) return out;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const reservedSize = dv.getUint32(4, true);
  const compressedSize = dv.getUint32(8, true);
  const tagOffset = 16 + reservedSize + compressedSize;
  if (tagOffset >= data.length) return out;

  const tags = new TextDecoder('utf-8').decode(data.subarray(tagOffset));
  const tagPos = tags.indexOf('[TAG]');
  if (tagPos < 0) return out;

  const parseDur = (raw) => {
    const m = String(raw).trim().match(/^(?:(\d+):)?(\d+)(?:\.(\d+))?$/);
    if (!m) {
      // Fade may also be plain seconds like "10.000".
      const n = Number(String(raw).trim());
      return isFinite(n) && n >= 0 ? n : 0;
    }
    const min = Number(m[1] || 0);
    const sec = Number(m[2] || 0);
    const frac = Number(`0.${m[3] || '0'}`);
    const total = min * 60 + sec + frac;
    return isFinite(total) && total >= 0 ? total : 0;
  };

  const lines = tags.substring(tagPos + 5).split(/\r?\n/);
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.substring(0, eq).trim().toLowerCase();
    if (key === 'length') out.length = parseDur(line.substring(eq + 1));
    else if (key === 'fade') out.fade = parseDur(line.substring(eq + 1));
  }
  return out;
}

function parseTagLengthSeconds(data) {
  return parseTagDurations(data).length;
}

function chooseTimeUnit(ext, maxPos, sampleRate, taggedLengthSec) {
  if (ext !== 'minigsf') return 'samples';
  if (!(maxPos > 0)) return 'ms';

  const asMs = maxPos / 1000;
  const asSamples = maxPos / sampleRate;
  if (taggedLengthSec > 0) {
    const errMs = Math.abs(asMs - taggedLengthSec);
    const errSamples = Math.abs(asSamples - taggedLengthSec);
    return errMs <= errSamples ? 'ms' : 'samples';
  }

  // Heuristic fallback: miniGSF lengths in ms are usually in human-scale range.
  return maxPos < 500000 ? 'ms' : 'samples';
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

  // Try fetching with the original-cased basename first; on 404, retry with
  // the basename lowercased. Modland's filesystem is case-sensitive but PSF
  // tags routinely reference the uppercase form (e.g. SOUND.DPK_SEP0.psflib
  // while the file on disk is sound.dpk_sep0.psflib).
  const tryFetchWithCaseFallback = async (libPath, libUrl) => {
    let res;
    try { res = await fetch(libUrl); }
    catch (e) {
      // Network/CORS; try lowercase variant before giving up.
      try {
        const alt = lowercaseBasenameUrl(libUrl);
        if (alt && alt !== libUrl) {
          const r2 = await fetch(alt);
          if (r2.ok) return { res: r2, libPath: lowercaseBasename(libPath), libUrl: alt };
        }
      } catch (_) {}
      return { error: e && e.message ? e.message : 'fetch failed' };
    }
    if (!res.ok && res.status === 404) {
      const alt = lowercaseBasenameUrl(libUrl);
      if (alt && alt !== libUrl) {
        try {
          const r2 = await fetch(alt);
          if (r2.ok) return { res: r2, libPath: lowercaseBasename(libPath), libUrl: alt };
        } catch (_) {}
      }
    }
    return { res, libPath, libUrl };
  };

  const walk = async (fileUrl, fileData, fallbackBaseUrl = rootAbsUrl) => {
    if (gen !== _loadGen) throw new Error('load superseded');
    const libs = parsePsfLibRefs(fileData);
    for (const libPathOrig of libs) {
      const libUrlOrig = resolveLibUrl(libPathOrig, fileUrl || fallbackBaseUrl);
      if (visited.has(libUrlOrig)) continue;
      visited.add(libUrlOrig);

      const r = await tryFetchWithCaseFallback(libPathOrig, libUrlOrig);
      if (r.error) { missing.push(`${libPathOrig} (${r.error})`); continue; }
      if (!r.res || !r.res.ok) { missing.push(`${libPathOrig} (HTTP ${r.res?.status ?? '?'})`); continue; }
      const bytes = new Uint8Array(await r.res.arrayBuffer());
      // Register under BOTH the originally referenced path and the resolved
      // (possibly lowercased) path so the backend finds it regardless of
      // which casing it requests via the file callback.
      registerVfsFile(mod, libPathOrig, bytes);
      if (r.libPath !== libPathOrig) {
        try { registerVfsFile(mod, r.libPath, bytes); } catch (_) {}
      }
      await walk(r.libUrl, bytes, fallbackBaseUrl);
    }
  };

  await walk(rootAbsUrl, mainData, rootAbsUrl);
  return { missing };
}

function lowercaseBasename(p) {
  const s = String(p || '');
  const i = s.lastIndexOf('/');
  if (i < 0) return s.toLowerCase();
  return s.substring(0, i + 1) + s.substring(i + 1).toLowerCase();
}

function lowercaseBasenameUrl(u) {
  try {
    const url = new URL(u);
    const path = url.pathname;
    const i = path.lastIndexOf('/');
    if (i < 0) return null;
    const base = path.substring(i + 1);
    const baseLower = base.toLowerCase();
    if (base === baseLower) return null;
    url.pathname = path.substring(0, i + 1) + baseLower;
    return url.href;
  } catch (_) { return null; }
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

async function ensureModule(ext, forcedCfg = null) {
  const cfg = forcedCfg || backendForExt(ext);
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

    // Some adapters report positive status codes while still exposing valid
    // output buffers. Only treat status as terminal when no frames are available.
    if (status !== 0 && (!len || len <= 0)) return { status, frames: 0, chunk: null };

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

    // Seek catch-up: while the backend is fast-forwarding to the requested
    // position it still produces audio. Drain those frames but emit silence
    // so the user does not hear a sped-up replay or a frozen last frame.
    // Exit only when BOTH (a) backend position has reached the target AND
    // (b) computeAudioSamples returns a clean status==0 frame. GSF in
    // particular snaps emu_get_current_position to the target instantly but
    // continues to recycle a stale audio buffer (status > 0) for a few more
    // callbacks while it fast-forwards internally; rendering that buffer
    // would loop the same audio fragment.
    if (_seekTargetUnits >= 0) {
      let pos = 0;
      let exited = false;
      for (let drains = 0; drains < 8; drains++) {
        const status = _adapter.computeAudioSamples();
        const len = Number(_adapter.getAudioBufferLength?.()) || 0;
        try { pos = Number(_mod?.ccall('emu_get_current_position', 'number')) || 0; } catch (_) {}
        if (pos >= _seekTargetUnits && status === 0 && len > 0) {
          _seekTargetUnits = -1;
          exited = true;
          break;
        }
      }
      if (!exited) {
        L.fill(0); R.fill(0);
        _chunk = null; _chunkFrames = 0; _chunkPos = 0;
        return;
      }
      // Discard any stale chunk state so the main loop fetches fresh audio.
      _chunk = null; _chunkFrames = 0; _chunkPos = 0;
    }

    let filled = 0;
    while (filled < L.length) {
      if (!_chunk || _chunkPos >= _chunkFrames) {
        const fetched = fetchChunk();
        if (!fetched.chunk) {
          // Treat non-zero status as track-end ONLY when we have actually
          // produced frames since the last seek/load AND backend reports a
          // position near the song duration. Otherwise it's a transient
          // (post-seek silent fast-forward, buffer underrun) and we emit
          // silence to keep the audio graph alive.
          let realEnd = false;
          if (fetched.status > 0 && _framesSinceSeek > _sr / 4) {
            try {
              const pos = Number(_adapter.getPlaybackPosition?.()) || 0;
              const posSec = pos / (_unitsPerSecond || _sr);
              if (_duration > 0 && posSec >= _duration - 1.0) realEnd = true;
              else if (_duration <= 0) realEnd = true;
            } catch (_) { realEnd = true; }
          }
          const inGrace = performance.now() < _seekGraceUntil;
          if (fetched.status !== 0 && realEnd && !inGrace) {
            _playing = false;
            for (let i = filled; i < L.length; i++) { L[i] = 0; R[i] = 0; }
            _onEnd?.();
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
      _framesSinceSeek += take;
      filled += take;
    }
  };

  node.connect(_gain);
  _node = node;
}

async function loadMini(url, sourceUrl, ext, gen, forcedCfg = null) {
  await ensureModule(ext, forcedCfg);
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
  _loadedTrackName = fname;
  _loadedTrackData = data;

  if (ext === 'minigsf') {
    await preloadGuessedGsfLibs(sourceUrl || url, data, fname, _mod, gen);
    if (gen !== _loadGen) throw new Error('load superseded');
  }

  const sr = Math.round(_ctx.sampleRate) || 44100;
  _sr = sr;
  _timeUnit = 'samples';
  _unitsPerSecond = _sr;
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
  if (loadRet < 0) {
    const suffix = preload?.missing?.length
      ? `; missing libs: ${preload.missing.join(', ')}`
      : '';
    if (ext === 'minigsf' && !preload?.missing?.length) {
      const attempts = gsfAttempts.length ? `; tried: ${gsfAttempts.join(', ')}` : '';
      throw new Error(`[mini] emu_init failed (${loadRet}) for ${fname}; backend_gsf rejected this minigsf sample (or variant not supported)${attempts}`);
    }
    throw new Error(`[mini] emu_init failed (${loadRet}) for ${fname}${suffix}`);
  }

  if (loadRet > 0) {
    console.warn('[mini] non-zero successful load code:', loadRet, '| ext:', ext);
  }

  try {
    if (typeof _adapter.evalTrackOptions === 'function') {
      const optRet = _adapter.evalTrackOptions({});
      if (optRet < 0) {
        console.warn(`[mini] evalTrackOptions returned ${optRet} (continuing)`);
      }
    }
  } catch (e) {
    console.warn('[mini] evalTrackOptions threw (continuing):', e?.message || String(e));
  }

  _framePos = 0;
  _chunk = null;
  _chunkFrames = 0;
  _chunkPos = 0;
  _framesSinceSeek = 0;

  const maxPos = Number(_adapter.getMaxPlaybackPosition?.()) || 0;
  const tagDur = parseTagDurations(data);
  const taggedLength = tagDur.length;
  const taggedFade = tagDur.fade;
  if (taggedLength > 0 && maxPos > 0) {
    // Most reliable: derive backend position scale from tag length.
    _unitsPerSecond = maxPos / taggedLength;
    _timeUnit = 'derived';
    // PSF spec: track plays for `length` then fades over `fade`. Backend's
    // maxPos typically reflects only `length`, so include fade in the user-
    // facing duration. unitsPerSecond stays based on length alone so seek
    // position math matches the backend's units.
    _duration = taggedLength + taggedFade;
  } else {
    _timeUnit = chooseTimeUnit(ext, maxPos, _sr, taggedLength);
    _unitsPerSecond = backendUsesMilliseconds() ? 1000 : _sr;
    _duration = maxPos > 0
      ? (maxPos / _unitsPerSecond + taggedFade)
      : 300;
  }
  console.log('[mini] timing scale | ext:', ext, '| maxPos:', maxPos, '| taggedLength:', taggedLength, '| unitsPerSecond:', _unitsPerSecond, '| duration:', _duration);

  if (_ctx.state === 'suspended') {
    try { await _ctx.resume(); } catch (_) {}
  }

  const probeStatus = _adapter.computeAudioSamples();
  const probeLen = Number(_adapter.getAudioBufferLength?.()) || 0;
  if (probeStatus !== 0 && probeLen <= 0) {
    throw new Error(`[mini] decoder produced no audio (status ${probeStatus}, len ${probeLen})`);
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

  const gen = ++_loadGen;
  _fallbackActive = false;
  ensureAudioCtx();
  const sourceUrl = entry?.url || url;
  let result;
  const candidates = backendCandidatesForExt(ext);
  const backendErrors = [];
  if (candidates.length === 0) {
    if (ext === 'mini2sf') {
      throw new Error('[mini] .mini2sf (Nintendo DS Sound Format) is not supported: chiptune-collection has no 2sf/vio2sf backend.');
    }
    throw new Error(`[mini] no backend available for .${ext}`);
  }
  try {
    for (const cfg of candidates) {
      try {
        result = await loadMini(url, sourceUrl, ext, gen, cfg);
        break;
      } catch (e) {
        backendErrors.push(`[${cfg.key}] ${e?.message || e}`);
      }
    }
    if (!result) {
      throw new Error(`[mini] all native backends failed for .${ext}: ${backendErrors.join(' | ')}`);
    }
  } catch (e) {
    // For non-PSF mini families, attempt VGM fallback if native backend fails.
    if (ext !== 'minipsf' && ext !== 'minipsf2' && ext !== 'minigsf') {
      const fallback = await getVgmFallbackEngine();
      _fallbackActive = true;
      _playing = false;
      teardownNode();
      if (_adapter) {
        try { _adapter.teardown?.(); } catch (_) {}
      }
      const fb = await fallback.load(url, entry);
      return {
        ...fb,
        fields: Array.isArray(fb?.fields)
          ? fb.fields.map((f) => f.label === 'Engine' ? { ...f, value: `${f.value} (mini fallback)` } : f)
          : fb?.fields,
      };
    }
    throw e;
  }
  if (gen !== _loadGen) throw new Error('load superseded');
  return result;
}

export function pause() {
  if (_fallbackActive) {
    try { _fallbackEngine?.pause?.(); } catch (_) {}
    return;
  }
  _playing = false;
}

export function resume() {
  if (_fallbackActive) {
    try { _fallbackEngine?.resume?.(); } catch (_) {}
    return;
  }
  if (_ctx?.state === 'suspended') _ctx.resume().catch(() => {});
  _playing = true;
}

export function seekTo(sec) {
  if (_fallbackActive) {
    try { return _fallbackEngine?.seekTo?.(sec); } catch (_) { return false; }
  }
  const t = Math.max(0, Number(sec) || 0);
  if (!_adapter || !_mod) return;
  _framePos = Math.max(0, Math.round(t * _sr));
  _chunk = null;
  _chunkFrames = 0;
  _chunkPos = 0;
  _framesSinceSeek = 0;
  const primaryPos = Math.round(t * (_unitsPerSecond || _sr));
  // The Wothke adapters' seekPlaybackPosition() requires a ScriptNodePlayer
  // singleton (they call ScriptNodePlayer.getInstance().getVolume()). We use
  // our own ScriptProcessorNode and never instantiate ScriptNodePlayer, so
  // calling the adapter wrapper silently throws. Instead, invoke the wasm
  // exports directly via Module.ccall — same primitives the wrappers use.
  try {
    let backendPos = 0;
    try { backendPos = Number(_mod.ccall('emu_get_current_position', 'number')) || 0; } catch (_) {}
    const isBackward = primaryPos < backendPos;
    if (isBackward && _loadedTrackName) {
      // PSX/GSF: backward seek requires emu_init reload before emu_seek_position.
      try {
        _mod.ccall('emu_init', 'number', ['string', 'string'], ['/', _loadedTrackName]);
      } catch (_) {
        // Fall back to adapter loadMusicData if direct ccall fails.
        try { _adapter.loadMusicData(_sr, '/', _loadedTrackName, _loadedTrackData, {}); } catch (_) {}
      }
    }
    try {
      _mod.ccall('emu_seek_position', 'number', ['number'], [primaryPos]);
      _seekTargetUnits = primaryPos;
    } catch (_) {
      // Last-ditch fallback to adapter wrapper (will likely throw silently).
      try { _adapter.seekPlaybackPosition?.(primaryPos); _seekTargetUnits = primaryPos; } catch (_) {}
    }
  } catch (_) {}
  // Grace window: backends fast-forward by emitting silence in
  // computeAudioSamples() until the target is reached. We must not interpret
  // that silence as track-end.
  _seekGraceUntil = performance.now() + 1500;
}

export function getTime() {
  if (_fallbackActive) {
    try { return Number(_fallbackEngine?.getTime?.()) || 0; } catch (_) { return 0; }
  }
  if (!_adapter) return 0;
  try {
    const backendPos = Number(_adapter.getPlaybackPosition()) || 0;
    const backendSec = backendPos / (_unitsPerSecond || _sr);
    return Math.max(backendSec, _framePos / _sr);
  } catch (_) {
    return _framePos / _sr;
  }
}

export function setVolume(v) {
  _volume = clamp01(v);
  if (_fallbackEngine) {
    try { _fallbackEngine.setVolume?.(_volume); } catch (_) {}
  }
  if (_gain) _gain.gain.value = _volume;
}

export function isEnded() {
  return false;
}

export function onEnd(cb) {
  _onEnd = cb;
  if (_fallbackEngine) {
    try { _fallbackEngine.onEnd?.(cb); } catch (_) {}
  }
}

export function destroy() {
  if (_fallbackEngine) {
    try { _fallbackEngine.destroy?.(); } catch (_) {}
  }
  _fallbackActive = false;
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
  _loadedTrackName = '';
  _loadedTrackData = null;
}

export function isContextSuspended() {
  if (_fallbackActive) {
    try { return !!_fallbackEngine?.isContextSuspended?.(); } catch (_) { return false; }
  }
  return _ctx?.state === 'suspended';
}

export async function attemptContextResume() {
  if (_fallbackActive) {
    try {
      await _fallbackEngine?.attemptContextResume?.();
      return;
    } catch (_) {}
  }
  if (_ctx?.state === 'suspended') {
    try { await _ctx.resume(); } catch (_) {}
  }
}
