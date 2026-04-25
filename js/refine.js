// js/refine.js — Refine dropdown population + placeholder helpers
import { S, elRefineFolder, elRefineArtist, elRefineRange, elFilter } from './state.js';
import { extractArtist } from './utils.js';
import { buildFormatPanel } from './format-panel.js';
import { applyFilter } from './filter.js';
import { doModlandSearch, doRandomBrowse } from './modland.js';
import * as remoteSearch from './remote-search.js';

export function populateFolderDropdown() {
  elRefineFolder.innerHTML = '<option value="">Folder</option>';
  if (S.searchMode === 'modland') return; // populated dynamically in modland mode
  const folders = new Set();
  for (const f of S.mergedFiles) {
    if (f.playerId === 'ahx') continue; // AHX folders = artists, not genres
    const slash = f.name.lastIndexOf('/');
    if (slash >= 0) folders.add(f.name.substring(0, slash));
  }
  const sorted = [...folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (sorted.length > 50) {
    const letters = new Set(sorted.map(f => f[0].toUpperCase()));
    for (const ch of [...letters].sort()) elRefineFolder.appendChild(new Option(ch, ch));
  } else {
    for (const f of sorted) elRefineFolder.appendChild(new Option(f, f));
  }
}

export function populateLocalArtistDropdown() {
  const prev = elRefineArtist.value;
  elRefineArtist.innerHTML = '<option value="">Artist</option>';
  const folderVal = elRefineFolder.value.toLowerCase();
  const raw = elFilter.value.trim();
  const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const artists = new Set();

  for (const f of S.mergedFiles) {
    if (!S.enabledPlayers[f.playerId]) continue;
    const name = f.name.toLowerCase();
    if (folderVal) {
      const slash = name.lastIndexOf('/');
      const ef = slash >= 0 ? name.substring(0, slash) : '';
      if (folderVal.length === 1) {
        if (!(ef.length > 0 && ef[0] === folderVal)) continue;
      } else {
        if (ef !== folderVal) continue;
      }
    }
    if (terms.length > 0 && !terms.every(t => name.includes(t))) continue;
    const artist = extractArtist(f);
    if (artist) artists.add(artist);
  }

  const sorted = [...artists].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (sorted.length > 50) {
    const letters = new Set(sorted.map(a => a[0].toUpperCase()));
    for (const ch of [...letters].sort()) elRefineArtist.appendChild(new Option(ch, ch));
  } else {
    for (const a of sorted) elRefineArtist.appendChild(new Option(a, a));
  }

  if (prev && [...elRefineArtist.options].some(o => o.value === prev)) {
    elRefineArtist.value = prev;
  }
}

export function populateLocalFormatDropdown() {
  const exts = new Set();
  for (const f of S.mergedFiles) {
    if (!S.enabledPlayers[f.playerId]) continue;
    if (f.ext) exts.add(f.ext);
  }
  buildFormatPanel(exts);
}

export function populateRangeDropdown(total) {
  const prev = elRefineRange.value;
  elRefineRange.innerHTML = '<option value="">Range</option>';
  if (total <= 200) return;
  for (let i = 0; i < total; i += 200) {
    const end = Math.min(i + 200, total);
    elRefineRange.appendChild(new Option(`${i + 1}–${end}`, String(i)));
  }
  if (prev && [...elRefineRange.options].some(o => o.value === prev)) {
    elRefineRange.value = prev;
  }
}

export function localPlaceholder() {
  return `Search ${S.mergedFiles.length.toLocaleString()} local tracks…`;
}

export function modlandPlaceholder() {
  const cnt = remoteSearch.isLoaded() ? remoteSearch.entryCount() : 0;
  return cnt > 0 ? `Search ${cnt.toLocaleString()} modland tracks…` : 'Search modland…';
}

// ── event listeners ───────────────────────────────────
elRefineFolder.addEventListener('change', () => {
  if (S.searchMode === 'local') {
    populateLocalArtistDropdown();
    applyFilter();
  } else {
    doModlandSearch();
  }
});

elRefineArtist.addEventListener('change', () => {
  applyFilter();
});

elRefineRange.addEventListener('change', () => {
  if (S._randomBrowsing) {
    const skip = parseInt(elRefineRange.value, 10) || 0;
    doRandomBrowse(skip);
  } else {
    doModlandSearch();
  }
});
