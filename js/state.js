// js/state.js — Shared mutable state object + constants + DOM references
// All mutable state lives on S so any module can read/write it by reference.
// DOM refs are exported as individual consts (safe live exports — they never change).

export const S = {
  players:           [],     // from players.json
  engines:           {},     // playerId → engine module (lazy-loaded)
  fileLists:         {},     // playerId → string[]
  enabledPlayers:    {},     // playerId → true (all always enabled)
  mergedFiles:       [],     // [{name, ext, playerId, origIdx}] — local only
  modlandFiles:      [],     // [{name, ext, playerId, url}] — modland list
  searchMode:        'local',// 'local' | 'modland'
  localSelected:     new Set(),
  modlandSelected:   new Set(),
  currentIdx:        -1,
  focusedIdx:        -1,
  playing:           false,
  loaded:            false,
  activeEngine:      null,   // playerId of the currently loaded engine
  _playingUrl:       null,   // URL of the currently playing track
  _loadSeq:          0,      // incremented on every loadAndPlay to abort stale loads
  _advancing:        false,  // prevents double-advance from engine onEnd
  _appReady:         false,  // guards persistContext until startup completes
  bulkState:         'restore', // restore | all | none
  bulkRestoreSelection: new Set(),
  suppressBulkSnapshot: false,
  _debugTiming:      true,
  selectedFormats:   new Set(),
  _allFormatOptions: new Set(),
  selectedFolders:   new Set(),
  _allFolderOptions: new Set(),
  selectedArtists:   new Set(),
  _allArtistOptions: new Set(),
  _currentRange:     0,
  _localCtx:         null,   // saved local filter context across mode switches
  _modlandCtx:       null,   // saved modland filter context across mode switches
  _localUrllistTracks: [],   // URL-based tracks from urllists.json
  _lastSearchResults:  [],
  _lastSearchSkip:     0,
  _lastSearchTotal:    0,
  _inSearchResults:    false,
  _randomBrowsing:     false,
};

// ── constants ─────────────────────────────────────────
export const FIXED_VOLUME        = 1.0;
export const USE_WEBSID          = false;
export const SID_TRACK_PLAYER_ID = 'jssid';
export const SID_ENGINE_PLAYER_ID = USE_WEBSID ? 'websid' : 'jssid';
export const MIN_FONT = 8;
export const MAX_FONT = 24;
export const CACHE_NAME = 'track-files-v1';

// ── DOM refs ──────────────────────────────────────────
// Module scripts are deferred; DOM is fully parsed at evaluation time.
export const btnPlay             = document.getElementById('btn-play');
export const elTime              = document.getElementById('time');
export const elSeek              = document.getElementById('seek');
export const elDur               = document.getElementById('duration');
export const elInfo              = document.getElementById('info');
export const elFilter            = document.getElementById('filter');
export const elFilterClr         = document.getElementById('filter-clear');
export const elFilterCnt         = document.getElementById('filter-count');
export const elSearchMode        = document.getElementById('search-mode');
export const elMlAddAll          = document.getElementById('ml-add-all');
export const elMlDelAll          = document.getElementById('ml-del-all');
export const elMlRandom          = document.getElementById('ml-random');
export const btnCopy             = document.getElementById('btn-copy');
export const btnZip              = document.getElementById('btn-zip');
export const btnShare            = document.getElementById('share-btn');
export const elBulkCb            = document.getElementById('sel-bulk-cb');
export const elSelCount          = document.getElementById('sel-count');
export const elList              = document.getElementById('playlist');
export const elTrackPos          = document.getElementById('track-pos');
export const elRefineFolderWrap  = document.getElementById('refine-folder-wrap');
export const elRefineFolderBtn   = document.getElementById('refine-folder-btn');
export const elRefineFolderPanel = document.getElementById('refine-folder-panel');
export const elRefineArtistWrap  = document.getElementById('refine-artist-wrap');
export const elRefineArtistBtn   = document.getElementById('refine-artist-btn');
export const elRefineArtistPanel = document.getElementById('refine-artist-panel');
export const elRefineRangeWrap   = document.getElementById('refine-range-wrap');
export const elRefineRangeBtn    = document.getElementById('refine-range-btn');
export const elRefineRangePanel  = document.getElementById('refine-range-panel');
export const elRefineFormatWrap  = document.getElementById('refine-format-wrap');
export const elRefineFormatBtn   = document.getElementById('refine-format-btn');
export const elRefineFormatPanel = document.getElementById('refine-format-panel');
export const elSelBulk           = document.getElementById('sel-bulk');
export const debugLog            = document.getElementById('debug-log');
export const elTransport         = document.getElementById('transport');
export const btnHelp             = document.getElementById('help-btn');
