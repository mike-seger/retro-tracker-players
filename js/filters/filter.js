// js/filter.js — applyFilter + refine visibility
import { S, elFilter,
         elRefineFolderWrap, elRefineArtistWrap, elRefineRangeWrap,
         elRefineFormatWrap, elList } from '../core/state.js';
import { extractArtist, normalizeFormatExt } from '../lib/utils.js';
import { buildFormatPanel } from './format-panel.js';
import { activeFiles, updateTrackPos, highlightCurrent, setFocus, syncPlayingTrackByUrl } from '../playlists/playlist.js';
import { persistContext } from '../core/persistence.js';
import { scrollIntoViewSmart } from '../playlists/playlist.js';
import { isSystemFolder, isSystemFolderVisible } from '../playlists/playlist-manager.js';
import { getDisabledFormats } from '../settings/settings.js';

export function applyFilter() {
  const raw = elFilter.value.trim();
  const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const totalLists = S._allFolderOptions.size + S._allPlaylistOptions.size;
  // In local mode, list visibility defines the base dataset and must always apply,
  // including the "no visible lists" case (which should yield zero visible rows).
  const listsActive = S.searchMode === 'local';
  const artistsActive = S.selectedArtists.size > 0 && S.selectedArtists.size < S._allArtistOptions.size;
  const disabledFormats = getDisabledFormats();

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

  let visible = 0;
  let scopedTotal = 0;
  const files = activeFiles();
  const items = elList.children;

  // In local mode, rebuild the format panel from the currently refined subset
  // (text + folder + artist + enabled player) — before applying format filtering.
  if (S.searchMode === 'local') {
    const availableFormats = new Set();
    for (let i = 0; i < items.length; i++) {
      const entry = files[i];
      const name = entry ? entry.name.toLowerCase() : '';
      let nameMatch = terms.length === 0 || terms.every(t => name.includes(t));
      if (nameMatch && listsActive) nameMatch = inSelectedLists(entry);
      if (nameMatch && artistsActive) {
        const a = entry ? extractArtist(entry) : '';
        nameMatch = S.selectedArtists.has(a);
      }
      const typeMatch = !entry || !entry.playerId || S.enabledPlayers[entry.playerId] !== false;
      if (nameMatch && typeMatch && entry?.ext) {
        const grp = normalizeFormatExt(entry.ext);
        if (!disabledFormats.has(grp)) availableFormats.add(entry.ext);
      }
    }
    buildFormatPanel(availableFormats);
  }

  for (let i = 0; i < items.length; i++) {
    const entry = files[i];
    const name = entry ? entry.name.toLowerCase() : '';
    let nameMatch = terms.length === 0 || terms.every(t => name.includes(t));
    if (nameMatch && listsActive) nameMatch = inSelectedLists(entry);
    if (nameMatch && artistsActive) {
      const a = entry ? extractArtist(entry) : '';
      nameMatch = S.selectedArtists.has(a);
    }
    if (nameMatch && S.selectedFormats.size > 0 && S.selectedFormats.size < S._allFormatOptions.size) {
      nameMatch = entry && S.selectedFormats.has(entry.ext);
    }
    const typeMatch = !entry || !entry.playerId || S.enabledPlayers[entry.playerId] !== false;
    const formatEnabled = !entry?.ext || !disabledFormats.has(normalizeFormatExt(entry.ext));
    const inScopeBeforeFormat = (() => {
      const e = entry;
      const n = e ? e.name.toLowerCase() : '';
      let m = terms.length === 0 || terms.every(t => n.includes(t));
      if (m && listsActive) m = inSelectedLists(e);
      if (m && artistsActive) {
        const a = e ? extractArtist(e) : '';
        m = S.selectedArtists.has(a);
      }
      const tMatch = !e || !e.playerId || S.enabledPlayers[e.playerId] !== false;
      return m && tMatch;
    })();
    if (inScopeBeforeFormat) scopedTotal++;

    const show = nameMatch && typeMatch && formatEnabled;
    items[i].classList.toggle('hidden', !show);
    if (show) visible++;
  }

  const fmtActive = S.selectedFormats.size > 0 && S.selectedFormats.size < S._allFormatOptions.size;
  S._lastFilteredVisible = visible;
  S._lastFilteredTotal = (terms.length || listsActive || artistsActive || fmtActive || totalLists === 0)
    ? scopedTotal : visible;

  // Re-number visible rows relative to the displayed list
  const pad = Math.max(2, String(visible || files.length).length);
  let visIdx = 0;
  for (let i = 0; i < items.length; i++) {
    const span = items[i].querySelector('.idx');
    if (!span) continue;
    if (!items[i].classList.contains('hidden')) {
      visIdx++;
      span.textContent = String(visIdx).padStart(pad, '\u2007');
    }
  }

  // First try to re-anchor by currently playing URL after list/filter changes.
  const syncedIdx = syncPlayingTrackByUrl('applyFilter');

  // Fallback: keep current/focus anchored by index if URL is not visible.
  if (S.currentIdx >= 0) {
    if (syncedIdx >= 0) {
      updateTrackPos();
      persistContext();
      return;
    }
    const cur = items[S.currentIdx];
    const currentHidden = !cur || cur.classList.contains('hidden');
    if (currentHidden) {
      let nextIdx = -1;
      if (items.length > 0) {
        const startFwd = Math.min(Math.max(S.currentIdx, 0), items.length - 1);
        for (let i = startFwd; i < items.length; i++) {
          if (!items[i].classList.contains('hidden')) { nextIdx = i; break; }
        }
        if (nextIdx < 0) {
          const startBack = Math.min(Math.max(S.currentIdx - 1, 0), items.length - 1);
          for (let i = startBack; i >= 0; i--) {
            if (!items[i].classList.contains('hidden')) { nextIdx = i; break; }
          }
        }
      }

      S.currentIdx = nextIdx;
      highlightCurrent();

      if (nextIdx >= 0) {
        setFocus(nextIdx);
      } else {
        const prevFocus = elList.querySelector('li.focused');
        if (prevFocus) prevFocus.classList.remove('focused');
        S.focusedIdx = -1;
      }
    }
  }

  updateTrackPos();

  persistContext();

  // Scroll the playing track into view after the DOM has reflowed.
  if (S.currentIdx >= 0) {
    requestAnimationFrame(() => {
      const curItem = elList.children[S.currentIdx];
      if (curItem && !curItem.classList.contains('hidden')) {
        scrollIntoViewSmart(curItem, true);
      }
    });
  }
}

export function updateRefineVisibility() {
  const isLocal = S.searchMode === 'local';
  elRefineFolderWrap.style.display = isLocal ? '' : 'none';
  elRefineArtistWrap.style.display = isLocal ? '' : 'none';
  elRefineRangeWrap.style.display  = isLocal ? 'none' : '';
  elRefineFormatWrap.style.display = '';
}
