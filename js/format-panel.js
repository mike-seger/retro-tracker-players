// js/format-panel.js — Format multi-select dropdown widget
import { S, elRefineFormatBtn, elRefineFormatPanel } from './state.js';
import { openDropdown, registerDropdown } from './dropdown-keys.js';

let _savedFormats = null;
let _openedFormats = null;
let _openedFormatState = null;

function selectionState(selectedSize, totalSize) {
  if (totalSize > 0 && selectedSize === totalSize) return 'all';
  if (selectedSize === 0) return 'none';
  return 'some';
}

function cycleMasterFormats() {
  const totalSize = S._allFormatOptions.size;
  const current = selectionState(S.selectedFormats.size, totalSize);
  const opened = _openedFormatState || current;

  let next;
  if (opened === 'some') {
    next = current === 'some' ? 'none' : (current === 'none' ? 'all' : 'some');
  } else if (opened === 'all') {
    next = current === 'none' ? 'all' : 'none';
  } else {
    next = current === 'all' ? 'none' : 'all';
  }

  if (next === 'all') {
    S.selectedFormats = new Set(S._allFormatOptions);
  } else if (next === 'none') {
    S.selectedFormats = new Set();
  } else {
    const restored = [...(_openedFormats || [])].filter(f => S._allFormatOptions.has(f));
    S.selectedFormats = new Set(restored);
  }

  updateFormatBtn();
  syncFormatCheckboxes();
  _onFormatChange?.();
}

// Set by app.js after all modules are loaded, to avoid circular import at eval time.
let _onFormatChange = null;
export function setFormatChangeHandler(fn) { _onFormatChange = fn; }

export function buildFormatPanel(formats) {
  const sorted = [...formats].sort();
  S._allFormatOptions = new Set(sorted);
  // Retain only formats still present after a rebuild
  const kept = new Set([...S.selectedFormats].filter(f => S._allFormatOptions.has(f)));
  S.selectedFormats = kept;

  const panel = elRefineFormatPanel;
  panel.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'panel-head';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'Format';
  head.appendChild(title);

  const master = document.createElement('label');
  master.className = 'fmt-opt fmt-master';
  master.tabIndex = -1;
  const masterCb = document.createElement('input');
  masterCb.type = 'checkbox';
  masterCb.value = '__master__';
  masterCb.checked = true;
  masterCb.addEventListener('change', cycleMasterFormats);
  master.appendChild(masterCb);
  master.appendChild(document.createTextNode('*'));
  head.appendChild(master);
  panel.appendChild(head);

  for (const fmt of sorted) {
    const label = document.createElement('label');
    label.className = 'fmt-opt';
    label.tabIndex = -1;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = fmt;
    cb.checked = S.selectedFormats.has(fmt);
    cb.addEventListener('change', () => {
      if (cb.checked) S.selectedFormats.add(fmt);
      else S.selectedFormats.delete(fmt);
      updateFormatBtn();
      syncFormatCheckboxes();
      _onFormatChange?.();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(fmt));
    panel.appendChild(label);
  }

  updateFormatBtn();
  syncFormatCheckboxes();
}

export function syncFormatCheckboxes() {
  const allSelected = S._allFormatOptions.size > 0 &&
    S.selectedFormats.size === S._allFormatOptions.size;
  const partial = S.selectedFormats.size > 0 &&
    S.selectedFormats.size < S._allFormatOptions.size;
  for (const cb of elRefineFormatPanel.querySelectorAll('input[type="checkbox"]')) {
    if (cb.value === '__master__') {
      cb.checked = allSelected;
      cb.indeterminate = partial;
      cb.classList.toggle('indeterminate', partial);
      continue;
    }
    cb.indeterminate = false;
    cb.classList.remove('indeterminate');
    cb.checked = S.selectedFormats.has(cb.value);
  }
}

export function updateFormatBtn() {
  const active = S.selectedFormats.size > 0 && S.selectedFormats.size < S._allFormatOptions.size;
  elRefineFormatBtn.textContent = 'T';
  elRefineFormatBtn.classList.toggle('active', active);
  elRefineFormatBtn.hidden = S._allFormatOptions.size === 0;
}

export function clearFormatFilter() {
  S.selectedFormats = new Set(S._allFormatOptions);
  updateFormatBtn();
  syncFormatCheckboxes();
}

// ── event listeners ───────────────────────────────────
elRefineFormatBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openDropdown(elRefineFormatBtn, elRefineFormatPanel);
});

registerDropdown({
  btn: elRefineFormatBtn,
  panel: elRefineFormatPanel,
  saveState: () => {
    _savedFormats = new Set(S.selectedFormats);
    _openedFormats = new Set(S.selectedFormats);
    _openedFormatState = selectionState(S.selectedFormats.size, S._allFormatOptions.size);
  },
  restoreState: () => {
    if (_savedFormats !== null) {
      S.selectedFormats = _savedFormats;
      _savedFormats = null;
      _openedFormats = null;
      _openedFormatState = null;
      updateFormatBtn();
      syncFormatCheckboxes();
      _onFormatChange?.();
    }
  },
});

document.addEventListener('click', () => {
  elRefineFormatPanel.hidden = true;
});

elRefineFormatPanel.addEventListener('click', (e) => {
  e.stopPropagation();
});
