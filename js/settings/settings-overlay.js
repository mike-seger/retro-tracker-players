// js/settings-overlay.js — Global settings overlay UI
import { getAppSettings, setAppSettings, resetAppSettings, DEFAULT_SETTINGS, ALL_FORMAT_GROUPS } from './settings.js';
import * as remoteSearch from '../browse/remote-search.js';
import { fmtCount } from '../lib/utils.js';

let _overlay = null;
let _content = null;
let _header = null;
let _busy = null;
let _closeSeq = 0;

function clampInputMax(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.maxListItems;
  return Math.max(5, Math.min(5000, Math.round(n)));
}

function ensureEls() {
  _overlay = _overlay || document.getElementById('settings-overlay');
  _content = _content || document.getElementById('settings-content');
  _header = _header || document.getElementById('settings-header');
  if (_header && !_busy) {
    _busy = document.createElement('div');
    _busy.className = 'settings-busy';
    _busy.hidden = true;
    _busy.innerHTML = '<span class="settings-busy-spinner" aria-hidden="true"></span><span>Applying…</span>';
    _header.appendChild(_busy);
  }
  return !!_overlay && !!_content;
}

function setClosingBusy(on) {
  if (!ensureEls()) return;
  _overlay.classList.toggle('is-closing', !!on);
  if (_busy) _busy.hidden = !on;
  if (on) _overlay.setAttribute('aria-busy', 'true');
  else _overlay.removeAttribute('aria-busy');
}

function render() {
  if (!ensureEls()) return;
  const s = getAppSettings();

  _content.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'settings-card';

  const maxRow = document.createElement('div');
  maxRow.className = 'settings-row';
  const maxLabelWrap = document.createElement('div');
  const maxLabel = document.createElement('div');
  maxLabel.className = 'settings-label';
  maxLabel.textContent = 'Maximum List Items';
  const maxHint = document.createElement('div');
  maxHint.className = 'settings-hint';
  maxHint.textContent = 'Maximum items shown in playlist/result lists. Range: 5-5000. Default: 500.';
  maxLabelWrap.append(maxLabel, maxHint);
  const maxInput = document.createElement('input');
  maxInput.className = 'settings-input';
  maxInput.type = 'number';
  maxInput.min = '5';
  maxInput.max = '5000';
  maxInput.step = '1';
  maxInput.value = String(s.maxListItems);
  const commitMaxItems = () => {
    const next = clampInputMax(maxInput.value);
    maxInput.value = String(next);
    setAppSettings({ maxListItems: next });
  };
  // Commit only when the field loses focus to avoid expensive redraws while typing.
  maxInput.addEventListener('blur', commitMaxItems);
  maxInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      maxInput.blur();
    }
  });
  maxRow.append(maxLabelWrap, maxInput);

  const autoRow = document.createElement('div');
  autoRow.className = 'settings-row';
  const autoLabelWrap = document.createElement('div');
  const autoLabel = document.createElement('div');
  autoLabel.className = 'settings-label';
  autoLabel.textContent = 'Autoplay Audio';
  const autoHint = document.createElement('div');
  autoHint.className = 'settings-hint';
  autoHint.textContent = 'Attempts desktop auto-resume when the browser allows it. Default: off.';
  autoLabelWrap.append(autoLabel, autoHint);
  const autoCheckLabel = document.createElement('label');
  autoCheckLabel.className = 'settings-checkbox';
  const autoCheck = document.createElement('input');
  autoCheck.type = 'checkbox';
  autoCheck.checked = !!s.autoplayAudio;
  autoCheck.addEventListener('change', () => {
    setAppSettings({ autoplayAudio: autoCheck.checked });
  });
  const autoText = document.createElement('span');
  autoText.textContent = 'Enabled';
  autoCheckLabel.append(autoCheck, autoText);
  autoRow.append(autoLabelWrap, autoCheckLabel);

  card.append(maxRow, autoRow);
  _content.appendChild(card);

  // ── Format Groups card ──────────────────────────────
  const fmtCard = document.createElement('div');
  fmtCard.className = 'settings-card';
  const fmtRow = document.createElement('div');
  fmtRow.className = 'settings-row settings-row--col';
  const fmtLabelWrap = document.createElement('div');
  const fmtLabel = document.createElement('div');
  fmtLabel.className = 'settings-label';
  fmtLabel.textContent = 'Enabled Format Groups';
  const fmtHint = document.createElement('div');
  fmtHint.className = 'settings-hint';
  fmtHint.textContent = 'Unchecked formats are hidden everywhere in the app.';
  fmtLabelWrap.append(fmtLabel, fmtHint);

  const fmtGrid = document.createElement('div');
  fmtGrid.className = 'settings-format-list';

  const disabledSet = new Set(s.disabledFormats || []);
  const checkboxes = new Map();
  const fmtCounts = remoteSearch.isLoaded() ? remoteSearch.rawFormatCounts() : new Map();

  // Master "all" toggle — same style as fmt-opt fmt-master
  const allLabel = document.createElement('label');
  allLabel.className = 'fmt-opt fmt-master settings-fmt-master';
  const allCheck = document.createElement('input');
  allCheck.type = 'checkbox';
  allCheck.checked = disabledSet.size === 0;
  allCheck.indeterminate = disabledSet.size > 0 && disabledSet.size < ALL_FORMAT_GROUPS.length;
  const allText = document.createElement('span');
  allText.textContent = '*';
  allLabel.append(allCheck, allText);
  fmtGrid.appendChild(allLabel);

  const syncAllCheck = () => {
    const disabled = [...checkboxes.entries()].filter(([, cb]) => !cb.checked).length;
    allCheck.checked = disabled === 0;
    allCheck.indeterminate = disabled > 0 && disabled < ALL_FORMAT_GROUPS.length;
  };

  const commitFormats = () => {
    const disabled = ALL_FORMAT_GROUPS.filter(g => !checkboxes.get(g).checked);
    setAppSettings({ disabledFormats: disabled });
  };

  for (const grp of ALL_FORMAT_GROUPS) {
    const lbl = document.createElement('label');
    lbl.className = 'fmt-opt';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !disabledSet.has(grp);
    cb.addEventListener('change', () => {
      syncAllCheck();
      commitFormats();
    });
    checkboxes.set(grp, cb);
    const txt = document.createElement('span');
    const cnt = fmtCounts.get(grp);
    txt.textContent = cnt != null ? `${grp} (${fmtCount(cnt)})` : grp;
    lbl.append(cb, txt);
    fmtGrid.appendChild(lbl);
  }

  allCheck.addEventListener('change', () => {
    const enable = allCheck.checked;
    for (const cb of checkboxes.values()) cb.checked = enable;
    allCheck.indeterminate = false;
    commitFormats();
  });

  fmtRow.append(fmtLabelWrap, fmtGrid);
  fmtCard.appendChild(fmtRow);
  _content.appendChild(fmtCard);

  const note = document.createElement('div');
  note.className = 'settings-note';
  note.innerHTML =
    '<strong>Autoplay help</strong><br>' +
    'Browsers may still block Web Audio until a user gesture. If autoplay does not work, use Resume once or allow sound/autoplay for this site in your browser settings.';
  _content.appendChild(note);

  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'settings-btn';
  resetBtn.textContent = 'Reset defaults';
  resetBtn.addEventListener('click', () => {
    resetAppSettings();
    render();
  });
  actions.appendChild(resetBtn);
  _content.appendChild(actions);
}

function onKey(e) {
  if (e.key !== 'Escape') return;
  if (_overlay?.hidden) return;
  e.preventDefault();
  closeSettingsOverlay();
}

export function openSettingsOverlay() {
  if (!ensureEls()) return;
  _closeSeq++;
  _overlay.classList.remove('is-hiding');
  setClosingBusy(false);
  render();
  _overlay.hidden = false;
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => _overlay?.focus());
}

export function closeSettingsOverlay() {
  if (!ensureEls()) return;
  if (_overlay.hidden) return;
  const seq = ++_closeSeq;
  setClosingBusy(true);
  document.removeEventListener('keydown', onKey);

  const finish = () => {
    if (seq !== _closeSeq || _overlay.hidden) return;
    _overlay.classList.add('is-hiding');
    setTimeout(() => {
      if (seq !== _closeSeq) return;
      _overlay.hidden = true;
      _overlay.classList.remove('is-hiding');
      setClosingBusy(false);
    }, 170);
  };

  const onDone = (ev) => {
    if (ev.detail?.seq !== seq) return;
    window.removeEventListener('settings-overlay-close-done', onDone);
    if (fallbackTimer) clearTimeout(fallbackTimer);
    finish();
  };

  // Safety net in case a close-done event is missed.
  const fallbackTimer = setTimeout(() => {
    window.removeEventListener('settings-overlay-close-done', onDone);
    finish();
  }, 1500);

  // Let busy UI paint first, then trigger deferred apply work.
  requestAnimationFrame(() => {
    window.addEventListener('settings-overlay-close-done', onDone);
    window.dispatchEvent(new CustomEvent('settings-overlay-closing', { detail: { seq } }));
  });
}
