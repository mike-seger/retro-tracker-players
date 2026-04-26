// js/format-panel.js — Format multi-select dropdown widget
import { S, elRefineFormatBtn, elRefineFormatPanel } from './state.js';

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

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'Format';
  panel.appendChild(title);

  const master = document.createElement('label');
  master.className = 'fmt-opt fmt-master';
  const masterCb = document.createElement('input');
  masterCb.type = 'checkbox';
  masterCb.value = '__master__';
  masterCb.checked = true;
  masterCb.addEventListener('change', () => {
    if (masterCb.checked) S.selectedFormats = new Set(S._allFormatOptions);
    else S.selectedFormats = new Set();
    updateFormatBtn();
    syncFormatCheckboxes();
    _onFormatChange?.();
  });
  master.appendChild(masterCb);
  master.appendChild(document.createTextNode(''));
  panel.appendChild(master);

  for (const fmt of sorted) {
    const label = document.createElement('label');
    label.className = 'fmt-opt';
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
}

export function clearFormatFilter() {
  S.selectedFormats = new Set(S._allFormatOptions);
  updateFormatBtn();
  syncFormatCheckboxes();
}

// ── event listeners ───────────────────────────────────
elRefineFormatBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  elRefineFormatPanel.hidden = !elRefineFormatPanel.hidden;
});

document.addEventListener('click', () => {
  elRefineFormatPanel.hidden = true;
});

elRefineFormatPanel.addEventListener('click', (e) => {
  e.stopPropagation();
});
