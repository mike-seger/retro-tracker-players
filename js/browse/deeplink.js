// js/deeplink.js — Deep link encode/decode and initial load
import { S, elFilter, elList } from '../core/state.js';
import { trackUrl, extOf, safeDecodeURIComponent } from '../lib/utils.js';
import { activeFiles, buildPlaylist, scrollIntoViewSmart, setFocus, highlightCurrent } from '../playlists/playlist.js';
import { loadAndPlay } from '../core/player.js';
import { showDeepLinkPrompt } from '../ui/prompts.js';
import { updateFormatBtn, syncFormatCheckboxes, clearFormatFilter, buildFormatPanel } from '../filters/format-panel.js';
import { applyFilter } from '../filters/filter.js';
import { getMaxListItems } from '../settings/settings.js';

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
    const sourceLabel = S._viewingScratchpad ? 'scratchpad' : S.searchMode;
    if (sourceLabel !== 'local') params.set('source', sourceLabel);
    if (!S._viewingScratchpad) {
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
    if (S._currentRange > 0) params.set('range', String(S._currentRange));
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
    range:   params.get('range') ? parseInt(params.get('range'), 10) : 0,
  };
}

export function applyDeepLinkFilters() {
  const f = deepLinkFilters();
  if (!f.source && !f.search && !f.folders && !f.artists && !f.formats && !f.range) return;

  // Restore page offset before search/filter fires — both doModlandSearch and applyFilter use it.
  if (f.range > 0) S._currentRange = f.range;

  // Scratchpad: show saved tracks. loadDeepLinkedTrack handles this when the play URL was
  // found in modlandFiles; here we cover the context-only restore (no play URL).
  if (f.source === 'scratchpad') {
    if (!S._viewingScratchpad) {
      (async () => {
        if (S.searchMode !== 'modland') {
          const { switchMode } = await import('../core/mode.js');
          switchMode('modland', { skipSearch: true });
        }
        const { showScratchpad } = await import('../browse/modland.js');
        showScratchpad();
      })();
    }
    return;
  }

  // Modland: loadDeepLinkedTrack already set up mode + search when there was a play URL.
  // Handle the context-only case (no play URL): switch mode and trigger the index search.
  if (f.source === 'modland') {
    if (S.searchMode !== 'modland') {
      (async () => {
        const { switchMode } = await import('../core/mode.js');
        const remoteSearch = await import('./remote-search.js').then(m => m.default || m);
        switchMode('modland', { skipSearch: true });
        if (f.search) elFilter.value = f.search;
        if (!remoteSearch.isLoaded()) await remoteSearch.loadIndex();
        if (f.formats) {
          buildFormatPanel(remoteSearch.availableFormats());
          const fmts = new Set(f.formats.split(',').map(s => s.trim().toUpperCase()));
          S.selectedFormats = new Set([...fmts].filter(fm => S._allFormatOptions.has(fm)));
        }
        const { doModlandSearch } = await import('../browse/modland.js');
        await doModlandSearch();
        updateFormatBtn();
        syncFormatCheckboxes();
      })();
    }
    // If already in modland, loadDeepLinkedTrack already handled mode + search.
    return;
  }

  // Local mode: restore text filter, folder/artist/format panels, then apply.
  if (f.search) elFilter.value = f.search;
  if (f.folders) {
    const fmts = new Set(f.folders.split(',').map(s => s.trim()));
    S.selectedFolders = new Set([...fmts].filter(fm => S._allFolderOptions.has(fm)));
    import('../filters/folder-panel.js').then(m => { m.updateFolderBtn(); m.syncFolderCheckboxes(); });
  }
  if (f.artists) {
    const arts = new Set(f.artists.split(',').map(s => s.trim()));
    S.selectedArtists = new Set([...arts].filter(a => S._allArtistOptions.has(a)));
    import('../filters/artist-panel.js').then(m => { m.updateArtistBtn(); m.syncArtistCheckboxes(); });
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

  // Parse filters once — used across all branches below.
  const f = deepLinkFilters();

  // Try to find in local files first
  let idx = findLocalEntryByUrl(targetUrl);
  if (idx >= 0) {
    S.currentIdx = idx;
    highlightCurrent();
    setFocus(idx);
    const files = activeFiles();
    const entry = files[idx];
    const label = safeDecodeURIComponent(entry.name).split('/').pop() || entry.name;
    showDeepLinkPrompt(label, () => loadAndPlay(idx));
    return true;
  }

  // Try to find in modland files (scratchpad / saved tracks)
  const mlIdx = S.modlandFiles.findIndex(t => t.url === targetUrl);
  if (mlIdx >= 0) {
    const { switchMode } = await import('../core/mode.js');
    switchMode('modland', { skipSearch: true });
    // Restore scratchpad view when the link was shared from scratchpad mode.
    if (f.source === 'scratchpad') {
      const { showScratchpad } = await import('./modland.js');
      showScratchpad();
    }
    S.currentIdx = mlIdx;
    highlightCurrent();
    setFocus(mlIdx);
    const entry = S.modlandFiles[mlIdx];
    const label = safeDecodeURIComponent(entry.name).split('/').pop() || entry.name;
    showDeepLinkPrompt(label, () => loadAndPlay(mlIdx));
    return true;
  }

  // If source=modland, restore modland context and trigger the index search.
  if (f.source === 'modland') {
    const { switchMode } = await import('../core/mode.js');
    const { doModlandSearch } = await import('./modland.js');
    const remoteSearch = await import('./remote-search.js').then(m => m.default || m);
    switchMode('modland', { skipSearch: true });
    if (f.search) elFilter.value = f.search;
    if (!remoteSearch.isLoaded()) await remoteSearch.loadIndex();

    // Apply format filter before search: buildFormatPanel populates S._allFormatOptions
    // so the intersection is correct even before the first doModlandSearch call.
    if (f.formats) {
      buildFormatPanel(remoteSearch.availableFormats());
      const fmts = new Set(f.formats.split(',').map(s => s.trim().toUpperCase()));
      S.selectedFormats = new Set([...fmts].filter(fm => S._allFormatOptions.has(fm)));
    }

    // Restore range: prefer the saved range param; fall back to computing from track position
    // (legacy behaviour for old links that don't carry the range param).
    if (f.range > 0) {
      S._currentRange = f.range;
    } else if (f.search) {
      const pageSize = getMaxListItems();
      const total = remoteSearch.count(f.search);
      if (total > pageSize) {
        const allResults = remoteSearch.search(f.search, total, 0);
        const globalIdx = allResults.findIndex(r => r.url === targetUrl);
        if (globalIdx >= 0) {
          S._currentRange = Math.floor(globalIdx / pageSize) * pageSize;
        }
      }
    }

    await doModlandSearch();
    updateFormatBtn();
    syncFormatCheckboxes();

    // Find the target track in the now-populated results list.
    const ci = (S._lastSearchResults || []).findIndex(r => r.url === targetUrl);
    if (ci >= 0) {
      S.currentIdx = ci;
      const curLi = elList.children[ci];
      if (curLi) { curLi.classList.add('current'); scrollIntoViewSmart(curLi, true); }
      const entry = S._lastSearchResults[ci];
      const label = safeDecodeURIComponent(entry.name).split('/').pop() || entry.name;
      showDeepLinkPrompt(label, () => loadAndPlay(ci));
    }
    return true; // Context restored — return true even if track not visible on current page
  }

  // Synthesize from URL (last resort — shows single result without context)
  const ext = extOf(targetUrl);
  const playerMap = {
    ahx: 'ahx', sid: 'jssid',
    mod: 'mod', xm: 'mod', s3m: 'mod', it: 'mod',
    mini2sf: 'mini', minigsf: 'mini', minipsf: 'mini', miniusf: 'mini', minipsf2: 'mini', minissf: 'mini',
    spc: 'spc', vgm: 'vgm', vgz: 'vgm',
  };
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
      const { switchMode } = await import('../core/mode.js');
      switchMode('modland', { skipSearch: true });
      S._inSearchResults = false;
      buildPlaylist();
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
