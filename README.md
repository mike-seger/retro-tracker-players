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

Use the format toggle checkboxes in the toolbar to show or hide each engine's tracks. Your toggle state is saved across sessions.

## Features

- **Unified playlist** — all tracks from every engine merged into one alphabetically sorted list
- **Format toggles** — show/hide AHX, SID, or MOD tracks independently
- **Instant playback** — click any track, or just press Space
- **Searchable playlist** — type to filter tracks by name, artist, or filename
- **Scrubbing** — jump forward or backward within a track
- **Track selection** — checkbox-select individual tracks or toggle all with the bulk checkbox
- **Copy to clipboard** — export selected filenames for playlists or archiving
- **Auto-advance** — plays through the catalog continuously
- **Keyboard-driven** — full control without touching the mouse
- **Installable PWA** — add to home screen on mobile for an app-like experience

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `Up` | Previous track |
| `Down` | Next track |
| `Left` | Scrub backward 10 seconds |
| `Right` | Scrub forward 10 seconds |
| `Enter` | Toggle selection checkbox on focused track |
| `/` | Focus the search/filter box |

## Selection & Export

The selection toolbar sits above the playlist:

1. Click the checkbox next to any track to select it
2. Use **Enter** to toggle selection on the currently focused track
3. The **bulk checkbox** cycles through all → none → restore previous selection
4. **Copy** exports selected filenames to the clipboard as a newline-separated list

The selection count updates in real time.

## Tech

- **Zero dependencies at runtime** — no npm, no bundler, no framework
- **Vanilla JS + Web Audio API** — runs in any modern browser
- **Lazy engine loading** — each engine is imported only when its first track plays
- **Fully offline** — serve locally, no internet required after initial setup
- **Modular** — engines live under `engines/`; add a new format by dropping in an `engine.js` and `filelist.json`

## Deep Links

You can link directly to a specific track or pre-configure the UI state via URL parameters. All parameters are optional and can be combined freely.

| Parameter | Description | Example |
|-----------|-------------|---------|
| `play` | URL of the track to load (local path or absolute URL) | `play=engines/mod/files/trance/dct2%20-%20SP-TIME.IT` |
| `source` | Pre-select the source mode (`local` or `modland`) | `source=modland` |
| `folder` | Pre-select the Folder dropdown | `folder=trance` |
| `artist` | Pre-select the Artist dropdown | `artist=dct2` |
| `search` | Pre-fill the search/filter input | `search=trance` |

### Examples

Open a specific track and filter the list to its folder and artist:
```
index.html?play=engines/mod/files/trance/dct2%20-%20SP-TIME.IT&folder=trance&artist=dct2
```

Open in Modland mode with a pre-filled search:
```
index.html?source=modland&search=purple motion
```

Browse locally with only the trance folder visible:
```
index.html?folder=trance
```

## Links
- [ModTube * Modland Webplayer & Research Tools](https://modtu.be/)
- [PlayMOD online player for various chiptune collections](https://www.wothke.ch/playmod/index.php)
- [Bassoon Fasttracker 2 Editor](https://www.stef.be/bassoontracker/)