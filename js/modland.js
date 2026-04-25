// js/modland.js — Modland file management, search, random browse, mode helpers
import { S, elFilter, elRefineFolder, elRefineRange, elFilterCnt,
         elSelBulk, elMlAddAll, elMlDelAll, elMlRandom, elList } from './state.js';
import { esc, trimDisplayPath, trackUrl, addLongPress } from './utils.js';
import { SID_TRACK_PLAYER_ID } from './state.js';
import { buildFormatPanel } from './format-panel.js';
import { loadAndPlay } from './player.js';
import { activeFiles, scrollIntoViewSmart, updateTrackPos, buildPlaylist } from './playlist.js';
import { restoreSelection } from './selection.js';
import { updateSelCount } from './selection.js';
import { populateRangeDropdown } from './refine.js';
import { showDeleteConfirm } from './prompts.js';
import * as remoteSearch from './remote-search.js';

// ── helpers ───────────────────────────────────────────
function detectPlayerIdFromUrl(url) {
  const ext = url.split('.').pop().toLowerCase();
  if (ext === 'ahx') return 'ahx';
  if (ext === 'sid') return SID_TRACK_PLAYER_ID;
  if (['mod', 'xm', 's3m', 'it'].includes(ext)) return 'mod';
  return null;
}

function urlToTrack(url) {
  const playerId = detectPlayerIdFromUrl(url);
  if (!playerId) return null;
  const { extOf } = { extOf: (u) => { const d = u.lastIndexOf('.'); return d >= 0 ? u.substring(d + 1).toUpperCase() : ''; } };
  const segments = new URL(url).pathname.split('/').map(decodeURIComponent);
  const artist = (segments[segments.length - 2] || '').replace(/\//g, '+');
  const file = segments[segments.length - 1];
  const name = `${artist}/${file}`;
  const dot = url.lastIndexOf('.');
  const ext = dot >= 0 ? url.substring(dot + 1).toUpperCase() : '';
  return { name, ext, playerId, url };
}

// ── file list management ──────────────────────────────
export function loadModlandTracks() {
  S.modlandFiles = [];
  const seen = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem('remote-urls'));
    if (Array.isArray(saved)) {
      for (const url of saved) {
        if (seen.has(url)) continue;
        const t = urlToTrack(url);
        if (t) { seen.add(url); S.modlandFiles.push(t); }
      }
    }
  } catch (_) {}
  S.modlandFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function saveModlandUrls() {
  const urls = S.modlandFiles.map(t => t.url);
  localStorage.setItem('remote-urls', JSON.stringify(urls));
}

export function addModlandTrack(entry) {
  if (S.modlandFiles.some(t => t.url === entry.url)) return false;
  S.modlandFiles.push(entry);
  S.modlandFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  saveModlandUrls();
  return true;
}

export function addModlandTracks(entries) {
  const existing = new Set(S.modlandFiles.map(t => t.url));
  let added = 0;
  for (const entry of entries) {
    if (existing.has(entry.url)) continue;
    existing.add(entry.url);
    S.modlandFiles.push(entry);
    added++;
  }
  if (added > 0) {
    S.modlandFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    saveModlandUrls();
    if (S.searchMode === 'modland') {
      import('./mode.js').then(m => m.switchMode('modland'));
    }
  }
  return added;
}

export function deleteModlandTrack(url) {
  S.modlandFiles = S.modlandFiles.filter(t => t.url !== url);
  S.modlandSelected.clear();
  saveModlandUrls();
  if (S.searchMode === 'modland') {
    if (elFilter.value.trim().length >= 2) doModlandSearch();
    else {
      import('./mode.js').then(m => m.switchMode('modland'));
    }
  }
}

export function deleteModlandByUrls(urls) {
  const removeSet = new Set(urls);
  S.modlandFiles = S.modlandFiles.filter(t => !removeSet.has(t.url));
  S.modlandSelected.clear();
  saveModlandUrls();
  if (S.searchMode === 'modland') {
    if (elFilter.value.trim().length >= 2) doModlandSearch();
    else {
      import('./mode.js').then(m => m.switchMode('modland'));
    }
  }
}

// ── artist search (cross-mode) ────────────────────────
export function searchByArtist(artist) {
  import('./mode.js').then(m => {
    if (S.searchMode !== 'modland') m.switchMode('modland');
    const clean = artist.replace(/^-\s*/, '');
    elFilter.value = '';
    elRefineFolder.innerHTML = '<option value="">Folder</option>';
    elRefineFolder.appendChild(new Option(clean, clean));
    elRefineFolder.value = clean;
    doModlandSearch();
  });
}

// ── ML button visibility ──────────────────────────────
export function updateMlButtons() {
  const isMl = S.searchMode === 'modland';
  const hasResults = S._lastSearchResults.length > 0;
  elMlAddAll.style.display = isMl && hasResults ? '' : 'none';
  elMlDelAll.style.display = isMl && S.modlandFiles.length > 0 ? '' : 'none';
  elMlRandom.style.display = isMl ? '' : 'none';
  if (isMl && hasResults) elMlAddAll.textContent = 'Add all';
}

// ── modland search ────────────────────────────────────
export function doModlandSearch() {
  S._randomBrowsing = false;
  const raw = elFilter.value.trim();
  const folderVal = elRefineFolder.value;
  const skip = parseInt(elRefineRange.value) || 0;

  if (raw.length < 2 && !folderVal) {
    S._lastSearchResults = [];
    S._inSearchResults = false;
    updateMlButtons();
    populateRangeDropdown(0);
    buildPlaylist();
    restoreSelection();
    return;
  }

  let q;
  if (folderVal) {
    q = folderVal.length === 1
      ? folderVal.toLowerCase() + (raw ? ' ' + raw : '')
      : folderVal + '/' + (raw ? ' ' + raw : '');
  } else {
    q = raw;
  }

  if (!remoteSearch.isLoaded()) {
    elFilterCnt.textContent = 'loading…';
    remoteSearch.loadIndex().then(() => doModlandSearch());
    return;
  }

  const total = remoteSearch.count(q);
  let clampedSkip = skip;
  if (clampedSkip > 0 && clampedSkip + 200 > total) clampedSkip = Math.max(total - 200, 0);

  const results = remoteSearch.search(q, 200, clampedSkip);
  const filtered = results.filter(r => S.enabledPlayers[r.playerId] !== false);
  S._lastSearchSkip = clampedSkip;
  S._lastSearchTotal = total;
  S._inSearchResults = true;

  populateRangeDropdown(total);

  // Populate folder dropdown from result folders
  const prevFolder = elRefineFolder.value;
  const folders = new Set();
  for (const r of filtered) {
    const s = r.name.lastIndexOf('/');
    if (s >= 0) folders.add(r.name.substring(0, s));
  }
  elRefineFolder.innerHTML = '<option value="">Folder</option>';
  const sortedFolders = [...folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (sortedFolders.length > 50) {
    const letters = new Set(sortedFolders.map(f => f[0].toUpperCase()));
    for (const ch of [...letters].sort()) elRefineFolder.appendChild(new Option(ch, ch));
  } else {
    for (const f of sortedFolders) elRefineFolder.appendChild(new Option(f, f));
  }
  if (prevFolder) {
    if (![...elRefineFolder.options].some(o => o.value === prevFolder)) {
      elRefineFolder.appendChild(new Option(prevFolder, prevFolder));
    }
    elRefineFolder.value = prevFolder;
  }

  // Populate format dropdown
  const formats = new Set();
  for (const r of filtered) formats.add(r.ext.toUpperCase());
  buildFormatPanel(formats);

  const displayed = (S.selectedFormats.size > 0 && S.selectedFormats.size < S._allFormatOptions.size)
    ? filtered.filter(r => S.selectedFormats.has(r.ext.toUpperCase()))
    : filtered;
  S._lastSearchResults = displayed;

  const playingUrl = S._playingUrl;

  elList.innerHTML = '';
  const addedUrls = new Set(S.modlandFiles.map(t => t.url));

  elFilterCnt.textContent = '';
  elSelBulk.style.display = 'none';
  updateMlButtons();
  updateTrackPos();

  for (let si = 0; si < displayed.length; si++) {
    const r = displayed[si];
    const li = document.createElement('li');
    li.dataset.idx = si;
    const slash = r.name.lastIndexOf('/');
    const artist = slash >= 0 ? trimDisplayPath(r.name.substring(0, slash)) : '';
    const baseName = slash >= 0 ? r.name.substring(slash + 1) : r.name;
    const displayName = baseName.replace(/\.\w+$/i, '').replace(/_/g, ' ');
    const isAdded = addedUrls.has(r.url);

    li.classList.add('remote');
    li.innerHTML =
      `<span class="idx"></span>` +
      (artist ? `<span class="artist">${esc(artist)}</span> ` : '') +
      `<span class="name">${esc(displayName)}</span>` +
      `<button class="r-dl" title="Download">D</button>` +
      `<span class="ext">${esc(r.ext)}</span>` +
      `<button class="r-add">${isAdded ? '✓' : '+'}</button>`;

    if (isAdded) li.classList.add('added');

    li.querySelector('.r-dl').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const a = document.createElement('a');
      a.href = r.url;
      a.download = baseName || r.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    li.querySelector('.r-add').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (li.classList.contains('added')) return;
      addModlandTrack(r);
      addedUrls.add(r.url);
      li.classList.add('added');
      li.querySelector('.r-add').textContent = '✓';
    });

    li.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('r-add') || ev.target.classList.contains('r-dl')) return;
      loadAndPlay(si);
    });

    if (artist) {
      li.addEventListener('dblclick', (ev) => {
        if (ev.target.classList.contains('r-add') || ev.target.classList.contains('r-dl')) return;
        searchByArtist(artist);
      });
      addLongPress(li, () => searchByArtist(artist));
    }

    elList.appendChild(li);
  }

  S.currentIdx = -1;
  if (playingUrl) {
    const ci = displayed.findIndex(r => r.url === playingUrl);
    if (ci >= 0) {
      S.currentIdx = ci;
      const curLi = elList.children[ci];
      if (curLi) {
        curLi.classList.add('current');
        scrollIntoViewSmart(curLi, true);
      }
    }
  }
  updateTrackPos();
  updateMlButtons();
}

// ── random browse ─────────────────────────────────────
export function doRandomBrowse(skip) {
  if (!remoteSearch.isLoaded()) return;

  const total = remoteSearch.totalPlayable();
  const results = remoteSearch.browseAll(1000, skip);

  S._lastSearchSkip = skip;
  S._lastSearchTotal = total;
  S._inSearchResults = true;

  // Populate range dropdown with pages of 1000
  elRefineRange.innerHTML = '<option value="">Range</option>';
  for (let i = 0; i < total; i += 1000) {
    const end = Math.min(i + 1000, total);
    elRefineRange.appendChild(new Option(`${i + 1}–${end}`, String(i)));
  }
  elRefineRange.value = String(skip);

  const formats = new Set();
  for (const r of results) formats.add(r.ext.toUpperCase());
  buildFormatPanel(formats);

  const displayed = (S.selectedFormats.size > 0 && S.selectedFormats.size < S._allFormatOptions.size)
    ? results.filter(r => S.selectedFormats.has(r.ext.toUpperCase()))
    : results;
  S._lastSearchResults = displayed;

  const playingUrl = S._playingUrl;

  elList.innerHTML = '';
  const addedUrls = new Set(S.modlandFiles.map(t => t.url));

  elFilterCnt.textContent = `${skip + 1}–${Math.min(skip + 1000, total)} of ${total}`;
  elSelBulk.style.display = 'none';
  updateMlButtons();

  for (let si = 0; si < displayed.length; si++) {
    const r = displayed[si];
    const li = document.createElement('li');
    li.dataset.idx = si;
    const slash = r.name.lastIndexOf('/');
    const artist = slash >= 0 ? trimDisplayPath(r.name.substring(0, slash)) : '';
    const baseName = slash >= 0 ? r.name.substring(slash + 1) : r.name;
    const displayName = baseName.replace(/\.\w+$/i, '').replace(/_/g, ' ');
    const isAdded = addedUrls.has(r.url);

    li.classList.add('remote');
    li.innerHTML =
      `<span class="idx"></span>` +
      (artist ? `<span class="artist">${esc(artist)}</span> ` : '') +
      `<span class="name">${esc(displayName)}</span>` +
      `<button class="r-dl" title="Download">D</button>` +
      `<span class="ext">${esc(r.ext)}</span>` +
      `<button class="r-add">${isAdded ? '✓' : '+'}</button>`;

    if (isAdded) li.classList.add('added');

    li.querySelector('.r-dl').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const a = document.createElement('a');
      a.href = r.url;
      a.download = baseName || r.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    li.querySelector('.r-add').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (li.classList.contains('added')) return;
      addModlandTrack(r);
      addedUrls.add(r.url);
      li.classList.add('added');
      li.querySelector('.r-add').textContent = '✓';
    });

    li.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('r-add') || ev.target.classList.contains('r-dl')) return;
      loadAndPlay(si);
    });

    if (artist) {
      li.addEventListener('dblclick', (ev) => {
        if (ev.target.classList.contains('r-add') || ev.target.classList.contains('r-dl')) return;
        searchByArtist(artist);
      });
      addLongPress(li, () => searchByArtist(artist));
    }

    elList.appendChild(li);
  }

  S.currentIdx = -1;
  if (playingUrl) {
    const ci = displayed.findIndex(r => r.url === playingUrl);
    if (ci >= 0) {
      S.currentIdx = ci;
      const curLi = elList.children[ci];
      if (curLi) {
        curLi.classList.add('current');
        scrollIntoViewSmart(curLi, true);
      }
    }
  }
  updateTrackPos();
  updateMlButtons();
}

// ── ML button listeners ───────────────────────────────
elMlAddAll.addEventListener('click', () => {
  if (S._lastSearchResults.length === 0) return;
  addModlandTracks(S._lastSearchResults);
  elFilter.value = '';
  S._lastSearchResults = [];
  updateMlButtons();
  buildPlaylist();
  restoreSelection();
});

elMlDelAll.addEventListener('click', () => {
  let targets;
  if (S._inSearchResults && S._lastSearchResults.length > 0) {
    targets = S._lastSearchResults
      .filter(r => S.modlandFiles.some(t => t.url === r.url))
      .map(r => r.url);
  } else {
    const items = elList.children;
    targets = [];
    for (let i = 0; i < items.length; i++) {
      if (!items[i].classList.contains('hidden')) {
        const f = S.modlandFiles[i];
        if (f) targets.push(f.url);
      }
    }
  }
  if (targets.length === 0) return;
  showDeleteConfirm(targets.length, () => deleteModlandByUrls(targets));
});

elMlRandom.addEventListener('click', () => {
  if (!remoteSearch.isLoaded()) return;
  remoteSearch.reshuffle();
  S._randomBrowsing = true;
  elFilter.value = '';
  elRefineFolder.value = '';
  import('./format-panel.js').then(m => m.clearFormatFilter());
  doRandomBrowse(0);
});
