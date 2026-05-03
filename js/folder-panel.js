// js/folder-panel.js — Folder multi-select dropdown panel
import { S, elRefineFolderBtn, elRefineFolderPanel } from './state.js';
import { openDropdown, registerDropdown } from './dropdown-keys.js';

let _savedFolders = null;
let _openedFolders = null;
let _openedFolderState = null;

function selectionState(selectedSize, totalSize) {
  if (totalSize > 0 && selectedSize === totalSize) return 'all';
  if (selectedSize === 0) return 'none';
  return 'some';
}

function cycleMasterFolders() {
  const totalSize = S._allFolderOptions.size;
  const current = selectionState(S.selectedFolders.size, totalSize);
  const opened = _openedFolderState || current;

  let next;
  if (opened === 'some') {
    next = current === 'some' ? 'none' : (current === 'none' ? 'all' : 'some');
  } else if (opened === 'all') {
    next = current === 'none' ? 'all' : 'none';
  } else {
    next = current === 'all' ? 'none' : 'all';
  }

  if (next === 'all') {
    S.selectedFolders = new Set(S._allFolderOptions);
  } else if (next === 'none') {
    S.selectedFolders = new Set();
  } else {
    const restored = [...(_openedFolders || [])].filter(f => S._allFolderOptions.has(f));
    S.selectedFolders = new Set(restored);
  }

  updateFolderBtn();
  syncFolderCheckboxes();
  _onFolderChange?.();
}

let _onFolderChange = null;
export function setFolderChangeHandler(fn) { _onFolderChange = fn; }

export function buildFolderPanel(folders) {
  const sorted = [...folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  S._allFolderOptions = new Set(sorted);
  const kept = new Set([...S.selectedFolders].filter(f => S._allFolderOptions.has(f)));
  S.selectedFolders = kept.size > 0 ? kept : new Set(S._allFolderOptions);

  const panel = elRefineFolderPanel;
  panel.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'panel-head';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'Folder';
  head.appendChild(title);

  const master = document.createElement('label');
  master.className = 'fmt-opt fmt-master';
  master.tabIndex = -1;
  const masterCb = document.createElement('input');
  masterCb.type = 'checkbox';
  masterCb.value = '__master__';
  masterCb.checked = true;
  masterCb.addEventListener('change', cycleMasterFolders);
  master.appendChild(masterCb);
  master.appendChild(document.createTextNode('*'));
  head.appendChild(master);
  panel.appendChild(head);

  for (const f of sorted) {
    const label = document.createElement('label');
    label.className = 'fmt-opt';
    label.tabIndex = -1;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = f;
    cb.checked = S.selectedFolders.has(f);
    cb.addEventListener('change', () => {
      if (cb.checked) S.selectedFolders.add(f);
      else S.selectedFolders.delete(f);
      updateFolderBtn();
      syncFolderCheckboxes();
      _onFolderChange?.();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(f));
    panel.appendChild(label);
  }

  updateFolderBtn();
  syncFolderCheckboxes();
}

export function syncFolderCheckboxes() {
  const allSelected = S._allFolderOptions.size > 0 &&
    S.selectedFolders.size === S._allFolderOptions.size;
  const partial = S.selectedFolders.size > 0 &&
    S.selectedFolders.size < S._allFolderOptions.size;
  for (const cb of elRefineFolderPanel.querySelectorAll('input[type="checkbox"]')) {
    if (cb.value === '__master__') {
      cb.checked = allSelected;
      cb.indeterminate = partial;
      cb.classList.toggle('indeterminate', partial);
      continue;
    }
    cb.indeterminate = false;
    cb.classList.remove('indeterminate');
    cb.checked = S.selectedFolders.has(cb.value);
  }
}

export function updateFolderBtn() {
  const active = S.selectedFolders.size > 0 && S.selectedFolders.size < S._allFolderOptions.size;
  elRefineFolderBtn.textContent = 'F';
  elRefineFolderBtn.classList.toggle('active', active);
  elRefineFolderBtn.hidden = S._allFolderOptions.size === 0;
}

export function clearFolderFilter() {
  S.selectedFolders = new Set(S._allFolderOptions);
  updateFolderBtn();
  syncFolderCheckboxes();
}

// ── event listeners ───────────────────────────────────
elRefineFolderBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openDropdown(elRefineFolderBtn, elRefineFolderPanel);
});

registerDropdown({
  btn: elRefineFolderBtn,
  panel: elRefineFolderPanel,
  saveState: () => {
    _savedFolders = new Set(S.selectedFolders);
    _openedFolders = new Set(S.selectedFolders);
    _openedFolderState = selectionState(S.selectedFolders.size, S._allFolderOptions.size);
  },
  restoreState: () => {
    if (_savedFolders !== null) {
      S.selectedFolders = _savedFolders;
      _savedFolders = null;
      _openedFolders = null;
      _openedFolderState = null;
      updateFolderBtn();
      syncFolderCheckboxes();
      _onFolderChange?.();
    }
  },
});

document.addEventListener('click', () => { elRefineFolderPanel.hidden = true; });

elRefineFolderPanel.addEventListener('click', (e) => e.stopPropagation());
