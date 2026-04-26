# Retro Tracker Players

A single-page browser-based chiptune player covering the golden age of demoscene music — from C64 SID chips to Amiga tracker modules. No installs, no plugins, no nonsense. Just open a browser and press play.

Demo: [Retro Tracker Players](https://mike-seger.github.io/retro-tracker-players/)

## Quick Start

From this directory, start a local web server:

```bash
cd retro-tracker-players
python3 -m http.server 8080
```

Then open [localhost:8080](http://localhost:8080/) in your browser. All engines and tracks are available from that single page.

## Engines

The unified player loads three engines on demand:

| Engine | Format | Description |
|--------|--------|-------------|
| **jsSID** | .sid | Pure-JS MOS 6510 CPU + SID chip emulator — three-voice synthesis, ring modulation, filters |
| **AHX** | .ahx | Abyss' Highest eXperience — four-voice Amiga wavetable synthesizer |
| **MOD** | .mod .xm .s3m .it | Classic tracker formats via libopenmpt |

## Features

- **Unified playlist** — all tracks from every engine merged into one alphabetically sorted list
- **Format filter** — multi-select dropdown to show only specific formats
- **Modland search** — switch to Modland mode to search and stream from the full Modland catalog
- **Instant playback** — click any track, or press Space
- **Searchable playlist** — filter tracks by name, artist, or filename
- **Refine dropdowns** — narrow results by folder, artist, and result range
- **Track selection** — checkbox-select individual tracks; bulk checkbox cycles all / none / restore
- **Copy to clipboard** — export selected track URLs as a newline-separated list
- **ZIP download** — download selected tracks as a `.zip` archive
- **Share / deep link** — the **S** button generates a URL encoding the current track and filter state
- **Auto-advance** — plays through the visible list continuously
- **Resume on reload** — offers to resume the last playing track with optional auto-resume
- **Keyboard-driven** — full control without touching the mouse
- **Touch gestures** — pinch to resize playlist font, swipe for prev/next
- **Installable PWA** — add to home screen on mobile for an app-like experience

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `↑` | Previous track |
| `↓` | Next track |
| `←` | Seek backward 5 seconds |
| `→` | Seek forward 5 seconds |
| `Enter` | Play focused track |
| `Shift+Enter` | Toggle selection on focused track |
| `/` | Focus the search/filter box |
| `Esc` | Blur search box / close help |

## Selection & Export

The selection toolbar sits above the playlist:

1. Click the checkbox next to any track to select it
2. Use **Enter** / **Shift+Enter** to play or toggle selection on the focused track
3. The **bulk checkbox** cycles through all → none → restore previous selection
4. **C** copies selected track URLs to the clipboard as a newline-separated list
5. **Z** downloads selected tracks as a `.zip` archive (remote tracks include a `urllist.json`)

## Modland Mode

Switch the source selector to **modland** to search the full Modland catalog (index loaded once per session):

- Type at least 2 characters to search, or pick a folder
- **+** on a result saves it to your personal Modland list
- **Add all** saves all current search results to your list
- **Random** browses a random shuffled slice of the index
- **Del all** removes visible tracks from your list (with confirmation)
- Double-tap or long-press a track to search Modland for that artist

## Deep Links

The **S** (Share) button generates a URL encoding the current track and filter state. All parameters are optional and can be combined freely.

| Parameter | Description | Example |
|-----------|-------------|---------|
| `play` | URL of the track to load | `play=engines/mod/files/trance/dct2%20-%20SP-TIME.IT` |
| `source` | Pre-select source mode (`local` or `modland`) | `source=modland` |
| `folder` | Pre-select the Folder dropdown | `folder=trance` |
| `artist` | Pre-select the Artist dropdown | `artist=dct2` |
| `search` | Pre-fill the search/filter input | `search=trance` |

### Examples

Open a specific track with its folder and artist pre-filtered:
```
index.html?play=engines/mod/files/trance/dct2%20-%20SP-TIME.IT&folder=trance&artist=dct2
```

Open in Modland mode with a pre-filled search:
```
index.html?source=modland&search=purple motion
```

## Help

Press **?** in the toolbar (or see [doc/index.html](doc/index.html)) for the in-app help overlay.

## Tech

- **Zero dependencies at runtime** — no npm, no bundler, no framework
- **Vanilla JS ES modules** — source split across `js/` for maintainability; no build step
- **Web Audio API** — one AudioContext shared across all engines
- **Lazy engine loading** — each engine is imported only when its first track plays
- **Track cache** — fetched files are stored in the Cache API and served as blob URLs on repeat plays
- **Fully offline** — serve locally, no internet required after initial setup (except Modland search)
- **Modular engines** — each format lives under `engines/<id>/engine.js`; add a new format by dropping in an `engine.js` and `filelist.json`

## Links
- [ModTube * Modland Webplayer & Research Tools](https://modtu.be/)
- [PlayMOD online player for various chiptune collections](https://www.wothke.ch/playmod/index.php)
- [Bassoon Fasttracker 2 Editor](https://www.stef.be/bassoontracker/)