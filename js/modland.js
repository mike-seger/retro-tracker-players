// js/modland.js — Modland file management, search, random browse, mode helpers
import { S, elFilter, elFilterCnt,
         elSelBulk, elMlAddAll, elMlDelAll, elMlRandom, elList,
         btnCopy, btnZip } from './state.js';
import { esc, trackUrl, addLongPress, isMobile, parseTrackDisplay } from './utils.js';
import { SID_TRACK_PLAYER_ID } from './state.js';
import { buildFormatPanel } from './format-panel.js';
import { loadAndPlay } from './player.js';
import { activeFiles, scrollIntoViewSmart, updateTrackPos, buildPlaylist } from './playlist.js';
import { restoreSelection } from './selection.js';
import { updateSelCount } from './selection.js';
import { getRangeSkip, buildRangePanel } from './range-panel.js';
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
    // Search using artist as path prefix (e.g. 'pulse/' finds all tracks in Pulse/ folder)
    elFilter.value = clean + '/';
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
  btnCopy.style.display    = isMl ? 'none' : '';
  btnZip.style.display     = isMl ? 'none' : '';
}

// ── modland search ────────────────────────────────────
export function doModlandSearch() {
  S._randomBrowsing = false;
  const raw = elFilter.value.trim();
  const skip = getRangeSkip();

  if (raw.length < 2) {
    S._lastSearchResults = [];
    S._inSearchResults = false;
    updateMlButtons();
    populateRangePanel(0);
    buildPlaylist();
    restoreSelection();
    return;
  }

  const q = raw;

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

  populateRangePanel(total);

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
    const baseName = slash >= 0 ? r.name.substring(slash + 1) : r.name;
    const { artist, title, folder } = parseTrackDisplay(r);
    const isAdded = addedUrls.has(r.url);

    li.classList.add('remote');
    li.innerHTML =
      `<span class="idx"></span>` +
      `<div class="row-top">` +
        `<span class="artist">${esc(artist)}</span>` +
        (folder ? `<span class="folder">${esc(folder)}</span>` : '') +
      `</div>` +
      `<div class="row-bot">` +
        `<span class="title">${esc(title)}</span>` +
        `<span class="ext">${esc(r.ext)}</span>` +
        (!isMobile ? `<button class="r-dl" title="Download">D</button>` : '') +
        `<button class="r-add">${isAdded ? '✓' : '+'}</button>` +
      `</div>`;

    if (isAdded) li.classList.add('added');

    const dlBtn = li.querySelector('.r-dl');
    if (dlBtn) {
      dlBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const a = document.createElement('a');
        a.href = r.url;
        a.download = baseName || r.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
    }

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

    const searchArtist = artist || folder;
    if (searchArtist) {
      li.addEventListener('dblclick', (ev) => {
        if (ev.target.classList.contains('r-add') || ev.target.classList.contains('r-dl')) return;
        searchByArtist(searchArtist);
      });
      addLongPress(li, () => searchByArtist(searchArtist));
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

  // Populate range panel with pages of 1000
  buildRangePanel(total, 1000);
  S._currentRange = skip;

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
    const baseName = slash >= 0 ? r.name.substring(slash + 1) : r.name;
    const { artist, title, folder } = parseTrackDisplay(r);
    const isAdded = addedUrls.has(r.url);

    li.classList.add('remote');
    li.innerHTML =
      `<span class="idx"></span>` +
      `<div class="row-top">` +
        `<span class="artist">${esc(artist)}</span>` +
        (folder ? `<span class="folder">${esc(folder)}</span>` : '') +
      `</div>` +
      `<div class="row-bot">` +
        `<span class="title">${esc(title)}</span>` +
        `<span class="ext">${esc(r.ext)}</span>` +
        (!isMobile ? `<button class="r-dl" title="Download">D</button>` : '') +
        `<button class="r-add">${isAdded ? '✓' : '+'}</button>` +
      `</div>`;

    if (isAdded) li.classList.add('added');

    const dlBtn = li.querySelector('.r-dl');
    if (dlBtn) {
      dlBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const a = document.createElement('a');
        a.href = r.url;
        a.download = baseName || r.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
    }

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

    const searchArtist = artist || folder;
    if (searchArtist) {
      li.addEventListener('dblclick', (ev) => {
        if (ev.target.classList.contains('r-add') || ev.target.classList.contains('r-dl')) return;
        searchByArtist(searchArtist);
      });
      addLongPress(li, () => searchByArtist(searchArtist));
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
  import('./range-panel.js').then(m => m.clearRangeFilter());
  import('./format-panel.js').then(m => m.clearFormatFilter());
  doRandomBrowse(0);
});
