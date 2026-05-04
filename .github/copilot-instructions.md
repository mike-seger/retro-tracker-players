# ReTrap – Copilot Instructions

## What this project is

**ReTrap** is a single-page browser player for retro chiptune music (demoscene era). It unifies three audio engines (SID, AHX, MOD) into one UI. No framework, no build step, no transpiler — pure vanilla ES6 modules served directly over HTTP/S.

Live at: `mike-seger.github.io/retro-tracker-players/`  
Local: `python3 -m http.server 8080` from repo root.

---

## Architecture

All state lives in **`js/state.js`** — a single exported object `S` plus all DOM refs and constants. Every module imports from it freely; it is the only source of truth.

| Module | Role |
|--------|------|
| `js/state.js` | Global state `S`, DOM refs, constants. Read this first. |
| `js/app.js` | Init IIFE; wires all event handlers; loads `players.json` + filelists. Exports `refreshUserPlaylistTracksAndRebuild()`. |
| `js/player.js` | `loadAndPlay()`, transport UI, seek, prefetch-ahead (AbortController). |
| `js/engines.js` | Lazy engine loader; pre-warms all imports at startup (see iOS constraint). |
| `js/playlist.js` | Playlist DOM rendering, scroll, file list merge (`rebuildMergedFiles`). Enriches merged entries with `userPlaylistIds`/`userPlaylistNames` from `S._userPlaylistTracks`. |
| `js/filter.js` | Text search + refine UI; rebuilds visible rows + format panel. |
| `js/mode.js` | Local ↔ Modland mode switch; saves/restores per-mode filter context. |
| `js/modland.js` | Modland file management, remote search, add/delete, random browse. Per-track `+` dropdown (checkbox multi-select) and global `+` add-all dropdown. |
| `js/deeplink.js` | URL param encode/decode; loads deep-linked track with filters. |
| `js/cache.js` | Two-tier cache: in-memory blob URLs + Cache API. |
| `js/refine.js` | Builds folder/artist/format filter panels from active file subset. |
| `js/selection.js` | Checkbox selection state; bulk all/none/restore cycle; persistence. Shows global playlist-remove button (`#btn-pl-del`) when selection contains user-playlist tracks. |
| `js/persistence.js` | Saves/restores filter context, font size, selection across reloads. |
| `js/keyboard.js` | Global hotkeys (Space, ↑↓, seek, /, s, c, z …). |
| `js/utils.js` | Pure helpers: `fmtTime()`, `esc()`, `trackUrl()`, `parseTrackDisplay()`. Badge includes user-playlist membership names appended with ` \| `. |
| `js/prompts.js` | Modal confirms (delete, add, resume prompt, iOS audio resume dialog). |
| `js/remote-search.js` | Modland API calls (paginated; supports text, folder, artist, format, or format-only queries). |
| `js/pinch.js` | Pinch-to-zoom playlist font on mobile. |
| `js/dropdown-keys.js` | Shared dropdown open/close/keyboard logic (`openDropdown`, `closeAllDropdowns`, `registerDropdown`). |
| `js/playlist-manager.js` | IndexedDB CRUD for user playlists. Unique-name validation, CSV import/export, per-folder/playlist visibility (localStorage), system folder registry. |
| `js/playlist-overlay.js` | Playlist Manager overlay UI: create, rename, delete playlists; CSV import/export; visibility panel. Per-track management removed — use per-row X buttons in main list instead. |
| `js/format-panel.js`, `js/folder-panel.js`, `js/artist-panel.js`, `js/range-panel.js` | Dropdown/panel builders. `folder-panel.js` merges default folders and user playlists alphabetically; builds `S._playlistTrackSets`. |
| `js/share-panel.js`, `js/doc-overlay.js` | Share UI, help overlay. |

**Circular imports** between e.g. `filter.js ↔ playlist.js` are intentional and safe — cross-calls only happen inside function bodies, never at module eval time.

---

## Engine system

Engines live in `engines/{id}/engine.js`. Each exports: `init()`, `load(url, entry?)`, `play()`, `pause()`, `seek(sec)`, `setVolume(0-1)`, `onEnd(callback)`, `currentTime`, `duration`.

| Engine ID | Formats | Notes |
|-----------|---------|-------|
| `jssid` | .sid | Pure-JS MOS 6510 + SID emulator. ScriptProcessorNode. |
| `ahx` | .ahx | Abyss' Highest eXperience 4-voice Amiga wavetable. Accepts optional `entry` param so artist/title are derived from `entry.name`, not the blob URL. |
| `mod` | .mod .xm .s3m .it | libopenmpt. **AudioWorklet (chiptune3) on desktop/HTTPS; ScriptProcessorNode (chiptune2) on mobile/HTTP.** Exports `isContextSuspended()` / `attemptContextResume()` for iOS detection. |

Routing: `js/engines.js` `ensureEngine(playerId)` lazy-loads on first `getEngine()`, calls `init()`, sets volume, registers `onEnd`, pauses other engines.

---

## Data files

- **`players.json`** — array of `{ id, label }` for enabled engines.
- **`engines/*/filelist.json`** — local track paths relative to `engines/{id}/files/`.
- **`engines/*/urllists.json`** — object mapping folder → URL array (Modland-style remotes).

---

## User playlists

User-created playlists are stored in **IndexedDB** via `js/playlist-manager.js` and integrated into local mode as follows:

- `app.js` calls `refreshUserPlaylistTracks()` on startup and on every `pm.onChange()` event, populating `S._userPlaylistTracks` (each entry has `source: 'user-playlist'`, `playlistId`, `playlistName`).
- `playlist.js` `rebuildMergedFiles()` enriches every merged entry that matches a user-playlist track with `userPlaylistIds[]` and `userPlaylistNames[]`. Deduplication is key-aware: if a track already exists from a local file list, membership metadata is added to it rather than creating a duplicate row.
- `utils.js` `parseTrackDisplay()` appends membership names to the folder badge (` | playlistName`).
- **Per-row X button** (`.r-pl-del`, red): appears on any row with `userPlaylistIds.length > 0`; removes track from all its playlists.
- **Global X button** (`#btn-pl-del`, red): visible in `#sel-row` when selection contains user-playlist tracks; removes selected tracks from all their playlists with confirmation.
- **Per-item Modland `+` dropdown** (`openAddDropdown`): live checkbox panel for Scratchpad + all user playlists; tracks keyboard navigation via `refreshOpenAddDropdown()`.
- **Global Modland `+` dropdown** (`openAddAllDropdown`): simple single-click panel — "Add X tracks to…" — for Scratchpad + user playlists; adds all `S._lastSearchResults`.

### Playlist-manager key rules
- Names must be unique; `create()` and `rename()` throw `Error` on duplicate.
- Visibility (show/hide in folder panel and merged list) is stored in `localStorage` per `hiddenListKeyForPlaylist(id)` / `hiddenListKeyForFolder(folder)`.
- System folders (e.g. `unknown`) are opt-in visible via `setSystemFolderVisible()`.
- `buildTrackSet(tracks)` → `Set<key>` used by `S._playlistTrackSets` for O(1) membership checks in filter.

---

## Critical constraints

### iOS Safari AudioContext (see also `.github/instructions/ios-audio.instructions.md`)
- iOS only grants `AudioContext.resume()` inside an active **user activation window** (tap/click call stack). Any async I/O (including `fetch()` from a dynamic `import()` cache miss) ends that window.
- **Rule**: `js/engines.js` **must** pre-warm all engine imports at startup via a top-level `Promise.all` fire-and-forget. Never remove this.
- **Rule**: Auto-resume on reload is desktop-only. Mobile always shows `showResumePrompt()` (a modal tap = user gesture).
- **Rule**: `isMobile()` check in `engines/mod/engine.js` must skip AudioWorklet (chiptune3) on mobile.

### No framework, no build step
- Serve `index.html` directly. No npm run, no bundler, no transpilation.
- External CDN deps: jszip (ZIP download), marked (help overlay markdown).

### Track display parsing
`utils.parseTrackDisplay()` splits filenames into artist/title/folder badge:
- All engines: split on ` – ` (en-dash) or ` - ` (hyphen) → artist from filename prefix, folder badge from path prefix.
- No dash: folder prefix becomes artist, folder badge is empty.
- User-playlist membership names are appended to the folder badge with ` | `.

### Selection cycle
Bulk checkbox cycles: **restore previous** → **all** → **none** → **restore** …

### Local mode list filtering
In local mode, `filter.js` `applyFilter()` always applies list scope (folders + user playlists) as the base dataset, even when nothing is explicitly selected (zero visible lists → zero visible rows). `filter.js` and `refine.js` both use `S._playlistTrackSets` for O(1) playlist membership lookups.

---

## Scripts (no build required for app)

| Script | Purpose |
|--------|---------|
| `scripts/generate-filelist.sh` | Regenerates `filelist.json` from `engines/*/files/`. |
| `scripts/sort-urllists.py` | Sorts `urllists.json` entries. |
| `scripts/extract-ui-elements.mjs` | Playwright tool: screenshots + dumps UI elements to `doc/elements.json`. Needs `npm install` in `scripts/`. |
| `scripts/build-modland-index.sh` | Builds remote-search index. |
| `engines/*/sid-compat-scan/` | Scans SID files for compatibility checks. |
