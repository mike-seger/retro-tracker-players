// js/deeplink.js — Deep link encode/decode and initial load
import { S, elFilter, elList } from './state.js';
import { trackUrl, extOf } from './utils.js';
import { activeFiles, buildPlaylist, scrollIntoViewSmart, setFocus, highlightCurrent } from './playlist.js';
import { loadAndPlay } from './player.js';
import { showDeepLinkPrompt } from './prompts.js';
import { updateFormatBtn, syncFormatCheckboxes, clearFormatFilter } from './format-panel.js';
import { applyFilter } from './filter.js';

// ── build ──────────────────────────────────────────────
export function buildDeepLink(fullContext) {
  const params = new URLSearchParams();

  const files = activeFiles();
  if (S.currentIdx >= 0 && S.currentIdx < files.length) {
    const entry = files[S.currentIdx];
    const url = entry.url || trackUrl(entry);
    params.set('play', url);
  }

  if (fullContext) {
    if (S.searchMode !== 'local') params.set('source', S.searchMode);
    if (elFilter.value.trim()) params.set('search', elFilter.value.trim());
    if (S.selectedFolders.size > 0 && S.selectedFolders.size < S._allFolderOptions.size) {
      params.set('folders', [...S.selectedFolders].join(','));
    }
    if (S.selectedArtists.size > 0 && S.selectedArtists.size < S._allArtistOptions.size) {
      params.set('artists', [...S.selectedArtists].join(','));
    }
    if (S.selectedFormats.size > 0 && S.selectedFormats.size < S._allFormatOptions.size) {
      params.set('formats', [...S.selectedFormats].join(','));
    }
  }

  const str = params.toString();
  const base = window.location.origin + window.location.pathname;
  return str ? `${base}?${str}` : base;
}

// ── parse ──────────────────────────────────────────────
export function deepLinkTarget() {
  const params = new URLSearchParams(window.location.search);
  return params.get('play') || null;
}

export function deepLinkFilters() {
  const params = new URLSearchParams(window.location.search);
  return {
    source:  params.get('source'),
    search:  params.get('search'),
    folders: params.get('folders'),
    artists: params.get('artists'),
    formats: params.get('formats'),
  };
}

export function applyDeepLinkFilters() {
  const f = deepLinkFilters();
  if (!f.search && !f.folders && !f.artists && !f.formats) return;
  if (f.search) elFilter.value = f.search;
  if (f.folders) {
    const fmts = new Set(f.folders.split(',').map(s => s.trim()));
    S.selectedFolders = new Set([...fmts].filter(fm => S._allFolderOptions.has(fm)));
    import('./folder-panel.js').then(m => { m.updateFolderBtn(); m.syncFolderCheckboxes(); });
  }
  if (f.artists) {
    const arts = new Set(f.artists.split(',').map(s => s.trim()));
    S.selectedArtists = new Set([...arts].filter(a => S._allArtistOptions.has(a)));
    import('./artist-panel.js').then(m => { m.updateArtistBtn(); m.syncArtistCheckboxes(); });
  }
  if (f.formats) {
    const fmts = new Set(f.formats.split(',').map(s => s.trim().toUpperCase()));
    S.selectedFormats = new Set([...fmts].filter(fm => S._allFormatOptions.has(fm)));
    updateFormatBtn();
    syncFormatCheckboxes();
  }
  applyFilter();
}

// ── find local entry ───────────────────────────────────
export function findLocalEntryByUrl(targetUrl) {
  // Check direct URL matches (urllist tracks)
  const direct = S.mergedFiles.find(e => e.url === targetUrl);
  if (direct) return S.mergedFiles.indexOf(direct);

  // Check computed file URL from filelist
  const computed = S.mergedFiles.find(e => !e.url && trackUrl(e) === targetUrl);
  if (computed) return S.mergedFiles.indexOf(computed);

  return -1;
}

// ── load deep linked track ─────────────────────────────
export async function loadDeepLinkedTrack() {
  const targetUrl = deepLinkTarget();
  if (!targetUrl) return false;

  // Try to find in local files first
  let idx = findLocalEntryByUrl(targetUrl);
  if (idx >= 0) {
    S.currentIdx = idx;
    highlightCurrent();
    setFocus(idx);
    const files = activeFiles();
    const entry = files[idx];
    const label = decodeURIComponent(entry.name).split('/').pop() || entry.name;
    showDeepLinkPrompt(label, () => loadAndPlay(idx));
    return true;
  }

  // Try to find in modland files
  const mlIdx = S.modlandFiles.findIndex(t => t.url === targetUrl);
  if (mlIdx >= 0) {
    const { switchMode } = await import('./mode.js');
    switchMode('modland');
    S.currentIdx = mlIdx;
    highlightCurrent();
    setFocus(mlIdx);
    const entry = S.modlandFiles[mlIdx];
    const label = decodeURIComponent(entry.name).split('/').pop() || entry.name;
    showDeepLinkPrompt(label, () => loadAndPlay(mlIdx));
    return true;
  }

  // If source=modland, run the full modland search so the track appears in context
  const f = deepLinkFilters();
  if (f.source === 'modland' && f.search) {
    const { switchMode } = await import('./mode.js');
    const { doModlandSearch } = await import('./modland.js');
    const remoteSearch = await import('./remote-search.js').then(m => m.default || m);
    switchMode('modland');
    elFilter.value = f.search;
    if (!remoteSearch.isLoaded()) await remoteSearch.loadIndex();

    // Find which page the target URL is on (results are paged at 200)
    const pageSize = 200;
    const total = remoteSearch.count(f.search);
    if (total > pageSize) {
      const allResults = remoteSearch.search(f.search, total, 0);
      const globalIdx = allResults.findIndex(r => r.url === targetUrl);
      if (globalIdx >= 0) {
        S._currentRange = Math.floor(globalIdx / pageSize) * pageSize;
      }
    }

    doModlandSearch();
    // After search the list is in S._lastSearchResults
    const ci = (S._lastSearchResults || []).findIndex(r => r.url === targetUrl);
    if (ci >= 0) {
      S.currentIdx = ci;
      const curLi = elList.children[ci];
      if (curLi) { curLi.classList.add('current'); scrollIntoViewSmart(curLi, true); }
      const entry = S._lastSearchResults[ci];
      const label = decodeURIComponent(entry.name).split('/').pop() || entry.name;
      showDeepLinkPrompt(label, () => loadAndPlay(ci));
      return true;
    }
  }

  // Synthesize from URL (last resort — shows single result without context)
  const ext = extOf(targetUrl);
  const playerMap = { ahx: 'ahx', sid: 'jssid', mod: 'mod', xm: 'mod', s3m: 'mod', it: 'mod' };
  const playerId = playerMap[ext.toLowerCase()] || 'mod';
  try {
    const u = new URL(targetUrl);
    const segments = u.pathname.split('/').map(decodeURIComponent);
    const fileName = segments[segments.length - 1];
    const artist = (segments[segments.length - 2] || '').replace(/\//g, '+');
    const name = artist ? `${artist}/${fileName}` : fileName;

    const entry = { name, ext: ext.toUpperCase(), playerId, url: targetUrl };
    S.modlandFiles.push(entry);
    // If already in modland mode (came through the search branch), switch off
    // search-results view so activeFiles() returns S.modlandFiles correctly.
    if (S.searchMode === 'modland') {
      S._inSearchResults = false;
      buildPlaylist();
    } else {
      const { switchMode } = await import('./mode.js');
      switchMode('modland');
    }
    S.currentIdx = S.modlandFiles.length - 1;
    highlightCurrent();
    setFocus(S.currentIdx);
    showDeepLinkPrompt(fileName, () => loadAndPlay(S.currentIdx));
    return true;
  } catch (_) {
    return false;
  }
}
