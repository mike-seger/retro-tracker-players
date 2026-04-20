// MOD/XM/S3M/IT engine adapter (libopenmpt)
// Uses chiptune3 (AudioWorklet) when secure context available,
// falls back to chiptune2 (ScriptProcessorNode) for insecure contexts (HTTP LAN)

const CHIPTUNE3_CDN = 'https://cdn.jsdelivr.net/npm/chiptune3@0.8/chiptune3.js';
const CHIPTUNE2_CDN = 'https://cdn.jsdelivr.net/gh/deskjet/chiptune2.js@master/';

let player = null;
let audioCtx = null;
let _onEnd = null;
let _ready = false;
let _playing = false;
let _ended = false;
let _volume = 1.0;
let _currentTime = 0;
let _duration = 0;
let _meta = null;
let _metaResolver = null;
let _useV2 = false;
let _pollTimer = null;
let _gainNode = null;
let _compressor = null;

function ensureCompressor() {
  if (!_compressor && audioCtx) {
    _compressor = audioCtx.createDynamicsCompressor();
    _compressor.threshold.value = -20;
    _compressor.knee.value = 12;
    _compressor.ratio.value = 8;
    _compressor.attack.value = 0.003;
    _compressor.release.value = 0.15;
    _compressor.connect(audioCtx.destination);
  }
  return _compressor;
}

function supportsWorklet() {
  return window.isSecureContext !== false && typeof AudioWorkletNode !== 'undefined';
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load: ' + src));
    document.head.appendChild(s);
  });
}

async function resumeContext() {
  if (audioCtx?.state === 'suspended') {
    try { await audioCtx.resume(); } catch (_) {}
  }
}

/* ── chiptune3 (AudioWorklet) init ──────────────── */
async function initV3() {
  const lib = await import(CHIPTUNE3_CDN);
  const { ChiptuneJsPlayer } = lib;

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  player = new ChiptuneJsPlayer({ context: audioCtx, repeatCount: 0 });

  await new Promise((resolve, reject) => {
    player.onInitialized(() => resolve());
    player.onError((e) => reject(new Error('ChiptuneJs init: ' + (e?.type || e))));
    setTimeout(() => reject(new Error('ChiptuneJs init timeout')), 10000);
  });

  player.onMetadata((meta) => {
    _meta = meta || null;
    _duration = meta?.dur || 0;
    if (_metaResolver) { _metaResolver(meta || null); _metaResolver = null; }
  });

  player.onProgress(() => { _currentTime = player.currentTime || 0; });

  player.onEnded(() => {
    _playing = false;
    _ended = true;
    _onEnd?.();
  });

  if (player.gain) {
    player.gain.gain.value = _volume;
    try { player.gain.disconnect(); } catch (_) {}
    const comp = ensureCompressor();
    player.gain.connect(comp || audioCtx.destination);
  }
}

/* ── chiptune2 (ScriptProcessorNode) init ───────── */
async function initV2() {
  // Pre-configure emscripten Module so it locates .mem file on the CDN
  // (dynamic <script> tags may not resolve scriptDirectory correctly)
  window.Module = { locateFile: (path) => CHIPTUNE2_CDN + path };

  await loadScript(CHIPTUNE2_CDN + 'libopenmpt.js');

  // Wait for libopenmpt asm.js to initialize (fetches .mem file from CDN)
  await new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      if (typeof libopenmpt !== 'undefined' && libopenmpt._malloc) {
        resolve();
      } else if (++attempts > 200) {
        reject(new Error('libopenmpt init timeout'));
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });

  await loadScript(CHIPTUNE2_CDN + 'chiptune2.js');

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  _gainNode = audioCtx.createGain();
  _gainNode.gain.value = _volume;
  const comp = ensureCompressor();
  _gainNode.connect(comp || audioCtx.destination);

  player = new ChiptuneJsPlayer(new ChiptuneJsConfig(0, 100, 8, audioCtx));

  player.onEnded(() => {
    stopPoll();
    _playing = false;
    _ended = true;
    _onEnd?.();
  });
}

function startPoll() {
  stopPoll();
  _pollTimer = setInterval(() => {
    if (player?.currentPlayingNode?.modulePtr) {
      _currentTime = player.getCurrentTime();
    }
  }, 200);
}

function stopPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/* ── public API ──────────────────────────────────── */
export async function init() {
  if (_ready) return;
  _useV2 = !supportsWorklet();
  if (!_useV2) {
    try {
      await initV3();
    } catch (e) {
      console.warn('chiptune3 (AudioWorklet) failed, falling back to chiptune2:', e.message);
      // Reset state so V2 can init cleanly
      player = null;
      audioCtx = null;
      _useV2 = true;
      await initV2();
    }
  } else {
    await initV2();
  }
  _ready = true;
}

export async function load(url) {
  await init();

  if (player) player.stop();
  if (_useV2) stopPoll();

  _ended = false;
  _playing = false;
  _currentTime = 0;
  _duration = 0;
  _meta = null;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`MOD fetch failed: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();

  await resumeContext();

  if (_useV2) {
    player.play(buffer);

    // Route through gain node for volume control
    if (player.currentPlayingNode && _gainNode) {
      player.currentPlayingNode.disconnect();
      player.currentPlayingNode.connect(_gainNode);
    }

    _playing = true;
    _duration = player.duration() || 300;

    const meta = player.metadata();
    startPoll();

    return {
      fields: [
        { label: 'Title', value: meta?.title || '—' },
        { label: 'Type', value: meta?.type_long || meta?.type || '—' },
        { label: 'Tracker', value: meta?.tracker || '—' },
      ],
      duration: _duration,
    };
  }

  // chiptune3 path
  const metaPromise = new Promise((resolve) => {
    _metaResolver = resolve;
    setTimeout(() => { if (_metaResolver) { _metaResolver(null); _metaResolver = null; } }, 2000);
  });

  if (player.gain) player.gain.gain.value = _volume;
  player.play(buffer);
  _playing = true;

  await metaPromise;

  return {
    fields: [
      { label: 'Title', value: _meta?.title || _meta?.name || '—' },
      { label: 'Type', value: _meta?.type || '—' },
      { label: 'Tracker', value: _meta?.tracker || '—' },
    ],
    duration: _duration || 300,
  };
}

export function pause() {
  if (!player || !_playing) return;
  if (_useV2) {
    player.currentPlayingNode?.pause();
    stopPoll();
  } else {
    player.pause();
  }
  _playing = false;
}

export function resume() {
  if (!player || _playing) return;
  resumeContext();
  if (_useV2) {
    player.currentPlayingNode?.unpause();
    startPoll();
  } else {
    player.unpause();
  }
  _playing = true;
}

export function seekTo(s) {
  if (!player) return;
  const pos = Math.max(0, Math.min(s, _duration || s));
  if (_useV2) {
    if (player.currentPlayingNode?.modulePtr) {
      libopenmpt._openmpt_module_set_position_seconds(player.currentPlayingNode.modulePtr, pos);
    }
  } else {
    player.setPos(pos);
  }
  _currentTime = pos;
}

export function getTime() {
  return _currentTime || 0;
}

export function setVolume(v) {
  _volume = v;
  if (_useV2) {
    if (_gainNode) _gainNode.gain.value = v;
  } else {
    if (player?.gain) player.gain.gain.value = v;
  }
}

export function isEnded() { return _ended; }
export function onEnd(cb) { _onEnd = cb; }
export function destroy() { stopPoll(); if (player) player.stop(); }
