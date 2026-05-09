// js/settings/search-history.js — Modland search history storage

const HISTORY_KEY = 'search-history-v1';
const MAX_KEY     = 'search-history-max';
const DEFAULT_MAX = 100;

export function getMaxHistory() {
  const n = parseInt(localStorage.getItem(MAX_KEY), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10000) : DEFAULT_MAX;
}

export function setMaxHistory(n) {
  const clamped = Math.max(1, Math.min(10000, Math.round(Number(n) || DEFAULT_MAX)));
  localStorage.setItem(MAX_KEY, String(clamped));
  // Trim existing history to new max.
  const h = getHistory();
  if (h.length > clamped) {
    saveHistory(h.slice(0, clamped));
  }
}

function readHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY));
    if (Array.isArray(raw)) return raw;
  } catch (_) {}
  return [];
}

function saveHistory(entries) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch (_) {}
}

// Returns entries newest-first: [{term, ts, count}]
export function getHistory() {
  return readHistory();
}

// Record a completed search. Removes older duplicates of the same term (case-insensitive),
// prepends the new entry, and trims to max.
export function addEntry(term, count) {
  const t = (term || '').trim().toLowerCase();
  if (!t) return;
  const max = getMaxHistory();
  let entries = readHistory();
  // Remove any older duplicates (same term, case-insensitive).
  const lc = t.toLowerCase();
  entries = entries.filter(e => (e.term || '').toLowerCase() !== lc);
  entries.unshift({ term: t, ts: Date.now(), count: count || 0 });
  if (entries.length > max) entries = entries.slice(0, max);
  saveHistory(entries);
}

// Delete one entry by its timestamp.
export function deleteEntry(ts) {
  const entries = readHistory().filter(e => e.ts !== ts);
  saveHistory(entries);
}

// Clear all entries.
export function clearHistory() {
  saveHistory([]);
}

// ── Deep link history ─────────────────────────────────

const DEEPLINK_HISTORY_KEY = 'deeplink-history-v1';
const DEEPLINK_MAX_KEY     = 'deeplink-history-max';
const DEFAULT_DEEPLINK_MAX = 50;

export function getMaxDeepLinkHistory() {
  const n = parseInt(localStorage.getItem(DEEPLINK_MAX_KEY), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10000) : DEFAULT_DEEPLINK_MAX;
}

export function setMaxDeepLinkHistory(n) {
  const clamped = Math.max(1, Math.min(10000, Math.round(Number(n) || DEFAULT_DEEPLINK_MAX)));
  localStorage.setItem(DEEPLINK_MAX_KEY, String(clamped));
  const h = getDeepLinkHistory();
  if (h.length > clamped) saveDeepLinkHistory(h.slice(0, clamped));
}

function readDeepLinkHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(DEEPLINK_HISTORY_KEY));
    if (Array.isArray(raw)) return raw;
  } catch (_) {}
  return [];
}

function saveDeepLinkHistory(entries) {
  try { localStorage.setItem(DEEPLINK_HISTORY_KEY, JSON.stringify(entries)); } catch (_) {}
}

function deeplinkLabel(url) {
  try {
    const params = new URL(url).searchParams;
    const play = params.get('play');
    if (play) {
      const segs = new URL(play).pathname.split('/').filter(Boolean);
      if (segs.length >= 2)
        return decodeURIComponent(segs[segs.length - 2]) + '/' + decodeURIComponent(segs[segs.length - 1]);
      if (segs.length === 1) return decodeURIComponent(segs[0]);
    }
  } catch (_) {}
  return url;
}

// Returns entries newest-first: [{ts, url, label}]
export function getDeepLinkHistory() {
  return readDeepLinkHistory();
}

// Record a shared deep link. Deduplicates by URL (removes older identical URL).
export function addDeepLinkEntry(url) {
  if (!url) return;
  const max = getMaxDeepLinkHistory();
  let entries = readDeepLinkHistory();
  entries = entries.filter(e => e.url !== url);
  entries.unshift({ url, label: deeplinkLabel(url), ts: Date.now() });
  if (entries.length > max) entries = entries.slice(0, max);
  saveDeepLinkHistory(entries);
}

export function deleteDeepLinkEntry(ts) {
  saveDeepLinkHistory(readDeepLinkHistory().filter(e => e.ts !== ts));
}

export function clearDeepLinkHistory() {
  saveDeepLinkHistory([]);
}
