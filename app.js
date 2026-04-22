// app.js — Modular tracker player UI
// Players are registered in players.json. Each player directory provides:
//   engine.js    — exports: init, load, pause, resume, seekTo, getTime, setVolume, isEnded, onEnd, destroy
//   filelist.json — array of relative file paths under engines/<player>/files/

import * as remoteSearch from './remote-search.js';

// ── state ───────────────────────────────────────────
let players = [];           // from players.json
let engines = {};           // playerId → engine module (lazy)
let fileLists = {};         // playerId → string[]
let enabledPlayers = {};    // playerId → boolean (checkbox state)

let mergedFiles = [];       // [{name, ext, playerId, origIdx}] — local only
let modlandFiles = [];      // [{name, ext, playerId, url}] — modland list
let searchMode = 'local';   // 'local' | 'modland'
let localSelected = new Set();    // indices into mergedFiles
let modlandSelected = new Set();  // indices into modlandFiles
let currentIdx = -1;
let focusedIdx = -1;
let playing = false;
let loaded = false;
let activeEngine = null;    // playerId of the currently loaded engine
let _playingUrl = null;     // URL of the currently playing track
let bulkState = 'restore';  // restore | all | none
let bulkRestoreSelection = new Set();
let suppressBulkSnapshot = false;
let _debugTiming = true;     // set to true to log perf timing

const FIXED_VOLUME = 1.0;

// ── DOM refs ────────────────────────────────────────
const btnPlay     = document.getElementById('btn-play');
const elTime      = document.getElementById('time');
const elSeek      = document.getElementById('seek');
const elDur       = document.getElementById('duration');
const elInfo      = document.getElementById('info');
const elFilter    = document.getElementById('filter');
const elFilterClr = document.getElementById('filter-clear');
const elFilterCnt = document.getElementById('filter-count');
const elSearchMode = document.getElementById('search-mode');
const elMlAddAll   = document.getElementById('ml-add-all');
const elMlDelAll   = document.getElementById('ml-del-all');
const elMlRandom   = document.getElementById('ml-random');
const btnCopy     = document.getElementById('btn-copy');
const btnZip      = document.getElementById('btn-zip');
const elBulkCb    = document.getElementById('sel-bulk-cb');
const elSelCount  = document.getElementById('sel-count');
const elList      = document.getElementById('playlist');
const elTrackPos  = document.getElementById('track-pos');
const elRefineFolder = document.getElementById('refine-folder');
const elRefineArtist = document.getElementById('refine-artist');
const elRefineRange  = document.getElementById('refine-range');
const elRefineFormat = document.getElementById('refine-format');
const elSelBulk   = document.getElementById('sel-bulk');

// ── helpers ─────────────────────────────────────────
function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function trimDisplayPath(path) {
  if (!path || !path.includes('/')) return path;
  const parts = path.split('/').filter(Boolean);
  const letterIdx = parts.findIndex(part => part.length === 1);
  if (letterIdx >= 0 && letterIdx < parts.length - 1) {
    return parts.slice(letterIdx + 1).join('/');
  }
  return path;
}

function extOf(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.substring(dot + 1).toUpperCase() : '';
}

function toAbsoluteUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch (_) {
    return url;
  }
}

function deepLinkTarget() {
  try {
    const value = new URLSearchParams(window.location.search).get('play');
    return value ? toAbsoluteUrl(value) : '';
  } catch (_) {
    return '';
  }
}

function deepLinkFilters() {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      folder: params.get('folder') || '',
      artist: params.get('artist') || '',
      search: params.get('search') || '',
    };
  } catch (_) {
    return { folder: '', artist: '', search: '' };
  }
}

function applyDeepLinkFilters() {
  const { folder, artist, search } = deepLinkFilters();
  if (!folder && !artist && !search) return;
  // Set folder first so populateLocalArtistDropdown rebuilds with the right scope
  if (folder) {
    if (![...elRefineFolder.options].some(o => o.value === folder)) {
      elRefineFolder.appendChild(new Option(folder, folder));
    }
    elRefineFolder.value = folder;
  }
  if (search) {
    elFilter.value = search;
  }
  // Rebuild artist dropdown now (scoped to folder/search), then set value
  populateLocalArtistDropdown();
  if (artist) {
    if (![...elRefineArtist.options].some(o => o.value === artist)) {
      elRefineArtist.appendChild(new Option(artist, artist));
    }
    elRefineArtist.value = artist;
  }
  applyFilter();
}

function findLocalEntryByUrl(targetUrl) {
  for (const p of players) {
    const files = fileLists[p.id] || [];
    for (let origIdx = 0; origIdx < files.length; origIdx++) {
      const name = files[origIdx];
      const entry = { name, ext: extOf(name), playerId: p.id, origIdx };
      if (toAbsoluteUrl(trackUrl(entry)) === targetUrl) return entry;
    }
  }

  for (const entry of _localUrllistTracks) {
    if (toAbsoluteUrl(trackUrl(entry)) === targetUrl) return entry;
  }

  return null;
}

async function loadDeepLinkedTrack() {
  const targetUrl = deepLinkTarget();
  if (!targetUrl) return false;

  const localEntry = findLocalEntryByUrl(targetUrl);
  if (localEntry) {
    if (!enabledPlayers[localEntry.playerId]) {
      enabledPlayers[localEntry.playerId] = true;
      saveEnabledPlayers();
      rebuildMergedFiles();
    }

    switchMode('local');
    const idx = mergedFiles.findIndex((entry) => toAbsoluteUrl(trackUrl(entry)) === targetUrl);
    if (idx >= 0) {
      currentIdx = idx;
      highlightCurrent();
      setFocus(idx);
      updateTrackPos();
      const entry = mergedFiles[idx];
      const label = decodeURIComponent(entry.name).split('/').pop() || entry.name;
      showDeepLinkPrompt(label, () => { loadAndPlay(idx); });
      return true;
    }
  }

  const remoteIdx = modlandFiles.findIndex((entry) => toAbsoluteUrl(entry.url) === targetUrl);
  if (remoteIdx >= 0) {
    switchMode('modland');
    currentIdx = remoteIdx;
    highlightCurrent();
    setFocus(remoteIdx);
    updateTrackPos();
    const entry = modlandFiles[remoteIdx];
    const label = decodeURIComponent(entry.name).split('/').pop() || entry.name;
    showDeepLinkPrompt(label, () => { loadAndPlay(remoteIdx); });
    return true;
  }

  console.warn('Deep link track not found:', targetUrl);
  return false;
}

// ── engine management ───────────────────────────────
async function getEngine(playerId) {
  if (!engines[playerId]) {
    const mod = await import(`./engines/${playerId}/engine.js`);
    await mod.init();
    mod.setVolume(FIXED_VOLUME);
    mod.onEnd(() => advanceTrack());
    engines[playerId] = mod;
  }
  return engines[playerId];
}

async function ensureEngine(playerId) {
  // Pause the old engine if switching
  if (activeEngine && activeEngine !== playerId && engines[activeEngine]) {
    engines[activeEngine].pause();
  }
  activeEngine = playerId;
  return getEngine(playerId);
}

// ── active list helpers ─────────────────────────────
function activeFiles() {
  if (_inSearchResults) return _lastSearchResults;
  return searchMode === 'local' ? mergedFiles : modlandFiles;
}
function activeSelected() { return searchMode === 'local' ? localSelected : modlandSelected; }
function setActiveSelected(s) { if (searchMode === 'local') localSelected = s; else modlandSelected = s; }

// ── merge file lists ────────────────────────────────
function rebuildMergedFiles() {
  mergedFiles = [];
  for (const p of players) {
    if (!enabledPlayers[p.id]) continue;
    const files = fileLists[p.id] || [];
    files.forEach((name, origIdx) => {
      mergedFiles.push({ name, ext: extOf(name), playerId: p.id, origIdx });
    });
  }
  // Append URL-based tracks from all-urllists.json
  for (const t of _localUrllistTracks) {
    if (!enabledPlayers[t.playerId]) continue;
    mergedFiles.push(t);
  }
  mergedFiles.sort((a, b) => {
    const sa = a.name.lastIndexOf('/');
    const sb = b.name.lastIndexOf('/');
    const artistA = sa >= 0 ? a.name.substring(0, sa) : '';
    const artistB = sb >= 0 ? b.name.substring(0, sb) : '';
    const cmp = artistA.localeCompare(artistB, undefined, { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    const titleA = sa >= 0 ? a.name.substring(sa + 1) : a.name;
    const titleB = sb >= 0 ? b.name.substring(sb + 1) : b.name;
    return titleA.localeCompare(titleB, undefined, { sensitivity: 'base' });
  });
}

// ── type toggles ────────────────────────────────────
function renderToggles() {
  // Format toggles removed; filtering done via format dropdown
}

function saveEnabledPlayers() {
  localStorage.setItem('enabled-players', JSON.stringify(enabledPlayers));
}

function loadEnabledPlayers() {
  try {
    const saved = JSON.parse(localStorage.getItem('enabled-players'));
    if (saved && typeof saved === 'object') {
      players.forEach(p => {
        enabledPlayers[p.id] = p.id in saved ? !!saved[p.id] : true;
      });
      return;
    }
  } catch (_) {}
  players.forEach(p => { enabledPlayers[p.id] = true; });
}

function onPlayerToggle() {
  const curFile = currentIdx >= 0 ? mergedFiles[currentIdx] : null;

  rebuildMergedFiles();
  elFilter.placeholder = searchMode === 'local' ? localPlaceholder() : modlandPlaceholder();
  localSelected.clear();
  bulkRestoreSelection = new Set();
  buildPlaylist();
  updateSelCount();

  if (curFile) {
    currentIdx = mergedFiles.findIndex(
      f => f.playerId === curFile.playerId && f.name === curFile.name
    );
  } else {
    currentIdx = -1;
  }
  if (currentIdx >= 0) {
    highlightCurrent();
    setFocus(currentIdx);
  }
}

// ── playlist ────────────────────────────────────────
function buildPlaylist() {
  _inSearchResults = false;
  elSelBulk.style.display = '';
  elList.innerHTML = '';
  const files = activeFiles();
  const sel = activeSelected();
  const pad = Math.max(2, String(files.length).length);

  files.forEach((entry, i) => {
    const li = document.createElement('li');
    li.dataset.idx = i;

    const decodedName = decodeURIComponent(entry.name);
    const slash = decodedName.lastIndexOf('/');
    const artist = slash >= 0 ? trimDisplayPath(decodedName.substring(0, slash)) : '';
    const baseName = slash >= 0 ? decodedName.substring(slash + 1) : decodedName;
    const displayName = baseName.replace(/\.\w+$/i, '').replace(/_/g, ' ');

    const idxStr = String(i + 1).padStart(pad, '\u2007');
    const checked = sel.has(i) ? ' checked' : '';

    if (entry.url) li.classList.add('remote');

    li.innerHTML =
      `<input type="checkbox" class="sel-cb" tabindex="-1"${checked}>` +
      `<span class="idx">${idxStr}</span>` +
      (artist ? `<span class="artist">${esc(artist)}</span> ` : '') +
      `<span class="name">${esc(displayName)}</span>` +
      `<button class="r-dl" title="Download">D</button>` +
      `<span class="ext">${esc(entry.ext)}</span>` +
      (searchMode === 'modland' && entry.url ? `<button class="r-del" title="Remove">&times;</button>` : '');

    li.querySelector('.r-dl').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const url = trackUrl(entry);
      const a = document.createElement('a');
      a.href = url;
      a.download = baseName || entry.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    li.querySelector('.sel-cb').addEventListener('change', (ev) => {
      ev.stopPropagation();
      toggleSelect(i, ev.target.checked);
    });
    const delBtn = li.querySelector('.r-del');
    if (delBtn) {
      delBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        deleteModlandTrack(entry.url);
      });
    }
    li.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('sel-cb') || ev.target.classList.contains('r-del') || ev.target.classList.contains('r-dl')) return;
      loadAndPlay(i);
    });

    if (searchMode === 'modland' && artist) {
      li.addEventListener('dblclick', (ev) => {
        if (ev.target.classList.contains('sel-cb') || ev.target.classList.contains('r-del') || ev.target.classList.contains('r-dl')) return;
        searchByArtist(artist);
      });
      addLongPress(li, () => searchByArtist(artist));
    } else if (searchMode === 'local') {
      const folder = decodedName.includes('/') ? decodedName.substring(0, decodedName.lastIndexOf('/')) : '';
      if (folder) {
        const setRefine = () => {
          if (entry.playerId === 'ahx') {
            if (![...elRefineArtist.options].some(o => o.value === folder)) {
              elRefineArtist.appendChild(new Option(folder, folder));
            }
            elRefineArtist.value = folder;
          } else {
            if (![...elRefineFolder.options].some(o => o.value === folder)) {
              elRefineFolder.appendChild(new Option(folder, folder));
            }
            elRefineFolder.value = folder;
            populateLocalArtistDropdown();
          }
          applyFilter();
        };
        li.addEventListener('dblclick', (ev) => {
          if (ev.target.classList.contains('sel-cb') || ev.target.classList.contains('r-dl')) return;
          setRefine();
        });
        addLongPress(li, setRefine);
      }
    }

    if (i === currentIdx) li.classList.add('current');
    if (i === focusedIdx) li.classList.add('focused');

    elList.appendChild(li);
  });

  applyFilter();
  updateTrackPos();
}

function updateTrackPos() {
  const files = activeFiles();
  if (currentIdx >= 0 && currentIdx < files.length) {
    elTrackPos.textContent = `${currentIdx + 1}/${files.length}`;
  } else if (_inSearchResults && activeEngine) {
    // Playing track not in current search results
    elTrackPos.textContent = '-/-';
  } else {
    elTrackPos.textContent = '-/-';
  }
}

// ── track cache ─────────────────────────────────────
const _trackCache = new Map();   // originalUrl → { blobUrl, ts }
const CACHE_MAX = 20;

function cacheHas(url) { return _trackCache.has(url); }

function cacheGet(url) {
  const c = _trackCache.get(url);
  if (!c) return null;
  c.ts = performance.now();
  return c.blobUrl;
}

async function cacheFetch(url) {
  const existing = cacheGet(url);
  if (existing) return existing;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const blobUrl = URL.createObjectURL(new Blob([buf]));
  _trackCache.set(url, { blobUrl, ts: performance.now() });
  // evict oldest entries beyond limit
  while (_trackCache.size > CACHE_MAX) {
    let oldestKey = null, oldestTs = Infinity;
    for (const [k, v] of _trackCache) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    }
    if (oldestKey) {
      URL.revokeObjectURL(_trackCache.get(oldestKey).blobUrl);
      _trackCache.delete(oldestKey);
    }
  }
  if (_debugTiming) tlog(`[cache] stored ${url.split('/').pop()} (${_trackCache.size}/${CACHE_MAX})`);
  return blobUrl;
}

// ── load + play ─────────────────────────────────────
async function loadAndPlay(idx) {
  const t0 = performance.now();
  const files = activeFiles();
  if (idx < 0 || idx >= files.length) return;

  const entry = files[idx];

  let engine;
  try {
    engine = await ensureEngine(entry.playerId);
  } catch (e) {
    console.error('engine init failed:', entry.playerId, e);
    elInfo.innerHTML = '<div class="label">Engine init failed: ' + esc(String(e)) + '</div>';
    return;
  }
  const tEngine = performance.now();

  currentIdx = idx;
  playing = true;
  loaded = true;
  _playingUrl = entry.url || trackUrl(entry);
  localStorage.setItem('current-track', JSON.stringify({ playerId: entry.playerId, name: entry.name, mode: searchMode }));

  const url = trackUrl(entry);

  elSeek.value = 0;
  elTime.textContent = '0:00';
  elDur.textContent = '—';

  try {
    const playUrl = entry.playerId === 'mod' ? url : await cacheFetch(url);
    const tFetch = performance.now();
    const result = await engine.load(playUrl);
    const tLoad = performance.now();

    elInfo.innerHTML = result.fields
      .map(f => `<span class="label">${esc(f.label)}:</span><span class="val">${esc(f.value)}</span>`)
      .join('');

    elSeek.max = result.duration || 300;
    elDur.textContent = fmtTime(result.duration || 300);

    if (_debugTiming) tlog(`[T] engine ${(tEngine - t0).toFixed(0)}ms  fetch ${(tFetch - tEngine).toFixed(0)}ms  decode ${(tLoad - tFetch).toFixed(0)}ms`);
  } catch (e) {
    console.error('Failed to load', url, e);
    elInfo.innerHTML = '<div class="label">Error loading track</div>';
  }

  highlightCurrent();
  setFocus(idx);
  updateTransportUI();
  updateTrackPos();
  if (_debugTiming) tlog(`[T] total ${(performance.now() - t0).toFixed(0)}ms`);
}

function trackUrl(entry) {
  return entry.url ? entry.url : `engines/${entry.playerId}/files/${entry.name.split('/').map(encodeURIComponent).join('/')}`;
}

function extractArtist(entry) {
  const slash = entry.name.lastIndexOf('/');
  if (slash < 0) return '';
  if (entry.playerId === 'ahx') return trimDisplayPath(entry.name.substring(0, slash));
  const fileName = entry.name.substring(slash + 1);
  const dashIdx = fileName.indexOf(' \u2013 ') >= 0 ? fileName.indexOf(' \u2013 ') : fileName.indexOf(' - ');
  return dashIdx >= 0 ? trimDisplayPath(fileName.substring(0, dashIdx)) : '';
}

let _prefetchAbort = null;  // AbortController for current prefetch batch

async function prefetchAhead(dir, count) {
  // Abort any previous prefetch batch
  if (_prefetchAbort) _prefetchAbort.abort();
  const ctrl = _prefetchAbort = new AbortController();

  const visible = getVisibleIndices();
  if (visible.length === 0) return;
  const pos = visible.indexOf(currentIdx);
  if (pos < 0) return;
  const files = activeFiles();

  // Collect URLs to prefetch (skip already cached)
  const urls = [];
  for (let i = 1; i <= count; i++) {
    const p = pos + dir * i;
    if (p < 0 || p >= visible.length) break;
    const entry = files[visible[p]];
    if (entry) {
      const u = trackUrl(entry);
      if (!cacheHas(u)) urls.push(u);
    }
  }

  // Fetch sequentially to avoid connection pressure
  for (const u of urls) {
    if (ctrl.signal.aborted) return;
    try {
      await cacheFetch(u);
    } catch (_) { /* ignore prefetch failures */ }
  }
}

function advanceTrack() {
  const visible = getVisibleIndices();
  if (visible.length === 0) return;
  const pos = visible.indexOf(currentIdx);
  const nextIdx = pos >= 0 && pos < visible.length - 1 ? visible[pos + 1] : visible[0];
  loadAndPlay(nextIdx);
  setTimeout(() => prefetchAhead(1, 3), 200);
}

function playPrevNext(dir) {
  const visible = getVisibleIndices();
  if (visible.length === 0) return;
  const pos = visible.indexOf(currentIdx);
  let newIdx;
  if (dir < 0) {
    newIdx = pos > 0 ? visible[pos - 1] : visible[visible.length - 1];
  } else {
    newIdx = pos >= 0 && pos < visible.length - 1 ? visible[pos + 1] : visible[0];
  }
  loadAndPlay(newIdx);
  setTimeout(() => prefetchAhead(dir, 3), 200);
}

// ── transport ───────────────────────────────────────
function updateTransportUI() {
  if (playing) {
    btnPlay.innerHTML = '&#10074;&#10074;';
    btnPlay.classList.add('active');
  } else {
    btnPlay.innerHTML = '&#9654;';
    btnPlay.classList.remove('active');
  }
}

btnPlay.addEventListener('click', async () => {
  if (currentIdx < 0 || !loaded) {
    const visible = getVisibleIndices();
    const idx = currentIdx >= 0 ? currentIdx : (visible[0] ?? 0);
    loadAndPlay(idx);
    return;
  }
  if (!activeEngine) return;
  const engine = engines[activeEngine];
  if (!engine) return;

  if (playing) {
    engine.pause();
    playing = false;
  } else {
    engine.resume();
    playing = true;
  }
  updateTransportUI();
});

// ── seek ────────────────────────────────────────────
let userDragging = false;
elSeek.addEventListener('pointerdown', () => { userDragging = true; });
document.addEventListener('pointerup', () => { userDragging = false; });

elSeek.addEventListener('change', () => {
  userDragging = false;
  if (!activeEngine || !engines[activeEngine] || currentIdx < 0) return;
  const target = parseFloat(elSeek.value);

  elTime.textContent = '>>>';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      engines[activeEngine].seekTo(target);
      elTime.textContent = fmtTime(target);
    });
  });
});

// ── playtime ticker ─────────────────────────────────
setInterval(() => {
  if (!activeEngine || !engines[activeEngine] || !playing) return;
  const engine = engines[activeEngine];

  const t = engine.getTime();
  elTime.textContent = fmtTime(t);
  if (!userDragging) elSeek.value = t;

  if (engine.isEnded()) advanceTrack();
}, 250);

// ── filter ──────────────────────────────────────────
// (filter input handled in mode switching section)

function applyFilter() {
  const raw = elFilter.value.trim();
  const folderVal = elRefineFolder.value.toLowerCase();
  const artistVal = elRefineArtist.value.toLowerCase();
  const formatVal = elRefineFormat.value;
  const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
  let visible = 0;
  const files = activeFiles();
  const items = elList.children;
  for (let i = 0; i < items.length; i++) {
    const entry = files[i];
    const name = entry ? entry.name.toLowerCase() : '';
    let nameMatch = terms.length === 0 || terms.every(t => name.includes(t));
    if (nameMatch && folderVal) {
      const slash = name.lastIndexOf('/');
      const entryFolder = slash >= 0 ? name.substring(0, slash) : '';
      if (folderVal.length === 1) {
        nameMatch = entryFolder.length > 0 && entryFolder[0] === folderVal;
      } else {
        nameMatch = entryFolder === folderVal;
      }
    }
    if (nameMatch && artistVal) {
      const artist = entry ? extractArtist(entry).toLowerCase() : '';
      if (artistVal.length === 1) {
        nameMatch = artist.length > 0 && artist[0] === artistVal;
      } else {
        nameMatch = artist === artistVal;
      }
    }
    if (nameMatch && formatVal) {
      nameMatch = entry && entry.ext === formatVal;
    }
    const typeMatch = !entry || !entry.playerId || enabledPlayers[entry.playerId] !== false;
    const show = nameMatch && typeMatch;
    items[i].classList.toggle('hidden', !show);
    if (show) visible++;
  }
  elFilterCnt.textContent = (terms.length || folderVal || artistVal || formatVal) ? `${visible} / ${files.length}` : '';
}

// ── highlight + focus ───────────────────────────────

/** Scroll el into view inside #playlist. When already visible do nothing.
 *  Otherwise place it at the *opposite* edge from the direction it went out —
 *  this maximises arrow-key presses before the next scroll.
 *  If centered=true, always scroll to place the element in the center. */
function scrollIntoViewSmart(el, centered) {
  if (!el) return;
  const container = elList;             // #playlist = scroll container
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  // Account for outline (1px offset on each side)
  const outlineExtra = 2;
  const eTop = eRect.top - outlineExtra;
  const eBot = eRect.bottom + outlineExtra;
  if (centered) {
    const containerMid = cRect.top + cRect.height / 2;
    const elMid = eTop + (eBot - eTop) / 2;
    container.scrollTop += (elMid - containerMid);
    return;
  }
  if (eTop >= cRect.top && eBot <= cRect.bottom) return; // fully visible
  if (eTop < cRect.top) {
    // element above viewport → scroll it to top edge
    container.scrollTop -= (cRect.top - eTop);
  } else {
    // element below viewport → scroll it to top edge
    container.scrollTop += (eTop - cRect.top);
  }
}

function highlightCurrent() {
  const prev = elList.querySelector('li.current');
  if (prev) prev.classList.remove('current');
  const cur = currentIdx >= 0 ? elList.children[currentIdx] : null;
  if (cur) {
    cur.classList.add('current');
    scrollIntoViewSmart(cur);
  }
}

function setFocus(idx) {
  const files = activeFiles();
  if (idx < 0 || idx >= files.length) return;
  focusedIdx = idx;
  const prev = elList.querySelector('li.focused');
  if (prev) prev.classList.remove('focused');
  const li = elList.children[idx];
  if (li) {
    li.classList.add('focused');
    scrollIntoViewSmart(li);
  }
}

function getVisibleIndices() {
  const indices = [];
  const items = elList.children;
  for (let i = 0; i < items.length; i++) {
    if (!items[i].classList.contains('hidden')) indices.push(i);
  }
  return indices;
}

// ── selection ───────────────────────────────────────
function toggleSelect(idx, force) {
  const sel = activeSelected();
  const on = force !== undefined ? force : !sel.has(idx);
  if (on) sel.add(idx); else sel.delete(idx);
  const li = elList.children[idx];
  const cb = li?.querySelector('.sel-cb');
  if (cb) cb.checked = on;
  updateSelCount();
  saveSelection();
  if (!suppressBulkSnapshot && isPartialSelection()) {
    bulkRestoreSelection = new Set(sel);
  }
}

function saveSelection() {
  const sel = activeSelected();
  const files = activeFiles();
  const items = Array.from(sel).map(i => {
    const f = files[i];
    return f ? { playerId: f.playerId, name: f.name } : null;
  }).filter(Boolean);
  const key = searchMode === 'local' ? 'selected-tracks' : 'selected-modland';
  localStorage.setItem(key, JSON.stringify(items));
}

function restoreSelection() {
  const key = searchMode === 'local' ? 'selected-tracks' : 'selected-modland';
  const sel = activeSelected();
  const files = activeFiles();
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (!Array.isArray(saved)) return;
    saved.forEach(s => {
      const idx = files.findIndex(f => f.playerId === s.playerId && f.name === s.name);
      if (idx >= 0) {
        sel.add(idx);
        const li = elList.children[idx];
        const cb = li?.querySelector('.sel-cb');
        if (cb) cb.checked = true;
      }
    });
    updateSelCount();
    if (isPartialSelection()) {
      bulkRestoreSelection = new Set(sel);
    }
  } catch (_) {}
}

function updateSelCount() {
  const sel = activeSelected();
  const n = sel.size;
  if (n > 0) {
    elSelCount.textContent = n + ' selected';
    elSelCount.dataset.short = n;
  } else {
    elSelCount.textContent = '';
    elSelCount.dataset.short = '';
  }
  syncBulkState();
}

function isPartialSelection() {
  const sel = activeSelected();
  const files = activeFiles();
  return sel.size > 0 && sel.size < files.length;
}

function setBulkState(next) {
  bulkState = next;
  if (bulkState === 'all') {
    elBulkCb.checked = true;
    elBulkCb.indeterminate = false;
    elBulkCb.classList.remove('indeterminate');
  } else if (bulkState === 'none') {
    elBulkCb.checked = false;
    elBulkCb.indeterminate = false;
    elBulkCb.classList.remove('indeterminate');
  } else {
    elBulkCb.checked = false;
    elBulkCb.indeterminate = true;
    elBulkCb.classList.add('indeterminate');
  }
}

function syncBulkState() {
  const sel = activeSelected();
  const files = activeFiles();
  if (!files.length) {
    setBulkState('none');
    return;
  }
  if (sel.size === 0) setBulkState('none');
  else if (sel.size === files.length) setBulkState('all');
  else setBulkState('restore');
}

function applySelectionSet(nextSet) {
  setActiveSelected(nextSet);
  const items = elList.children;
  for (let i = 0; i < items.length; i++) {
    const cb = items[i].querySelector('.sel-cb');
    if (cb) cb.checked = nextSet.has(i);
  }
  updateSelCount();
  saveSelection();
}

function selectAll() {
  const nextSet = new Set();
  const files = activeFiles();
  for (let i = 0; i < files.length; i++) nextSet.add(i);
  applySelectionSet(nextSet);
}

function selectNone() {
  applySelectionSet(new Set());
}

function restoreBulkSelection() {
  const nextSet = new Set();
  bulkRestoreSelection.forEach(i => {
    if (i >= 0 && i < mergedFiles.length) nextSet.add(i);
  });
  applySelectionSet(nextSet);
}

elSelBulk.addEventListener('click', (e) => {
  e.preventDefault();
  let next;
  if (bulkState === 'none') next = 'all';
  else if (bulkState === 'all') next = 'none';
  else next = 'all'; // from restore/partial → all

  if ((next === 'all' || next === 'none') && isPartialSelection()) {
    bulkRestoreSelection = new Set(activeSelected());
  }

  suppressBulkSnapshot = true;
  setBulkState(next);
  if (next === 'all') selectAll();
  else if (next === 'none') selectNone();
  else restoreBulkSelection();
  suppressBulkSnapshot = false;
});

btnCopy.addEventListener('click', () => {
  const sel = activeSelected();
  const files = activeFiles();
  if (sel.size === 0) return;
  const csv = Array.from(sel).sort((a, b) => a - b)
    .map(i => {
      const f = files[i];
      return f.url || `engines/${f.playerId}/files/${f.name}`;
    })
    .join('\n');
  navigator.clipboard.writeText(csv).then(() => {
    btnCopy.classList.add('copied');
    setTimeout(() => { btnCopy.classList.remove('copied'); }, 1500);
  });
});

btnZip.addEventListener('click', async () => {
  const sel = activeSelected();
  const files = activeFiles();
  if (sel.size === 0) return;
  btnZip.textContent = '…';
  try {
    const zip = new JSZip();
    const entries = Array.from(sel).sort((a, b) => a - b).map(i => files[i]);
    const usedNames = new Set();
    const urls = [];
    await Promise.all(entries.map(async (f) => {
      const url = trackUrl(f);
      const resp = await fetch(url);
      if (!resp.ok) return;
      const blob = await resp.blob();

      // Build flat filename: <artist> - <title>.<ext>
      const decoded = decodeURIComponent(f.name);
      const slash = decoded.lastIndexOf('/');
      const artist = slash >= 0 ? decoded.substring(0, slash).split('/').pop() : '';
      const baseName = slash >= 0 ? decoded.substring(slash + 1) : decoded;
      const dotPos = baseName.lastIndexOf('.');
      const title = dotPos >= 0 ? baseName.substring(0, dotPos) : baseName;
      const ext = dotPos >= 0 ? baseName.substring(dotPos) : '';
      let flatName = artist ? `${artist} - ${title}${ext}` : `${title}${ext}`;

      // Deduplicate names
      let finalName = flatName;
      let dup = 1;
      while (usedNames.has(finalName.toLowerCase())) {
        finalName = artist ? `${artist} - ${title} (${++dup})${ext}` : `${title} (${++dup})${ext}`;
      }
      usedNames.add(finalName.toLowerCase());

      zip.file(finalName, blob);
      if (f.url) urls.push(f.url);
    }));
    // Include urllist.json with remote source URLs (if any)
    if (urls.length) zip.file('urllist.json', JSON.stringify(urls, null, 2));
    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = 'tracks.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.error('Zip failed:', e);
  }
  btnZip.textContent = 'Z';
});

// ── scrub helper ────────────────────────────────────
function scrub(delta) {
  if (!activeEngine || !engines[activeEngine] || currentIdx < 0) return;
  const engine = engines[activeEngine];
  const cur = engine.getTime();
  const target = Math.max(0, cur + delta);
  elTime.textContent = '>>>';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      engine.seekTo(target);
      elTime.textContent = fmtTime(target);
    });
  });
}

// ── keyboard shortcuts ──────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target === elFilter || e.target === elSearchMode) return;
  if (e.key === ' ')               { e.preventDefault(); btnPlay.click(); }
  else if (e.key === 'ArrowLeft')  { e.preventDefault(); scrub(-10); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); scrub(10); }
  else if (e.key === 'ArrowUp')    { e.preventDefault(); playPrevNext(-1); }
  else if (e.key === 'ArrowDown')  { e.preventDefault(); playPrevNext(1); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const idx = focusedIdx >= 0 ? focusedIdx : currentIdx;
    if (idx >= 0) toggleSelect(idx);
  }
  else if (e.key === '/') {
    e.preventDefault();
    elFilter.focus();
  }
});

// ── debug log (toggle with double-click or long-press on transport) ─
const debugLog = document.getElementById('debug-log');
const elTransport = document.getElementById('transport');

async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.padding = '0';
    ta.style.border = '0';
    ta.style.outline = '0';
    ta.style.boxShadow = 'none';
    ta.style.background = 'transparent';
    ta.style.opacity = '0';
    ta.style.fontSize = '16px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

async function shareText(text) {
  if (!text || !navigator.share) return false;
  try {
    await navigator.share({ text });
    return true;
  } catch (_) {
    return false;
  }
}

async function shareLogFile(text) {
  if (!text || !navigator.share || typeof File === 'undefined') return false;
  try {
    const file = new File([text], `retro-debug-${Date.now()}.log`, { type: 'text/plain' });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: 'Retro tracker debug log' });
    return true;
  } catch (_) {
    return false;
  }
}

function downloadLogFile(text) {
  if (!text) return false;
  try {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `retro-debug-${Date.now()}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return true;
  } catch (_) {
    return false;
  }
}

elTransport.addEventListener('dblclick', (e) => {
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
  debugLog.hidden = !debugLog.hidden;
});
let _dbgLongPress = 0;
elTransport.addEventListener('touchstart', (e) => {
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
  _dbgLongPress = setTimeout(() => {
    debugLog.hidden = !debugLog.hidden;
    _dbgLongPress = 0;
  }, 800);
}, { passive: true });
elTransport.addEventListener('touchend', () => { clearTimeout(_dbgLongPress); }, { passive: true });
elTransport.addEventListener('touchmove', () => { clearTimeout(_dbgLongPress); }, { passive: true });

let _dbgCopyTouchStart = 0;
let _dbgCopyTouchMoved = false;
debugLog.addEventListener('touchstart', (e) => {
  if (debugLog.hidden) return;
  _dbgCopyTouchStart = Date.now();
  _dbgCopyTouchMoved = false;
}, { passive: true });
debugLog.addEventListener('touchend', async () => {
  const held = _dbgCopyTouchStart ? (Date.now() - _dbgCopyTouchStart) : 0;
  _dbgCopyTouchStart = 0;
  if (_dbgCopyTouchMoved || held < 700 || debugLog.hidden) return;
  const text = debugLog.textContent.trim();
  const copied = await copyText(text);
  if (copied) {
    dbg('[I] debug log copied');
    return;
  }
  const sharedFile = await shareLogFile(text);
  if (sharedFile) {
    dbg('[I] debug log shared as file');
    return;
  }
  const shared = await shareText(text);
  if (shared) {
    dbg('[I] debug log shared');
    return;
  }
  const downloaded = downloadLogFile(text);
  if (downloaded) {
    dbg('[I] debug log downloaded');
    return;
  }
  dbg('[W] failed to copy debug log');
}, { passive: true });
debugLog.addEventListener('touchmove', () => { _dbgCopyTouchMoved = true; }, { passive: true });
debugLog.addEventListener('touchcancel', () => {
  _dbgCopyTouchStart = 0;
  _dbgCopyTouchMoved = true;
}, { passive: true });

function dbg(msg) {
  debugLog.textContent += msg + '\n';
  debugLog.scrollTop = debugLog.scrollHeight;
}
function tlog(msg) {
  console.log(msg);
  dbg(msg);
}
const origWarn = console.warn, origErr = console.error;
console.warn = (...a) => { dbg('[W] ' + a.join(' ')); origWarn.apply(console, a); };
console.error = (...a) => { dbg('[E] ' + a.join(' ')); origErr.apply(console, a); };
window.addEventListener('error', (e) => dbg('[ERR] ' + e.message + ' @ ' + e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => dbg('[REJ] ' + e.reason));

// ── init ────────────────────────────────────────────
function detectPlayerIdFromUrl(url) {
  const ext = url.split('.').pop().toLowerCase();
  if (ext === 'ahx') return 'ahx';
  if (ext === 'sid') return 'jssid';
  if (['mod', 'xm', 's3m', 'it'].includes(ext)) return 'mod';
  return null;
}

function urlToTrack(url) {
  const playerId = detectPlayerIdFromUrl(url);
  if (!playerId) return null;
  const segments = new URL(url).pathname.split('/').map(decodeURIComponent);
  const artist = (segments[segments.length - 2] || '').replace(/\//g, '+');
  const file = segments[segments.length - 1];
  const name = `${artist}/${file}`;
  return { name, ext: extOf(url), playerId, url };
}

function loadModlandTracks() {
  modlandFiles = [];
  const seen = new Set();

  // From localStorage (user-added via search)
  try {
    const saved = JSON.parse(localStorage.getItem('remote-urls'));
    if (Array.isArray(saved)) {
      for (const url of saved) {
        if (seen.has(url)) continue;
        const t = urlToTrack(url);
        if (t) { seen.add(url); modlandFiles.push(t); }
      }
    }
  } catch (_) {}
  modlandFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function saveModlandUrls() {
  const urls = modlandFiles.map(t => t.url);
  localStorage.setItem('remote-urls', JSON.stringify(urls));
}

function addModlandTrack(entry) {
  if (modlandFiles.some(t => t.url === entry.url)) return false;
  modlandFiles.push(entry);
  modlandFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  saveModlandUrls();
  return true;
}

function addModlandTracks(entries) {
  const existing = new Set(modlandFiles.map(t => t.url));
  let added = 0;
  for (const entry of entries) {
    if (existing.has(entry.url)) continue;
    existing.add(entry.url);
    modlandFiles.push(entry);
    added++;
  }
  if (added > 0) {
    modlandFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    saveModlandUrls();
    if (searchMode === 'modland') switchMode('modland');
  }
  return added;
}

function deleteModlandTrack(url) {
  modlandFiles = modlandFiles.filter(t => t.url !== url);
  modlandSelected.clear();
  saveModlandUrls();
  if (searchMode === 'modland') {
    if (elFilter.value.trim().length >= 2) doModlandSearch();
    else switchMode('modland');
  }
}

function deleteModlandByUrls(urls) {
  const removeSet = new Set(urls);
  modlandFiles = modlandFiles.filter(t => !removeSet.has(t.url));
  modlandSelected.clear();
  saveModlandUrls();
  if (searchMode === 'modland') {
    if (elFilter.value.trim().length >= 2) doModlandSearch();
    else switchMode('modland');
  }
}

function showDeleteConfirm(count, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML =
    `<div class="confirm-box">` +
    `<div class="confirm-msg">Delete ${count} track${count !== 1 ? 's' : ''}?</div>` +
    `<div class="confirm-btns">` +
    `<button class="confirm-yes">Delete</button>` +
    `<button class="confirm-no">Cancel</button>` +
    `</div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.confirm-yes').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
  overlay.querySelector('.confirm-no').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function showDeepLinkPrompt(trackName, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML =
    `<div class="confirm-box">` +
    `<div class="confirm-msg">Start linked track?<br><span class="confirm-detail">${esc(trackName)}</span></div>` +
    `<div class="confirm-btns">` +
    `<button class="confirm-yes">Play</button>` +
    `<button class="confirm-no">Cancel</button>` +
    `</div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.confirm-yes').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
  overlay.querySelector('.confirm-no').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function switchMode(mode) {
  searchMode = mode;
  elSearchMode.value = mode;
  document.body.classList.toggle('mode-modland', mode === 'modland');
  updateMlButtons();
  updateRefineVisibility();
  elFilter.placeholder = mode === 'local' ? localPlaceholder() : modlandPlaceholder();
  // Reset refine dropdowns
  elRefineFolder.value = '';
  elRefineArtist.value = '';
  elRefineRange.value = '';
  elRefineFormat.value = '';
  if (mode === 'local') {
    populateLocalArtistDropdown();
    populateFolderDropdown();
    populateLocalFormatDropdown();
    elSelBulk.style.display = '';
  } else {
    elRefineFolder.innerHTML = '<option value="">Folder</option>';
    elRefineFormat.innerHTML = '<option value="">Format</option>';
  }
  // Preserve filter text but rebuild list for the mode
  currentIdx = -1;
  focusedIdx = -1;
  if (mode === 'modland' && elFilter.value.trim().length >= 2) {
    doModlandSearch();
  } else {
    buildPlaylist();
    restoreSelection();
  }
  updateSelCount();
}

let _localUrllistTracks = [];  // from per-engine urllists.json, shown in local mode

(async function init() {
  const resp = await fetch('players.json');
  players = await resp.json();
  loadModlandTracks();

  loadEnabledPlayers();

  await Promise.all(players.map(async (p) => {
    try {
      const r = await fetch(`engines/${p.id}/filelist.json`);
      fileLists[p.id] = await r.json();
    } catch (e) {
      fileLists[p.id] = [];
      console.warn('Failed to load filelist for', p.id, e);
    }
  }));

  // Load per-engine urllists.json (URL-based tracks with folders, for local mode)
  // Format per engine: { "folder-name": ["url1", ...], ... }
  _localUrllistTracks = [];
  await Promise.all(players.map(async (p) => {
    try {
      const r = await fetch(`engines/${p.id}/urllists.json`);
      if (!r.ok) return;
      const data = await r.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      for (const [folder, urls] of Object.entries(data)) {
        if (!Array.isArray(urls)) continue;
        for (const url of urls) {
          try {
            const safeUrl = encodeURI(url);
            const segments = new URL(safeUrl).pathname.split('/').map(decodeURIComponent);
            const fileName = segments[segments.length - 1];
            const artist = (segments.length >= 2 ? segments[segments.length - 2] : '').replace(/\//g, '+');
            const displayName = artist ? `${artist} - ${fileName}` : fileName;
            const name = `${folder}/${displayName}`;
            _localUrllistTracks.push({ name, ext: extOf(safeUrl), playerId: p.id, url: safeUrl });
          } catch (_) {}
        }
      }
    } catch (_) {}
  }));

  renderToggles();
  rebuildMergedFiles();
  populateLocalArtistDropdown();
  populateFolderDropdown();
  populateLocalFormatDropdown();
  updateRefineVisibility();
  buildPlaylist();
  restoreSelection();

  const deepLinked = await loadDeepLinkedTrack();
  applyDeepLinkFilters();

  if (!deepLinked) {
    try {
      const saved = JSON.parse(localStorage.getItem('current-track'));
      if (saved) {
        if (saved.mode === 'modland') {
          switchMode('modland');
          currentIdx = modlandFiles.findIndex(
            f => f.playerId === saved.playerId && f.name === saved.name
          );
        } else {
          currentIdx = mergedFiles.findIndex(
            f => f.playerId === saved.playerId && f.name === saved.name
          );
        }
        if (currentIdx >= 0) {
          highlightCurrent();
          setFocus(currentIdx);
        }
      }
    } catch (_) {}
  }

  // Restore persisted font size
  const savedSize = parseFloat(localStorage.getItem('playlist-font-size'));
  if (savedSize) setPlaylistFontSize(savedSize);

  // Start loading remote index in background
  remoteSearch.loadIndex().then(() => {
    if (searchMode === 'modland') {
      elFilter.placeholder = modlandPlaceholder();
    }
  }).catch(e => console.warn('Remote index not available:', e));
})();

// ── mode switching + modland search ─────────────────
elSearchMode.addEventListener('change', () => {
  switchMode(elSearchMode.value);
});

// In modland mode, search input queries the remote index
let _searchTimer = 0;
elFilter.addEventListener('input', () => {
  if (searchMode === 'modland') {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(doModlandSearch, 150);
  } else {
    populateLocalArtistDropdown();
    applyFilter();
  }
});

// Prevent global shortcuts when typing in filter
elFilter.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') elFilter.blur();
});

elFilterClr.addEventListener('click', () => {
  elFilter.value = '';
  elRefineFolder.value = '';
  elRefineArtist.value = '';
  elRefineRange.value = '';
  elRefineFormat.value = '';
  elFilter.dispatchEvent(new Event('input'));
  elFilter.focus();
});

// ── refine dropdowns ────────────────────────────────
function populateFolderDropdown() {
  elRefineFolder.innerHTML = '<option value="">Folder</option>';
  if (searchMode === 'modland') return; // populated dynamically in modland
  const folders = new Set();
  for (const f of mergedFiles) {
    if (f.playerId === 'ahx') continue; // AHX folders are artists, not genres
    const slash = f.name.lastIndexOf('/');
    if (slash >= 0) folders.add(f.name.substring(0, slash));
  }
  const sorted = [...folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (sorted.length > 50) {
    const letters = new Set(sorted.map(f => f[0].toUpperCase()));
    for (const ch of [...letters].sort()) {
      elRefineFolder.appendChild(new Option(ch, ch));
    }
  } else {
    for (const f of sorted) {
      elRefineFolder.appendChild(new Option(f, f));
    }
  }
}

function populateLocalArtistDropdown() {
  const prev = elRefineArtist.value;
  elRefineArtist.innerHTML = '<option value="">Artist</option>';
  const folderVal = elRefineFolder.value.toLowerCase();
  const raw = elFilter.value.trim();
  const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const artists = new Set();
  for (const f of mergedFiles) {
    if (!enabledPlayers[f.playerId]) continue;
    const name = f.name.toLowerCase();
    // Apply folder filter
    if (folderVal) {
      const slash = name.lastIndexOf('/');
      const entryFolder = slash >= 0 ? name.substring(0, slash) : '';
      if (folderVal.length === 1) {
        if (!(entryFolder.length > 0 && entryFolder[0] === folderVal)) continue;
      } else {
        if (entryFolder !== folderVal) continue;
      }
    }
    // Apply text filter
    if (terms.length > 0 && !terms.every(t => name.includes(t))) continue;
    const artist = extractArtist(f);
    if (artist) artists.add(artist);
  }
  const sorted = [...artists].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (sorted.length > 50) {
    const letters = new Set(sorted.map(a => a[0].toUpperCase()));
    for (const ch of [...letters].sort()) {
      elRefineArtist.appendChild(new Option(ch, ch));
    }
  } else {
    for (const a of sorted) {
      elRefineArtist.appendChild(new Option(a, a));
    }
  }
  if (prev && [...elRefineArtist.options].some(o => o.value === prev)) {
    elRefineArtist.value = prev;
  }
}

function populateLocalFormatDropdown() {
  const prev = elRefineFormat.value;
  elRefineFormat.innerHTML = '<option value="">Format</option>';
  const exts = new Set();
  for (const f of mergedFiles) {
    if (!enabledPlayers[f.playerId]) continue;
    if (f.ext) exts.add(f.ext);
  }
  for (const e of [...exts].sort()) {
    elRefineFormat.appendChild(new Option(e, e));
  }
  if (prev && [...elRefineFormat.options].some(o => o.value === prev)) {
    elRefineFormat.value = prev;
  }
}

function populateRangeDropdown(total) {
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

function updateRefineVisibility() {
  const isLocal = searchMode === 'local';
  elRefineArtist.style.display = isLocal ? '' : 'none';
  elRefineFolder.style.display = '';  // always visible
  elRefineRange.style.display = isLocal ? 'none' : '';
  elRefineFormat.style.display = '';
}

elRefineFolder.addEventListener('change', () => {
  if (searchMode === 'local') {
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
  if (_randomBrowsing) {
    const skip = parseInt(elRefineRange.value, 10) || 0;
    doRandomBrowse(skip);
  } else {
    doModlandSearch();
  }
});

elRefineFormat.addEventListener('change', () => {
  if (searchMode === 'local') {
    populateLocalArtistDropdown();
    applyFilter();
  } else if (_randomBrowsing) {
    const skip = parseInt(elRefineRange.value, 10) || 0;
    doRandomBrowse(skip);
  } else {
    doModlandSearch();
  }
});

function localPlaceholder() {
  return `Search ${mergedFiles.length.toLocaleString()} local tracks…`;
}

function modlandPlaceholder() {
  const cnt = remoteSearch.isLoaded() ? remoteSearch.entryCount() : 0;
  return cnt > 0 ? `Search ${cnt.toLocaleString()} modland tracks…` : 'Search modland…';
}

function searchByArtist(artist) {
  if (searchMode !== 'modland') switchMode('modland');
  const clean = artist.replace(/^-\s*/, '');
  elFilter.value = '';
  elRefineFolder.innerHTML = '<option value="">Folder</option>';
  elRefineFolder.appendChild(new Option(clean, clean));
  elRefineFolder.value = clean;
  doModlandSearch();
}

function addLongPress(el, callback, delay = 500) {
  let timer = 0;
  el.addEventListener('touchstart', (e) => {
    timer = setTimeout(() => { e.preventDefault(); callback(); }, delay);
  }, { passive: false });
  el.addEventListener('touchend', () => clearTimeout(timer));
  el.addEventListener('touchmove', () => clearTimeout(timer));
}

function updateMlButtons() {
  const isMl = searchMode === 'modland';
  const hasResults = _lastSearchResults.length > 0;
  elMlAddAll.style.display = isMl && hasResults ? '' : 'none';
  elMlDelAll.style.display = isMl && modlandFiles.length > 0 ? '' : 'none';
  elMlRandom.style.display = isMl ? '' : 'none';
  if (isMl && hasResults) {
    elMlAddAll.textContent = 'Add all';
  }
}

let _lastSearchResults = [];
let _lastSearchSkip = 0;
let _lastSearchTotal = 0;
let _inSearchResults = false;  // true when showing search result list

function doModlandSearch() {
  _randomBrowsing = false;
  const raw = elFilter.value.trim();
  const folderVal = elRefineFolder.value;
  const skip = parseInt(elRefineRange.value) || 0;

  if (raw.length < 2 && !folderVal) {
    _lastSearchResults = [];
    _inSearchResults = false;
    updateMlButtons();
    populateRangeDropdown(0);
    buildPlaylist();
    restoreSelection();
    return;
  }

  // Build query: folder dropdown prepends "folder/" to search
  let q;
  if (folderVal) {
    if (folderVal.length === 1) {
      q = folderVal.toLowerCase() + (raw ? ' ' + raw : '');
    } else {
      q = folderVal + '/' + (raw ? ' ' + raw : '');
    }
  } else {
    q = raw;
  }

  if (!remoteSearch.isLoaded()) {
    elFilterCnt.textContent = 'loading…';
    remoteSearch.loadIndex().then(() => doModlandSearch());
    return;
  }

  // Count total matches to clamp skip
  const total = remoteSearch.count(q);
  let clampedSkip = skip;
  if (clampedSkip > 0 && clampedSkip + 200 > total) clampedSkip = Math.max(total - 200, 0);

  const results = remoteSearch.search(q, 200, clampedSkip);
  const filtered = results.filter(r => enabledPlayers[r.playerId] !== false);
  _lastSearchSkip = clampedSkip;
  _lastSearchTotal = total;
  _inSearchResults = true;

  populateRangeDropdown(total);

  // Populate folder dropdown from result folders (preserve current selection)
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
    for (const ch of [...letters].sort()) {
      elRefineFolder.appendChild(new Option(ch, ch));
    }
  } else {
    for (const f of sortedFolders) {
      elRefineFolder.appendChild(new Option(f, f));
    }
  }
  if (prevFolder) {
    if (![...elRefineFolder.options].some(o => o.value === prevFolder)) {
      elRefineFolder.appendChild(new Option(prevFolder, prevFolder));
    }
    elRefineFolder.value = prevFolder;
  }

  // Populate format dropdown from result formats
  const prevFormat = elRefineFormat.value;
  const formats = new Set();
  for (const r of filtered) formats.add(r.ext.toUpperCase());
  elRefineFormat.innerHTML = '<option value="">Format</option>';
  for (const f of [...formats].sort()) {
    elRefineFormat.appendChild(new Option(f, f));
  }
  if (prevFormat && [...elRefineFormat.options].some(o => o.value === prevFormat)) {
    elRefineFormat.value = prevFormat;
  }

  // Apply format filter
  const fmtFilter = elRefineFormat.value;
  const displayed = fmtFilter ? filtered.filter(r => r.ext.toUpperCase() === fmtFilter) : filtered;
  _lastSearchResults = displayed;

  // Save currently playing track URL before rebuilding
  const playingUrl = _playingUrl;

  // Rebuild list showing search results with add buttons
  elList.innerHTML = '';
  const addedUrls = new Set(modlandFiles.map(t => t.url));

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

  // If the currently playing track is in the results, highlight and center it
  currentIdx = -1;
  if (playingUrl) {
    const ci = displayed.findIndex(r => r.url === playingUrl);
    if (ci >= 0) {
      currentIdx = ci;
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

elMlAddAll.addEventListener('click', () => {
  if (_lastSearchResults.length === 0) return;
  addModlandTracks(_lastSearchResults);
  // Clear search, show the modland list
  elFilter.value = '';
  _lastSearchResults = [];
  updateMlButtons();
  buildPlaylist();
  restoreSelection();
});

elMlDelAll.addEventListener('click', () => {
  let targets;
  if (_inSearchResults && _lastSearchResults.length > 0) {
    // Only delete tracks from the current search results that are in the stored list
    targets = _lastSearchResults.filter(r => modlandFiles.some(t => t.url === r.url)).map(r => r.url);
  } else {
    // Delete only the currently visible/filtered items in the playlist
    const items = elList.children;
    targets = [];
    for (let i = 0; i < items.length; i++) {
      if (!items[i].classList.contains('hidden')) {
        const f = modlandFiles[i];
        if (f) targets.push(f.url);
      }
    }
  }
  if (targets.length === 0) return;
  showDeleteConfirm(targets.length, () => deleteModlandByUrls(targets));
});

let _randomBrowsing = false;

elMlRandom.addEventListener('click', () => {
  if (!remoteSearch.isLoaded()) return;
  remoteSearch.reshuffle();
  _randomBrowsing = true;
  elFilter.value = '';
  elRefineFolder.value = '';
  elRefineFormat.value = '';
  doRandomBrowse(0);
});

function doRandomBrowse(skip) {
  if (!remoteSearch.isLoaded()) return;

  const total = remoteSearch.totalPlayable();
  const results = remoteSearch.browseAll(1000, skip);

  _lastSearchResults = results;
  _lastSearchSkip = skip;
  _lastSearchTotal = total;
  _inSearchResults = true;

  // Populate range dropdown with pages of 1000
  const prevRange = elRefineRange.value;
  elRefineRange.innerHTML = '<option value="">Range</option>';
  for (let i = 0; i < total; i += 1000) {
    const end = Math.min(i + 1000, total);
    elRefineRange.appendChild(new Option(`${i + 1}–${end}`, String(i)));
  }
  elRefineRange.value = String(skip);

  // Populate format dropdown from results
  const prevFormat = elRefineFormat.value;
  const formats = new Set();
  for (const r of results) formats.add(r.ext.toUpperCase());
  elRefineFormat.innerHTML = '<option value="">Format</option>';
  for (const f of [...formats].sort()) {
    elRefineFormat.appendChild(new Option(f, f));
  }
  if (prevFormat && [...elRefineFormat.options].some(o => o.value === prevFormat)) {
    elRefineFormat.value = prevFormat;
  }

  // Apply format filter
  const fmtFilter = elRefineFormat.value;
  const displayed = fmtFilter ? results.filter(r => r.ext.toUpperCase() === fmtFilter) : results;
  _lastSearchResults = displayed;

  const playingUrl = _playingUrl;

  // Rebuild list
  elList.innerHTML = '';
  const addedUrls = new Set(modlandFiles.map(t => t.url));

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

  // Highlight playing track if present
  currentIdx = -1;
  if (playingUrl) {
    const ci = displayed.findIndex(r => r.url === playingUrl);
    if (ci >= 0) {
      currentIdx = ci;
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

// ── pinch-to-zoom playlist font ─────────────────────
let pinchStartDist = 0;
let pinchStartSize = 0;
let swipeStartX = 0;
let swipeStartY = 0;
let swipeTracking = false;
const MIN_FONT = 8;
const MAX_FONT = 24;

function setPlaylistFontSize(px) {
  elList.style.fontSize = px + 'px';
  localStorage.setItem('playlist-font-size', px);
}

function getPlaylistFontSize() {
  return parseFloat(getComputedStyle(elList).fontSize) || 14;
}

elList.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    swipeTracking = false;
    pinchStartDist = Math.hypot(
      e.touches[1].clientX - e.touches[0].clientX,
      e.touches[1].clientY - e.touches[0].clientY
    );
    pinchStartSize = getPlaylistFontSize();
    return;
  }
  if (e.touches.length === 1) {
    const target = e.target;
    if (target instanceof Element && target.closest('input, button, select, a')) {
      swipeTracking = false;
      return;
    }
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeTracking = true;
  }
}, { passive: true });

elList.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && pinchStartDist > 0) {
    e.preventDefault();
    const dist = Math.hypot(
      e.touches[1].clientX - e.touches[0].clientX,
      e.touches[1].clientY - e.touches[0].clientY
    );
    const scale = dist / pinchStartDist;
    const newSize = Math.round(Math.min(MAX_FONT, Math.max(MIN_FONT, pinchStartSize * scale)));
    setPlaylistFontSize(newSize);
  }
}, { passive: false });

elList.addEventListener('touchend', (e) => {
  if (swipeTracking && pinchStartDist === 0 && e.changedTouches.length === 1) {
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;
    if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      playPrevNext(dx < 0 ? 1 : -1);
    }
  }
  swipeTracking = false;
  pinchStartDist = 0;
}, { passive: true });

elList.addEventListener('touchcancel', () => {
  swipeTracking = false;
  pinchStartDist = 0;
}, { passive: true });
