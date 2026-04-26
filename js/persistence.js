// js/persistence.js — Persist filter context + play position to localStorage
import { S, elFilter } from './state.js';

export function persistContext() {
  if (!S._appReady) return;
  try {
    localStorage.setItem('app-context', JSON.stringify({
      mode:    S.searchMode,
      filter:  elFilter.value,
      folders: [...S.selectedFolders],
      artists: [...S.selectedArtists],
      formats: [...S.selectedFormats],
    }));
  } catch (_) {}
}

export function savePlayPos() {
  if (!S.playing || !S.activeEngine || !S.engines[S.activeEngine]) return;
  try {
    const saved = JSON.parse(localStorage.getItem('current-track'));
    if (!saved) return;
    saved.playPos = S.engines[S.activeEngine].getTime();
    localStorage.setItem('current-track', JSON.stringify(saved));
  } catch (_) {}
}

// ── event listeners ───────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') savePlayPos();
});
window.addEventListener('pagehide', savePlayPos);
