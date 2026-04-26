// js/mode.js — switchMode + per-mode context save/restore
import { S, elFilter, elSearchMode, elSelBulk, elList } from './state.js';
import { clearFormatFilter, updateFormatBtn, syncFormatCheckboxes } from './format-panel.js';
import { clearFolderFilter, updateFolderBtn, syncFolderCheckboxes } from './folder-panel.js';
import { clearArtistFilter, updateArtistBtn, syncArtistCheckboxes } from './artist-panel.js';
import { clearRangeFilter } from './range-panel.js';
import { buildPlaylist, scrollIntoViewSmart } from './playlist.js';
import { applyFilter, updateRefineVisibility } from './filter.js';
import { populateFolderPanel, populateLocalArtistPanel,
         populateLocalFormatDropdown, localPlaceholder, modlandPlaceholder } from './refine.js';
import { doModlandSearch, updateMlButtons } from './modland.js';
import { persistContext } from './persistence.js';
import { restoreSelection, updateSelCount } from './selection.js';
import { trackUrl } from './utils.js';

// ── context save/restore ──────────────────────────────
export function saveLocalContext() {
  S._localCtx = {
    filter:         elFilter.value,
    selectedFolders: new Set(S.selectedFolders),
    selectedArtists: new Set(S.selectedArtists),
    formats:         new Set(S.selectedFormats),
    currentIdx:      S.currentIdx,
    focusedIdx:      S.focusedIdx,
  };
}

export function restoreLocalContext() {
  if (!S._localCtx) return;
  elFilter.value = S._localCtx.filter;
  S.selectedFolders = new Set(
    [...S._localCtx.selectedFolders].filter(f => S._allFolderOptions.has(f))
  );
  updateFolderBtn();
  syncFolderCheckboxes();
  populateLocalArtistPanel();
  S.selectedArtists = new Set(
    [...S._localCtx.selectedArtists].filter(a => S._allArtistOptions.has(a))
  );
  updateArtistBtn();
  syncArtistCheckboxes();
  S.selectedFormats = new Set(
    [...S._localCtx.formats].filter(f => S._allFormatOptions.has(f))
  );
  updateFormatBtn();
  syncFormatCheckboxes();
  if (S._localCtx.currentIdx >= 0) S.currentIdx = S._localCtx.currentIdx;
  if (S._localCtx.focusedIdx >= 0) S.focusedIdx = S._localCtx.focusedIdx;
}

export function saveModlandContext() {
  S._modlandCtx = {
    filter:     elFilter.value,
    currentIdx: S.currentIdx,
    focusedIdx: S.focusedIdx,
  };
}

export function restoreModlandContext() {
  if (!S._modlandCtx) return;
  elFilter.value = S._modlandCtx.filter;
  if (S._modlandCtx.currentIdx >= 0) S.currentIdx = S._modlandCtx.currentIdx;
  if (S._modlandCtx.focusedIdx >= 0) S.focusedIdx = S._modlandCtx.focusedIdx;
}

// ── restorePersistedContext ───────────────────────────
export function restorePersistedContext() {
  try {
    const saved = JSON.parse(localStorage.getItem('app-context'));
    if (!saved) return;
    if (saved.mode && saved.mode !== S.searchMode) {
      switchMode(saved.mode);
    }
    if (saved.filter) elFilter.value = saved.filter;
    if (saved.folders?.length && S.searchMode === 'local') {
      S.selectedFolders = new Set(saved.folders.filter(f => S._allFolderOptions.has(f)));
      updateFolderBtn();
      syncFolderCheckboxes();
    }
    if (saved.artists?.length && S.searchMode === 'local') {
      S.selectedArtists = new Set(saved.artists.filter(a => S._allArtistOptions.has(a)));
      updateArtistBtn();
      syncArtistCheckboxes();
    }
    if (saved.formats?.length && S.searchMode === 'local') {
      S.selectedFormats = new Set(saved.formats.filter(f => S._allFormatOptions.has(f)));
      updateFormatBtn();
      syncFormatCheckboxes();
    }
    if (S.searchMode === 'modland' && elFilter.value.trim().length >= 2) {
      doModlandSearch();
    } else {
      applyFilter();
    }
  } catch (_) {}
}

// ── switchMode ────────────────────────────────────────
export function switchMode(mode) {
  if (S.searchMode === 'local') saveLocalContext();
  else if (S.searchMode === 'modland') saveModlandContext();

  S.searchMode = mode;
  elSearchMode.value = mode;
  document.body.classList.toggle('mode-modland', mode === 'modland');
  updateMlButtons();
  updateRefineVisibility();
  elFilter.placeholder = mode === 'local' ? localPlaceholder() : modlandPlaceholder();

  clearFolderFilter();
  clearArtistFilter();
  clearRangeFilter();
  clearFormatFilter();
  S.currentIdx = -1;
  S.focusedIdx = -1;

  if (mode === 'local') {
    populateFolderPanel();
    populateLocalArtistPanel();
    populateLocalFormatDropdown();
    elSelBulk.style.display = '';
    restoreLocalContext();
  } else {
    import('./format-panel.js').then(m => m.buildFormatPanel([]));
    restoreModlandContext();
  }

  if (mode === 'modland' && elFilter.value.trim().length >= 2) {
    doModlandSearch();
  } else {
    buildPlaylist();
    restoreSelection();
  }

  // Scroll playing track into view after DOM settles
  setTimeout(() => {
    const files = S.searchMode === 'local' ? S.mergedFiles : S.modlandFiles;
    if (S._playingUrl && files.length) {
      const idx = files.findIndex(e => (e.url || trackUrl(e)) === S._playingUrl);
      if (idx >= 0 && elList.children[idx]) {
        elList.children[idx].classList.add('current');
        scrollIntoViewSmart(elList.children[idx], true);
      }
    }
  }, 0);

  updateSelCount();
}

