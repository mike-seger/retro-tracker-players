// js/refine-panel.js — Shared DOM utilities for multi-select refine panels
import { registerDropdown } from '../ui/dropdown-keys.js';

// Returns 'all' | 'some' | 'none' based on selection counts.
export function selectionState(selectedSize, totalSize) {
  if (totalSize > 0 && selectedSize === totalSize) return 'all';
  if (selectedSize === 0) return 'none';
  return 'some';
}

// Builds the sticky header with a title and master checkbox inside it.
// The checkbox sits at the same left position as checkboxes in fmt-opt rows.
// Returns the master <input> element.
export function buildPanelHead(panel, titleText, onCycleMaster) {
  const head = document.createElement('label');
  head.className = 'panel-head';
  head.tabIndex = -1;

  const masterCb = document.createElement('input');
  masterCb.type = 'checkbox';
  masterCb.value = '__master__';
  masterCb.checked = true;
  masterCb.dataset.kind = 'master';
  masterCb.addEventListener('change', onCycleMaster);

  const titleEl = document.createElement('span');
  titleEl.className = 'panel-title';
  titleEl.textContent = titleText;

  head.append(masterCb, titleEl);
  panel.appendChild(head);

  return masterCb;
}

// Appends one checkbox option row to panel.
// onChange(checked) is called when the checkbox changes.
// Returns the <input> element.
export function appendPanelOption(panel, value, labelText, checked, onChange, extraClass = '') {
  const label = document.createElement('label');
  label.className = 'fmt-opt' + (extraClass ? ' ' + extraClass : '');
  label.tabIndex = -1;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = value;
  cb.checked = checked;
  cb.addEventListener('change', () => onChange(cb.checked));

  label.appendChild(cb);
  label.appendChild(document.createTextNode(labelText));
  panel.appendChild(label);

  return cb;
}

// Syncs master and all item checkboxes to current selection state.
// predicate(value, dataKind) → bool: whether that item is currently selected.
export function syncPanelCheckboxes(masterCb, panel, predicate, selectedSize, totalSize) {
  const allSelected = totalSize > 0 && selectedSize === totalSize;
  const partial = selectedSize > 0 && selectedSize < totalSize;

  masterCb.checked = allSelected;
  masterCb.indeterminate = partial;
  masterCb.classList.toggle('indeterminate', partial);

  for (const cb of panel.querySelectorAll('input[type="checkbox"]')) {
    if (cb.value === '__master__') continue;
    cb.indeterminate = false;
    cb.classList.remove('indeterminate');
    cb.checked = predicate(cb.value, cb.dataset.kind);
  }
}

// Registers the shared dropdown keyboard behaviour, outside-click close,
// and panel click stop-propagation. The btn click-to-open listener is NOT
// included here; callers add that themselves via openDropdown.
export function wireDropdown(btn, panel, saveState, restoreState) {
  registerDropdown({ btn, panel, saveState, restoreState });
  document.addEventListener('click', () => { panel.hidden = true; });
  panel.addEventListener('click', e => e.stopPropagation());
}
