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

export function populateFolderPanel() {
  if (S.searchMode === 'modland') { clearFolderFilter(); return; }
  const folders = new Set();
  for (const f of S.mergedFiles) {
    if (f.playerId === 'ahx') continue; // AHX folders = artists, not genres
    const slash = f.name.lastIndexOf('/');
    if (slash >= 0) folders.add(f.name.substring(0, slash));
  }
  buildFolderPanel(folders);
}

export function populateLocalArtistPanel() {
  const foldersActive = S.selectedFolders.size > 0 && S.selectedFolders.size < S._allFolderOptions.size;
  const raw = elFilter.value.trim();
  const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const artists = new Set();

  for (const f of S.mergedFiles) {
    if (!S.enabledPlayers[f.playerId]) continue;
    const name = f.name.toLowerCase();
    if (foldersActive) {
      const slash = name.lastIndexOf('/');
      const ef = slash >= 0 ? f.name.substring(0, slash) : '';
      if (!S.selectedFolders.has(ef)) continue;
    }
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
  buildRangePanel(total, 200);
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
