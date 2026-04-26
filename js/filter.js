// js/filter.js — applyFilter + refine visibility
import { S, elFilter, elFilterCnt,
         elRefineFolderWrap, elRefineArtistWrap, elRefineRangeWrap,
         elRefineFormatWrap, elList } from './state.js';
import { extractArtist } from './utils.js';
import { buildFormatPanel } from './format-panel.js';
import { activeFiles } from './playlist.js';
import { persistContext } from './persistence.js';
import { scrollIntoViewSmart } from './playlist.js';

export function applyFilter() {
  const raw = elFilter.value.trim();
  const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const foldersActive = S.selectedFolders.size > 0 && S.selectedFolders.size < S._allFolderOptions.size;
  const artistsActive = S.selectedArtists.size > 0 && S.selectedArtists.size < S._allArtistOptions.size;
  let visible = 0;
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
      if (nameMatch && foldersActive) {
        const slash = name.lastIndexOf('/');
        const ef = slash >= 0 ? entry.name.substring(0, slash) : '';
        nameMatch = S.selectedFolders.has(ef);
      }
      if (nameMatch && artistsActive) {
        const a = entry ? extractArtist(entry) : '';
        nameMatch = S.selectedArtists.has(a);
      }
      const typeMatch = !entry || !entry.playerId || S.enabledPlayers[entry.playerId] !== false;
      if (nameMatch && typeMatch && entry?.ext) availableFormats.add(entry.ext);
    }
    buildFormatPanel(availableFormats);
  }

  for (let i = 0; i < items.length; i++) {
    const entry = files[i];
    const name = entry ? entry.name.toLowerCase() : '';
    let nameMatch = terms.length === 0 || terms.every(t => name.includes(t));
    if (nameMatch && foldersActive) {
      const slash = name.lastIndexOf('/');
      const ef = slash >= 0 ? entry.name.substring(0, slash) : '';
      nameMatch = S.selectedFolders.has(ef);
    }
    if (nameMatch && artistsActive) {
      const a = entry ? extractArtist(entry) : '';
      nameMatch = S.selectedArtists.has(a);
    }
    if (nameMatch && S.selectedFormats.size > 0 && S.selectedFormats.size < S._allFormatOptions.size) {
      nameMatch = entry && S.selectedFormats.has(entry.ext);
    }
    const typeMatch = !entry || !entry.playerId || S.enabledPlayers[entry.playerId] !== false;
    const show = nameMatch && typeMatch;
    items[i].classList.toggle('hidden', !show);
    if (show) visible++;
  }

  const fmtActive = S.selectedFormats.size > 0 && S.selectedFormats.size < S._allFormatOptions.size;
  elFilterCnt.textContent = (terms.length || foldersActive || artistsActive || fmtActive)
    ? `${visible} / ${files.length}` : '';

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
