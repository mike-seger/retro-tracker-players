// js/modland.js — Modland file management, search, random browse, mode helpers
import { S, elFilter, elFilterCnt,
         elSelBulk, elMlAddAll, elMlDelAll, elMlRandom, elList,
         btnCopy, btnZip, SID_TRACK_PLAYER_ID } from '../core/state.js';
import { trackUrl, addLongPress, isMobile, parseTrackDisplay } from '../lib/utils.js';
import { buildFormatPanel } from '../filters/format-panel.js';
import { loadAndPlay } from '../core/player.js';
import { activeFiles, updateTrackPos, buildPlaylist, syncPlayingTrackByUrl } from '../playlists/playlist.js';
import { restoreSelection, updateSelCount } from '../playlists/selection.js';
import { getRangeSkip, buildRangePanel } from '../filters/range-panel.js';
import { showAddConfirm, showDeleteConfirm } from '../ui/prompts.js';
import * as remoteSearch from './remote-search.js';
import * as pm from '../playlists/playlist-manager.js';
import { createTrackRow, isTrackRowControlTarget } from '../playlists/track-row.js';
import { getMaxListItems } from '../settings/settings.js';

// ── helpers ───────────────────────────────────────────
function detectPlayerIdFromUrl(url) {
  const ext = url.split('.').pop().toLowerCase();
  if (ext === 'ahx') return 'ahx';
  if (ext === 'sid') return SID_TRACK_PLAYER_ID;
  if (['mod', 'xm', 's3m', 'it'].includes(ext)) return 'mod';
  if (['spc', 'vgm', 'vgz'].includes(ext)) return 'gme';
  return null;
}

function urlToTrack(url) {
  const playerId = detectPlayerIdFromUrl(url);
  if (!playerId) return null;
  const { extOf } = { extOf: (u) => { const d = u.lastIndexOf('.'); return d >= 0 ? u.substring(d + 1).toUpperCase() : ''; } };
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/').map(decodeURIComponent);
  const artist = (segments[segments.length - 2] || '').replace(/\//g, '+');
  const file = segments[segments.length - 1];
  const name = `${artist}/${file}`;
  const dot = url.lastIndexOf('.');
  const ext = dot >= 0 ? url.substring(dot + 1).toUpperCase() : '';
  // Reconstruct the URL with proper single-encoding (fixes any double-encoded % in stored URLs)
  const normalizedPath = segments.map((s, i) => i === 0 ? s : encodeURIComponent(s)).join('/');
  const normalizedUrl = parsed.origin + normalizedPath;
  return { name, ext, playerId, url: normalizedUrl };
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
  saveModlandUrls(); // persist normalized URLs (fixes any historically double-encoded entries)
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
      import('../core/mode.js').then(m => m.switchMode('modland'));
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
      import('../core/mode.js').then(m => m.switchMode('modland'));
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
      import('../core/mode.js').then(m => m.switchMode('modland'));
    }
  }
}

// ── artist search (cross-mode) ────────────────────────
export function searchByArtist(artist) {
  import('../core/mode.js').then(m => {
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
  btnCopy.style.display    = (isMl && hasResults) ? 'none' : '';
  btnZip.style.display     = (isMl && hasResults) ? 'none' : '';
}

// ── modland search ────────────────────────────────────
export function doModlandSearch() {
  S._randomBrowsing = false;
  const raw = elFilter.value.trim();
  const skip = getRangeSkip();
  const pageSize = getMaxListItems();

  if (!remoteSearch.isLoaded()) {
    elFilterCnt.textContent = 'loading…';
    remoteSearch.loadIndex().then(() => doModlandSearch());
    return;
  }

  const allFormats = remoteSearch.availableFormats();
  buildFormatPanel(allFormats);
  const fmtActive = S.selectedFormats.size > 0 && S.selectedFormats.size < S._allFormatOptions.size;
  const qActive = raw.length >= 2;

  if (!qActive && !fmtActive) {
    S._lastSearchResults = [];
    S._inSearchResults = false;
    updateMlButtons();
    buildRangePanel(0);
    buildPlaylist();
    restoreSelection();
    return;
  }

  const q = raw;
  const total = remoteSearch.countWithFormats(q, fmtActive ? S.selectedFormats : null);
  let clampedSkip = skip;
  if (clampedSkip > 0 && clampedSkip + pageSize > total) clampedSkip = Math.max(total - pageSize, 0);

  const results = remoteSearch.searchWithFormats(q, fmtActive ? S.selectedFormats : null, pageSize, clampedSkip);
  const filtered = results.filter(r => S.enabledPlayers[r.playerId] !== false);
  S._lastSearchSkip = clampedSkip;
  S._lastSearchTotal = total;
  S._inSearchResults = true;

  buildRangePanel(total, pageSize);

  const displayed = (S.selectedFormats.size > 0 && S.selectedFormats.size < S._allFormatOptions.size)
    ? filtered.filter(r => S.selectedFormats.has(r.ext.toUpperCase()))
    : filtered;
  S._lastSearchResults = displayed;

  elList.innerHTML = '';
  const addedUrls = new Set(S.modlandFiles.map(t => t.url));

  elFilterCnt.textContent = '';
  elSelBulk.style.display = 'none';
  updateMlButtons();
  updateTrackPos();

  for (let si = 0; si < displayed.length; si++) {
    const r = displayed[si];
    const isAdded = addedUrls.has(r.url);
    const { li, actionButtons, baseName, searchArtist } = createTrackRow({
      entry: r,
      actions: [
        ...(!isMobile ? [{
          key: 'download',
          className: 'r-dl',
          text: 'D',
          title: 'Download track',
          ariaLabel: 'Download track',
        }] : []),
        { key: 'add', className: 'r-add', text: isAdded ? '✓' : '+', title: 'Add track' },
      ],
    });
    li.dataset.idx = si;

    if (isAdded) li.classList.add('added');

    const dlBtn = actionButtons.get('download');
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

    actionButtons.get('add').addEventListener('click', (ev) => {
      ev.stopPropagation();
      openAddDropdown(ev.currentTarget, r);
    });

    li.addEventListener('click', (ev) => {
      if (isTrackRowControlTarget(ev.target)) return;
      loadAndPlay(si);
    });

    if (searchArtist) {
      li.addEventListener('dblclick', (ev) => {
        if (isTrackRowControlTarget(ev.target)) return;
        searchByArtist(searchArtist);
      });
      addLongPress(li, () => searchByArtist(searchArtist));
    }

    elList.appendChild(li);
  }

  syncPlayingTrackByUrl('doModlandSearch');
  updateTrackPos();
  updateMlButtons();
}

// ── random browse ─────────────────────────────────────
export function doRandomBrowse(skip) {
  if (!remoteSearch.isLoaded()) return;

  const pageSize = getMaxListItems();

  const total = remoteSearch.totalPlayable();
  const results = remoteSearch.browseAll(pageSize, skip);

  S._lastSearchSkip = skip;
  S._lastSearchTotal = total;
  S._inSearchResults = true;

  // Populate range panel with pages of configured size
  buildRangePanel(total, pageSize);
  S._currentRange = skip;

  const formats = new Set();
  for (const r of results) formats.add(r.ext.toUpperCase());
  buildFormatPanel(formats);

  const displayed = (S.selectedFormats.size > 0 && S.selectedFormats.size < S._allFormatOptions.size)
    ? results.filter(r => S.selectedFormats.has(r.ext.toUpperCase()))
    : results;
  S._lastSearchResults = displayed;

  elList.innerHTML = '';
  const addedUrls = new Set(S.modlandFiles.map(t => t.url));

  elFilterCnt.textContent = `${skip + 1}–${Math.min(skip + pageSize, total)} of ${total}`;
  elSelBulk.style.display = 'none';
  updateMlButtons();

  for (let si = 0; si < displayed.length; si++) {
    const r = displayed[si];
    const isAdded = addedUrls.has(r.url);
    const { li, actionButtons, baseName, searchArtist } = createTrackRow({
      entry: r,
      actions: [
        ...(!isMobile ? [{
          key: 'download',
          className: 'r-dl',
          text: 'D',
          title: 'Download',
          ariaLabel: 'Download track',
        }] : []),
        { key: 'add', className: 'r-add', text: isAdded ? '✓' : '+', title: 'Add track' },
      ],
    });
    li.dataset.idx = si;

    if (isAdded) li.classList.add('added');

    const dlBtn = actionButtons.get('download');
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

    actionButtons.get('add').addEventListener('click', (ev) => {
      ev.stopPropagation();
      openAddDropdown(ev.currentTarget, r);
    });

    li.addEventListener('click', (ev) => {
      if (isTrackRowControlTarget(ev.target)) return;
      loadAndPlay(si);
    });

    if (searchArtist) {
      li.addEventListener('dblclick', (ev) => {
        if (isTrackRowControlTarget(ev.target)) return;
        searchByArtist(searchArtist);
      });
      addLongPress(li, () => searchByArtist(searchArtist));
    }

    elList.appendChild(li);
  }

  syncPlayingTrackByUrl('doRandomBrowse');
  updateTrackPos();
  updateMlButtons();
}

// ── r-add dropdown ────────────────────────────────────
let _addDropdownSession = null;

function closeAddDropdown() {
  _addDropdownSession = null;
  document.getElementById('r-add-dropdown')?.remove();
}

function positionAddDropdown(panel, btn) {
  if (!panel || !btn) return;
  const pad = 4;
  const gap = 2;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const rect = btn.getBoundingClientRect();
  panel.style.maxHeight = `${Math.max(120, vh - pad * 2)}px`;
  const pw = panel.offsetWidth || 220;
  const ph = panel.offsetHeight || 120;

  let left = rect.right - pw;
  if (left < pad) left = pad;
  if (left + pw > vw - pad) left = Math.max(pad, vw - pad - pw);

  const belowTop = rect.bottom + gap;
  const aboveTop = rect.top - gap - ph;
  const belowSpace = vh - pad - belowTop;
  const aboveSpace = rect.top - pad - gap;

  let top = belowTop;
  if (ph > belowSpace && aboveSpace > belowSpace) {
    top = aboveTop;
  }
  if (top < pad) top = pad;
  if (top + ph > vh - pad) top = Math.max(pad, vh - pad - ph);

  panel.style.cssText = `position:fixed;z-index:500;left:${left}px;top:${top}px;max-height:${Math.max(120, vh - pad * 2)}px;`;
}

function renderAddDropdown(panel, btn, track) {
  panel.innerHTML = '';
  const playlists = _addDropdownSession?.playlists || [];
  const trackKey = pm.trackKey(track);
  const scratchSet = new Set(S.modlandFiles.map(pm.trackKey));
  const { artist, title } = parseTrackDisplay(track);
  const li = btn.closest('li');
  const syncScratchVisual = (checked) => {
    if (li) li.classList.toggle('added', checked);
    btn.textContent = checked ? '✓' : '+';
  };

  const head = document.createElement('div');
  head.className = 'r-add-head';
  const headArtist = document.createElement('div');
  headArtist.className = 'r-add-head-artist';
  headArtist.textContent = artist || 'Unknown';
  const headTitle = document.createElement('div');
  headTitle.className = 'r-add-head-title';
  headTitle.textContent = title || track.name || 'Untitled';
  head.appendChild(headArtist);
  head.appendChild(headTitle);
  panel.appendChild(head);

  const buildRow = ({ text, checked, strong = false, onToggle }) => {
    const row = document.createElement('label');
    row.className = 'r-add-opt r-add-row' + (strong ? ' r-add-scratch' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    const txt = document.createElement(strong ? 'em' : 'span');
    txt.textContent = text;
    row.appendChild(cb);
    row.appendChild(txt);

    cb.addEventListener('change', async (e) => {
      e.stopPropagation();
      cb.disabled = true;
      try {
        await onToggle(cb.checked);
      } finally {
        cb.disabled = false;
      }
    });
    row.addEventListener('click', (e) => e.stopPropagation());
    return row;
  };

  panel.appendChild(buildRow({
    text: 'Scratchpad',
    checked: scratchSet.has(trackKey),
    strong: true,
    onToggle: async (checked) => {
      if (checked) {
        addModlandTrack(track);
      } else {
        S.modlandFiles = S.modlandFiles.filter(t => pm.trackKey(t) !== trackKey);
        saveModlandUrls();
      }
      syncScratchVisual(checked);
    },
  }));

  for (const pl of playlists) {
    const inPlaylist = (pl.tracks || []).some(t => pm.trackKey(t) === trackKey);
    panel.appendChild(buildRow({
      text: pl.name,
      checked: inPlaylist,
      onToggle: async (checked) => {
        if (checked) {
          const added = await pm.addTrack(pl.id, track);
          if (added && !(pl.tracks || []).some(t => pm.trackKey(t) === trackKey)) {
            pl.tracks = [...(pl.tracks || []), track];
          }
        } else {
          await pm.removeTrack(pl.id, trackKey);
          pl.tracks = (pl.tracks || []).filter(t => pm.trackKey(t) !== trackKey);
        }
      },
    }));
  }
}

export function refreshOpenAddDropdown() {
  const panel = document.getElementById('r-add-dropdown');
  if (!_addDropdownSession || !panel) return;
  if (S.searchMode !== 'modland' || !S._inSearchResults) {
    closeAddDropdown();
    return;
  }
  const idx = S.focusedIdx >= 0 ? S.focusedIdx : S.currentIdx;
  const track = activeFiles()[idx];
  const row = idx >= 0 ? elList.children[idx] : null;
  const btn = row?.querySelector('.r-add');
  if (!track || !btn) {
    closeAddDropdown();
    return;
  }
  _addDropdownSession.trackKey = pm.trackKey(track);
  renderAddDropdown(panel, btn, track);
  positionAddDropdown(panel, btn);
}

function openAddDropdown(btn, track) {
  closeAddDropdown();
  pm.getAll().then(playlists => {
    playlists = playlists.filter(pl => !pm.isListHidden(pm.hiddenListKeyForPlaylist(pl.id)));
    const panel = document.createElement('div');
    panel.id = 'r-add-dropdown';
    panel.className = 'r-add-panel';
    _addDropdownSession = { playlists };
    renderAddDropdown(panel, btn, track);
    panel.addEventListener('click', (e) => e.stopPropagation());

    document.body.appendChild(panel);
    positionAddDropdown(panel, btn);
  });
}

document.addEventListener('click', () => closeAddDropdown());
window.addEventListener('resize', () => refreshOpenAddDropdown());
elList.addEventListener('scroll', () => refreshOpenAddDropdown());

// ── Global add-all dropdown ──────────────────────────
let _addAllPanel = null;

function closeAddAllDropdown() {
  if (_addAllPanel) { _addAllPanel.remove(); _addAllPanel = null; }
}

function openAddAllDropdown(btn) {
  closeAddAllDropdown();
  const tracks = S._lastSearchResults;
  if (!tracks.length) return;

  pm.getAll().then(playlists => {
    playlists = playlists.filter(pl => !pm.isListHidden(pm.hiddenListKeyForPlaylist(pl.id)));

    const panel = document.createElement('div');
    panel.id = 'r-add-all-dropdown';
    panel.className = 'r-add-panel';
    _addAllPanel = panel;

    const head = document.createElement('div');
    head.className = 'r-add-head r-add-all-head';
    head.textContent = `Add ${tracks.length} track${tracks.length !== 1 ? 's' : ''} to…`;
    panel.appendChild(head);

    const buildSimpleRow = (text, strong, onClick) => {
      const row = document.createElement('div');
      row.className = 'r-add-opt r-add-row' + (strong ? ' r-add-scratch' : '');
      const lbl = document.createElement(strong ? 'em' : 'span');
      lbl.textContent = text;
      row.appendChild(lbl);
      row.addEventListener('click', (e) => { e.stopPropagation(); onClick(); closeAddAllDropdown(); });
      return row;
    };

    panel.appendChild(buildSimpleRow('Scratchpad', true, () => {
      addModlandTracks(tracks);
      elFilter.value = '';
      S._lastSearchResults = [];
      updateMlButtons();
      buildPlaylist();
      restoreSelection();
    }));

    for (const pl of playlists) {
      panel.appendChild(buildSimpleRow(pl.name, false, async () => {
        for (const t of tracks) await pm.addTrack(pl.id, t);
      }));
    }

    panel.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(panel);
    positionAddDropdown(panel, btn);
  });
}

// ── ML button listeners ───────────────────────────────
elMlAddAll.addEventListener('click', (e) => {
  e.stopPropagation();
  if (_addAllPanel) { closeAddAllDropdown(); return; }
  openAddAllDropdown(elMlAddAll);
});

document.addEventListener('click', () => closeAddAllDropdown());

elMlDelAll.addEventListener('click', () => {
  // If items are selected, only delete those
  const sel = S.modlandSelected;
  if (sel.size > 0) {
    const files = activeFiles();
    const targets = [...sel].map(i => files[i]?.url).filter(Boolean);
    if (!targets.length) return;
    showDeleteConfirm(targets.length, () => deleteModlandByUrls(targets));
    return;
  }
  // No selection — offer deleting all visible
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
  if (!targets.length) return;
  showDeleteConfirm(targets.length, () => deleteModlandByUrls(targets));
});

elMlRandom.addEventListener('click', () => {
  if (!remoteSearch.isLoaded()) return;
  remoteSearch.reshuffle();
  S._randomBrowsing = true;
  elFilter.value = '';
  import('../filters/range-panel.js').then(m => m.clearRangeFilter());
  import('../filters/format-panel.js').then(m => m.clearFormatFilter());
  doRandomBrowse(0);
});
