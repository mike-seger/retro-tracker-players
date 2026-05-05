// js/refine.js — Refine panel population + placeholder helpers
import { S, elFilter } from './state.js';
import { extractArtist } from './utils.js';
import { buildFormatPanel } from './format-panel.js';
import { buildFolderPanel, clearFolderFilter } from './folder-panel.js';
import { buildArtistPanel } from './artist-panel.js';
import { buildRangePanel, getRangeSkip } from './range-panel.js';
import { applyFilter } from './filter.js';
import { doModlandSearch, doRandomBrowse } from './modland.js';
import * as remoteSearch from './remote-search.js';
import { isSystemFolder, isSystemFolderVisible } from './playlist-manager.js';
import { getMaxListItems } from './settings.js';

export async function populateFolderPanel() {
  if (S.searchMode === 'modland') { clearFolderFilter(); return; }
  const folders = new Set();
  for (const f of S.mergedFiles) {
    if (f.source === 'user-playlist') continue;
    if (f.playerId === 'ahx') continue; // AHX folders = artists, not genres
    const slash = f.name.lastIndexOf('/');
    if (slash >= 0) folders.add(f.name.substring(0, slash));
  }
  await buildFolderPanel(folders);

  // List options may complete after initial playlist render; refresh dependent
  // local refinements so visible rows reflect the resolved list scope.
  if (S.searchMode === 'local') {
    populateLocalArtistPanel();
    applyFilter();
  }
}

export function populateLocalArtistPanel() {
  const totalLists = S._allFolderOptions.size + S._allPlaylistOptions.size;
  const listsActive = true;
  const raw = elFilter.value.trim();
  const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const artists = new Set();

  const inSelectedPlaylist = (entry) => {
    if (!entry) return false;
    if (S.selectedPlaylists.size === 0) return false;
    const key = entry.url || (entry.playerId + ':' + entry.name);
    for (const id of S.selectedPlaylists) {
      if (S._playlistTrackSets.get(id)?.has(key)) return true;
    }
    return false;
  };

  const inSelectedFolder = (entry) => {
    if (!entry) return false;
    // User-playlist rows are controlled by playlist selection, not folder selection.
    if (entry.source === 'user-playlist') return false;
    if (S.selectedFolders.size === 0) return false;
    const slash = entry.name.lastIndexOf('/');
    const ef = slash >= 0 ? entry.name.substring(0, slash) : '';
    // Hidden system folders must not leak into the visible dataset.
    if (!S._allFolderOptions.has(ef)) {
      return isSystemFolder(ef) && isSystemFolderVisible(ef);
    }
    return S.selectedFolders.has(ef);
  };

  const inSelectedLists = (entry) => inSelectedFolder(entry) || inSelectedPlaylist(entry);

  for (const f of S.mergedFiles) {
    if (!S.enabledPlayers[f.playerId]) continue;
    const name = f.name.toLowerCase();
    if (listsActive && !inSelectedLists(f)) continue;
    if (terms.length > 0 && !terms.every(t => name.includes(t))) continue;
    const artist = extractArtist(f);
    if (artist) artists.add(artist);
  }

  buildArtistPanel(artists);
}

export function populateLocalFormatDropdown() {
  const exts = new Set();
  for (const f of S.mergedFiles) {
    if (!S.enabledPlayers[f.playerId]) continue;
    if (f.ext) exts.add(f.ext);
  }
  buildFormatPanel(exts);
}

export function populateRangePanel(total) {
  buildRangePanel(total, getMaxListItems());
}

export function localPlaceholder() {
  return `Search ${S.mergedFiles.length.toLocaleString()} local tracks…`;
}

export function modlandPlaceholder() {
  const cnt = remoteSearch.isLoaded() ? remoteSearch.entryCount() : 0;
  return cnt > 0 ? `Search ${cnt.toLocaleString()} modland tracks…` : 'Search modland…';
}

// ── Change handlers wired up by app.js after all modules load ─────────────
// (folder/artist panels call back via setFolderChangeHandler / setArtistChangeHandler)
