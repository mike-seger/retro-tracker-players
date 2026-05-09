// js/format-panel.js — Format multi-select dropdown widget
import { S, elRefineFormatBtn, elRefineFormatPanel } from '../core/state.js';
import { openDropdown } from '../ui/dropdown-keys.js';
import { selectionState, buildPanelHead, appendPanelOption, syncPanelCheckboxes, wireDropdown } from './refine-panel.js';

let _savedFormats = null;
let _openedFormats = null;
let _openedFormatState = null;
let _masterCb = null;
let _pendingChange = false;

// ── floating "Applying…" pill (body-level, shown on close) ──
let _applyingPill = null;
let _pillTimer = null;

function ensureApplyingPill() {
  if (!_applyingPill) {
    _applyingPill = document.createElement('div');
    _applyingPill.className = 'fmt-applying-pill';
    _applyingPill.hidden = true;
    _applyingPill.innerHTML = '<span class="fmt-pending-spinner" aria-hidden="true"></span>Applying\u2026';
    document.body.appendChild(_applyingPill);
  }
  return _applyingPill;
}

function showApplyingPill() {
  const pill = ensureApplyingPill();
  const rect = elRefineFormatBtn.getBoundingClientRect();
  pill.style.top = (rect.bottom + 6) + 'px';
  pill.style.left = rect.left + 'px';
  pill.hidden = false;
  clearTimeout(_pillTimer);
  _pillTimer = setTimeout(() => { pill.hidden = true; }, 900);
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
  _pendingChange = true; // silent: pill only appears on close
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
  _masterCb = buildPanelHead(panel, 'Format', cycleMasterFormats);

  for (const fmt of sorted) {
    appendPanelOption(panel, fmt, fmt, S.selectedFormats.has(fmt), (checked) => {
      if (checked) S.selectedFormats.add(fmt);
      else S.selectedFormats.delete(fmt);
      updateFormatBtn();
      syncFormatCheckboxes();
      _pendingChange = true; // silent: pill only appears on close
    });
  }

  updateFormatBtn();
  syncFormatCheckboxes();
}

export function syncFormatCheckboxes() {
  if (!_masterCb) return;
  syncPanelCheckboxes(
    _masterCb, elRefineFormatPanel,
    (value) => S.selectedFormats.has(value),
    S.selectedFormats.size, S._allFormatOptions.size,
  );
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

let _escRestoring = false;

wireDropdown(elRefineFormatBtn, elRefineFormatPanel,
  () => {
    _savedFormats = new Set(S.selectedFormats);
    _openedFormats = new Set(S.selectedFormats);
    _openedFormatState = selectionState(S.selectedFormats.size, S._allFormatOptions.size);
    _pendingChange = false;
  },
  () => {
    // Esc: restore snapshot silently (no search trigger)
    if (_savedFormats !== null) {
      _escRestoring = true;
      S.selectedFormats = _savedFormats;
      _savedFormats = null;
      _openedFormats = null;
      _openedFormatState = null;
      _pendingChange = false;
      updateFormatBtn();
      syncFormatCheckboxes();
      _escRestoring = false;
    }
  },
);

// Fire the search when the panel closes via outside-click or Enter (not Esc)
new MutationObserver(() => {
  if (elRefineFormatPanel.hidden && !_escRestoring && _pendingChange) {
    _pendingChange = false;
    _savedFormats = null;
    _openedFormats = null;
    _openedFormatState = null;
    showApplyingPill();
    _onFormatChange?.();
  }
}).observe(elRefineFormatPanel, { attributeFilter: ['hidden'] });
