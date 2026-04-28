// js/playlist.js — Playlist rendering, scroll helpers, file list management
import { S, elList, elTrackPos, elSelBulk, elFilter, elInfo } from './state.js';
import { esc, extOf, trackUrl, addLongPress, isMobile, parseTrackDisplay } from './utils.js';
// Note: circular imports below (filter.js ↔ playlist.js, etc.) are safe —
// all cross-module calls happen inside function bodies, never at eval time.
import { applyFilter } from './filter.js';
import { loadAndPlay } from './player.js';
import { toggleSelect } from './selection.js';
import { deleteModlandTrack, searchByArtist } from './modland.js';
import { updateSelCount } from './selection.js';
import { localPlaceholder, modlandPlaceholder } from './refine.js';

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
  S.mergedFiles = [];
  for (const p of S.players) {
    if (!S.enabledPlayers[p.id]) continue;
    const files = S.fileLists[p.id] || [];
    files.forEach((name, origIdx) => {
      S.mergedFiles.push({ name, ext: extOf(name), playerId: p.id, origIdx });
    });
  }
  for (const t of S._localUrllistTracks) {
    if (!S.enabledPlayers[t.playerId]) continue;
    S.mergedFiles.push(t);
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
  const sel = activeSelected();
  const pad = Math.max(2, String(files.length).length);

  files.forEach((entry, i) => {
    const li = document.createElement('li');
    li.dataset.idx = i;

    const decodedName = decodeURIComponent(entry.name);
    const slash = decodedName.lastIndexOf('/');
    const baseName = slash >= 0 ? decodedName.substring(slash + 1) : decodedName;
    const { artist, title, folder } = parseTrackDisplay(entry);
    const idxStr = String(i + 1).padStart(pad, '\u2007');
    const checked = sel.has(i) ? ' checked' : '';

    if (entry.url) li.classList.add('remote');

    li.innerHTML =
      `<span class="idx">${idxStr}</span>` +
      `<input type="checkbox" class="sel-cb" tabindex="-1"${checked}>` +
      `<div class="row-top">` +
        `<span class="artist">${esc(artist)}</span>` +
        (folder ? `<span class="folder">${esc(folder)}</span>` : '') +
      `</div>` +
      `<div class="row-bot">` +
        `<span class="title">${esc(title)}</span>` +
        `<span class="ext">${esc(entry.ext)}</span>` +
        (!isMobile ? `<button class="r-dl" title="Download">D</button>` : '') +
        (S.searchMode === 'modland' && entry.url
          ? `<button class="r-del" title="Remove">&times;</button>` : '') +
      `</div>`;

    const dlBtn = li.querySelector('.r-dl');
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
      if (ev.target.classList.contains('sel-cb') ||
          ev.target.classList.contains('r-del') ||
          ev.target.classList.contains('r-dl')) return;
      loadAndPlay(i);
    });

    if (S.searchMode === 'modland' && (artist || folder)) {
      const searchArtist = artist || folder;
      li.addEventListener('dblclick', (ev) => {
        if (ev.target.classList.contains('sel-cb') ||
            ev.target.classList.contains('r-del') ||
            ev.target.classList.contains('r-dl')) return;
        searchByArtist(searchArtist);
      });
      addLongPress(li, () => searchByArtist(searchArtist));
    } else if (S.searchMode === 'local') {
      const goToArtist = () => {
        const sa = artist || folder;
        if (!sa) return;
        searchByArtist(sa);
      };
      li.addEventListener('dblclick', (ev) => {
        if (ev.target.classList.contains('sel-cb') ||
            ev.target.classList.contains('r-dl')) return;
        goToArtist();
      });
      addLongPress(li, goToArtist);
    }

    if (i === S.currentIdx) li.classList.add('current');
    if (i === S.focusedIdx) li.classList.add('focused');

    elList.appendChild(li);
  });

  applyFilter();
  updateTrackPos();
}

export function updateTrackPos() {
  const files = activeFiles();
  if (S.currentIdx >= 0 && S.currentIdx < files.length) {
    const items = elList.children;
    let visibleTotal = 0;
    let visiblePos = 0;

    for (let i = 0; i < items.length; i++) {
      if (items[i].classList.contains('hidden')) continue;
      visibleTotal++;
      if (i === S.currentIdx) visiblePos = visibleTotal;
    }

    if (visibleTotal > 0) {
      elTrackPos.textContent = visiblePos > 0 ? `${visiblePos} / ${visibleTotal}` : `- / ${visibleTotal}`;
    } else {
      elTrackPos.textContent = '-/-';
    }
  } else {
    elTrackPos.textContent = '-/-';
  }
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
