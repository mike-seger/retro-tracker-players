// GME engine adapter — SPC (via @smwcentral/spc-player) + VGM/VGZ (via wothke/vgmplay-0.40.9)

// ─── Shared utilities ────────────────────────────────────────────────────────
const SPC_JS_URL = 'https://unpkg.com/@smwcentral/spc-player@2.0.2/dist/spc.js';
const VGM_STDLIB_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/vgmplay-0.40.9@master/emscripten/htdocs/stdlib/scriptprocessor_player.min.js';
const VGM_JS_URL = 'https://cdn.jsdelivr.net/gh/wothke/vgmplay-0.40.9@master/emscripten/htdocs/backend_vgm.js';

let _onEnd     = null;
let _volume    = 1;
let _activeExt = ''; // 'spc' | 'vgm' | 'vgz' | ''
let _loadGen   = 0;

function getExt(url) {
  const q = String(url || '').split('?')[0].split('#')[0];
  const dot = q.lastIndexOf('.');
  return dot >= 0 ? q.substring(dot + 1).toLowerCase() : '';
}

function resolveExt(url, entry) {
  const fromUrl = getExt(url);
  const isSimpleExt = (s) => /^[a-z0-9]+$/i.test(String(s || ''));
  if (isSimpleExt(fromUrl) && fromUrl !== 'blob') return fromUrl;

  const fromEntryExt = String(entry?.ext || '').toLowerCase();
  if (isSimpleExt(fromEntryExt)) return fromEntryExt;

  const fromEntryName = getExt(entry?.name || '');
  if (isSimpleExt(fromEntryName)) return fromEntryName;

  const fromEntryUrl = getExt(entry?.url || '');
  if (isSimpleExt(fromEntryUrl)) return fromEntryUrl;

  return fromUrl;
}

function clamp01(v) {
  if (!isFinite(v)) return 1;
  return Math.max(0, Math.min(1.5, v));
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── SPC state ───────────────────────────────────────────────────────────────
let _spcInitPromise = null;
let _spcReady       = false;
let _songData       = null; // Uint8Array of current SPC file (for seek reload)
let _spcDuration    = 300;
let _spcPlaying     = false;

function ensureSpcUiScaffold() {
  if (document.getElementById('spc-player-interface')) return;

  const root = document.createElement('div');
  root.id = 'spc-player-host-retrotrap';
  root.style.display = 'none';

  // Minimal scaffold required by @smwcentral/spc-player.
  root.innerHTML = `
<div id="spc-player-container">
  <input type="checkbox" id="spc-player-toggle">
  <input type="checkbox" id="spc-player-loop" checked>
  <div id="spc-player-interface" class="spc-player">
    <div id="spc-player-header" class="header">
      <div class="group-left"><span>SPC Player</span></div>
      <div class="now-playing"><span class="title"></span></div>
      <div class="group-right"><a class="stop close header-button" title="Close"></a></div>
    </div>
    <div id="spc-player-content" class="player-content">
      <div class="track-info">
        <h2 class="title"></h2>
        <h3 class="subtitle"></h3>
        <div class="details"></div>
      </div>
      <div class="seek-container">
        <span class="track-time-elapsed"></span>
        <div class="seek"><span class="seek-preview"></span></div>
        <span class="track-duration"></span>
      </div>
      <div id="spc-player-controls" class="controls">
        <div class="group-left">
          <a class="play hidden" title="Resume song"></a>
          <a class="pause" title="Pause song"></a>
          <a id="spc-player-skip" class="hidden" title="Skip song"></a>
          <a class="restart" title="Restart song"></a>
          <label for="spc-player-loop" class="loop" title="Toggle looping"></label>
        </div>
        <div id="spc-player-volume" class="volume">
          <span class="volume-level">100%</span>
          <div class="volume-control">
            <input type="range" id="volume-slider" title="Volume">
            <div class="volume-track">
              <div class="volume-fill"></div>
              <div class="volume-thumb"></div>
            </div>
          </div>
        </div>
      </div>
      <div id="track-list-container" class="hidden">
        <div class="overflow-indicator top"></div>
        <div class="track-list-scrollbox"><ul class="track-list"></ul></div>
        <div class="overflow-indicator bottom"></div>
      </div>
      <div id="spc-player-up-next" class="up-next hidden">
        <span>Up Next: </span><a id="spc-player-up-next-link" target="_blank"></a>
      </div>
    </div>
  </div>
</div>`;

  document.body.appendChild(root);
}

// Preload SPC script before first user gesture (iOS friendliness).
const _spcWarmup = (async () => {
  ensureSpcUiScaffold();
  try { await loadScript(SPC_JS_URL); } catch (_) {}
})();

function getSpcNS()   { return window.SMWCentral?.SPCPlayer || null; }
function getBackend() { return getSpcNS()?.Backend || null; }

function parseSpcMeta(buf) {
  const ns = getSpcNS();
  try { return ns?.parseSPC ? ns.parseSPC(buf) : null; } catch (_) { return null; }
}

async function initSpc() {
  if (_spcReady) return;
  if (_spcInitPromise) return _spcInitPromise;

  _spcInitPromise = (async () => {
    await _spcWarmup;
    ensureSpcUiScaffold();
    await loadScript(SPC_JS_URL);

    const ns      = getSpcNS();
    const backend = getBackend();
    if (!ns || !backend) throw new Error('SPC backend not available');

    ns.onEnd   = () => { _spcPlaying = false; _onEnd?.(); };
    ns.onError = (msg) => { console.warn('[gme/spc]', msg); };

    const loop = document.getElementById('spc-player-loop');
    if (loop instanceof HTMLInputElement) {
      loop.checked = false;
      try { sessionStorage.setItem('spc_loop', 'false'); } catch (_) {}
    }

    try { backend.unlock?.(); } catch (_) {}
    try { backend.resume?.(); } catch (_) {}
    backend.setVolume?.(clamp01(_volume), 0);
    _spcReady = true;
  })();

  try { await _spcInitPromise; } finally { _spcInitPromise = null; }
}

async function loadSpc(url, gen) {
  await initSpc();
  const backend = getBackend();
  if (!backend) throw new Error('SPC backend unavailable');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`SPC fetch failed: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (gen !== _loadGen) throw new Error('load superseded');

  _songData = new Uint8Array(buf);
  const meta = parseSpcMeta(buf) || {};
  const d = Number(meta.duration);
  _spcDuration = isFinite(d) && d > 0 ? d : 300;

  backend.loadSPC(_songData, 0);
  backend.setVolume?.(clamp01(_volume), 0);
  _spcPlaying = true;

  return {
    fields: [
      { label: 'Engine',  value: 'SPC' },
      { label: 'Title',   value: meta.title || '—' },
      { label: 'Type',    value: 'SPC' },
      { label: 'Tracker', value: meta.game  || 'SNES SPC700' },
    ],
    duration: _spcDuration,
  };
}

// ─── VGM/VGZ state ───────────────────────────────────────────────────────────
let _vgmMod        = null; // backend_vgmPlay.Module
let _vgmModReady   = false;
let _vgmModPromise = null;
let _vgmCtx        = null; // AudioContext
let _vgmGain       = null; // GainNode (volume control)
let _vgmNode       = null; // ScriptProcessorNode
let _vgmPlaying    = false;
let _vgmDuration   = 0;
let _vgmSR         = 44100; // internal emulator sample rate
let _vgmFileReg    = null;  // filename registered in Emscripten virtual FS

// Minimal VGMPlay.ini injected into the Emscripten virtual FS so vgmplay does
// not attempt to fetch it over the network.
const VGM_INI = '; minimal retrotrap config\n[General]\nSampleRate=44100\n';

function vgmFsCreateDataFile(mod, dir, name, data, canRead, canWrite, canOwn) {
  if (mod?.FS?.createDataFile) {
    return mod.FS.createDataFile(dir, name, data, canRead, canWrite, canOwn);
  }
  if (typeof mod?.FS_createDataFile === 'function') {
    return mod.FS_createDataFile(dir, name, data, canRead, canWrite, canOwn);
  }
  throw new Error('[gme/vgm] createDataFile API unavailable');
}

function vgmFsUnlink(mod, path) {
  if (mod?.FS?.unlink) return mod.FS.unlink(path);
  if (typeof mod?.FS_unlink === 'function') return mod.FS_unlink(path);
  throw new Error('[gme/vgm] unlink API unavailable');
}

async function ensureVgmModule() {
  if (_vgmModReady) return;
  if (_vgmModPromise) return _vgmModPromise;

  _vgmModPromise = (async () => {
    // backend_vgm.js depends on stdlib globals (e.g. extend, EmsHEAP16BackendAdapter)
    // provided by scriptprocessor_player.min.js.
    await loadScript(VGM_STDLIB_JS_URL);
    await loadScript(VGM_JS_URL);
    const mod = window.backend_vgmPlay?.Module;
    if (!mod) throw new Error('[gme/vgm] backend_vgmPlay not found after load');

    // asm.js modules set calledRun synchronously; WASM modules need the callback.
    if (!mod.calledRun) {
      await new Promise((resolve, reject) => {
        const orig = mod.onRuntimeInitialized;
        mod.onRuntimeInitialized = () => { if (orig) orig.call(mod); resolve(); };
        setTimeout(() => reject(new Error('[gme/vgm] module init timeout')), 25000);
      });
    }

    _vgmMod = mod;

    // Provide VGMPlay.ini in the virtual FS so the emulator doesn't fail.
    try {
      vgmFsCreateDataFile(mod, '/', 'VGMPlay.ini', new TextEncoder().encode(VGM_INI), true, true, true);
    } catch (_) {}

    _vgmModReady = true;
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
  // data: Uint8Array
  if (data.length < 0x40) return {};
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  if (magic !== 'Vgm ') return {};

  // Total samples at 44100 Hz is at offset 0x18.
  const totalSamples = v.getUint32(0x18, true);
  const duration = totalSamples > 0 ? totalSamples / 44100 : 0;

  // GD3 offset is relative to file position 0x14.
  const gd3Rel = v.getUint32(0x14, true);
  if (!gd3Rel) return { duration };
  const gd3Abs = 0x14 + gd3Rel;
  if (gd3Abs + 12 >= data.length) return { duration };

  const gd3id = String.fromCharCode(
    v.getUint8(gd3Abs), v.getUint8(gd3Abs + 1),
    v.getUint8(gd3Abs + 2), v.getUint8(gd3Abs + 3));
  if (gd3id !== 'Gd3 ') return { duration };

  const gd3Len    = v.getUint32(gd3Abs + 8, true);
  const dataStart = gd3Abs + 12;
  const dataEnd   = Math.min(dataStart + gd3Len, data.length);

  // Strings are null-terminated UTF-16LE sequences.
  const strs = [];
  let cur = '';
  for (let pos = dataStart; pos + 1 < dataEnd && strs.length < 9;) {
    const ch = v.getUint16(pos, true); pos += 2;
    if (ch === 0) { strs.push(cur); cur = ''; }
    else cur += String.fromCodePoint(ch);
  }

  // GD3 field order: trackEN, trackJA, gameEN, gameJA, systemEN, systemJA,
  //                  authorEN, authorJA, date
  return {
    duration,
    title:  strs[0] || strs[1] || '',
    game:   strs[2] || strs[3] || '',
    system: strs[4] || strs[5] || '',
    author: strs[6] || strs[7] || '',
    date:   strs[8] || '',
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
  const M   = _vgmMod;
  const ctx = _vgmCtx;

  // ScriptProcessorNode: 8192 frames, 0 inputs, 2 output channels.
  const node = ctx.createScriptProcessor(8192, 0, 2);

  node.onaudioprocess = (e) => {
    const L = e.outputBuffer.getChannelData(0);
    const R = e.outputBuffer.getChannelData(1);
    if (!_vgmPlaying) { L.fill(0); R.fill(0); return; }

    // Pull emulator batches until the output buffer is filled.
    let filled = 0;
    while (filled < L.length) {
      const status = M.ccall('emu_compute_audio_samples', 'number');
      if (status !== 0) {
        _vgmPlaying = false;
        for (let i = filled; i < L.length; i++) { L[i] = 0; R[i] = 0; }
        _onEnd?.();
        return;
      }
      // ptr is a byte pointer; >> 1 converts to HEAP16 index.
      const ptr    = M.ccall('emu_get_audio_buffer', 'number') >> 1;
      const frames = M.ccall('emu_get_audio_buffer_length', 'number');
      const heap   = M.HEAP16;
      const take   = Math.min(frames, L.length - filled);
      for (let i = 0; i < take; i++) {
        L[filled + i] = heap[ptr + i * 2]     / 32768;
        R[filled + i] = heap[ptr + i * 2 + 1] / 32768;
      }
      filled += take;
      // If the emulator batch was larger than needed, the remaining samples
      // of that batch are lost (acceptable — happens rarely).
      if (take < frames) break;
    }
  };

  node.connect(_vgmGain);
  _vgmNode = node;
}

function ensureVgmAudioCtx() {
  if (!_vgmCtx || _vgmCtx.state === 'closed') {
    // 44100 Hz matches VGM's internal sample rate.
    _vgmCtx  = new AudioContext({ sampleRate: 44100 });
    _vgmGain = _vgmCtx.createGain();
    _vgmGain.gain.value = clamp01(_volume);
    _vgmGain.connect(_vgmCtx.destination);
  }
}

async function loadVgm(url, ext, gen) {
  await ensureVgmModule();
  if (gen !== _loadGen) throw new Error('load superseded');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`VGM fetch failed: HTTP ${res.status}`);
  const raw = await res.arrayBuffer();
  if (gen !== _loadGen) throw new Error('load superseded');

  const data = ext === 'vgz' ? await decompressGzip(raw) : new Uint8Array(raw);
  if (gen !== _loadGen) throw new Error('load superseded');

  const meta   = parseVgmMeta(data);
  _vgmDuration = meta.duration || 300;

  // Register the VGM data in the Emscripten virtual FS.
  const M     = _vgmMod;
  const fname = 'track.vgm';
  if (_vgmFileReg) {
    try { vgmFsUnlink(M, '/' + _vgmFileReg); } catch (_) {}
    _vgmFileReg = null;
  }
  vgmFsCreateDataFile(M, '/', fname, data, true, true, true);
  _vgmFileReg = fname;

  // Initialise the emulator.
  const sr  = Math.round(_vgmCtx.sampleRate) || 44100;
  const ret = M.ccall('emu_init', 'number', ['number', 'string', 'string'], [sr, '/', fname]);
  if (ret !== 0) throw new Error(`VGM emu_init returned ${ret}`);

  _vgmSR = M.ccall('emu_get_sample_rate', 'number') || 44100;

  // Prefer the emulator's reported length over the header parse.
  const maxPos = M.ccall('emu_get_max_position', 'number');
  if (maxPos > 0) _vgmDuration = maxPos / _vgmSR;

  if (_vgmCtx.state === 'suspended') {
    try { await _vgmCtx.resume(); } catch (_) {}
  }
  buildVgmNode();
  _vgmPlaying = true;

  return {
    fields: [
      { label: 'Engine', value: 'VGM' },
      { label: 'Title',  value: meta.title  || '—' },
      { label: 'Game',   value: meta.game   || '—' },
      { label: 'System', value: meta.system || '—' },
      { label: 'Author', value: meta.author || '—' },
    ],
    duration: _vgmDuration,
  };
}

function teardownVgm() {
  teardownVgmNode();
  if (_vgmMod) {
    try { _vgmMod.ccall('emu_teardown', 'number'); } catch (_) {}
  }
  if (_vgmFileReg && _vgmMod) {
    try { vgmFsUnlink(_vgmMod, '/' + _vgmFileReg); } catch (_) {}
    _vgmFileReg = null;
  }
  _vgmPlaying = false;
}

// ─── Public engine API ───────────────────────────────────────────────────────

export async function init() {
  // Run SPC init early so the backend is unlocked.
  // VGM module is loaded lazily on first VGM load.
  await initSpc();
}

export async function load(url, entry) {
  const ext = resolveExt(url, entry);
  const gen = ++_loadGen;
  _activeExt = '';

  if (ext === 'spc') {
    teardownVgm();
    const result = await loadSpc(url, gen);
    if (gen !== _loadGen) throw new Error('load superseded');
    _activeExt = 'spc';
    return result;
  }

  if (ext === 'vgm' || ext === 'vgz') {
    // Create AudioContext synchronously — must happen before any await to stay
    // inside the iOS user-gesture window.
    ensureVgmAudioCtx();

    // Pause any live SPC session.
    if (_spcPlaying) {
      try { getBackend()?.pause?.(); } catch (_) {}
      _spcPlaying = false;
    }

    const result = await loadVgm(url, ext, gen);
    if (gen !== _loadGen) throw new Error('load superseded');
    _activeExt = ext;
    return result;
  }

  throw new Error(`Unsupported extension for gme engine: .${ext || 'unknown'}`);
}

export function pause() {
  if (_activeExt === 'spc') {
    try { getBackend()?.pause?.(); } catch (_) {}
    _spcPlaying = false;
  } else if (_activeExt === 'vgm' || _activeExt === 'vgz') {
    _vgmPlaying = false;
  }
}

export function resume() {
  if (_activeExt === 'spc') {
    const backend = getBackend();
    if (!backend) return;
    try { backend.unlock?.(); } catch (_) {}
    try { backend.resume?.(); } catch (_) {}
    _spcPlaying = true;
  } else if (_activeExt === 'vgm' || _activeExt === 'vgz') {
    if (_vgmCtx?.state === 'suspended') _vgmCtx.resume().catch(() => {});
    _vgmPlaying = true;
  }
}

export function seekTo(s) {
  const t = Math.max(0, Number(s) || 0);
  if (_activeExt === 'spc') {
    const backend = getBackend();
    if (!backend || !_songData) return;
    backend.loadSPC(_songData, Math.min(t, _spcDuration || t));
    backend.setVolume?.(clamp01(_volume), 0);
  } else if (_activeExt === 'vgm' || _activeExt === 'vgz') {
    if (!_vgmMod) return;
    try { _vgmMod.ccall('emu_seek_position', 'number', ['number'], [Math.round(t * _vgmSR)]); } catch (_) {}
  }
}

export function getTime() {
  if (_activeExt === 'spc') {
    const backend = getBackend();
    if (!backend) return 0;
    try { return backend.getTime?.() || 0; } catch (_) { return 0; }
  } else if (_activeExt === 'vgm' || _activeExt === 'vgz') {
    if (!_vgmMod) return 0;
    try { return _vgmMod.ccall('emu_get_position', 'number') / _vgmSR; } catch (_) { return 0; }
  }
  return 0;
}

export function setVolume(v) {
  _volume = clamp01(v);
  if (_activeExt === 'spc') {
    getBackend()?.setVolume?.(_volume, 0);
  } else if (_activeExt === 'vgm' || _activeExt === 'vgz') {
    if (_vgmGain) _vgmGain.gain.value = _volume;
  }
}

export function isEnded() {
  return false;
}

export function onEnd(cb) {
  _onEnd = cb;
}

export function destroy() {
  try { getBackend()?.stopSPC?.(true); } catch (_) {}
  _spcPlaying = false;
  teardownVgm();
  _activeExt = '';
}
