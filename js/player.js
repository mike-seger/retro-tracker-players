// js/player.js — loadAndPlay, transport, seek, advance, prefetch
import { S, btnPlay, elSeek, elTime, elDur, elInfo, elTrackPos } from './state.js';
import { fmtTime, esc, trackUrl, tlog } from './utils.js';
import { ensureEngine } from './engines.js';
import { cacheFetch, cacheHas } from './cache.js';
import { activeFiles, highlightCurrent, setFocus, updateTrackPos,
         getVisibleIndices, alignInfoValueColumn, scrollIntoViewSmart } from './playlist.js';
import { setAdvanceTrackCallback } from './engines.js';

function renderInfoFields(fields) {
  elInfo.innerHTML = fields.map((f) =>
    `<div class="info-field">` +
    `<span class="label" aria-label="${esc(f.label)} label" title="Copy ${esc(f.label)}" data-copy="${esc(f.value)}" data-ui-doc="1">${esc(f.label)}:&nbsp;</span>` +
    `<span class="val" aria-label="${esc(f.label)} value" data-ui-doc="1">${esc(f.value)}</span>` +
    `</div>`
  ).join('');
  alignInfoValueColumn();
}

function renderInfoStatus(engineValue) {
  renderInfoFields([
    { label: 'Engine', value: engineValue || '—' },
    { label: 'Title', value: '—' },
    { label: 'Type', value: '—' },
    { label: 'Tracker', value: '—' },
  ]);
}

// ── load + play ───────────────────────────────────────
export async function loadAndPlay(idx) {
  const seq = ++S._loadSeq;
  const t0 = performance.now();
  const files = activeFiles();
  if (idx < 0 || idx >= files.length) return;

  const entry = files[idx];

  // Pause all engines before any async work to prevent stale audio overlap.
  for (const eng of Object.values(S.engines)) { try { eng.pause(); } catch (_) {} }

  let engine;
  try {
    engine = await ensureEngine(entry.playerId);
  } catch (e) {
    console.error('engine init failed:', entry.playerId, e);
    renderInfoStatus(`Engine init failed: ${String(e)}`);
    return;
  }
  if (seq !== S._loadSeq) { engine.pause(); return; }

  engine.pause(); // handles same-engine rapid clicks
  const tEngine = performance.now();

  S.currentIdx = idx;
  S.playing = true;
  S.loaded = true;
  S._playingUrl = entry.url || trackUrl(entry);
  localStorage.setItem('current-track', JSON.stringify({
    playerId: entry.playerId, name: entry.name, mode: S.searchMode, wasPlaying: true,
  }));

  const url = trackUrl(entry);

  elSeek.value = 0;
  elTime.textContent = '0:00';
  elDur.textContent = '—';
  renderInfoStatus('Loading…');
  highlightCurrent();
  setFocus(idx);
  updateTransportUI();
  updateTrackPos();

  const applyMeta = (result) => {
    if (S._loadSeq !== seq) return;
    renderInfoFields(result.fields);
    elSeek.max = result.duration || 300;
    elDur.textContent = fmtTime(result.duration || 300);
  };

  try {
    const playUrl = await cacheFetch(url);
    if (seq !== S._loadSeq) { engine.pause(); return; }
    const tFetch = performance.now();
    const result = await engine.load(playUrl);
    if (seq !== S._loadSeq) { engine.pause(); return; }
    const tLoad = performance.now();

    applyMeta(result);
    result.metaReady?.then(applyMeta).catch(() => {});

    if (S._debugTiming) {
      tlog(`[T] engine ${(tEngine - t0).toFixed(0)}ms  fetch ${(tFetch - tEngine).toFixed(0)}ms  decode ${(tLoad - tFetch).toFixed(0)}ms`);
    }
  } catch (e) {
    if (seq !== S._loadSeq) { try { engine?.pause(); } catch (_) {} return; }
    console.error('Failed to load', url, e);
    renderInfoStatus('Error loading track');
  }

  if (S._debugTiming) tlog(`[T] total ${(performance.now() - t0).toFixed(0)}ms`);
}

// ── advance + prev/next ───────────────────────────────
let _prefetchAbort = null;

export function advanceTrack() {
  if (S._advancing) return;
  S._advancing = true;
  const visible = getVisibleIndices();
  if (visible.length === 0) { S._advancing = false; return; }
  const pos = visible.indexOf(S.currentIdx);
  const nextIdx = pos >= 0 && pos < visible.length - 1 ? visible[pos + 1] : visible[0];
  loadAndPlay(nextIdx).then(
    () => { S._advancing = false; },
    () => { S._advancing = false; }
  );
  setTimeout(() => prefetchAhead(1, 5), 200);
}

export async function prefetchAhead(dir, count) {
  if (_prefetchAbort) _prefetchAbort.abort();
  const ctrl = _prefetchAbort = new AbortController();
  const visible = getVisibleIndices();
  if (visible.length === 0) return;
  const pos = visible.indexOf(S.currentIdx);
  if (pos < 0) return;
  const files = activeFiles();
  const urls = [];
  for (let i = 1; i <= count; i++) {
    const p = pos + dir * i;
    if (p < 0 || p >= visible.length) break;
    const entry = files[visible[p]];
    if (entry) {
      const u = trackUrl(entry);
      if (!cacheHas(u)) urls.push(u);
    }
  }
  for (const u of urls) {
    if (ctrl.signal.aborted) return;
    try { await cacheFetch(u); } catch (_) {}
  }
}

export function playPrevNext(dir) {
  const visible = getVisibleIndices();
  if (visible.length === 0) return;
  const pos = visible.indexOf(S.currentIdx);
  let newIdx;
  if (dir < 0) {
    newIdx = pos > 0 ? visible[pos - 1] : visible[visible.length - 1];
  } else {
    newIdx = pos >= 0 && pos < visible.length - 1 ? visible[pos + 1] : visible[0];
  }
  loadAndPlay(newIdx);
  setTimeout(() => prefetchAhead(dir, 5), 200);
}

// ── scrub ─────────────────────────────────────────────
export function scrub(delta) {
  if (!S.activeEngine || !S.engines[S.activeEngine] || S.currentIdx < 0) return;
  const engine = S.engines[S.activeEngine];
  const target = Math.max(0, engine.getTime() + delta);
  elTime.textContent = '>>>';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ok = engine.seekTo(target);
      const t = ok === false ? engine.getTime() : target;
      elTime.textContent = fmtTime(t);
      elSeek.value = t;
    });
  });
}

// ── transport UI ──────────────────────────────────────
export function updateTransportUI() {
  if (S.playing) {
    btnPlay.innerHTML = '&#10074;&#10074;';
    btnPlay.classList.add('active');
  } else {
    btnPlay.innerHTML = '&#9654;';
    btnPlay.classList.remove('active');
  }
}

// ── event listeners ───────────────────────────────────
btnPlay.addEventListener('click', async () => {
  if (S.currentIdx < 0 || !S.loaded) {
    const visible = getVisibleIndices();
    const idx = S.currentIdx >= 0 ? S.currentIdx : (visible[0] ?? 0);
    loadAndPlay(idx);
    return;
  }
  if (!S.activeEngine) return;
  const engine = S.engines[S.activeEngine];
  if (!engine) return;

  if (S.playing) {
    engine.pause();
    S.playing = false;
  } else {
    engine.resume();
    S.playing = true;
  }
  updateTransportUI();
  try {
    const saved = JSON.parse(localStorage.getItem('current-track'));
    if (saved) {
      saved.wasPlaying = S.playing;
      localStorage.setItem('current-track', JSON.stringify(saved));
    }
  } catch (_) {}
});

let _userDragging = false;
elSeek.addEventListener('pointerdown', () => { _userDragging = true; });
document.addEventListener('pointerup', () => { _userDragging = false; });

elSeek.addEventListener('change', () => {
  _userDragging = false;
  if (!S.activeEngine || !S.engines[S.activeEngine] || S.currentIdx < 0) return;
  const target = parseFloat(elSeek.value);
  const engine = S.engines[S.activeEngine];
  elTime.textContent = '>>>';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ok = engine.seekTo(target);
      const t = ok === false ? engine.getTime() : target;
      elTime.textContent = fmtTime(t);
      elSeek.value = t;
    });
  });
});

setInterval(() => {
  if (!S.activeEngine || !S.engines[S.activeEngine] || !S.playing) return;
  const engine = S.engines[S.activeEngine];
  const t = engine.getTime();
  elTime.textContent = fmtTime(t);
  if (!_userDragging) elSeek.value = t;
  if (engine.isEnded()) advanceTrack();
}, 250);

// Wire advanceTrack into engines.js (breaks circular dep at eval time)
setAdvanceTrackCallback(advanceTrack);
