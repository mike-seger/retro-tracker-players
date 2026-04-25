// js/filter.js — applyFilter + refine visibility
import { S, elFilter, elFilterCnt, elRefineFolder, elRefineArtist,
         elRefineFormatWrap, elRefineRange, elRefineArtist as _artist,
         elList } from './state.js';
import { extractArtist } from './utils.js';
import { buildFormatPanel } from './format-panel.js';
import { activeFiles } from './playlist.js';
import { persistContext } from './persistence.js';
import { scrollIntoViewSmart } from './playlist.js';

export function applyFilter() {
  const raw = elFilter.value.trim();
  const folderVal = elRefineFolder.value.toLowerCase();
  const artistVal = elRefineArtist.value.toLowerCase();
  const terms = raw.toLowerCase().split(/\s+/).filter(Boolean);
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
      if (nameMatch && folderVal) {
        const slash = name.lastIndexOf('/');
        const ef = slash >= 0 ? name.substring(0, slash) : '';
        nameMatch = folderVal.length === 1
          ? (ef.length > 0 && ef[0] === folderVal)
          : ef === folderVal;
      }
      if (nameMatch && artistVal) {
        const a = entry ? extractArtist(entry).toLowerCase() : '';
        nameMatch = artistVal.length === 1
          ? (a.length > 0 && a[0] === artistVal)
          : a === artistVal;
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
    if (nameMatch && folderVal) {
      const slash = name.lastIndexOf('/');
      const ef = slash >= 0 ? name.substring(0, slash) : '';
      nameMatch = folderVal.length === 1
        ? (ef.length > 0 && ef[0] === folderVal)
        : ef === folderVal;
    }
    if (nameMatch && artistVal) {
      const a = entry ? extractArtist(entry).toLowerCase() : '';
      nameMatch = artistVal.length === 1
        ? (a.length > 0 && a[0] === artistVal)
        : a === artistVal;
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
  elFilterCnt.textContent = (terms.length || folderVal || artistVal || fmtActive)
    ? `${visible} / ${files.length}` : '';

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
  elRefineArtist.style.display = isLocal ? '' : 'none';
  elRefineFolder.style.display = '';
  elRefineRange.style.display  = isLocal ? 'none' : '';
  elRefineFormatWrap.style.display = '';
}
