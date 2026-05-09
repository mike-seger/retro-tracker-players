# Mini Engine Support Handoff

Date: 2026-05-09 (updated)
Repo: retro-tracker-players

## Goal
Support the Modland mini family in the dedicated `mini` engine and provide a usable filter/listing experience:
- mini2sf
- minigsf
- minipsf / minipsf2
- miniusf
- minissf

## Test URLs
1. mini2sf — https://modland.com/pub/modules/Nintendo%20DS%20Sound%20Format/-%20unknown/1500%20DS%20Spirits%20Vol.%201%20-%20Mahjong/ntr-a8aj-jpn-01h2-majang-qz-0000.mini2sf
2. minipsf — https://modland.com/pub/modules/Playstation%20Sound%20Format/-%20unknown/19ji%2003pun%20-%20Ueno%20Hatsu%20Yakou%20Ressha/19ji%2003pun-0-13.minipsf
3. minigsf — https://modland.com/pub/modules/Gameboy%20Sound%20Format/-%20unknown/Akagi/2335.0010.minigsf

## Current status

| Format    | Decode | Playback | Seek | Notes |
|-----------|--------|----------|------|-------|
| minipsf   | OK     | OK       | OK   | Duration uses `length + fade` from PSF tags |
| minipsf2  | OK     | OK       | OK   | Same backend as minipsf (PSX) |
| minigsf   | OK     | OK       | OK   | Mute-on-fast-forward implemented to avoid sped-up replay |
| miniusf   | Untested | -      | -    | Routed to N64 backend; no regression tests yet |
| minissf   | Untested | -      | -    | Routed to SEGA backend; no regression tests yet |
| mini2sf   | Unsupported | - | -   | No 2sf/vio2sf backend exists in chiptune-collection (Nintendo DS); engine throws clear error |

## Key resolutions

### 1. minipsf sidecar 404s — fixed
Modland's filesystem is case-sensitive but PSF `_lib*` tags often reference uppercase
(`SOUND.DPK_SEP0.psflib`) while the file on disk is lowercase (`sound.dpk_sep0.psflib`).
`preloadMiniLibraries()` now retries every `.psflib` fetch with a lowercased basename on
404/network failure and registers the bytes under both names so the backend's file
callback finds them regardless of which casing it asks for.

### 2. minigsf/minipsf seek "returns to start" — fixed
The Wothke adapters' `seekPlaybackPosition()` calls `ScriptNodePlayer.getInstance().getVolume()`
to mute during the seek. We use our own `ScriptProcessorNode` and never instantiate
`ScriptNodePlayer`, so `getInstance()` returned null and the wrapper threw silently. Fix:
bypass the adapter and invoke wasm exports directly via `Module.ccall`:
- `emu_get_current_position` to detect direction
- `emu_init('/', loadedTrackName)` for backward seeks (both PSX and GSF require a reload before backward seek per the adapter source)
- `emu_seek_position(pos)` to set the target

### 3. minigsf catch-up audio (sped-up replay / frozen last frame) — fixed
GSF emulates audio while fast-forwarding to the seek target. Added `_seekTargetUnits`
tracker. While `emu_get_current_position < target`, the audio callback drains up to 8
backend chunks per frame (advances emulation faster) and emits silence. Once the
backend reaches the target, normal playback resumes.

### 4. End-of-track misdetection after seek — fixed
The audio callback previously interpreted any non-zero `computeAudioSamples()` status
as track-end, which during the post-seek silent-FF window caused `_onEnd → advanceTrack
→ reload-from-zero` (the original "always returns to start" symptom). Now end-of-track
requires: `status > 0` AND ≥ 250 ms of frames produced since seek/load AND backend
position within 1 s of `_duration`. A 1500 ms grace window after each seek further
suppresses spurious end events.

### 5. minipsf duration shown a few seconds short — fixed
PSF spec: track plays for `length` then fades over `fade` seconds. Backend `maxPos`
reflects only `length`. New `parseTagDurations()` reads both; user-facing `_duration`
is now `length + fade`. `_unitsPerSecond` stays based on `length` so seek math matches
the backend's units.

### 6. mini2sf — declared unsupported
Confirmed via Wothke's bitbucket listing of `chiptune-collection/library/JS/`: shipped
backends are adplug, asap, gsf, hes, mdx, mpt, n64, nez, psx, s98, sc68, sega, snes,
tinyrsid, uade, v2m, vgm, xmp, zxtune. There is no 2sf/vio2sf backend. NEZ is
NES/Famicom (8-bit), not Nintendo DS — the previous routing was wrong. The engine
now throws a clear unsupported-format error instead of silently appearing to load.

## Architecture summary (`engines/mini/engine.js`)

- Backend candidates per extension:
  - minipsf, minipsf2 → PSX (`backend_psx.js`, blaster stdlib)
  - minigsf          → GSF (`backend_gsf.js`, library stdlib)
  - miniusf          → N64 (`backend_n64.js`, library stdlib)
  - minissf          → SEGA (`backend_sega.js`, library stdlib)
  - mini2sf          → none (returns explicit unsupported error)
- All backends loaded lazily via `loadScript` with top-level warmup `Promise.all`.
- Sidecar handling:
  - `parsePsfLibRefs()` recursively walks `_lib*` tags.
  - Lowercase-basename fallback on 404 / network error.
  - `registerVfsFile()` writes both original-case and resolved-case paths.
  - `installFileRequestCallback` bridges backend file-by-name requests through
    `window.fileRequestCallback` to the registered VFS aliases.
- Seek (PSX/GSF): direct `Module.ccall` on `emu_get_current_position`,
  `emu_init`, `emu_seek_position`. Backward seek triggers reload-then-FF.
- Fast-forward: `_seekTargetUnits` muting until backend position reaches target.
- End detection: requires status>0 + frames-since-seek + position near duration +
  outside grace window.
- Duration: `length + fade` from PSF tags when present; otherwise `maxPos / unitsPerSecond + fade`.

## Files relevant to mini support
- `engines/mini/engine.js` (all logic)
- `engines/mini/urllists.json`, `engines/mini/filelist.json`
- `engines/shared.js` (extension resolution)
- `js/core/engines.js` (warmup pre-loads mini engine)
- `js/lib/utils.js` (`MINI_FORMAT_EXTS`, `isMiniFormatExt`, `normalizeFormatExt`)
- `js/browse/remote-search.js` (`EXT_TO_PLAYER` mapping)
- `js/browse/modland.js` (forces MINI filter visible)
- `js/playlists/track-row.js` (real ext display)
- `scripts/build-modland-index.sh` (regex includes mini family)
- `players.json` (mini entry)

## Possible follow-ups
1. Test miniusf and minissf on representative Modland tracks and verify the same
   seek/duration fixes work for N64 and SEGA backends (they share the same
   `emu_*` ccall API per Wothke convention; should "just work").
2. Add a regression matrix per mini subtype: load OK, audio starts (RMS > 0 in first
   second), duration sane, seek to 25% and 75% lands within ±1 s and continues
   playing.
3. A real Nintendo DS 2sf backend would need a fresh wasm port (vio2sf or AOSDK);
   out of scope for this engine without upstream additions to chiptune-collection.

## Notes for next person
- Do not call adapter wrappers `seekPlaybackPosition`/`getPlaybackPosition` — they
  depend on `ScriptNodePlayer` which we don't use. Always go via `Module.ccall`.
- Do not interpret a single non-zero `computeAudioSamples` status as track-end;
  the existing gate (frames-since-seek + near-duration + grace) is required.
- Sidecar fetches must tolerate both casings on case-sensitive origins.
