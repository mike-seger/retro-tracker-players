// js/folder-panel.js — List (folder/playlist) multi-select dropdown panel
import { S, elRefineFolderBtn, elRefineFolderPanel } from './state.js';
import { openDropdown } from './dropdown-keys.js';
import * as pm from './playlist-manager.js';
import { selectionState, buildPanelHead, appendPanelOption, syncPanelCheckboxes, wireDropdown } from './refine-panel.js';

let _savedFolders = null;
let _savedPlaylists = null;
let _openedFolders = null;
let _openedPlaylists = null;
let _openedFolderState = null;
let _masterCb = null;

function selectedListCount() {
  return S.selectedFolders.size + S.selectedPlaylists.size;
}

function allListCount() {
  return S._allFolderOptions.size + S._allPlaylistOptions.size;
}

function cycleMasterFolders() {
  const totalSize = allListCount();
  const current = selectionState(selectedListCount(), totalSize);
  const opened = _openedFolderState || current;

  let next;
  if (opened === 'some') {
    next = current === 'some' ? 'none' : (current === 'none' ? 'all' : 'some');
  } else if (opened === 'all') {
    next = current === 'none' ? 'all' : 'none';
  } else {
    next = current === 'all' ? 'none' : 'all';
  }

  if (next === 'all') {
    S.selectedFolders = new Set(S._allFolderOptions);
    S.selectedPlaylists = new Set(S._allPlaylistOptions);
  } else if (next === 'none') {
    S.selectedFolders = new Set();
    S.selectedPlaylists = new Set();
  } else {
    const restored = [...(_openedFolders || [])].filter(f => S._allFolderOptions.has(f));
    const restoredPlaylists = [...(_openedPlaylists || [])].filter(id => S._allPlaylistOptions.has(id));
    S.selectedFolders = new Set(restored);
    S.selectedPlaylists = new Set(restoredPlaylists);
  }

  updateFolderBtn();
  syncFolderCheckboxes();
  _onFolderChange?.();
}

let _onFolderChange = null;
export function setFolderChangeHandler(fn) { _onFolderChange = fn; }

export async function buildFolderPanel(folders) {
  const sorted = [...folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  // Only include lists that are visible in Playlist Manager's visibility panel.
  // System folders (e.g. 'unknown') are additionally gated by system visibility.
  const visibleSorted = sorted.filter((name) => {
    if (pm.isListHidden(pm.hiddenListKeyForFolder(name))) return false;
    if (pm.isSystemFolder(name) && !pm.isSystemFolderVisible(name)) return false;
    return true;
  });

  const prevAllFolderCount = S._allFolderOptions.size;
  const hadAllFoldersSelected = prevAllFolderCount > 0 && S.selectedFolders.size === prevAllFolderCount;
  S._allFolderOptions = new Set(visibleSorted);

  const allPlaylists = await pm.getAll();
  const visiblePlaylists = allPlaylists.filter(pl => !pm.isListHidden(pm.hiddenListKeyForPlaylist(pl.id)));
  const prevAllPlaylistCount = S._allPlaylistOptions.size;
  const hadAllPlaylistsSelected = prevAllPlaylistCount > 0 && S.selectedPlaylists.size === prevAllPlaylistCount;
  S._allPlaylistOptions = new Set(visiblePlaylists.map(pl => pl.id));
  S._playlistTrackSets = new Map(visiblePlaylists.map(pl => [pl.id, pm.buildTrackSet(pl.tracks)]));

  const kept = new Set([...S.selectedFolders].filter(f => S._allFolderOptions.has(f)));
  if (prevAllFolderCount === 0 && S.selectedFolders.size === 0) {
    S.selectedFolders = new Set(S._allFolderOptions);
  } else if (hadAllFoldersSelected) {
    S.selectedFolders = new Set(S._allFolderOptions);
  } else if (S.selectedFolders.size > 0) {
    S.selectedFolders = kept;
  }

  const keptPlaylists = new Set([...S.selectedPlaylists].filter(id => S._allPlaylistOptions.has(id)));
  if (prevAllPlaylistCount === 0 && S.selectedPlaylists.size === 0) {
    S.selectedPlaylists = new Set(S._allPlaylistOptions);
  } else if (hadAllPlaylistsSelected) {
    S.selectedPlaylists = new Set(S._allPlaylistOptions);
  } else if (S.selectedPlaylists.size > 0) {
    S.selectedPlaylists = keptPlaylists;
  }

  const panel = elRefineFolderPanel;
  panel.innerHTML = '';
  _masterCb = buildPanelHead(panel, 'List', cycleMasterFolders);

  const folderOptions = visibleSorted
    .map(name => ({
      type: 'folder',
      id: name,
      name: pm.isSystemFolder(name) ? pm.getSystemFolderLabel(name) : name,
    }));

  const playlistOptions = visiblePlaylists
    .map(pl => ({ type: 'playlist', id: pl.id, name: pl.name }));

  // Sort all lists together alphabetically, case-insensitive
  const options = [...folderOptions, ...playlistOptions]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  for (const opt of options) {
    const cb = appendPanelOption(
      panel, opt.id, opt.name,
      opt.type === 'folder' ? S.selectedFolders.has(opt.id) : S.selectedPlaylists.has(opt.id),
      (checked) => {
        if (opt.type === 'folder') {
          if (checked) S.selectedFolders.add(opt.id);
          else S.selectedFolders.delete(opt.id);
        } else {
          if (checked) S.selectedPlaylists.add(opt.id);
          else S.selectedPlaylists.delete(opt.id);
        }
        updateFolderBtn();
        syncFolderCheckboxes();
        _onFolderChange?.();
      },
      opt.type === 'playlist' ? 'pl-opt' : '',
    );
    cb.dataset.kind = opt.type;
  }

  updateFolderBtn();
  syncFolderCheckboxes();
}

export function syncFolderCheckboxes() {
  if (!_masterCb) return;
  syncPanelCheckboxes(
    _masterCb, elRefineFolderPanel,
    (value, kind) => kind === 'playlist' ? S.selectedPlaylists.has(value) : S.selectedFolders.has(value),
    selectedListCount(), allListCount(),
  );
}

export function updateFolderBtn() {
  const total = allListCount();
  const selected = selectedListCount();
  const active = total > 0 && selected < total;
  elRefineFolderBtn.textContent = 'L';
  elRefineFolderBtn.classList.toggle('active', active);
  elRefineFolderBtn.title = 'Filter by list';
  elRefineFolderBtn.hidden = total === 0;
}

export function clearFolderFilter() {
  S.selectedFolders = new Set(S._allFolderOptions);
  S.selectedPlaylists = new Set(S._allPlaylistOptions);
  updateFolderBtn();
  syncFolderCheckboxes();
}

// ── event listeners ───────────────────────────────────
elRefineFolderBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openDropdown(elRefineFolderBtn, elRefineFolderPanel);
});

wireDropdown(elRefineFolderBtn, elRefineFolderPanel,
  () => {
    _savedFolders = new Set(S.selectedFolders);
    _savedPlaylists = new Set(S.selectedPlaylists);
    _openedFolders = new Set(S.selectedFolders);
    _openedPlaylists = new Set(S.selectedPlaylists);
    _openedFolderState = selectionState(selectedListCount(), allListCount());
  },
  () => {
    if (_savedFolders !== null) {
      S.selectedFolders = _savedFolders;
      S.selectedPlaylists = _savedPlaylists || new Set();
      _savedFolders = null;
      _savedPlaylists = null;
      _openedFolders = null;
      _openedPlaylists = null;
      _openedFolderState = null;
      updateFolderBtn();
      syncFolderCheckboxes();
      _onFolderChange?.();
    }
  },
);
