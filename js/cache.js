// js/cache.js — Two-tier track file cache (in-memory blob URLs + Cache API)
import { S, CACHE_NAME } from './state.js';
import { tlog } from './utils.js';

const _blobCache = new Map(); // url → blobUrl (session-lifetime)

export function cacheHas(url) { return _blobCache.has(url); }

export async function cacheFetch(url) {
  if (_blobCache.has(url)) return _blobCache.get(url);

  let buf;
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      let cached = await cache.match(url);
      if (!cached) {
        const fetched = await fetch(url);
        if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
        await cache.put(url, fetched.clone());
        cached = fetched;
      }
      buf = await cached.arrayBuffer();
    } catch (_) {
      // Cache API unavailable (e.g. private browsing) — fall through
    }
  }

  if (!buf) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = await res.arrayBuffer();
  }

  const blobUrl = URL.createObjectURL(new Blob([buf]));
  _blobCache.set(url, blobUrl);
  if (S._debugTiming) tlog(`[cache] stored ${url.split('/').pop()} (${_blobCache.size} in-mem)`);
  return blobUrl;
}
