// js/artist-panel.js — Artist multi-select dropdown panel
import { S, elRefineArtistBtn, elRefineArtistPanel } from './state.js';

let _onArtistChange = null;
export function setArtistChangeHandler(fn) { _onArtistChange = fn; }

export function buildArtistPanel(artists) {
  const sorted = [...artists].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  S._allArtistOptions = new Set(sorted);
  const kept = new Set([...S.selectedArtists].filter(a => S._allArtistOptions.has(a)));
  S.selectedArtists = kept.size > 0 ? kept : new Set(S._allArtistOptions);

  const panel = elRefineArtistPanel;
  panel.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'Artist';
  panel.appendChild(title);

  const master = document.createElement('label');
  master.className = 'fmt-opt fmt-master';
  const masterCb = document.createElement('input');
  masterCb.type = 'checkbox';
  masterCb.value = '__master__';
  masterCb.checked = true;
  masterCb.addEventListener('change', () => {
    if (masterCb.checked) S.selectedArtists = new Set(S._allArtistOptions);
    else S.selectedArtists = new Set();
    updateArtistBtn();
    syncArtistCheckboxes();
    _onArtistChange?.();
  });
  master.appendChild(masterCb);
  master.appendChild(document.createTextNode(''));
  panel.appendChild(master);

  for (const a of sorted) {
    const label = document.createElement('label');
    label.className = 'fmt-opt';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = a;
    cb.checked = S.selectedArtists.has(a);
    cb.addEventListener('change', () => {
      if (cb.checked) S.selectedArtists.add(a);
      else S.selectedArtists.delete(a);
      updateArtistBtn();
      syncArtistCheckboxes();
      _onArtistChange?.();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(a));
    panel.appendChild(label);
  }

  updateArtistBtn();
  syncArtistCheckboxes();
}

export function syncArtistCheckboxes() {
  const allSelected = S._allArtistOptions.size > 0 &&
    S.selectedArtists.size === S._allArtistOptions.size;
  const partial = S.selectedArtists.size > 0 &&
    S.selectedArtists.size < S._allArtistOptions.size;
  for (const cb of elRefineArtistPanel.querySelectorAll('input[type="checkbox"]')) {
    if (cb.value === '__master__') {
      cb.checked = allSelected;
      cb.indeterminate = partial;
      cb.classList.toggle('indeterminate', partial);
      continue;
    }
    cb.indeterminate = false;
    cb.classList.remove('indeterminate');
    cb.checked = S.selectedArtists.has(cb.value);
  }
}

export function updateArtistBtn() {
  const active = S.selectedArtists.size > 0 && S.selectedArtists.size < S._allArtistOptions.size;
  elRefineArtistBtn.textContent = 'A';
  elRefineArtistBtn.classList.toggle('active', active);
  elRefineArtistBtn.hidden = S._allArtistOptions.size === 0;
}

export function clearArtistFilter() {
  S.selectedArtists = new Set(S._allArtistOptions);
  updateArtistBtn();
  syncArtistCheckboxes();
}

// ── event listeners ───────────────────────────────────
elRefineArtistBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  elRefineArtistPanel.hidden = !elRefineArtistPanel.hidden;
});

document.addEventListener('click', () => { elRefineArtistPanel.hidden = true; });

elRefineArtistPanel.addEventListener('click', (e) => e.stopPropagation());
