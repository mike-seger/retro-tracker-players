// js/remote-search.js — Search remote-index.json by substring
// The index format: { base, formats, entries: [[fmtIdx, "Artist/file.ext"], ...] }

import { normalizeFormatExt } from '../lib/utils.js';

let _index = null;
let _loading = null;

const EXT_TO_PLAYER = {
  ahx: 'ahx',
  sid: 'jssid',
  mod: 'mod', xm: 'mod', s3m: 'mod', it: 'mod',
  mini2sf: 'mini', minigsf: 'mini', minipsf: 'mini', miniusf: 'mini', minipsf2: 'mini', minissf: 'mini',
  spc: 'spc', vgm: 'vgm', vgz: 'vgm',
};

// ── raw arrays: full dataset from disk ────────────────
let _rawEntries = [];       // index.entries (reference)
let _rawSearchLower = [];   // lowercased path strings
let _rawExtInfo = [];       // { normExt, playerId } per raw entry

// ── working set: raw minus disabled formats ───────────
// All search/count/browse functions operate on these.
let _entries = [];          // filtered subset of _rawEntries
let _searchLower = [];      // filtered subset of _rawSearchLower
let _extInfo = [];          // filtered subset of _rawExtInfo

export async function loadIndex() {
  if (_index) return _index;
  if (_loading) return _loading;
  _loading = (async () => {
    const resp = await fetch('remote-index.json.gz');
    const ds = new DecompressionStream('gzip');
    const decompressed = resp.body.pipeThrough(ds);
    _index = await new Response(decompressed).json();
    _rawEntries = _index.entries;
    // Pre-build lowercased path strings and ext info for fast search
    _rawSearchLower = new Array(_rawEntries.length);
    _rawExtInfo = new Array(_rawEntries.length);
    for (let i = 0; i < _rawEntries.length; i++) {
      const rest = _rawEntries[i][1];
      _rawSearchLower[i] = rest.toLowerCase();
      const rawExt = rest.substring(rest.lastIndexOf('.') + 1).toLowerCase();
      _rawExtInfo[i] = { normExt: normalizeFormatExt(rawExt), playerId: EXT_TO_PLAYER[rawExt] || null };
    }
    // Start with full set (no disabled formats yet)
    _entries = _rawEntries;
    _searchLower = _rawSearchLower;
    _extInfo = _rawExtInfo;
    return _index;
  })();
  return _loading;
}

export function isLoaded() {
  return !!_index;
}

/**
 * Rebuild the working set by excluding entries whose format group is in disabledSet.
 * Pass an empty/null set to restore the full index.
 * Idempotent: calling with the same set twice is a no-op (cheap key check).
 * Safe to call at the top of every doModlandSearch / doRandomBrowse.
 */
let _lastDisabledKey = null;
export function applyDisabledFormats(disabledSet) {
  if (!_rawEntries.length) return; // index not loaded yet
  const key = (disabledSet && disabledSet.size > 0)
    ? [...disabledSet].sort().join(',')
    : '';
  if (key === _lastDisabledKey) return; // nothing changed
  _lastDisabledKey = key;

  if (!key) {
    _entries = _rawEntries;
    _searchLower = _rawSearchLower;
    _extInfo = _rawExtInfo;
    _shuffleOrder = null;
    return;
  }
  const newEntries = [];
  const newLower = [];
  const newExtInfo = [];
  for (let i = 0; i < _rawEntries.length; i++) {
    const info = _rawExtInfo[i];
    if (!info.playerId) continue;
    if (disabledSet.has(info.normExt)) continue;
    newEntries.push(_rawEntries[i]);
    newLower.push(_rawSearchLower[i]);
    newExtInfo.push(info);
  }
  _entries = newEntries;
  _searchLower = newLower;
  _extInfo = newExtInfo;
  _shuffleOrder = null;
}

function normalizeFormatSet(formatSet) {
  // S.selectedFormats stores uppercase values from normalizeFormatExt (e.g. 'MOD', 'XM').
  // Return a Set of uppercase strings for direct comparison against _extInfo.normExt.
  if (!formatSet || formatSet.size === 0) return null;
  const out = new Set();
  for (const f of formatSet) out.add(String(f).toUpperCase());
  return out.size > 0 ? out : null;
}

function matchesTerms(s, terms) {
  for (let t = 0; t < terms.length; t++) {
    if (s.indexOf(terms[t]) < 0) return false;
  }
  return true;
}

// Search entries by substring (case-insensitive). Returns up to `limit` results.
// Multiple space-delimited terms are matched with AND (all must appear, any order).
// Each result: { name, ext, playerId, url }
export function search(query, limit = 100, skip = 0) {
  if (!_index) return [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return searchByFilters(terms, null, limit, skip);
}

export function searchWithFormats(query, formatSet, limit = 100, skip = 0) {
  if (!_index) return [];
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return searchByFilters(terms, normalizeFormatSet(formatSet), limit, skip);
}

function searchByFilters(terms, formatSet, limit, skip) {
  const all = [];
  const formats = _index.formats;
  const base = _index.base;

  for (let i = 0; i < _entries.length; i++) {
    if (!matchesTerms(_searchLower[i], terms)) continue;
    const { normExt, playerId } = _extInfo[i];
    if (!playerId) continue;
    if (formatSet && !formatSet.has(normExt)) continue;
    const [fmtIdx, rest] = _entries[i];
    const fullPath = formats[fmtIdx] + '/' + rest;
    all.push({
      name: rest,
      ext: normExt,
      playerId,
      url: base + fullPath.split('/').map(encodeURIComponent).join('/'),
    });
  }

  // Sort by artist/folder then title
  all.sort((a, b) => {
    const sa = a.name.lastIndexOf('/');
    const sb = b.name.lastIndexOf('/');
    const fa = sa >= 0 ? a.name.substring(0, sa) : '';
    const fb = sb >= 0 ? b.name.substring(0, sb) : '';
    const cmp = fa.localeCompare(fb, undefined, { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    const ta = sa >= 0 ? a.name.substring(sa + 1) : a.name;
    const tb = sb >= 0 ? b.name.substring(sb + 1) : b.name;
    return ta.localeCompare(tb, undefined, { sensitivity: 'base' });
  });

  return all.slice(skip, skip + limit);
}

export function count(query) {
  if (!_index) return 0;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  return countByFilters(terms, null);
}

export function countWithFormats(query, formatSet) {
  if (!_index) return 0;
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return countByFilters(terms, normalizeFormatSet(formatSet));
}

function countByFilters(terms, formatSet) {
  let n = 0;
  for (let i = 0; i < _searchLower.length; i++) {
    if (!matchesTerms(_searchLower[i], terms)) continue;
    const { normExt, playerId } = _extInfo[i];
    if (!playerId) continue;
    if (formatSet && !formatSet.has(normExt)) continue;
    n++;
  }
  return n;
}

export function availableFormats() {
  if (!_index) return new Set();
  const out = new Set();
  for (let i = 0; i < _extInfo.length; i++) {
    if (_extInfo[i].playerId) out.add(_extInfo[i].normExt);
  }
  return out;
}

export function entryCount() {
  return _index ? _index.entries.length : 0;
}

// Return a Map<normExt, count> from the full raw index (ignores disabled filter)
export function rawFormatCounts() {
  const map = new Map();
  for (let i = 0; i < _rawExtInfo.length; i++) {
    const { normExt, playerId } = _rawExtInfo[i];
    if (!playerId) continue;
    map.set(normExt, (map.get(normExt) || 0) + 1);
  }
  return map;
}

// Return total count of all playable entries in the active working set (no query filter)
export function totalPlayable() {
  return _entries.length;
}

// Return a slice of all playable entries (no query filter), shuffled per session
export function browseAll(limit = 1000, skip = 0) {
  if (!_index) return [];
  const formats = _index.formats;
  const base = _index.base;
  const n = _entries.length;

  // Shuffle deterministically using Fisher-Yates with a seed so pages are stable per session
  if (!_shuffleOrder || _shuffleOrder.length !== n) {
    _shuffleOrder = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = (_shuffleSeed = (_shuffleSeed * 16807 + 0) % 2147483647) % (i + 1);
      const tmp = _shuffleOrder[i]; _shuffleOrder[i] = _shuffleOrder[j]; _shuffleOrder[j] = tmp;
    }
  }

  const result = [];
  const end = Math.min(skip + limit, n);
  for (let i = skip; i < end; i++) {
    const ri = _shuffleOrder[i];
    const [fmtIdx, rest] = _entries[ri];
    const { normExt, playerId } = _extInfo[ri];
    result.push({
      name: rest,
      ext: normExt,
      playerId,
      url: base + (formats[fmtIdx] + '/' + rest).split('/').map(encodeURIComponent).join('/'),
    });
  }
  return result;
}

let _shuffleOrder = null;
let _shuffleSeed = Math.floor(Math.random() * 2147483646) + 1;

// Reset shuffle order (e.g. when user wants a new random set)
export function reshuffle() {
  _shuffleOrder = null;
  _shuffleSeed = Math.floor(Math.random() * 2147483646) + 1;
}
