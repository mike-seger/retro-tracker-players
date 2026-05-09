// js/settings.js — Global app settings storage/helpers

const SETTINGS_KEY = 'app-settings-v1';

// Canonical format groups in display order.
export const ALL_FORMAT_GROUPS = Object.freeze(['AHX', 'IT', 'MINI', 'MOD', 'S3M', 'SID', 'SPC', 'VGZ', 'XM']);

export const DEFAULT_SETTINGS = Object.freeze({
  maxListItems: 500,
  autoplayAudio: false,
  disabledFormats: [],
  minQueryCharsThreshold: 40000,
});

let _cached = null;

function clampMaxListItems(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.maxListItems;
  return Math.max(5, Math.min(5000, Math.round(n)));
}

function clampThreshold(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.minQueryCharsThreshold;
  return Math.max(0, Math.min(1000000, Math.round(n)));
}

function normalize(raw) {
  const out = {
    maxListItems: DEFAULT_SETTINGS.maxListItems,
    autoplayAudio: DEFAULT_SETTINGS.autoplayAudio,
    disabledFormats: [],
    minQueryCharsThreshold: DEFAULT_SETTINGS.minQueryCharsThreshold,
  };

  if (raw && typeof raw === 'object') {
    if ('maxListItems' in raw) out.maxListItems = clampMaxListItems(raw.maxListItems);
    if (typeof raw.autoplayAudio === 'boolean') out.autoplayAudio = raw.autoplayAudio;
    if (Array.isArray(raw.disabledFormats)) {
      out.disabledFormats = raw.disabledFormats.filter(f => ALL_FORMAT_GROUPS.includes(f));
    }
    if ('minQueryCharsThreshold' in raw) out.minQueryCharsThreshold = clampThreshold(raw.minQueryCharsThreshold);
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

export function getMinQueryCharsThreshold() {
  return readSettings().minQueryCharsThreshold;
}

export function getDisabledFormats() {
  return new Set(readSettings().disabledFormats);
}

export function isFormatEnabled(formatGroup) {
  return !readSettings().disabledFormats.includes(formatGroup);
}

export function setAppSettings(partial) {
  const prev = readSettings();
  const merged = normalize({ ...prev, ...(partial || {}) });
  const prevDisabled = JSON.stringify([...(prev.disabledFormats || [])].sort());
  const nextDisabled = JSON.stringify([...(merged.disabledFormats || [])].sort());
  const changed = merged.maxListItems !== prev.maxListItems
    || merged.autoplayAudio !== prev.autoplayAudio
    || prevDisabled !== nextDisabled;
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
