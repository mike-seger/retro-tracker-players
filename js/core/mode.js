// js/mode.js — switchMode + per-mode context save/restore
import { S, elFilter, elSearchMode, elSelBulk } from './state.js';
import { clearFormatFilter, updateFormatBtn, syncFormatCheckboxes } from '../filters/format-panel.js';
import { clearFolderFilter, updateFolderBtn, syncFolderCheckboxes } from '../filters/folder-panel.js';
import { clearArtistFilter, updateArtistBtn, syncArtistCheckboxes } from '../filters/artist-panel.js';
import { clearRangeFilter } from '../filters/range-panel.js';
import { buildPlaylist, syncPlayingTrackByUrl } from '../playlists/playlist.js';
import { applyFilter, updateRefineVisibility } from '../filters/filter.js';
import { populateFolderPanel, populateLocalArtistPanel,
         populateLocalFormatDropdown, localPlaceholder, modlandPlaceholder } from '../filters/refine.js';
import { doModlandSearch, abortModlandSearch, cancelScheduledSearch as cancelScheduledModlandSearch, updateMlButtons, showScratchpad } from '../browse/modland.js';
import { persistContext } from './persistence.js';
import { restoreSelection, updateSelCount } from '../playlists/selection.js';
import * as remoteSearch from '../browse/remote-search.js';
import { getDisabledFormats } from '../settings/settings.js';

// ── context save/restore ──────────────────────────────
export function saveLocalContext() {
  S._localCtx = {
    filter:         elFilter.value,
    selectedFolders: new Set(S.selectedFolders),
    selectedPlaylists: new Set(S.selectedPlaylists),
    selectedArtists: new Set(S.selectedArtists),
    formats:         new Set(S.selectedFormats),
    currentIdx:      S.currentIdx,
    focusedIdx:      S.focusedIdx,
    range:           S._currentRange,
  };
}

export function restoreLocalContext() {
  if (!S._localCtx) return;
  elFilter.value = S._localCtx.filter;
  S.selectedFolders = new Set(
    [...S._localCtx.selectedFolders].filter(f => S._allFolderOptions.has(f))
  );
  S.selectedPlaylists = new Set(
    [...(S._localCtx.selectedPlaylists || [])].filter(id => S._allPlaylistOptions.has(id))
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
  if (S._localCtx.range > 0) S._currentRange = S._localCtx.range;
}

export function saveModlandContext() {
  if (S._viewingScratchpad) return; // don't save the transient empty-filter scratchpad state
  S._modlandCtx = {
    filter:     elFilter.value,
    currentIdx: S.currentIdx,
    focusedIdx: S.focusedIdx,
    range:      S._currentRange,
  };
}

export function restoreModlandContext() {
  if (!S._modlandCtx) return;
  elFilter.value = S._modlandCtx.filter;
  // Do NOT restore currentIdx/focusedIdx here — buildPlaylist() is about to
  // render S.modlandFiles (not search results), so any saved index would be
  // stale and out of range. doModlandSearch() re-anchors via syncPlayingTrackByUrl.
  if (S._modlandCtx.range > 0) S._currentRange = S._modlandCtx.range;
}

// ── restorePersistedContext ───────────────────────────
export function restorePersistedContext() {
  try {
    const raw = localStorage.getItem('app-context');
    const saved = JSON.parse(raw);
    if (!saved) return;

    const isScratchpad = saved.mode === 'scratchpad';
    const targetMode   = isScratchpad ? 'modland' : (saved.mode || S.searchMode);
    const savedRange   = saved.range || 0;

    // Pre-populate the target-mode context so switchMode → restoreXxxContext
    // restores S._currentRange before the first search/filter fires.
    if (targetMode === 'modland') {
      S._modlandCtx = { filter: isScratchpad ? '' : (saved.filter || ''), range: savedRange };
    }

    if (targetMode !== S.searchMode) {
      switchMode(targetMode, { skipSearch: true });
    } else if (savedRange > 0) {
      // Already in the target mode — apply range directly.
      S._currentRange = savedRange;
    }

    if (targetMode === 'local') {
      if (saved.filter) elFilter.value = saved.filter;
      if (Array.isArray(saved.folders)) {
        S.selectedFolders = new Set(saved.folders.filter(f => S._allFolderOptions.has(f)));
        updateFolderBtn();
        syncFolderCheckboxes();
      }
      if (Array.isArray(saved.playlists)) {
        S.selectedPlaylists = new Set(saved.playlists.filter(id => S._allPlaylistOptions.has(id)));
        updateFolderBtn();
        syncFolderCheckboxes();
      }
      if (Array.isArray(saved.artists)) {
        S.selectedArtists = new Set(saved.artists.filter(a => S._allArtistOptions.has(a)));
        updateArtistBtn();
        syncArtistCheckboxes();
      }
      if (Array.isArray(saved.formats)) {
        S.selectedFormats = new Set(saved.formats.filter(f => S._allFormatOptions.has(f)));
        updateFormatBtn();
        syncFormatCheckboxes();
      }
      applyFilter();
    } else {
      // Modland or scratchpad: range was pre-seeded into S._modlandCtx and
      // restored by switchMode → restoreModlandContext. Trigger the display.
      if (isScratchpad) {
        showScratchpad();
      } else {
        // Defensively re-apply the saved filter immediately before the search,
        // in case switchMode or any intermediate step cleared elFilter.value.
        if (saved.filter) elFilter.value = saved.filter;
        doModlandSearch();
      }
    }
  } catch (_) {}
}

// ── switchMode ────────────────────────────────────────
// opts.skipSearch — pass true to suppress the automatic doModlandSearch() call.
// Used by deep-link loading which manages its own search/display flow.
export function switchMode(mode, { skipSearch = false } = {}) {
  // Capture the current filter before saving/restoring contexts so it can be
  // transferred to the target mode (shared search input across Lo/Ml).
  // Don't transfer when coming from scratchpad — it intentionally clears the filter.
  const transferFilter = S._viewingScratchpad ? null : elFilter.value;

  if (S.searchMode === 'local') saveLocalContext();
  else if (S.searchMode === 'modland') saveModlandContext();

  S.searchMode = mode;
  S._viewingScratchpad = false; // always clear on a real mode switch
  elSearchMode.textContent = mode === 'local' ? 'Lo' : 'Ml';
  elSearchMode.dataset.value = mode;
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
    if (transferFilter) elFilter.value = transferFilter;
  } else {
    remoteSearch.loadIndex()
      .then(() => {
        remoteSearch.applyDisabledFormats(getDisabledFormats());
        return import('../filters/format-panel.js').then(m => m.buildFormatPanel(remoteSearch.availableFormats()));
      })
      .catch(() => import('../filters/format-panel.js').then(m => m.buildFormatPanel([])));
    restoreModlandContext();
    if (transferFilter) elFilter.value = transferFilter;
  }

  // Show scratchpad immediately as a loading placeholder, then trigger the
  // index search (which replaces it with the first alphabetical page).
  buildPlaylist();
  restoreSelection();
  if (mode === 'modland' && !skipSearch) {
    // Cancel any debounced search timer that may have been set by the input
    // handler before the mode switch, then abort any in-flight search so this
    // fresh mode-switch search always wins cleanly.
    cancelScheduledModlandSearch();
    abortModlandSearch();
    doModlandSearch();
  }

  // Re-anchor to the currently playing track in the newly displayed list.
  requestAnimationFrame(() => {
    syncPlayingTrackByUrl('switchMode');
  });

  updateSelCount();
}

