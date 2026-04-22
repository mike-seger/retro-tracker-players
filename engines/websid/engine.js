// WebSid engine adapter
//
// Vendored upstream runtime files:
// - engines/websid/stdlib/scriptprocessor_player.min.js
// - engines/websid/backend_websid.js
// - engines/websid/websid.wasm

import { BASIC_ROM, CHAR_ROM, KERNAL_ROM } from './roms.js';

const BASE = 'engines/websid/';
const PLAYER_JS = BASE + 'stdlib/scriptprocessor_player.min.js';
const BACKEND_JS = BASE + 'backend_websid.js';
const DEFAULT_TIMEOUT_SEC = 300;

let _initPromise = null;
let _onEnd = null;
let _volume = 1.0;
let _maxPosRaw = 0;
let _durationSec = 300;
let _posUnit = 'unknown';   // 'samples' | 'ms' | 'sec' | 'unknown'
let _currentUrl = null;
let _seekSerial = 0;

function debugSeek(...args) {
  if (!window.__WEB_SID_DEBUG_SEEK) return;
  try { console.log('[websid-seek]', ...args); } catch (_) {}
}

function backendRawPos(module) {
  if (!module?.ccall) return -1;
  try {
    const v = module.ccall('emu_get_current_position', 'number');
    return Number.isFinite(v) ? v : -1;
  } catch (_) {
    return -1;
  }
}

function resolveGlobalSymbol(name) {
  const direct = window[name];
  if (direct) return direct;

  // Some vendored scripts declare globals via class/let bindings that do not
  // become window properties. Indirect eval can still read those bindings.
  try {
    const resolved = (0, eval)(`typeof ${name} !== 'undefined' ? ${name} : undefined`);
    if (resolved) {
      window[name] = resolved;
      return resolved;
    }
  } catch (_) {}

  return undefined;
}

function getScriptNodePlayerCtor() {
  return resolveGlobalSymbol('ScriptNodePlayer');
}

function getSidBackendAdapterCtor() {
  return resolveGlobalSymbol('SIDBackendAdapter');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded === '1') {
      resolve();
      return;
    }

    const s = existing || document.createElement('script');
    const onLoad = () => {
      s.dataset.loaded = '1';
      resolve();
    };
    const onError = () => reject(new Error('Failed to load script: ' + src));

    s.addEventListener('load', onLoad, { once: true });
    s.addEventListener('error', onError, { once: true });

    if (!existing) {
      s.src = src;
      document.head.appendChild(s);
    }
  });
}

function sampleRate() {
  const p = getScriptNodePlayerCtor();
  const sr = p?.getWebAudioSampleRate?.();
  return sr && isFinite(sr) ? sr : 44100;
}

function currentPlayer() {
  return getScriptNodePlayerCtor()?.getInstance?.() || null;
}

async function ensureAudioContextRunning(ScriptNodePlayer) {
  if (!ScriptNodePlayer?.getWebAudioContext) return;
  try {
    const ctx = ScriptNodePlayer.getWebAudioContext();
    if (ctx?.state === 'suspended') await ctx.resume();
  } catch (_) {}
}

function kickPlayback() {
  const p = currentPlayer();
  if (!p) return;
  try { p.resume?.(); } catch (_) {}
  try { p.play?.(); } catch (_) {}
}

function inferPosUnit(maxPosRaw) {
  if (!(maxPosRaw > 0)) return 'unknown';
  // Large values are usually raw sample positions.
  if (maxPosRaw > 1_000_000) return 'samples';
  // Mid-range values are usually milliseconds.
  if (maxPosRaw > 10_000) return 'ms';
  return 'sec';
}

function rawPosToSeconds(rawPos) {
  if (!(rawPos > 0)) return 0;
  if (_posUnit === 'samples') return rawPos / sampleRate();
  if (_posUnit === 'ms') return rawPos / 1000;
  if (_posUnit === 'sec') return rawPos;
  // Unknown unit: assume samples (most common for SID WASM backends).
  return rawPos / sampleRate();
}

function secondsToRawPos(seconds) {
  const s = Math.max(0, seconds || 0);
  if (_posUnit === 'samples') return Math.round(s * sampleRate());
  if (_posUnit === 'ms') return Math.round(s * 1000);
  if (_posUnit === 'sec') return Math.round(s);
  // Unknown unit: assume samples.
  return Math.round(s * sampleRate());
}

function rawPlaybackWindow() {
  const p = currentPlayer();
  if (!p) return { rawPos: 0, maxPos: 0 };
  // getMaxPlaybackPosition returns -1 when the backend has no precomputed
  // duration; treat anything <= 0 as unknown.
  const reportedMax = p.getMaxPlaybackPosition?.() ?? -1;
  const maxPos = reportedMax > 0 ? reportedMax : (_maxPosRaw > 0 ? _maxPosRaw : 0);
  const reportedPos = p.getPlaybackPosition?.() ?? -1;
  const rawPos = reportedPos > 0 ? reportedPos : 0;
  return { rawPos, maxPos };
}

export async function init() {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    // backend_websid.js locates websid.wasm relative to this path.
    window.WASM_SEARCH_PATH = new URL(BASE, window.location.href).href;

    await loadScript(PLAYER_JS);
    await loadScript(BACKEND_JS);

    const ScriptNodePlayer = getScriptNodePlayerCtor();
    const SIDBackendAdapter = getSidBackendAdapterCtor();
    if (!ScriptNodePlayer || !SIDBackendAdapter) {
      throw new Error('WebSid globals are missing after script load');
    }

    const backend = new SIDBackendAdapter(BASIC_ROM, CHAR_ROM, KERNAL_ROM);
    backend.setProcessorBufSize(4096);

    await ScriptNodePlayer.initialize(
      backend,
      () => { _onEnd?.(); },
      [],
      false,
      undefined,
    );

    await ensureAudioContextRunning(ScriptNodePlayer);

    const p = currentPlayer();
    if (!p) throw new Error('WebSid player initialization failed');
    p.setVolume(_volume);
  })();

  return _initPromise;
}

export async function load(url) {
  await init();

  debugSeek('debug enabled');
  _currentUrl = url;

  const ScriptNodePlayer = getScriptNodePlayerCtor();
  if (!ScriptNodePlayer) throw new Error('ScriptNodePlayer unavailable');

  await ensureAudioContextRunning(ScriptNodePlayer);

  const options = {
    track: -1,
    // A finite timeout ensures WebSid can expose a seekable playback range.
    timeout: DEFAULT_TIMEOUT_SEC,
    traceSID: false,
  };

  await new Promise((resolve, reject) => {
    ScriptNodePlayer.loadMusicFromURL(
      url,
      options,
      () => reject(new Error('WebSid failed to load SID')),
      () => {},
    ).then(resolve).catch(reject);
  });

  await ensureAudioContextRunning(ScriptNodePlayer);
  kickPlayback();

  const p = currentPlayer();
  p?.setVolume(_volume);
  const info = p?.getSongInfo?.() || {};
  const reportedMax = p?.getMaxPlaybackPosition?.() ?? -1;
  _maxPosRaw = reportedMax > 0 ? reportedMax : 0;
  _posUnit = reportedMax > 0 ? inferPosUnit(_maxPosRaw) : 'samples';
  const duration = _maxPosRaw > 0 ? rawPosToSeconds(_maxPosRaw) : DEFAULT_TIMEOUT_SEC;
  _durationSec = duration > 0 ? duration : DEFAULT_TIMEOUT_SEC;

  const maxSub = Number.isFinite(info.maxSubsong) ? info.maxSubsong : -1;
  const curSub = Number.isFinite(info.actualSubsong) ? info.actualSubsong : -1;
  const subtune = maxSub >= 0 && curSub >= 0
    ? `${curSub + 1} / ${maxSub + 1}`
    : '—';

  return {
    fields: [
      { label: 'Title', value: info.songName || '—' },
      { label: 'Author', value: info.songAuthor || '—' },
      { label: 'Released', value: info.songReleased || '—' },
      { label: 'Subtune', value: subtune },
      { label: 'Engine', value: 'WebSid' },
    ],
    duration,
  };
}

export function pause() {
  currentPlayer()?.pause?.();
}

export async function resume() {
  const ScriptNodePlayer = getScriptNodePlayerCtor();
  await ensureAudioContextRunning(ScriptNodePlayer);
  kickPlayback();
}

export function seekTo(s) {
  const seekToken = ++_seekSerial;
  const p = currentPlayer();
  if (!p?.seekPlaybackPosition) return false;

  const { maxPos } = rawPlaybackWindow();
  const dur = _durationSec > 0 ? _durationSec : DEFAULT_TIMEOUT_SEC;
  const ratio = Math.max(0, Math.min((s || 0) / dur, 1));

  const candidates = [];
  if (maxPos > 0) {
    candidates.push(Math.max(0, Math.min(Math.round(maxPos * ratio), maxPos)));
  } else {
    // No authoritative max position available: try common unit encodings.
    candidates.push(Math.max(0, secondsToRawPos(s)));
    candidates.push(Math.max(0, Math.round((s || 0) * sampleRate())));
    candidates.push(Math.max(0, Math.round((s || 0) * 1000)));
    candidates.push(Math.max(0, Math.round(s || 0)));
  }

  const tried = new Set();
  const module = p?._backendAdapter?.Module;
  const wasPaused = !!p?.isPaused?.();
  const beforePos = backendRawPos(module);
  let movedByNativeSeek = false;
  debugSeek('request', { seconds: s, maxPos, duration: _durationSec, posUnit: _posUnit, beforePos, candidates: [...candidates] });

  for (const target of candidates) {
    if (tried.has(target)) continue;
    tried.add(target);
    try { p.seekPlaybackPosition(target); } catch (_) {}
    // Defensive fallback: some builds only react to direct backend seek.
    try {
      if (module?.ccall) {
        module.ccall('emu_seek_position', 'number', ['number'], [target]);
      }
    } catch (_) {}

    // Stop at the first candidate that actually moves backend position.
    const afterPos = backendRawPos(module);
    debugSeek('attempt', { target, beforePos, afterPos, moved: beforePos >= 0 && afterPos >= 0 ? Math.abs(afterPos - beforePos) : null });
    if (beforePos >= 0 && afterPos >= 0 && Math.abs(afterPos - beforePos) > 512) {
      movedByNativeSeek = true;
      break;
    }
  }

  if (movedByNativeSeek) {
    if (wasPaused) {
      try { p.pause?.(); } catch (_) {}
    } else {
      kickPlayback();
    }
    return true;
  }

  // Native seek path is ineffective in this backend build. Use a deterministic
  // reload + offline fast-forward fallback with synchronized transformer state.
  debugSeek('native seek unsupported; using synced fallback');
  const targetSec = Math.max(0, Number(s) || 0);
  const url = _currentUrl;
  if (!url) {
    debugSeek('fallback skipped: no current URL');
    return false;
  }

  void (async () => {
    try {
      const ScriptNodePlayer = getScriptNodePlayerCtor();
      if (!ScriptNodePlayer) return;

      await ensureAudioContextRunning(ScriptNodePlayer);
      try { p.pause?.(); } catch (_) {}

      const options = { track: -1, timeout: DEFAULT_TIMEOUT_SEC, traceSID: false };
      await new Promise((resolve, reject) => {
        ScriptNodePlayer.loadMusicFromURL(
          url,
          options,
          () => reject(new Error('WebSid failed to reload SID for seek fallback')),
          () => {},
        ).then(resolve).catch(reject);
      });

      if (seekToken !== _seekSerial) return; // superseded by a newer seek

      const p2 = currentPlayer();
      p2?.setVolume(_volume);
      try { p2?.pause?.(); } catch (_) {}

      const adapter2 = p2?._backendAdapter;
      if (!adapter2?.computeAudioSamples) return;

      let chunk = 0;
      try { chunk = adapter2.getAudioBufferLength?.() || 0; } catch (_) {}
      if (!(chunk > 0)) chunk = 1024;

      const targetSamples = Math.max(0, Math.round(targetSec * sampleRate()));
      const maxSteps = 200000;
      const steps = Math.min(maxSteps, Math.ceil(targetSamples / chunk));

      for (let i = 0; i < steps; i++) {
        if (seekToken !== _seekSerial) return;
        const ended = adapter2.computeAudioSamples();
        if (ended) break;
      }

      // Sync JS-side timing and clear pending buffered sample counters to
      // avoid stale-loop artifacts after synthetic stepping.
      try {
        const t = adapter2._transformer;
        if (t) {
          t._currentPlaytime = targetSamples;
          t.resetBuffers?.();
          t._sourceBufferIdx = 0;
        }
      } catch (_) {}

      debugSeek('fallback completed', { targetSec, targetSamples, chunk, steps });

      if (wasPaused) {
        try { p2?.pause?.(); } catch (_) {}
      } else {
        try { p2?.resume?.(); } catch (_) {}
        try { p2?.play?.(); } catch (_) {}
      }
    } catch (err) {
      debugSeek('fallback failed', { error: String(err) });
      if (!wasPaused) {
        try { p?.resume?.(); } catch (_) {}
      }
    }
  })();

  // Async fallback in progress; caller can keep temporary UI state.
  return true;
}

export function getTime() {
  const { rawPos, maxPos } = rawPlaybackWindow();
  if (maxPos > 0 && _durationSec > 0) {
    const ratio = Math.max(0, Math.min(rawPos / maxPos, 1));
    return ratio * _durationSec;
  }

  // Prefer backend raw position when available: this reflects emu_seek_position
  // immediately even if backend playtime lags one tick behind.
  if (rawPos > 0) return rawPosToSeconds(rawPos);

  const p = currentPlayer();
  const currentSeconds = p?.getCurrentPlaytime?.();
  if (Number.isFinite(currentSeconds) && currentSeconds >= 0) return currentSeconds;

  const rawPosFallback = p?.getPlaybackPosition?.() || 0;
  return rawPosToSeconds(rawPosFallback);
}

export function setVolume(v) {
  _volume = Number.isFinite(v) ? v : _volume;
  currentPlayer()?.setVolume?.(_volume);
}

export function isEnded() {
  return false;
}

export function onEnd(cb) {
  _onEnd = cb;
}

export function destroy() {
  currentPlayer()?.pause?.();
}
