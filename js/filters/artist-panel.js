// js/artist-panel.js — Artist multi-select dropdown panel
import { S, elRefineArtistBtn, elRefineArtistPanel } from '../core/state.js';
import { openDropdown } from '../ui/dropdown-keys.js';
import { selectionState, buildPanelHead, appendPanelOption, syncPanelCheckboxes, wireDropdown } from './refine-panel.js';

let _savedArtists = null;
let _openedArtists = null;
let _openedArtistState = null;
let _masterCb = null;

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
  _masterCb = buildPanelHead(panel, 'Artist', cycleMasterArtists);

  for (const a of sorted) {
    appendPanelOption(panel, a, a, S.selectedArtists.has(a), (checked) => {
      if (checked) S.selectedArtists.add(a);
      else S.selectedArtists.delete(a);
      updateArtistBtn();
      syncArtistCheckboxes();
      _onArtistChange?.();
    });
  }

  updateArtistBtn();
  syncArtistCheckboxes();
}

export function syncArtistCheckboxes() {
  if (!_masterCb) return;
  syncPanelCheckboxes(
    _masterCb, elRefineArtistPanel,
    (value) => S.selectedArtists.has(value),
    S.selectedArtists.size, S._allArtistOptions.size,
  );
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

wireDropdown(elRefineArtistBtn, elRefineArtistPanel,
  () => {
    _savedArtists = new Set(S.selectedArtists);
    _openedArtists = new Set(S.selectedArtists);
    _openedArtistState = selectionState(S.selectedArtists.size, S._allArtistOptions.size);
  },
  () => {
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
);
