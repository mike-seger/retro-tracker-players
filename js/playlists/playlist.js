// js/playlist.js — Playlist rendering, scroll helpers, file list management
import { S, elList, elTrackPos, elSelBulk, elFilter, elInfo, elPlDel } from '../core/state.js';
import { extOf, trackUrl, addLongPress, isMobile, toAbsoluteUrl, dbg } from '../lib/utils.js';
import { createTrackRow, isTrackRowControlTarget } from './track-row.js';
// Note: circular imports below (filter.js ↔ playlist.js, etc.) are safe —
// all cross-module calls happen inside function bodies, never at eval time.
import { applyFilter } from '../filters/filter.js';
import { loadAndPlay } from '../core/player.js';
import { toggleSelect, updateSelCount } from './selection.js';
import { deleteModlandTrack, searchByArtist, openAddDropdown } from '../browse/modland.js';
import { localPlaceholder, modlandPlaceholder } from '../filters/refine.js';
import * as pm from './playlist-manager.js';
import { getMaxListItems } from '../settings/settings.js';
import * as remoteSearch from '../browse/remote-search.js';

// ── active list helpers ───────────────────────────────
export function activeFiles() {
  if (S._inSearchResults) return S._lastSearchResults;
  return S.searchMode === 'local' ? S.mergedFiles : S.modlandFiles;
}

export function activeSelected() {
  return S.searchMode === 'local' ? S.localSelected : S.modlandSelected;
}

export function setActiveSelected(s) {
  if (S.searchMode === 'local') S.localSelected = s;
  else S.modlandSelected = s;
}

// ── merge local file lists ────────────────────────────
export function rebuildMergedFiles() {
  const hidden = pm.getHiddenListKeys();
  const isHiddenList = (name) => {
    const slash = name.lastIndexOf('/');
    if (slash < 0) return false;
    const folder = name.substring(0, slash);
    return hidden.has(pm.hiddenListKeyForFolder(folder));
  };

  S.mergedFiles = [];
  const seen = new Map();

  const membershipByKey = new Map();
  for (const t of S._userPlaylistTracks) {
    const key = t.url || (t.playerId + ':' + t.name);
    let m = membershipByKey.get(key);
    if (!m) {
      m = { ids: new Set(), names: new Set() };
      membershipByKey.set(key, m);
    }
    if (t.playlistId) m.ids.add(t.playlistId);
    if (t.playlistName) m.names.add(t.playlistName);
  }

  const applyMembership = (entry, key) => {
    const m = membershipByKey.get(key);
    if (!m) return;
    entry.userPlaylistIds = [...m.ids];
    entry.userPlaylistNames = [...m.names]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    if (!entry.playlistId && entry.userPlaylistIds.length) entry.playlistId = entry.userPlaylistIds[0];
  };

  const pushUnique = (entry) => {
    const key = entry.url || (entry.playerId + ':' + entry.name);
    const existingIdx = seen.get(key);
    if (existingIdx !== undefined) {
      applyMembership(S.mergedFiles[existingIdx], key);
      return;
    }
    applyMembership(entry, key);
    seen.set(key, S.mergedFiles.length);
    S.mergedFiles.push(entry);
  };

  for (const p of S.players) {
    if (!S.enabledPlayers[p.id]) continue;
    const files = S.fileLists[p.id] || [];
    files.forEach((name, origIdx) => {
      if (p.id !== 'ahx' && isHiddenList(name)) return;
      pushUnique({ name, ext: extOf(name), playerId: p.id, origIdx });
    });
  }
  for (const t of S._localUrllistTracks) {
    if (!S.enabledPlayers[t.playerId]) continue;
    if (t.playerId !== 'ahx' && isHiddenList(t.name || '')) continue;
    pushUnique(t);
  }
  for (const t of S._userPlaylistTracks) {
    if (!S.enabledPlayers[t.playerId]) continue;
    pushUnique(t);
  }
  S.mergedFiles.sort((a, b) => {
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

// ── type toggles (stubs — all players always enabled) ─
export function renderToggles() {}
export function saveEnabledPlayers() {}

export function loadEnabledPlayers() {
  S.players.forEach(p => { S.enabledPlayers[p.id] = true; });
}

export function onPlayerToggle() {
  const curFile = S.currentIdx >= 0 ? S.mergedFiles[S.currentIdx] : null;
  rebuildMergedFiles();
  elFilter.placeholder = S.searchMode === 'local' ? localPlaceholder() : modlandPlaceholder();
  S.localSelected.clear();
  S.bulkRestoreSelection = new Set();
  buildPlaylist();
  updateSelCount();
  if (curFile) {
    S.currentIdx = S.mergedFiles.findIndex(
      f => f.playerId === curFile.playerId && f.name === curFile.name
    );
  } else {
    S.currentIdx = -1;
  }
  if (S.currentIdx >= 0) {
    highlightCurrent();
    setFocus(S.currentIdx);
  }
}

// ── build playlist DOM ────────────────────────────────
export function buildPlaylist() {
  S._inSearchResults = false;
  elSelBulk.style.display = '';
  elList.innerHTML = '';
  const files = activeFiles();
  const maxItems = getMaxListItems();
  const displayCount = Math.min(files.length, maxItems);
  const sel = activeSelected();
  const pad = Math.max(2, String(displayCount).length);

  for (let i = 0; i < displayCount; i++) {
    const entry = files[i];
    const actions = [];
    if (!isMobile) {
      actions.push({
        key: 'download',
        className: 'r-dl',
        text: 'D↧',
        title: 'Download track',
        ariaLabel: 'Download track',
      });
    }
    if (S.searchMode === 'modland' && entry.url) {
      actions.push({ key: 'remove', className: 'r-del', text: '×', title: 'Remove' });
    }
    if (S.searchMode === 'local' && Array.isArray(entry.userPlaylistIds) && entry.userPlaylistIds.length > 0) {
      actions.push({
        key: 'playlist-remove',
        className: 'r-pl-del',
        text: 'X',
        title: 'Remove from playlist',
        ariaLabel: 'Remove from playlist',
      });
    }
    actions.push({ key: 'add', className: 'r-add', text: '+', title: 'Add to playlist' });

    const { li, checkbox, actionButtons, baseName, searchArtist } = createTrackRow({
      entry,
      indexLabel: String(i + 1).padStart(pad, '\u2007'),
      selected: sel.has(i),
      showCheckbox: true,
      actions,
    });
    li.dataset.idx = i;

    const dlBtn = actionButtons.get('download');
    if (dlBtn) {
      dlBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const url = trackUrl(entry);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName || entry.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
    }

    checkbox.addEventListener('change', (ev) => {
      ev.stopPropagation();
      toggleSelect(i, ev.target.checked);
    });

    const delBtn = actionButtons.get('remove');
    if (delBtn) {
      delBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        deleteModlandTrack(entry.url);
      });
    }

    const plDelBtn = actionButtons.get('playlist-remove');
    if (plDelBtn) {
      plDelBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const visibleRows = [...elList.children].filter((row) => !row.classList.contains('hidden'));
        let preferredVisibleRow = visibleRows.indexOf(li);
        if (preferredVisibleRow < 0) preferredVisibleRow = 0;
        const ids = (entry.userPlaylistIds || []).slice();
        const key = pm.trackKey(entry);
        Promise.all(ids.map(id => pm.removeTrack(id, key))).then(() => {
          import('../core/app.js').then(m => m.refreshUserPlaylistTracksAndRebuild({ preferredVisibleRow }));
        });
      });
    }

    const addBtn = actionButtons.get('add');
    if (addBtn) {
      addBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openAddDropdown(ev.currentTarget, entry);
      });
    }

    li.addEventListener('click', (ev) => {
      if (isTrackRowControlTarget(ev.target)) return;
      loadAndPlay(i);
    });

    if (S.searchMode === 'modland' && searchArtist) {
      li.addEventListener('dblclick', (ev) => {
        if (isTrackRowControlTarget(ev.target)) return;
        searchByArtist(searchArtist);
      });
      addLongPress(li, () => searchByArtist(searchArtist));
    } else if (S.searchMode === 'local') {
      const goToArtist = () => {
        if (!searchArtist) return;
        searchByArtist(searchArtist);
      };
      li.addEventListener('dblclick', (ev) => {
        if (isTrackRowControlTarget(ev.target)) return;
        goToArtist();
      });
      addLongPress(li, goToArtist);
    }

    if (i === S.currentIdx) li.classList.add('current');
    if (i === S.focusedIdx) li.classList.add('focused');

    elList.appendChild(li);
  }

  applyFilter();
  updateTrackPos();
}

export function updateTrackPos() {
  if (!elTrackPos) return;
  const files = activeFiles();
  const items = elList.children;
  let visibleTotal = 0;
  let visiblePos = 0;

  for (let i = 0; i < items.length; i++) {
    if (items[i].classList.contains('hidden')) continue;
    visibleTotal++;
    if (i === S.currentIdx) visiblePos = visibleTotal;
  }

  const filtered = (S.searchMode === 'modland' && S._inSearchResults && S._lastSearchTotal > 0)
    ? S._lastSearchTotal
    : visibleTotal;
  // In modland search results, show the full remote index total (not the page size).
  const total = (S.searchMode === 'modland' && S._inSearchResults && remoteSearch.isLoaded())
    ? remoteSearch.totalPlayable()
    : files.length;
  const pos = (S.currentIdx >= 0 && S.currentIdx < files.length && visiblePos > 0) ? String(visiblePos) : '-';

  elTrackPos.textContent = isMobile
    ? `${pos}/${filtered}`
    : `${pos}/${filtered}/${total}`;
}

// ── scroll + highlight + focus ────────────────────────
export function scrollIntoViewSmart(el, centered) {
  if (!el) return;
  const container = elList;
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  const elTop = container.scrollTop + (eRect.top - cRect.top);

  if (centered) {
    const target = elTop - Math.max(0, Math.floor((container.clientHeight - el.offsetHeight) / 2));
    container.scrollTop = Math.max(0, target);
    return;
  }

  const elBottom = elTop + el.offsetHeight;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;
  if (elTop >= viewTop && elBottom <= viewBottom) return;
  container.scrollTop = Math.max(0, elTop - 2);
}

export function highlightCurrent() {
  const prev = elList.querySelector('li.current');
  if (prev) prev.classList.remove('current');
  const cur = S.currentIdx >= 0 ? elList.children[S.currentIdx] : null;
  if (cur) {
    cur.classList.add('current');
    scrollIntoViewSmart(cur);
  }
}

export function setFocus(idx) {
  const files = activeFiles();
  if (idx < 0 || idx >= files.length) return;
  S.focusedIdx = idx;
  const prev = elList.querySelector('li.focused');
  if (prev) prev.classList.remove('focused');
  const li = elList.children[idx];
  if (li) {
    li.classList.add('focused');
    scrollIntoViewSmart(li);
  }
  import('../browse/modland.js').then(m => m.refreshOpenAddDropdown?.()).catch(() => {});
}

// Re-anchor current/focus by the playing URL after list content changes.
// Returns the matched index, or -1 when no visible match exists.
export function syncPlayingTrackByUrl(reason = 'unknown') {
  const log = (msg) => {
    if (S._debugTrackReanchor) dbg(`[R] ${msg}`);
  };

  const files = activeFiles();
  if (!S._playingUrl || files.length === 0) {
    if (S._playingUrl) log(`${reason}: skip (no active files)`);
    return -1;
  }

  const target = toAbsoluteUrl(S._playingUrl);
  const idx = files.findIndex((e) => toAbsoluteUrl(e.url || trackUrl(e)) === target);
  if (idx < 0) {
    log(`${reason}: no URL match in displayed list`);
    return -1;
  }

  const li = elList.children[idx];
  if (!li || li.classList.contains('hidden')) {
    log(`${reason}: URL matched idx ${idx}, but row is not visible`);
    return -1;
  }

  S.currentIdx = idx;
  highlightCurrent();
  setFocus(idx);
  scrollIntoViewSmart(li, true);
  log(`${reason}: synced to idx ${idx + 1}`);
  // Fire deferred auto-resume set during startup (modland search hadn't completed yet).
  if (S._pendingAutoResume) {
    const resume = S._pendingAutoResume;
    S._pendingAutoResume = null;
    resume();
  }
  return idx;
}

export function getVisibleIndices() {
  const indices = [];
  const items = elList.children;
  for (let i = 0; i < items.length; i++) {
    if (!items[i].classList.contains('hidden')) indices.push(i);
  }
  return indices;
}

export function alignInfoValueColumn() {
  const labels = elInfo.querySelectorAll('.info-field .label');
  if (!labels.length) { elInfo.style.removeProperty('--info-label-col'); return; }
  let max = 0;
  labels.forEach(label => {
    const w = Math.ceil(label.getBoundingClientRect().width);
    if (w > max) max = w;
  });
  if (max > 0) elInfo.style.setProperty('--info-label-col', `${max}px`);
}

// ── playlist font size ────────────────────────────────
export function setPlaylistFontSize(px) {
  elList.style.fontSize = px + 'px';
  localStorage.setItem('playlist-font-size', px);
}

export function getPlaylistFontSize() {
  return parseFloat(getComputedStyle(elList).fontSize) || 14;
}
