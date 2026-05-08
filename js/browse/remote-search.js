// js/remote-search.js — Search remote-index.json by substring
// The index format: { base, formats, entries: [[fmtIdx, "Artist/file.ext"], ...] }

import { normalizeFormatExt } from '../lib/utils.js';

let _index = null;
let _loading = null;
let _searchLower = [];  // pre-lowercased entries for fast search

const EXT_TO_PLAYER = {
  ahx: 'ahx',
  sid: 'jssid',
  mod: 'mod', xm: 'mod', s3m: 'mod', it: 'mod',
  mini2sf: 'mini', minigsf: 'mini', minipsf: 'mini', miniusf: 'mini', minipsf2: 'mini', minissf: 'mini',
  spc: 'spc', vgm: 'vgm', vgz: 'vgm',
};

export async function loadIndex() {
  if (_index) return _index;
  if (_loading) return _loading;
  _loading = (async () => {
    const resp = await fetch('remote-index.json.gz');
    const ds = new DecompressionStream('gzip');
    const decompressed = resp.body.pipeThrough(ds);
    _index = await new Response(decompressed).json();
    // Pre-build lowercased path strings for fast substring matching
    _searchLower = _index.entries.map(e => e[1].toLowerCase());
    return _index;
  })();
  return _loading;
}

export function isLoaded() {
  return !!_index;
}

function normalizeFormatSet(formatSet) {
  if (!formatSet || formatSet.size === 0) return null;
  const out = new Set();
  for (const f of formatSet) out.add(String(f).toLowerCase());
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
  const entries = _index.entries;
  const formats = _index.formats;
  const base = _index.base;

  for (let i = 0; i < entries.length; i++) {
    const s = _searchLower[i];
    if (!matchesTerms(s, terms)) continue;
    const [fmtIdx, rest] = entries[i];
    const ext = rest.substring(rest.lastIndexOf('.') + 1).toLowerCase();
    const normExt = normalizeFormatExt(ext);
    const playerId = EXT_TO_PLAYER[ext];
    if (!playerId) continue;
    if (formatSet && !formatSet.has(normExt) && !formatSet.has(normExt.toLowerCase())) continue;
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
    const s = _searchLower[i];
    if (!matchesTerms(s, terms)) continue;
    const ext = _index.entries[i][1].substring(_index.entries[i][1].lastIndexOf('.') + 1).toLowerCase();
    const normExt = normalizeFormatExt(ext);
    if (!EXT_TO_PLAYER[ext]) continue;
    if (formatSet && !formatSet.has(normExt) && !formatSet.has(normExt.toLowerCase())) continue;
    n++;
  }
  return n;
}

export function availableFormats() {
  if (!_index) return new Set();
  const out = new Set();
  for (let i = 0; i < _index.entries.length; i++) {
    const rest = _index.entries[i][1];
    const ext = rest.substring(rest.lastIndexOf('.') + 1).toLowerCase();
    if (EXT_TO_PLAYER[ext]) out.add(normalizeFormatExt(ext));
  }
  return out;
}

export function entryCount() {
  return _index ? _index.entries.length : 0;
}

// Return total count of all playable entries (no query filter)
export function totalPlayable() {
  if (!_index) return 0;
  let n = 0;
  for (let i = 0; i < _index.entries.length; i++) {
    const ext = _index.entries[i][1].substring(_index.entries[i][1].lastIndexOf('.') + 1).toLowerCase();
    if (EXT_TO_PLAYER[ext]) n++;
  }
  return n;
}

// Return a slice of all playable entries (no query filter), shuffled per session
export function browseAll(limit = 1000, skip = 0) {
  if (!_index) return [];
  const entries = _index.entries;
  const formats = _index.formats;
  const base = _index.base;
  const all = [];

  for (let i = 0; i < entries.length; i++) {
    const [fmtIdx, rest] = entries[i];
    const ext = rest.substring(rest.lastIndexOf('.') + 1).toLowerCase();
    const normExt = normalizeFormatExt(ext);
    const playerId = EXT_TO_PLAYER[ext];
    if (playerId) {
      all.push({
        name: rest,
        ext: normExt,
        playerId,
        url: base + (formats[fmtIdx] + '/' + rest).split('/').map(encodeURIComponent).join('/'),
      });
    }
  }

  // Shuffle deterministically using Fisher-Yates with a seed so pages are stable per session
  if (!_shuffleOrder) {
    _shuffleOrder = Array.from({ length: all.length }, (_, i) => i);
    for (let i = _shuffleOrder.length - 1; i > 0; i--) {
      const j = (_shuffleSeed = (_shuffleSeed * 16807 + 0) % 2147483647) % (i + 1);
      [_shuffleOrder[i], _shuffleOrder[j]] = [_shuffleOrder[j], _shuffleOrder[i]];
    }
  }

  const result = [];
  const end = Math.min(skip + limit, _shuffleOrder.length);
  for (let i = skip; i < end; i++) {
    result.push(all[_shuffleOrder[i]]);
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
