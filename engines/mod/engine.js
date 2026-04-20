// MOD/XM/S3M/IT engine adapter (libopenmpt)
// Uses chiptune3 (AudioWorklet) when secure context available,
// falls back to chiptune2 (ScriptProcessorNode) for insecure contexts (HTTP LAN)

const CHIPTUNE3_CDN = 'https://cdn.jsdelivr.net/npm/chiptune3@0.8/chiptune3.js';
const CHIPTUNE2_LOCAL = new URL('./vendor/chiptune2/', import.meta.url).href;
const CHIPTUNE2_BASES = [
  CHIPTUNE2_LOCAL,
  'https://cdn.jsdelivr.net/gh/deskjet/chiptune2.js@master/',
  'https://raw.githubusercontent.com/deskjet/chiptune2.js/master/',
];
const MOD_BUILD_TAG = 'mod-build-2026-04-20-01';

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
let _unlockHooksInstalled = false;
let _v2PendingReject = null;
let _initPromise = null;
const _scriptPromises = new Map();

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
  if (_scriptPromises.has(src)) return _scriptPromises.get(src);

  const p = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded === '1') {
      resolve();
      return;
    }

    console.warn('[mod] loading script', src);
    const s = existing || document.createElement('script');
    const done = () => {
      s.dataset.loaded = '1';
      console.warn('[mod] loaded script', src);
      resolve();
    };

    const fail = () => reject(new Error('Failed to load: ' + src));

    s.addEventListener('load', done, { once: true });
    s.addEventListener('error', fail, { once: true });

    if (existing) return;

    s.src = src;
    document.head.appendChild(s);
  });

  const wrapped = p.then(
    (value) => {
      _scriptPromises.delete(src);
      return value;
    },
    (err) => {
      _scriptPromises.delete(src);
      throw err;
    }
  );

  _scriptPromises.set(src, wrapped);
  return wrapped;
}

function resetV2Globals() {
  try { delete window.Module; } catch (_) { window.Module = undefined; }
  try { delete window.libopenmpt; } catch (_) { window.libopenmpt = undefined; }
  try { delete window.ChiptuneJsPlayer; } catch (_) { window.ChiptuneJsPlayer = undefined; }
  try { delete window.ChiptuneJsConfig; } catch (_) { window.ChiptuneJsConfig = undefined; }
}

function installLibopenmptGlobalShim() {
  // Older iOS Safari can fail to resolve unqualified globals in dependent scripts.
  // Force both property and var-style global symbol for chiptune2.js.
  const mpt = window.libopenmpt || window.Module || globalThis.libopenmpt;
  if (!mpt) return;
  window.libopenmpt = mpt;
  globalThis.libopenmpt = mpt;
  try {
    const s = document.createElement('script');
    s.text = 'var libopenmpt = window.libopenmpt || window.Module || globalThis.libopenmpt;';
    document.head.appendChild(s);
    s.remove();
  } catch (_) {}
}

async function resumeContext() {
  if (audioCtx?.state === 'suspended') {
    try { await audioCtx.resume(); } catch (_) {}
  }
}

async function unlockV2Audio() {
  if (!_useV2 || !player) return;
  await resumeContext();
  try {
    if (player.touchLocked && typeof player.unlock === 'function') {
      player.unlock();
      console.warn('[mod] V2 unlocked audio');
    }
  } catch (_) {}
}

function ensureV2OutputChain() {
  if (!audioCtx) return null;
  if (!_gainNode) {
    _gainNode = audioCtx.createGain();
    _gainNode.gain.value = _volume;
    const comp = ensureCompressor();
    _gainNode.connect(comp || audioCtx.destination);
    console.warn('[mod] V2 output chain ready');
  }
  return _gainNode;
}

function routeV2NodeToOutput() {
  const node = player?.currentPlayingNode;
  const out = ensureV2OutputChain();
  if (!node || !out) return false;
  try { node.disconnect(); } catch (_) {}
  try {
    node.connect(out);
    console.warn('[mod] V2 node routed to output');
    return true;
  } catch (e) {
    console.error('[mod] V2 route failed', e);
    return false;
  }
}

function installUnlockHooks() {
  if (_unlockHooksInstalled) return;
  _unlockHooksInstalled = true;

  const unlock = () => { unlockV2Audio(); };
  const opts = { passive: true };

  window.addEventListener('touchstart', unlock, opts);
  window.addEventListener('pointerdown', unlock, opts);
  window.addEventListener('mousedown', unlock, opts);
  window.addEventListener('keydown', unlock, opts);
}

/* ── chiptune3 (AudioWorklet) init ──────────────── */
async function initV3() {
  console.warn('[mod] initV3 start');
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await resumeContext();

  const lib = await import(CHIPTUNE3_CDN);
  const { ChiptuneJsPlayer } = lib;

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
  console.warn('[mod] initV3 ready');
}

/* ── chiptune2 (ScriptProcessorNode) init ───────── */
async function initV2() {
  let lastError = null;
  console.warn('[mod] initV2 start', MOD_BUILD_TAG);

  // Create and resume the context before any async loader work starts so
  // the initial tap/click can unlock audio on mobile browsers.
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await resumeContext();

  for (const base of CHIPTUNE2_BASES) {
    try {
      console.warn('[mod] trying V2 base', base);
      resetV2Globals();

      const memUrl = base + 'libopenmpt.js.mem';
      try {
        const memRes = await fetch(memUrl, { cache: 'no-store' });
        console.warn('[mod] preflight mem', memUrl, 'status=', memRes.status);
        if (!memRes.ok) throw new Error('mem fetch failed: HTTP ' + memRes.status);
        await memRes.arrayBuffer();
      } catch (e) {
        console.error('[mod] preflight mem failed', memUrl, e);
      }

      let runtimeReady = false;

      // Pre-configure emscripten Module so it locates .mem file correctly.
      window.Module = {
        locateFile: (path) => {
          const resolved = base + path;
          console.warn('[mod] locateFile', path, '->', resolved);
          return resolved;
        },
        onAbort: (reason) => console.error('[mod] emscripten abort:', reason),
        printErr: (...args) => console.error('[mod] libopenmpt:', ...args),
        onRuntimeInitialized: () => {
          runtimeReady = true;
          console.warn('[mod] runtime initialized from', base);
        },
      };

      await loadScript(base + 'libopenmpt.js');

      // Wait for libopenmpt asm.js to initialize (fetches .mem file from base)
      await new Promise((resolve, reject) => {
        let attempts = 0;
        const check = () => {
          const apiReady = typeof libopenmpt !== 'undefined' && typeof libopenmpt._malloc === 'function';
          const calledRun = !!window.Module?.calledRun;
          if (runtimeReady || apiReady || calledRun) {
            console.warn('[mod] libopenmpt ready from', base);
            resolve();
          } else if (++attempts > 200) {
            reject(new Error('libopenmpt init timeout (runtimeReady=' + runtimeReady + ', apiReady=' + apiReady + ', calledRun=' + calledRun + ')'));
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });

      installLibopenmptGlobalShim();

      await loadScript(base + 'chiptune2.js');

      _gainNode = null;
      ensureV2OutputChain();

      player = new ChiptuneJsPlayer(new ChiptuneJsConfig(0, 100, 8, audioCtx));
      installLibopenmptGlobalShim();
      installUnlockHooks();
      console.warn('[mod] chiptune2 player created');

      player.onError((e) => {
        stopPoll();
        _playing = false;
        const err = new Error('chiptune2: ' + (e?.type || e));
        if (_v2PendingReject) {
          const reject = _v2PendingReject;
          _v2PendingReject = null;
          reject(err);
        } else {
          console.warn(err);
        }
      });

      player.onEnded(() => {
        stopPoll();
        _playing = false;
        _ended = true;
        _onEnd?.();
      });

      console.warn('[mod] initV2 ready');
      return;
    } catch (e) {
      console.error('[mod] initV2 base failed', base, e);
      lastError = e;
    }
  }

  throw new Error('Failed to initialize MOD engine from all fallback sources: ' + (lastError?.message || lastError));
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

function scheduleV2Watchdog(url) {
  setTimeout(() => {
    if (!_useV2 || !player?.currentPlayingNode?.modulePtr) return;
    try {
      const time = player.getCurrentTime?.() || 0;
      const order = player.getCurrentOrder?.();
      const row = player.getCurrentRow?.();
      console.warn('[mod] V2 watchdog', url, 'time=', time, 'order=', order, 'row=', row, 'ctx=', audioCtx?.state);
    } catch (e) {
      console.error('[mod] V2 watchdog failed', e);
    }
  }, 1200);
}

/* ── public API ──────────────────────────────────── */
export async function init() {
  if (_ready) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    console.warn('[mod] init start', MOD_BUILD_TAG, 'secureContext=', window.isSecureContext, 'AudioWorkletNode=', typeof AudioWorkletNode);
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
    console.warn('[mod] init complete, useV2=', _useV2);
  })();

  try {
    await _initPromise;
  } finally {
    _initPromise = null;
  }
}

export async function load(url) {
  console.warn('[mod] load start', url);
  await init();

  if (player) player.stop();
  if (_useV2) stopPoll();

  _ended = false;
  _playing = false;
  _currentTime = 0;
  _duration = 0;
  _meta = null;

  if (_useV2) {
    installLibopenmptGlobalShim();
    await unlockV2Audio();
    console.warn('[mod] V2 load begin', url, 'ctx=', audioCtx?.state, 'touchLocked=', player?.touchLocked);
    return await new Promise((resolve, reject) => {
      _v2PendingReject = reject;
      const timer = setTimeout(() => {
        if (_v2PendingReject === reject) {
          _v2PendingReject = null;
          console.error('[mod] V2 load timeout', url);
          reject(new Error('chiptune2 load timeout'));
        }
      }, 10000);

      player.load(url, (buffer) => {
        try {
          console.warn('[mod] V2 load callback', url, 'bytes=', buffer?.byteLength || 0);
          if (_v2PendingReject === reject) _v2PendingReject = null;
          clearTimeout(timer);

          player.play(buffer);
          resumeContext();
          routeV2NodeToOutput();
          if (!player.currentPlayingNode?.modulePtr) {
            reject(new Error('chiptune2 failed to create playback node'));
            return;
          }

          _playing = true;
          _duration = player.duration() || 300;

          const meta = player.metadata();
          startPoll();
          scheduleV2Watchdog(url);
          console.warn('[mod] V2 play started', url, 'duration=', _duration, 'ctx=', audioCtx?.state, 'touchLocked=', player?.touchLocked, 'modulePtr=', player.currentPlayingNode?.modulePtr || 0);

          resolve({
            fields: [
              { label: 'Title', value: meta?.title || '—' },
              { label: 'Type', value: meta?.type_long || meta?.type || '—' },
              { label: 'Tracker', value: meta?.tracker || '—' },
            ],
            duration: _duration,
          });
        } catch (e) {
          if (_v2PendingReject === reject) _v2PendingReject = null;
          clearTimeout(timer);
          reject(e);
        }
      });
    });
  }

  const res = await fetch(url);
  console.warn('[mod] V3 fetch status', res.status, url);
  if (!res.ok) throw new Error(`MOD fetch failed: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();

  await resumeContext();

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
    const mpt = globalThis.libopenmpt || window.libopenmpt;
    if (player.currentPlayingNode?.modulePtr) {
      mpt?._openmpt_module_set_position_seconds(player.currentPlayingNode.modulePtr, pos);
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
