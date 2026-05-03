// js/artist-panel.js — Artist multi-select dropdown panel
import { S, elRefineArtistBtn, elRefineArtistPanel } from './state.js';
import { openDropdown, registerDropdown } from './dropdown-keys.js';

let _savedArtists = null;
let _openedArtists = null;
let _openedArtistState = null;

function selectionState(selectedSize, totalSize) {
  if (totalSize > 0 && selectedSize === totalSize) return 'all';
  if (selectedSize === 0) return 'none';
  return 'some';
}

function cycleMasterArtists() {
  const totalSize = S._allArtistOptions.size;
  const current = selectionState(S.selectedArtists.size, totalSize);
  const opened = _openedArtistState || current;

  let next;
  if (opened === 'some') {
    next = current === 'some' ? 'none' : (current === 'none' ? 'all' : 'some');
  } else if (opened === 'all') {
    next = current === 'none' ? 'all' : 'none';
  } else {
    next = current === 'all' ? 'none' : 'all';
  }

  if (next === 'all') {
    S.selectedArtists = new Set(S._allArtistOptions);
  } else if (next === 'none') {
    S.selectedArtists = new Set();
  } else {
    const restored = [...(_openedArtists || [])].filter(a => S._allArtistOptions.has(a));
    S.selectedArtists = new Set(restored);
  }

  updateArtistBtn();
  syncArtistCheckboxes();
  _onArtistChange?.();
}

let _onArtistChange = null;
export function setArtistChangeHandler(fn) { _onArtistChange = fn; }

export function buildArtistPanel(artists) {
  const sorted = [...artists].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  S._allArtistOptions = new Set(sorted);
  const kept = new Set([...S.selectedArtists].filter(a => S._allArtistOptions.has(a)));
  S.selectedArtists = kept.size > 0 ? kept : new Set(S._allArtistOptions);

  const panel = elRefineArtistPanel;
  panel.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'panel-head';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'Artist';
  head.appendChild(title);

  const master = document.createElement('label');
  master.className = 'fmt-opt fmt-master';
  master.tabIndex = -1;
  const masterCb = document.createElement('input');
  masterCb.type = 'checkbox';
  masterCb.value = '__master__';
  masterCb.checked = true;
  masterCb.addEventListener('change', cycleMasterArtists);
  master.appendChild(masterCb);
  master.appendChild(document.createTextNode('*'));
  head.appendChild(master);
  panel.appendChild(head);

  for (const a of sorted) {
    const label = document.createElement('label');
    label.className = 'fmt-opt';
    label.tabIndex = -1;
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
  openDropdown(elRefineArtistBtn, elRefineArtistPanel);
});

registerDropdown({
  btn: elRefineArtistBtn,
  panel: elRefineArtistPanel,
  saveState: () => {
    _savedArtists = new Set(S.selectedArtists);
    _openedArtists = new Set(S.selectedArtists);
    _openedArtistState = selectionState(S.selectedArtists.size, S._allArtistOptions.size);
  },
  restoreState: () => {
    if (_savedArtists !== null) {
      S.selectedArtists = _savedArtists;
      _savedArtists = null;
      _openedArtists = null;
      _openedArtistState = null;
      updateArtistBtn();
      syncArtistCheckboxes();
      _onArtistChange?.();
    }
  },
});

document.addEventListener('click', () => { elRefineArtistPanel.hidden = true; });

elRefineArtistPanel.addEventListener('click', (e) => e.stopPropagation());
