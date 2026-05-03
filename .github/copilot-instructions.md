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
| `js/app.js` | Init IIFE; wires all event handlers; loads `players.json` + filelists. |
| `js/player.js` | `loadAndPlay()`, transport UI, seek, prefetch-ahead (AbortController). |
| `js/engines.js` | Lazy engine loader; pre-warms all imports at startup (see iOS constraint). |
| `js/playlist.js` | Playlist DOM rendering, scroll, file list merge. |
| `js/filter.js` | Text search + refine UI; rebuilds visible rows + format panel. |
| `js/mode.js` | Local ↔ Modland mode switch; saves/restores per-mode filter context. |
| `js/modland.js` | Modland file management, remote search, add/delete, random browse. |
| `js/deeplink.js` | URL param encode/decode; loads deep-linked track with filters. |
| `js/cache.js` | Two-tier cache: in-memory blob URLs + Cache API. |
| `js/refine.js` | Builds folder/artist/format filter panels from active file subset. |
| `js/selection.js` | Checkbox selection state; bulk all/none/restore cycle; persistence. |
| `js/persistence.js` | Saves/restores filter context, font size, selection across reloads. |
| `js/keyboard.js` | Global hotkeys (Space, ↑↓, seek, /, s, c, z …). |
| `js/utils.js` | Pure helpers: `fmtTime()`, `esc()`, `trackUrl()`, `parseTrackDisplay()`. |
| `js/prompts.js` | Modal confirms (delete, add, resume prompt). |
| `js/remote-search.js` | Modland API calls (paginated, supports folder/artist/format). |
| `js/pinch.js` | Pinch-to-zoom playlist font on mobile. |
| `js/format-panel.js`, `js/folder-panel.js`, `js/artist-panel.js`, `js/range-panel.js` | Dropdown/panel builders. |
| `js/share-panel.js`, `js/doc-overlay.js` | Share UI, help overlay. |

**Circular imports** between e.g. `filter.js ↔ playlist.js` are intentional and safe — cross-calls only happen inside function bodies, never at module eval time.

---

## Engine system

Engines live in `engines/{id}/engine.js`. Each exports: `init()`, `load(url)`, `play()`, `pause()`, `seek(sec)`, `setVolume(0-1)`, `onEnd(callback)`, `currentTime`, `duration`.

| Engine ID | Formats | Notes |
|-----------|---------|-------|
| `jssid` | .sid | Pure-JS MOS 6510 + SID emulator. ScriptProcessorNode. |
| `ahx` | .ahx | Abyss' Highest eXperience 4-voice Amiga wavetable. |
| `mod` | .mod .xm .s3m .it | libopenmpt. **AudioWorklet (chiptune3) on desktop/HTTPS; ScriptProcessorNode (chiptune2) on mobile/HTTP.** |

Routing: `js/engines.js` `ensureEngine(playerId)` lazy-loads on first `getEngine()`, calls `init()`, sets volume, registers `onEnd`, pauses other engines.

---

## Data files

- **`players.json`** — array of `{ id, label }` for enabled engines.
- **`engines/*/filelist.json`** — local track paths relative to `engines/{id}/files/`.
- **`engines/*/urllists.json`** — object mapping folder → URL array (Modland-style remotes).

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
`utils.parseTrackDisplay()` splits filenames into artist/title:
- AHX: artist = folder path prefix, title = filename.
- MOD/SID: split on ` – ` (en-dash) or ` - ` (hyphen); else artist = folder prefix.

### Selection cycle
Bulk checkbox cycles: **restore previous** → **all** → **none** → **restore** …

---

## Scripts (no build required for app)

| Script | Purpose |
|--------|---------|
| `scripts/generate-filelist.sh` | Regenerates `filelist.json` from `engines/*/files/`. |
| `scripts/sort-urllists.py` | Sorts `urllists.json` entries. |
| `scripts/extract-ui-elements.mjs` | Playwright tool: screenshots + dumps UI elements to `doc/elements.json`. Needs `npm install` in `scripts/`. |
| `scripts/build-modland-index.sh` | Builds remote-search index. |
| `engines/*/sid-compat-scan/` | Scans SID files for compatibility checks. |
