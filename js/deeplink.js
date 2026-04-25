// js/deeplink.js — Deep link encode/decode and initial load
import { S, elFilter, elRefineFolder, elRefineArtist } from './state.js';
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
    if (elRefineFolder.value) params.set('folder', elRefineFolder.value);
    if (elRefineArtist.value) params.set('artist', elRefineArtist.value);
    if (S.selectedFormats.size > 0 && S.selectedFormats.size < S._allFormatOptions.size) {
      params.set('formats', [...S.selectedFormats].join(','));
    }
  }

  const str = params.toString();
  return str ? `${window.location.pathname}?${str}` : window.location.pathname;
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
    folder:  params.get('folder'),
    artist:  params.get('artist'),
    formats: params.get('formats'),
  };
}

export function applyDeepLinkFilters() {
  const f = deepLinkFilters();
  if (!f.search && !f.folder && !f.artist && !f.formats) return;
  if (f.search) elFilter.value = f.search;
  if (f.folder && [...elRefineFolder.options].some(o => o.value === f.folder)) {
    elRefineFolder.value = f.folder;
  }
  if (f.artist && S.searchMode === 'local') {
    if ([...elRefineArtist.options].some(o => o.value === f.artist)) {
      elRefineArtist.value = f.artist;
    }
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

  // Synthesize from URL
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
    const { switchMode } = await import('./mode.js');
    switchMode('modland');
    S.currentIdx = S.modlandFiles.length - 1;
    highlightCurrent();
    setFocus(S.currentIdx);
    showDeepLinkPrompt(fileName, () => loadAndPlay(S.currentIdx));
    return true;
  } catch (_) {
    return false;
  }
}
