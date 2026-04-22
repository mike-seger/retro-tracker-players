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

let _initPromise = null;
let _onEnd = null;
let _volume = 1.0;
let _maxPosRaw = 0;
let _durationSec = 300;
let _posUnit = 'unknown';   // 'samples' | 'ms' | 'sec' | 'unknown'

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
  return rawPos;
}

function secondsToRawPos(seconds) {
  const s = Math.max(0, seconds || 0);
  if (_posUnit === 'samples') return Math.round(s * sampleRate());
  if (_posUnit === 'ms') return Math.round(s * 1000);
  return Math.round(s);
}

function rawPlaybackWindow() {
  const p = currentPlayer();
  if (!p) return { rawPos: 0, maxPos: 0 };
  const maxPos = p.getMaxPlaybackPosition?.() || _maxPosRaw || 0;
  const rawPos = p.getPlaybackPosition?.() || 0;
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

  const ScriptNodePlayer = getScriptNodePlayerCtor();
  if (!ScriptNodePlayer) throw new Error('ScriptNodePlayer unavailable');

  await ensureAudioContextRunning(ScriptNodePlayer);

  const options = {
    track: -1,
    timeout: -1,
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
  _maxPosRaw = p?.getMaxPlaybackPosition?.() || 0;
  _posUnit = inferPosUnit(_maxPosRaw);
  const duration = _maxPosRaw > 0 ? rawPosToSeconds(_maxPosRaw) : 300;
  _durationSec = duration > 0 ? duration : 300;

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
  const p = currentPlayer();
  if (!p?.seekPlaybackPosition) return;

  const { maxPos } = rawPlaybackWindow();
  const dur = _durationSec > 0 ? _durationSec : 300;
  const ratio = Math.max(0, Math.min((s || 0) / dur, 1));

  let target = 0;
  if (maxPos > 0) {
    target = Math.max(0, Math.min(Math.round(maxPos * ratio), maxPos));
  } else {
    // Fallback when backend does not yet report max position.
    target = Math.max(0, secondsToRawPos(s));
  }

  p.seekPlaybackPosition(target);

  // Defensive fallback: some WebSid builds ignore facade seek until a direct
  // backend seek is issued.
  try {
    const module = p?._backendAdapter?.Module;
    if (module?.ccall) {
      module.ccall('emu_seek_position', 'number', ['number'], [target]);
    }
  } catch (_) {}

  kickPlayback();
}

export function getTime() {
  const { rawPos, maxPos } = rawPlaybackWindow();
  if (maxPos > 0 && _durationSec > 0) {
    const ratio = Math.max(0, Math.min(rawPos / maxPos, 1));
    return ratio * _durationSec;
  }

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
