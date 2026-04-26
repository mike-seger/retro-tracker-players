// js/app.js — Thin init entry point; imports all modules and runs startup
import * as remoteSearch from './remote-search.js';
import { S, elFilter, elFilterClr, elSearchMode, elRefineFolder, elRefineArtist,
         elRefineRange, elSelBulk, debugLog, elTransport } from './state.js';
import { extOf, dbg, tlog } from './utils.js';
import { setFormatChangeHandler, clearFormatFilter } from './format-panel.js';
import { buildPlaylist, rebuildMergedFiles, renderToggles, loadEnabledPlayers,
         activeFiles, highlightCurrent, setFocus, setPlaylistFontSize } from './playlist.js';
import { applyFilter, updateRefineVisibility } from './filter.js';
import { populateFolderDropdown, populateLocalArtistDropdown, populateLocalFormatDropdown,
         modlandPlaceholder, localPlaceholder } from './refine.js';
import { restoreSelection, updateSelCount } from './selection.js';
import { loadModlandTracks } from './modland.js';
import { doModlandSearch, doRandomBrowse } from './modland.js';
import { switchMode, restorePersistedContext } from './mode.js';
import { loadDeepLinkedTrack, applyDeepLinkFilters } from './deeplink.js';
import { showResumePrompt } from './prompts.js';
import { loadAndPlay } from './player.js';

// Side-effect-only imports (register their own listeners)
import './keyboard.js';
import './pinch.js';
import './doc-overlay.js';

// ── format change callback — breaks format-panel ↔ filter circular dep ──
setFormatChangeHandler(() => {
  if (S.searchMode === 'local') {
    populateLocalArtistDropdown();
    applyFilter();
  } else if (S._randomBrowsing) {
    const skip = parseInt(elRefineRange.value, 10) || 0;
    doRandomBrowse(skip);
  } else {
    doModlandSearch();
  }
});

// ── debug log helpers ────────────────────────────────
async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (_) {}
  try {
    const ta = Object.assign(document.createElement('textarea'), {
      value: text,
      style: 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;outline:0;' +
             'box-shadow:none;background:transparent;opacity:0;font-size:16px',
    });
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) { return false; }
}

async function shareText(text) {
  if (!text || !navigator.share) return false;
  try { await navigator.share({ text }); return true; } catch (_) { return false; }
}

async function shareLogFile(text) {
  if (!text || !navigator.share || typeof File === 'undefined') return false;
  try {
    const file = new File([text], `retro-debug-${Date.now()}.log`, { type: 'text/plain' });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: 'Retro tracker debug log' });
    return true;
  } catch (_) { return false; }
}

function downloadLogFile(text) {
  if (!text) return false;
  try {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `retro-debug-${Date.now()}.log`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return true;
  } catch (_) { return false; }
}

// Debug log toggle — double-click / long-press on transport bar
elTransport.addEventListener('dblclick', (e) => {
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
  debugLog.hidden = !debugLog.hidden;
});
let _dbgLongPress = 0;
elTransport.addEventListener('touchstart', (e) => {
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
  _dbgLongPress = setTimeout(() => { debugLog.hidden = !debugLog.hidden; _dbgLongPress = 0; }, 800);
}, { passive: true });
elTransport.addEventListener('touchend',  () => clearTimeout(_dbgLongPress), { passive: true });
elTransport.addEventListener('touchmove', () => clearTimeout(_dbgLongPress), { passive: true });

// Debug log copy / share on long-press
let _dbgCopyTouchStart = 0, _dbgCopyTouchMoved = false;
debugLog.addEventListener('touchstart', () => {
  if (debugLog.hidden) return;
  _dbgCopyTouchStart = Date.now(); _dbgCopyTouchMoved = false;
}, { passive: true });
debugLog.addEventListener('touchend', async () => {
  const held = _dbgCopyTouchStart ? (Date.now() - _dbgCopyTouchStart) : 0;
  _dbgCopyTouchStart = 0;
  if (_dbgCopyTouchMoved || held < 700 || debugLog.hidden) return;
  const text = debugLog.textContent.trim();
  if (await copyText(text))      { dbg('[I] debug log copied'); return; }
  if (await shareLogFile(text))  { dbg('[I] debug log shared as file'); return; }
  if (await shareText(text))     { dbg('[I] debug log shared'); return; }
  if (downloadLogFile(text))     { dbg('[I] debug log downloaded'); return; }
  dbg('[W] failed to copy debug log');
}, { passive: true });
debugLog.addEventListener('touchmove',  () => { _dbgCopyTouchMoved = true; }, { passive: true });
debugLog.addEventListener('touchcancel', () => { _dbgCopyTouchStart = 0; _dbgCopyTouchMoved = true; }, { passive: true });

// ── console overrides ────────────────────────────────
const origWarn = console.warn, origErr = console.error;
console.warn  = (...a) => { dbg('[W] ' + a.join(' ')); origWarn.apply(console, a); };
console.error = (...a) => { dbg('[E] ' + a.join(' ')); origErr.apply(console, a); };
window.addEventListener('error', (e) => dbg('[ERR] ' + e.message + ' @ ' + e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => dbg('[REJ] ' + e.reason));

// ── mode + filter event listeners ────────────────────
elSearchMode.addEventListener('change', () => switchMode(elSearchMode.value));

let _searchTimer = 0;
elFilter.addEventListener('input', () => {
  if (S.searchMode === 'modland') {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(doModlandSearch, 150);
  } else {
    populateLocalArtistDropdown();
    applyFilter();
  }
});

elFilter.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') elFilter.blur();
});

elFilterClr.addEventListener('click', () => {
  elFilter.value = '';
  elRefineFolder.value = '';
  elRefineArtist.value = '';
  elRefineRange.value = '';
  clearFormatFilter();
  elFilter.dispatchEvent(new Event('input'));
  elFilter.focus();
});

// ── init ─────────────────────────────────────────────
(async function init() {
  // Emergency escape hatch: ?clear-resume removes any stale auto-resume flag
  if (new URLSearchParams(location.search).has('clear-resume')) {
    localStorage.removeItem('auto-resume');
  }

  const resp = await fetch('players.json');
  S.players = await resp.json();

  loadModlandTracks();
  loadEnabledPlayers();

  await Promise.all(S.players.map(async (p) => {
    try {
      const r = await fetch(`engines/${p.id}/filelist.json`);
      S.fileLists[p.id] = await r.json();
    } catch (e) {
      S.fileLists[p.id] = [];
      console.warn('Failed to load filelist for', p.id, e);
    }
  }));

  // Load per-engine urllists.json
  S._localUrllistTracks = [];
  await Promise.all(S.players.map(async (p) => {
    try {
      const r = await fetch(`engines/${p.id}/urllists.json`);
      if (!r.ok) return;
      const data = await r.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      for (const [folder, urls] of Object.entries(data)) {
        if (!Array.isArray(urls)) continue;
        for (const url of urls) {
          try {
            const safeUrl = encodeURI(decodeURI(url));
            const segments = new URL(safeUrl).pathname.split('/').map(decodeURIComponent);
            const fileName = segments[segments.length - 1];
            let artistSeg = segments.length >= 2 ? segments[segments.length - 2] : '';
            if (/^coop-/i.test(artistSeg) && segments.length >= 3) artistSeg = segments[segments.length - 3];
            const artist = artistSeg.replace(/\//g, '+');
            const displayName = artist ? `${artist} - ${fileName}` : fileName;
            const name = `${folder}/${displayName}`;
            S._localUrllistTracks.push({ name, ext: extOf(safeUrl), playerId: p.id, url: safeUrl });
          } catch (_) {}
        }
      }
    } catch (_) {}
  }));

  renderToggles();
  rebuildMergedFiles();
  populateLocalArtistDropdown();
  populateFolderDropdown();
  populateLocalFormatDropdown();
  updateRefineVisibility();
  buildPlaylist();
  restoreSelection();

  const hadDeepLink = !!window.location.search;
  const deepLinked = await loadDeepLinkedTrack();
  applyDeepLinkFilters();

  if (window.location.search) history.replaceState(null, '', window.location.pathname);
  if (!hadDeepLink) restorePersistedContext();

  if (!deepLinked) {
    try {
      const saved = JSON.parse(localStorage.getItem('current-track'));
      if (saved) {
        if (saved.mode === 'modland') {
          switchMode('modland');
          S.currentIdx = S.modlandFiles.findIndex(
            f => f.playerId === saved.playerId && f.name === saved.name
          );
        } else {
          S.currentIdx = S.mergedFiles.findIndex(
            f => f.playerId === saved.playerId && f.name === saved.name
          );
        }
        if (S.currentIdx >= 0) {
          highlightCurrent();
          setFocus(S.currentIdx);
          if (saved.wasPlaying) {
            const files = activeFiles();
            const entry = files[S.currentIdx];
            const label = entry
              ? (decodeURIComponent(entry.name).split('/').pop() || entry.name)
              : String(S.currentIdx + 1);
            const resumePos = (typeof saved.playPos === 'number' && saved.playPos > 0) ? saved.playPos : 0;
            const doResume = () =>
              loadAndPlay(S.currentIdx).then(() => {
                if (resumePos > 0 && S.activeEngine && S.engines[S.activeEngine]) {
                  S.engines[S.activeEngine].seekTo(resumePos);
                }
              });
            // iOS Safari requires AudioContext.resume() to be called inside a
            // user gesture — auto-resuming silently at startup will always fail.
            // So on iOS we always show the prompt (no auto-resume option).
            // iOS and Android both require AudioContext.resume() inside a user gesture.
            // On desktop there is no such restriction: honour the auto-resume flag
            // directly, or show the prompt with the checkbox so the user can set it.
            const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
              (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
            if (!isMobile && localStorage.getItem('auto-resume') === '1') {
              doResume();
            } else {
              showResumePrompt(label, doResume, /* showAutoOption */ !isMobile);
            }
          }
        }
      }
    } catch (_) {}
  }

  const savedSize = parseFloat(localStorage.getItem('playlist-font-size'));
  if (savedSize) setPlaylistFontSize(savedSize);

  S._appReady = true;

  remoteSearch.loadIndex().then(() => {
    if (S.searchMode === 'modland') elFilter.placeholder = modlandPlaceholder();
  }).catch(e => console.warn('Remote index not available:', e));
})();
