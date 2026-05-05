// js/settings-overlay.js — Global settings overlay UI
import { getAppSettings, setAppSettings, resetAppSettings, DEFAULT_SETTINGS } from './settings.js';

let _overlay = null;
let _content = null;

function clampInputMax(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.maxListItems;
  return Math.max(1, Math.min(5000, Math.round(n)));
}

function ensureEls() {
  _overlay = _overlay || document.getElementById('settings-overlay');
  _content = _content || document.getElementById('settings-content');
  return !!_overlay && !!_content;
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
  maxHint.textContent = 'Maximum items shown in playlist/result lists. Default: 200.';
  maxLabelWrap.append(maxLabel, maxHint);
  const maxInput = document.createElement('input');
  maxInput.className = 'settings-input';
  maxInput.type = 'number';
  maxInput.min = '1';
  maxInput.max = '5000';
  maxInput.step = '1';
  maxInput.value = String(s.maxListItems);
  maxInput.addEventListener('change', () => {
    const next = clampInputMax(maxInput.value);
    maxInput.value = String(next);
    setAppSettings({ maxListItems: next });
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
  render();
  _overlay.hidden = false;
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => _overlay?.focus());
}

export function closeSettingsOverlay() {
  if (!ensureEls()) return;
  _overlay.hidden = true;
  document.removeEventListener('keydown', onKey);
}
