// VGM/VGZ engine adapter via wothke/vgmplay-0.40.9.
import { clamp01, loadScript, resolveExt } from '../shared.js';

const VGM_STDLIB_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/vgmplay-0.40.9@master/emscripten/htdocs/stdlib/scriptprocessor_player.min.js';
const VGM_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/vgmplay-0.40.9@master/emscripten/htdocs/backend_vgm.js';
const VGM_ENGINE_PATCH = 'vgm-2026-05-07-split-c';
const MINI_EXTS = new Set(['mini2sf', 'minigsf', 'minipsf', 'miniusf', 'minipsf2', 'minissf']);

let _onEnd = null;
let _volume = 1;
let _loadGen = 0;

let _vgmAdapter = null;
let _vgmMod = null;
let _vgmModReady = false;
let _vgmModPromise = null;
let _vgmCtx = null;
let _vgmGain = null;
let _vgmNode = null;
let _vgmPlaying = false;
let _vgmDuration = 0;
let _vgmSR = 44100;
let _vgmFileReg = null;
let _vgmRegisteredFiles = new Set();
let _vgmDbgLogged = false;
let _vgmAmpLogged = false;
let _vgmFramePos = 0;
let _vgmChunk = null;
let _vgmChunkFrames = 0;
let _vgmChunkPos = 0;
let _vgmLastExt = '';

const VGM_INI = '; minimal retrotrap config\n[General]\nSampleRate=44100\n';

function vgmPosUsesMilliseconds() {
  return MINI_EXTS.has(_vgmLastExt);
}

const _vgmWarmup = (async () => {
  try {
    await loadScript(VGM_STDLIB_JS_URL);
    await loadScript(VGM_JS_URL);
  } catch (_) {}
})();

function _vgmFs() {
  return (
    window.backend_vgmPlay?.FS ??
    window.spp_backend_state_VGM?.FS ??
    window.FS ?? null
  );
}

function vgmFsCreateDataFile(mod, dir, name, data, canRead, canWrite, canOwn) {
  const fs = _vgmFs();
  if (fs?.createDataFile) {
    return fs.createDataFile(dir, name, data, canRead, canWrite, canOwn);
  }
  const fn = mod?.FS_createDataFile ??
    window.backend_vgmPlay?.FS_createDataFile ??
    window.spp_backend_state_VGM?.FS_createDataFile;
  if (typeof fn === 'function') {
    return fn(dir, name, data, canRead, canWrite, canOwn);
  }
  throw new Error('[vgm] createDataFile API unavailable');
}

function vgmFsUnlink(mod, path) {
  const fs = _vgmFs();
  if (fs?.unlink) return fs.unlink(path);
  const fn = mod?.FS_unlink ??
    window.backend_vgmPlay?.FS_unlink ??
    window.spp_backend_state_VGM?.FS_unlink;
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

function ensureVfsDir(mod, absDir) {
  const fs = _vgmFs();
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
  if (!rel) throw new Error('[vgm] empty virtual path');

  const slash = rel.lastIndexOf('/');
  const dir = slash >= 0 ? ('/' + rel.substring(0, slash)) : '/';
  const name = slash >= 0 ? rel.substring(slash + 1) : rel;
  const abs = dir === '/' ? '/' + name : dir + '/' + name;

  ensureVfsDir(mod, dir);
  try { vgmFsUnlink(mod, abs); } catch (_) {}
  vgmFsCreateDataFile(mod, dir, name, data, true, true, true);
  _vgmRegisteredFiles.add(abs);
  return rel;
}

function clearRegisteredVfsFiles(mod) {
  for (const p of _vgmRegisteredFiles) {
    try { vgmFsUnlink(mod, p); } catch (_) {}
  }
  _vgmRegisteredFiles.clear();
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

async function preloadMiniLibraries(mainUrl, mainData, mod, gen) {
  const visited = new Set();

  const walk = async (fileUrl, fileData) => {
    if (gen !== _loadGen) throw new Error('load superseded');
    const libs = parsePsfLibRefs(fileData);
    for (const libPath of libs) {
      const libUrl = resolveLibUrl(libPath, fileUrl || mainUrl);
      if (visited.has(libUrl)) continue;
      visited.add(libUrl);

      const res = await fetch(libUrl);
      if (!res.ok) {
        throw new Error(`[vgm] mini lib fetch failed: ${libPath} (HTTP ${res.status})`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      registerVfsFile(mod, libPath, bytes);
      await walk(libUrl, bytes);
    }
  };

  await walk(mainUrl, mainData);
}

async function ensureVgmModule() {
  if (_vgmModReady) return;
  if (_vgmModPromise) return _vgmModPromise;

  _vgmModPromise = (async () => {
    try {
      await _vgmWarmup;
      await loadScript(VGM_STDLIB_JS_URL);
      await loadScript(VGM_JS_URL);

      if (!window.spp_backend_state_VGM) {
        throw new Error('[vgm] spp_backend_state_VGM not found');
      }
      if (window.spp_backend_state_VGM.notReady) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('[vgm] module init timeout')), 25000);
          const origCb = window.spp_backend_state_VGM.adapterCallback;
          window.spp_backend_state_VGM.adapterCallback = function () {
            clearTimeout(t);
            if (typeof origCb === 'function') origCb.call(this);
            resolve();
          };
        });
      }

      if (typeof window.VgmBackendAdapter !== 'function') {
        throw new Error('[vgm] VgmBackendAdapter not defined');
      }
      _vgmAdapter = new window.VgmBackendAdapter();
      _vgmMod = _vgmAdapter.Module;
      if (!_vgmMod) {
        throw new Error('[vgm] VgmBackendAdapter.Module not set');
      }

      if (typeof _vgmMod.FS_createDataFile !== 'function' && typeof _vgmMod.FS?.createDataFile === 'function') {
        _vgmMod.FS_createDataFile = _vgmMod.FS.createDataFile.bind(_vgmMod.FS);
      }

      try {
        const ini = new TextEncoder().encode(VGM_INI);
        vgmFsCreateDataFile(_vgmMod, '/', 'VGMPlay.ini', ini, true, true, true);
      } catch (e) {
        console.warn('[vgm] VGMPlay.ini injection failed (non-fatal):', e.message);
      }

      _vgmModReady = true;
    } catch (e) {
      _vgmModPromise = null;
      _vgmAdapter = null;
      _vgmMod = null;
      throw e;
    }
  })();

  return _vgmModPromise;
}

async function decompressGzip(buffer) {
  if (!window.DecompressionStream) {
    throw new Error('VGZ playback requires DecompressionStream (Chrome 80+, Firefox 113+, Safari 16.4+)');
  }
  const src = new ReadableStream({
    start(ctrl) { ctrl.enqueue(new Uint8Array(buffer)); ctrl.close(); },
  });
  const reader = src.pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function parseVgmMeta(data) {
  if (data.length < 0x40) return {};
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  if (magic !== 'Vgm ') return {};

  const totalSamples = v.getUint32(0x18, true);
  const duration = totalSamples > 0 ? totalSamples / 44100 : 0;

  const gd3Rel = v.getUint32(0x14, true);
  if (!gd3Rel) return { duration };
  const gd3Abs = 0x14 + gd3Rel;
  if (gd3Abs + 12 >= data.length) return { duration };

  const gd3id = String.fromCharCode(
    v.getUint8(gd3Abs), v.getUint8(gd3Abs + 1),
    v.getUint8(gd3Abs + 2), v.getUint8(gd3Abs + 3));
  if (gd3id !== 'Gd3 ') return { duration };

  const gd3Len = v.getUint32(gd3Abs + 8, true);
  const dataStart = gd3Abs + 12;
  const dataEnd = Math.min(dataStart + gd3Len, data.length);

  const strs = [];
  let cur = '';
  for (let pos = dataStart; pos + 1 < dataEnd && strs.length < 9;) {
    const ch = v.getUint16(pos, true);
    pos += 2;
    if (ch === 0) { strs.push(cur); cur = ''; }
    else cur += String.fromCodePoint(ch);
  }

  return {
    duration,
    title: strs[0] || strs[1] || '',
    game: strs[2] || strs[3] || '',
    system: strs[4] || strs[5] || '',
    author: strs[6] || strs[7] || '',
    date: strs[8] || '',
  };
}

function teardownVgmNode() {
  if (_vgmNode) {
    _vgmNode.onaudioprocess = null;
    try { _vgmNode.disconnect(); } catch (_) {}
    _vgmNode = null;
  }
}

function buildVgmNode() {
  teardownVgmNode();
  const M = _vgmMod;
  const ctx = _vgmCtx;
  const node = ctx.createScriptProcessor(8192, 0, 2);

  function peakFromFloat(buf, frames, maxFrames) {
    const lim = Math.min(frames, maxFrames);
    let peakL = 0;
    let peakR = 0;
    for (let i = 0; i < lim; i++) {
      const sL = Math.abs((buf[i * 2] || 0) * 32767);
      const sR = Math.abs((buf[i * 2 + 1] || 0) * 32767);
      if (sL > peakL) peakL = sL;
      if (sR > peakR) peakR = sR;
    }
    return { peakL, peakR };
  }

  function fetchChunk() {
    const status = _vgmAdapter.computeAudioSamples();
    const ptr = _vgmAdapter.getAudioBuffer();
    const len = _vgmAdapter.getAudioBufferLength();

    if (!_vgmDbgLogged) {
      _vgmDbgLogged = true;
      console.log('[vgm] first onaudioprocess | status:', status, '| ptr:', ptr, '| len:', len);
    }

    // Any non-zero status = end of track (1) or error (<0); stop immediately.
    // status=1 is normal end: the adapter keeps returning the same buffer on
    // subsequent calls, which would cause an infinite loop if we read it.
    if (status !== 0) {
      return { status, frames: 0, chunk: null };
    }

    const base = ptr; // getAudioBuffer() returns Int16 index directly (EmsHEAP16BackendAdapter convention)
    const frames = len;
    if (frames <= 0) {
      return { status, frames: 0, chunk: null };
    }

    const heap = M.HEAP16;
    const end = base + frames * 2;
    if (base < 0 || end > heap.length) {
      return { status, frames: 0, chunk: null };
    }

    const out = new Float32Array(frames * 2);
    for (let i = 0; i < frames * 2; i++) {
      out[i] = heap[base + i] / 32768;
    }

    if (!_vgmAmpLogged && frames > 0) {
      _vgmAmpLogged = true;
      const p = peakFromFloat(out, frames, 8192);
      console.log('[vgm] first buffer peak | L:', p.peakL, '| R:', p.peakR, '| take:', Math.min(frames, 8192));
    }

    return { status, frames, chunk: out };
  }

  node.onaudioprocess = (e) => {
    const L = e.outputBuffer.getChannelData(0);
    const R = e.outputBuffer.getChannelData(1);
    if (!_vgmPlaying) { L.fill(0); R.fill(0); return; }

    let filled = 0;
    while (filled < L.length) {
      if (!_vgmChunk || _vgmChunkPos >= _vgmChunkFrames) {
        const fetched = fetchChunk();
        if (!fetched.chunk) {
          if (fetched.status !== 0) {
            _vgmPlaying = false;
            for (let i = filled; i < L.length; i++) { L[i] = 0; R[i] = 0; }
            if (fetched.status > 0) _onEnd?.(); // positive = normal track end
            return;
          }
          for (let i = filled; i < L.length; i++) { L[i] = 0; R[i] = 0; }
          break;
        }
        _vgmChunk = fetched.chunk;
        _vgmChunkFrames = fetched.frames;
        _vgmChunkPos = 0;
      }

      const avail = _vgmChunkFrames - _vgmChunkPos;
      const take = Math.min(avail, L.length - filled);
      const base = _vgmChunkPos * 2;
      for (let i = 0; i < take; i++) {
        L[filled + i] = _vgmChunk[base + i * 2];
        R[filled + i] = _vgmChunk[base + i * 2 + 1];
      }
      _vgmChunkPos += take;
      _vgmFramePos += take;
      filled += take;
    }
  };

  node.connect(_vgmGain);
  _vgmNode = node;
}

function ensureVgmAudioCtx() {
  if (!_vgmCtx || _vgmCtx.state === 'closed') {
    _vgmCtx = new AudioContext({ sampleRate: 44100 });
    _vgmGain = _vgmCtx.createGain();
    _vgmGain.gain.value = clamp01(_volume);
    _vgmGain.connect(_vgmCtx.destination);
  }
}

async function loadVgm(url, ext, gen, sourceUrl) {
  await ensureVgmModule();
  if (gen !== _loadGen) throw new Error('load superseded');
  console.log('[vgm] engine patch:', VGM_ENGINE_PATCH);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`VGM fetch failed: HTTP ${res.status}`);
  const raw = await res.arrayBuffer();
  if (gen !== _loadGen) throw new Error('load superseded');

  const data = ext === 'vgz' ? await decompressGzip(raw) : new Uint8Array(raw);
  if (gen !== _loadGen) throw new Error('load superseded');
  _vgmLastExt = ext;

  const meta = parseVgmMeta(data);
  _vgmDuration = meta.duration || 300;

  const fname = ext === 'vgz' ? 'track.vgm' : `track.${ext}`;
  clearRegisteredVfsFiles(_vgmMod);
  _vgmFileReg = null;

  if (MINI_EXTS.has(ext)) {
    await preloadMiniLibraries(sourceUrl || url, data, _vgmMod, gen);
    if (gen !== _loadGen) throw new Error('load superseded');
  }

  try {
    registerVfsFile(_vgmMod, fname, data);
  } catch (e) {
    throw new Error(`[vgm] failed to register track in virtual FS: ${e?.message || e}`);
  }

  const sr = Math.round(_vgmCtx.sampleRate) || 44100;
  _vgmSR = sr;
  const loadRet = _vgmAdapter.loadMusicData(sr, '/', fname, data, {});
  console.log('[vgm] loadMusicData returned:', loadRet, '| data.length:', data.length, '| sr:', sr);

  if (loadRet !== 0) {
    throw new Error(`[vgm] emu_init failed (${loadRet}) for ${fname}`);
  }

  let optRet = 0;
  try {
    if (typeof _vgmAdapter.evalTrackOptions === 'function') {
      optRet = _vgmAdapter.evalTrackOptions({});
      console.log('[vgm] evalTrackOptions returned:', optRet);
    }
  } catch (e) {
    console.warn('[vgm] evalTrackOptions threw (continuing):', e?.message || e);
  }
  if (optRet < 0) {
    throw new Error(`[vgm] evalTrackOptions failed (${optRet})`);
  }

  _vgmDbgLogged = false;
  _vgmAmpLogged = false;
  _vgmFramePos = 0;
  _vgmChunk = null;
  _vgmChunkFrames = 0;
  _vgmChunkPos = 0;
  _vgmFileReg = fname;

  const maxPos = _vgmAdapter.getMaxPlaybackPosition();
  console.log('[vgm] getMaxPlaybackPosition():', maxPos);
  if (maxPos > 0) {
    _vgmDuration = vgmPosUsesMilliseconds() ? (maxPos / 1000) : (maxPos / _vgmSR);
  }

  if (_vgmCtx.state === 'suspended') {
    try { await _vgmCtx.resume(); } catch (_) {}
  }
  buildVgmNode();
  _vgmPlaying = true;

  return {
    fields: [
      { label: 'Engine', value: 'VGM' },
      { label: 'Title', value: meta.title || '—' },
      { label: 'Game', value: meta.game || '—' },
      { label: 'System', value: meta.system || '—' },
      { label: 'Author', value: meta.author || '—' },
    ],
    duration: _vgmDuration,
  };
}

function teardownVgm() {
  teardownVgmNode();
  if (_vgmAdapter) {
    try { _vgmAdapter.teardown(); } catch (_) {}
  }
  if (_vgmMod) clearRegisteredVfsFiles(_vgmMod);
  _vgmFileReg = null;
  _vgmPlaying = false;
  _vgmFramePos = 0;
  _vgmChunk = null;
  _vgmChunkFrames = 0;
  _vgmChunkPos = 0;
}

export async function init() {
  await ensureVgmModule();
}

export async function load(url, entry) {
  const ext = resolveExt(url, entry);
  if (ext !== 'vgm' && ext !== 'vgz' && !MINI_EXTS.has(ext)) {
    throw new Error(`Unsupported extension for vgm engine: .${ext || 'unknown'}`);
  }

  const gen = ++_loadGen;
  ensureVgmAudioCtx();
  const result = await loadVgm(url, ext, gen, entry?.url || url);
  if (gen !== _loadGen) throw new Error('load superseded');
  return result;
}

export function pause() {
  _vgmPlaying = false;
}

export function resume() {
  if (_vgmCtx?.state === 'suspended') _vgmCtx.resume().catch(() => {});
  _vgmPlaying = true;
}

export function seekTo(s) {
  const t = Math.max(0, Number(s) || 0);
  if (!_vgmAdapter) return;
  _vgmFramePos = Math.max(0, Math.round(t * _vgmSR));
  _vgmChunk = null;
  _vgmChunkFrames = 0;
  _vgmChunkPos = 0;
  const pos = vgmPosUsesMilliseconds()
    ? Math.round(t * 1000)
    : Math.round(t * _vgmSR);
  try { _vgmAdapter.seekPlaybackPosition(pos); } catch (_) {}
}

export function getTime() {
  if (!_vgmAdapter) return 0;
  try {
    const backendPos = Number(_vgmAdapter.getPlaybackPosition()) || 0;
    const backendSec = vgmPosUsesMilliseconds()
      ? backendPos / 1000
      : backendPos / _vgmSR;
    return Math.max(backendSec, _vgmFramePos / _vgmSR);
  } catch (_) {
    return _vgmFramePos / _vgmSR;
  }
}

export function setVolume(v) {
  _volume = clamp01(v);
  if (_vgmGain) _vgmGain.gain.value = _volume;
}

export function isEnded() {
  return false;
}

export function onEnd(cb) {
  _onEnd = cb;
}

export function destroy() {
  teardownVgm();
}
