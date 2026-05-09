// search-worker.js — ES module Web Worker for off-thread Modland index searches.
// Runs the 300k-entry scan on a background thread; main thread stays fully responsive.

const MINI_FORMAT_EXTS = new Set(['mini2sf', 'minigsf', 'minipsf', 'miniusf', 'minipsf2', 'minissf']);
const EXT_TO_PLAYER = {
  ahx: 'ahx', sid: 'jssid',
  mod: 'mod', xm: 'mod', s3m: 'mod', it: 'mod',
  mini2sf: 'mini', minigsf: 'mini', minipsf: 'mini', miniusf: 'mini',
  minipsf2: 'mini', minissf: 'mini',
  spc: 'spc', vgm: 'vgm', vgz: 'vgm',
};

function normalizeExt(raw) {
  if (!raw) return '';
  if (MINI_FORMAT_EXTS.has(raw)) return 'MINI';
  return raw.toUpperCase();
}

let _rawEntries = [];
let _rawSearchLower = [];
let _rawExtInfo = [];
let _entries = [];
let _searchLower = [];
let _extInfo = [];
let _base = '';
let _formats = [];
let _lastDisabledKey = null;

// ── incremental search cache ──────────────────────────
// Stores the full (unpaginated, sorted) result set from the last search.
// If the new query is a string-prefix of the cached query and the format set
// is identical, we search this smaller set instead of all _entries — giving a
// dramatic speedup as the user continues typing (e.g. "foo" → "foobar").
let _cacheQuery  = '';
let _cacheFmtKey = '';
let _cacheAll    = null;   // result objects [{name, ext, playerId, url}, …]
let _cacheAllLower = null; // parallel lowercase name strings for matching

function _invalidateSearchCache() {
  _cacheQuery = '';
  _cacheFmtKey = '';
  _cacheAll = null;
  _cacheAllLower = null;
}

async function load(indexUrl) {
  const resp = await fetch(indexUrl);
  const ds = new DecompressionStream('gzip');
  const decompressed = resp.body.pipeThrough(ds);
  const index = await new Response(decompressed).json();
  _base = index.base;
  _formats = index.formats;
  _rawEntries = index.entries;
  _rawSearchLower = new Array(_rawEntries.length);
  _rawExtInfo = new Array(_rawEntries.length);
  for (let i = 0; i < _rawEntries.length; i++) {
    const rest = _rawEntries[i][1];
    _rawSearchLower[i] = rest.toLowerCase();
    const rawExt = rest.substring(rest.lastIndexOf('.') + 1).toLowerCase();
    _rawExtInfo[i] = { normExt: normalizeExt(rawExt), playerId: EXT_TO_PLAYER[rawExt] || null };
  }
  _entries = _rawEntries;
  _searchLower = _rawSearchLower;
  _extInfo = _rawExtInfo;

  // Pre-sort alphabetically (by folder then filename, case-insensitive) and
  // filter out unplayable entries (no known engine) so every subsequent search
  // over _entries is already in order — no runtime sort needed.
  const indices = Array.from({ length: _rawEntries.length }, (_, i) => i);
  indices.sort((ia, ib) => {
    const a = _rawSearchLower[ia], b = _rawSearchLower[ib];
    const sa = a.lastIndexOf('/'), sb = b.lastIndexOf('/');
    const fa = sa >= 0 ? a.substring(0, sa) : '';
    const fb = sb >= 0 ? b.substring(0, sb) : '';
    if (fa < fb) return -1; if (fa > fb) return 1;
    const ta = sa >= 0 ? a.substring(sa + 1) : a;
    const tb = sb >= 0 ? b.substring(sb + 1) : b;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  const se = [], sl = [], sx = [];
  for (let k = 0; k < indices.length; k++) {
    const src = indices[k];
    if (!_rawExtInfo[src].playerId) continue; // drop unplayable entries
    se.push(_rawEntries[src]);
    sl.push(_rawSearchLower[src]);
    sx.push(_rawExtInfo[src]);
  }
  _rawEntries = se; _rawSearchLower = sl; _rawExtInfo = sx;
  _entries = _rawEntries; _searchLower = _rawSearchLower; _extInfo = _rawExtInfo;
}

function applyDisabled(disabledArr) {
  const key = disabledArr.length > 0 ? [...disabledArr].sort().join(',') : '';
  if (key === _lastDisabledKey) return;
  _lastDisabledKey = key;
  _invalidateSearchCache(); // working set changed — cached results are stale
  if (!key) {
    _entries = _rawEntries;
    _searchLower = _rawSearchLower;
    _extInfo = _rawExtInfo;
    return;
  }
  const disabled = new Set(disabledArr);
  const newEntries = [], newLower = [], newExtInfo = [];
  for (let i = 0; i < _rawEntries.length; i++) {
    const info = _rawExtInfo[i];
    if (!info.playerId) continue;
    if (disabled.has(info.normExt)) continue;
    newEntries.push(_rawEntries[i]);
    newLower.push(_rawSearchLower[i]);
    newExtInfo.push(info);
  }
  _entries = newEntries;
  _searchLower = newLower;
  _extInfo = newExtInfo;
}

function matchesTerms(s, terms) {
  for (let t = 0; t < terms.length; t++) {
    if (s.indexOf(terms[t]) < 0) return false;
  }
  return true;
}

function runSearch(query, formatSet, limit, skip) {
  const queryLower = String(query || '').toLowerCase();
  const terms = queryLower.split(/\s+/).filter(Boolean);
  const fmtSet = formatSet ? new Set(formatSet) : null;
  const fmtKey = formatSet ? [...formatSet].sort().join(',') : '';

  // Fast path: empty query, no format filter — _entries is pre-sorted; just slice.
  if (terms.length === 0 && !fmtSet) {
    const total = _entries.length;
    const results = [];
    for (let i = skip, end = Math.min(skip + limit, total); i < end; i++) {
      const [fmtIdx, rest] = _entries[i];
      const info = _extInfo[i];
      const fullPath = _formats[fmtIdx] + '/' + rest;
      results.push({ name: rest, ext: info.normExt, playerId: info.playerId,
        url: _base + fullPath.split('/').map(encodeURIComponent).join('/') });
    }
    _invalidateSearchCache();
    return { results, total };
  }

  // Incremental search: if the new query is a string-prefix of the cached query
  // and the format filter is unchanged, the cached full result set is a valid
  // superset — scan it instead of all _entries.  The cache is already sorted,
  // so we can skip the sort step entirely for an extra speedup.
  const useCache = (
    _cacheAll !== null &&
    _cacheQuery.length > 0 &&
    queryLower.startsWith(_cacheQuery) &&
    fmtKey === _cacheFmtKey
  );

  const all = [];
  const allLower = [];

  if (useCache) {
    for (let i = 0; i < _cacheAll.length; i++) {
      if (!matchesTerms(_cacheAllLower[i], terms)) continue;
      const entry = _cacheAll[i];
      if (fmtSet && !fmtSet.has(entry.ext)) continue;
      all.push(entry);
      allLower.push(_cacheAllLower[i]);
    }
    // Cached results are pre-sorted — no re-sort needed.
  } else {
    // _entries is pre-sorted alphabetically at load time; scan preserves that order.
    for (let i = 0; i < _entries.length; i++) {
      if (!matchesTerms(_searchLower[i], terms)) continue;
      const { normExt, playerId } = _extInfo[i];
      if (!playerId) continue;
      if (fmtSet && !fmtSet.has(normExt)) continue;
      const [fmtIdx, rest] = _entries[i];
      const fullPath = _formats[fmtIdx] + '/' + rest;
      all.push({ name: rest, ext: normExt, playerId,
        url: _base + fullPath.split('/').map(encodeURIComponent).join('/') });
      allLower.push(_searchLower[i]);
    }
    // No sort needed — _entries is already sorted, so the filtered subset is too.
  }

  // Update cache with the full result set for this query.
  _cacheQuery  = queryLower;
  _cacheFmtKey = fmtKey;
  _cacheAll    = all;
  _cacheAllLower = allLower;

  return { results: all.slice(skip, skip + limit), total: all.length };
}

self.onmessage = async ({ data }) => {
  const { type, token } = data;
  if (type === 'load') {
    await load(data.indexUrl);
    self.postMessage({ type: 'loaded' });
  } else if (type === 'warmup') {
    // Pre-apply disabled formats so the next search hits the pre-filtered working set.
    applyDisabled(data.disabled || []);
  } else if (type === 'search') {
    // Apply disabled-format filter atomically with the search (no race conditions).
    applyDisabled(data.disabled || []);
    const result = runSearch(data.query, data.formatSet, data.limit, data.skip);
    self.postMessage({ type: 'result', result, token });
  }
};
