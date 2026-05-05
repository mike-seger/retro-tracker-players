// js/settings.js — Global app settings storage/helpers

const SETTINGS_KEY = 'app-settings-v1';

export const DEFAULT_SETTINGS = Object.freeze({
  maxListItems: 200,
  autoplayAudio: false,
});

let _cached = null;

function clampMaxListItems(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.maxListItems;
  return Math.max(5, Math.min(5000, Math.round(n)));
}

function normalize(raw) {
  const out = {
    maxListItems: DEFAULT_SETTINGS.maxListItems,
    autoplayAudio: DEFAULT_SETTINGS.autoplayAudio,
  };

  if (raw && typeof raw === 'object') {
    if ('maxListItems' in raw) out.maxListItems = clampMaxListItems(raw.maxListItems);
    if (typeof raw.autoplayAudio === 'boolean') out.autoplayAudio = raw.autoplayAudio;
  }

  // Back-compat migration from legacy key used by older resume prompt code.
  if ((!raw || typeof raw.autoplayAudio !== 'boolean') && localStorage.getItem('auto-resume') === '1') {
    out.autoplayAudio = true;
  }

  return out;
}

function readSettings() {
  if (_cached) return _cached;
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    _cached = normalize(parsed);
  } catch (_) {
    _cached = normalize(null);
  }
  return _cached;
}

function writeSettings(next) {
  _cached = normalize(next);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(_cached));
}

function emitChanged() {
  window.dispatchEvent(new CustomEvent('app-settings-changed', {
    detail: getAppSettings(),
  }));
}

export function getAppSettings() {
  const s = readSettings();
  return { ...s };
}

export function getMaxListItems() {
  return readSettings().maxListItems;
}

export function isAutoplayAudioEnabled() {
  return !!readSettings().autoplayAudio;
}

export function setAppSettings(partial) {
  const prev = readSettings();
  const merged = normalize({ ...prev, ...(partial || {}) });
  const changed = merged.maxListItems !== prev.maxListItems || merged.autoplayAudio !== prev.autoplayAudio;
  if (!changed) return getAppSettings();
  writeSettings(merged);
  emitChanged();
  return getAppSettings();
}

export function resetAppSettings() {
  writeSettings(DEFAULT_SETTINGS);
  emitChanged();
  return getAppSettings();
}
