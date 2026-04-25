// js/mode.js — switchMode + per-mode context save/restore
import { S, elFilter, elRefineFolder, elRefineArtist, elRefineRange,
         elSearchMode, elSelBulk, elList } from './state.js';
import { clearFormatFilter, updateFormatBtn, syncFormatCheckboxes } from './format-panel.js';
import { buildPlaylist, scrollIntoViewSmart } from './playlist.js';
import { applyFilter, updateRefineVisibility } from './filter.js';
import { populateFolderDropdown, populateLocalArtistDropdown,
         populateLocalFormatDropdown, localPlaceholder, modlandPlaceholder } from './refine.js';
import { doModlandSearch, updateMlButtons } from './modland.js';
import { persistContext } from './persistence.js';
import { restoreSelection, updateSelCount } from './selection.js';
import { trackUrl } from './utils.js';

// ── context save/restore ──────────────────────────────
export function saveLocalContext() {
  S._localCtx = {
    filter:     elFilter.value,
    folder:     elRefineFolder.value,
    artist:     elRefineArtist.value,
    formats:    new Set(S.selectedFormats),
    currentIdx: S.currentIdx,
    focusedIdx: S.focusedIdx,
  };
}

export function restoreLocalContext() {
  if (!S._localCtx) return;
  elFilter.value = S._localCtx.filter;
  if (S._localCtx.folder &&
      [...elRefineFolder.options].some(o => o.value === S._localCtx.folder)) {
    elRefineFolder.value = S._localCtx.folder;
  }
  populateLocalArtistDropdown();
  if (S._localCtx.artist &&
      [...elRefineArtist.options].some(o => o.value === S._localCtx.artist)) {
    elRefineArtist.value = S._localCtx.artist;
  }
  S.selectedFormats = new Set(
    [...S._localCtx.formats].filter(f => S._allFormatOptions.has(f))
  );
  updateFormatBtn();
  syncFormatCheckboxes();
  if (S._localCtx.currentIdx >= 0) S.currentIdx = S._localCtx.currentIdx;
  if (S._localCtx.focusedIdx >= 0) S.focusedIdx = S._localCtx.focusedIdx;
}

export function saveModlandContext() {
  const folderOpt = [...elRefineFolder.options].find(o => o.value === elRefineFolder.value);
  S._modlandCtx = {
    filter:      elFilter.value,
    folder:      elRefineFolder.value,
    folderLabel: folderOpt ? folderOpt.text : elRefineFolder.value,
    currentIdx:  S.currentIdx,
    focusedIdx:  S.focusedIdx,
  };
}

export function restoreModlandContext() {
  if (!S._modlandCtx) return;
  elFilter.value = S._modlandCtx.filter;
  elRefineFolder.innerHTML = '<option value="">Folder</option>';
  if (S._modlandCtx.folder) {
    elRefineFolder.appendChild(new Option(S._modlandCtx.folderLabel, S._modlandCtx.folder));
    elRefineFolder.value = S._modlandCtx.folder;
  }
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
    if (saved.folder) {
      const opt = [...elRefineFolder.options].find(o => o.value === saved.folder);
      if (opt) {
        elRefineFolder.value = saved.folder;
      } else if (S.searchMode === 'modland') {
        elRefineFolder.appendChild(new Option(saved.folder, saved.folder));
        elRefineFolder.value = saved.folder;
      }
    }
    if (saved.artist && S.searchMode === 'local') {
      populateLocalArtistDropdown();
      if ([...elRefineArtist.options].some(o => o.value === saved.artist)) {
        elRefineArtist.value = saved.artist;
      }
    }
    if (saved.formats?.length && S.searchMode === 'local') {
      S.selectedFormats = new Set(saved.formats.filter(f => S._allFormatOptions.has(f)));
      updateFormatBtn();
      syncFormatCheckboxes();
    }
    if (S.searchMode === 'modland' && (elFilter.value.trim().length >= 2 || elRefineFolder.value)) {
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

  elRefineFolder.value = '';
  elRefineArtist.value = '';
  elRefineRange.value = '';
  clearFormatFilter();
  S.currentIdx = -1;
  S.focusedIdx = -1;

  if (mode === 'local') {
    populateLocalArtistDropdown();
    populateFolderDropdown();
    populateLocalFormatDropdown();
    elSelBulk.style.display = '';
    restoreLocalContext();
  } else {
    elRefineFolder.innerHTML = '<option value="">Folder</option>';
    import('./format-panel.js').then(m => m.buildFormatPanel([]));
    restoreModlandContext();
  }

  if (mode === 'modland' && (elFilter.value.trim().length >= 2 || elRefineFolder.value)) {
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
