// SPC engine adapter via @smwcentral/spc-player.
import { clamp01, loadScript, resolveExt } from '../shared.js';

const SPC_JS_URL = 'https://unpkg.com/@smwcentral/spc-player@2.0.2/dist/spc.js';

let _onEnd = null;
let _volume = 1;
let _loadGen = 0;

let _spcInitPromise = null;
let _spcReady = false;
let _songData = null;
let _spcDuration = 300;
let _spcPlaying = false;

function ensureSpcUiScaffold() {
  if (document.getElementById('spc-player-interface')) return;

  const root = document.createElement('div');
  root.id = 'spc-player-host-retrotrap';
  root.style.display = 'none';

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

const _spcWarmup = (async () => {
  ensureSpcUiScaffold();
  try { await loadScript(SPC_JS_URL); } catch (_) {}
})();

function getSpcNS() {
  return window.SMWCentral?.SPCPlayer || null;
}

function getBackend() {
  return getSpcNS()?.Backend || null;
}

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

    const ns = getSpcNS();
    const backend = getBackend();
    if (!ns || !backend) throw new Error('SPC backend not available');

    ns.onEnd = () => { _spcPlaying = false; _onEnd?.(); };
    ns.onError = (msg) => { console.warn('[spc]', msg); };

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
      { label: 'Engine', value: 'SPC' },
      { label: 'Title', value: meta.title || '—' },
      { label: 'Type', value: 'SPC' },
      { label: 'Tracker', value: meta.game || 'SNES SPC700' },
    ],
    duration: _spcDuration,
  };
}

export async function init() {
  await initSpc();
}

export async function load(url, entry) {
  const ext = resolveExt(url, entry);
  if (ext !== 'spc') {
    throw new Error(`Unsupported extension for spc engine: .${ext || 'unknown'}`);
  }

  const gen = ++_loadGen;
  const result = await loadSpc(url, gen);
  if (gen !== _loadGen) throw new Error('load superseded');
  return result;
}

export function pause() {
  try { getBackend()?.pause?.(); } catch (_) {}
  _spcPlaying = false;
}

export function resume() {
  const backend = getBackend();
  if (!backend) return;
  try { backend.unlock?.(); } catch (_) {}
  try { backend.resume?.(); } catch (_) {}
  _spcPlaying = true;
}

export function seekTo(s) {
  const t = Math.max(0, Number(s) || 0);
  const backend = getBackend();
  if (!backend || !_songData) return;
  backend.loadSPC(_songData, Math.min(t, _spcDuration || t));
  backend.setVolume?.(clamp01(_volume), 0);
}

export function getTime() {
  const backend = getBackend();
  if (!backend) return 0;
  try { return backend.getTime?.() || 0; } catch (_) { return 0; }
}

export function setVolume(v) {
  _volume = clamp01(v);
  getBackend()?.setVolume?.(_volume, 0);
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
}
