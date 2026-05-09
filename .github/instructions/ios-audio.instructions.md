---
description: "Use when editing engine files, audio initialization, dynamic imports, resume/autoplay logic, or the player/engines/prompts modules. Covers the iOS Safari AudioContext user-activation constraint that broke chiptune playback and auto-resume after modularization."
applyTo: ["engines/**", "js/core/engines.js", "js/core/player.js", "js/ui/prompts.js", "js/core/app.js"]
---
# iOS Safari AudioContext – Hard Constraints

## Which engine runs where (MOD/XM/S3M/IT)

The MOD engine (`engines/mod/engine.js`) has two implementations:

| Implementation | Mechanism | Used when |
|---|---|---|
| **chiptune3** | `AudioWorklet` + dynamic CDN `import()` | Desktop, HTTPS, non-mobile |
| **chiptune2** | `ScriptProcessorNode` + local/CDN `<script>` tags | **iOS, Android, any HTTP (LAN)** |

**chiptune2 is the correct solution for iOS.** chiptune3 is explicitly blocked on mobile via
`isMobile()` because `context.audioWorklet.addModule(CDN_URL)` is a cross-origin fetch that
breaks the iOS user-activation window and fails on some iOS versions entirely.

Decision flow in `init()`:
```
supportsWorklet()?  ──No (mobile/HTTP)──▶  initV2()  [chiptune2, ScriptProcessorNode]
        │
       Yes (desktop HTTPS)
        │
    initV3()  [chiptune3, AudioWorklet]
        │ (if fails)
        └──────────────────────────────▶  initV2()  [chiptune2, ScriptProcessorNode]
```

chiptune2 loads libopenmpt in priority order from three sources:
1. `engines/mod/vendor/chiptune2/` — local copy (bundled, no network needed)
2. `cdn.jsdelivr.net/gh/deskjet/chiptune2.js@master/` — CDN mirror
3. `raw.githubusercontent.com/deskjet/chiptune2.js/master/` — GitHub raw fallback

---

## The Problem (commit ff4b7d9)

iOS Safari grants `AudioContext.resume()` only inside an active **user activation window**
(the call stack started by a tap/click). Any async I/O — including a `fetch()` triggered by
a dynamic `import()` cache miss — terminates that window. After modularization, engine
modules were loaded lazily on first play. On a fresh visit the `import('../engines/mod/engine.js')`
triggered a network fetch, by which time `resumeContext()` was called outside the activation
window and silently failed, so audio never played.

## Rules

### 1. Pre-warm ALL engine modules at startup (do NOT remove)
`js/core/engines.js` runs a fire-and-forget `Promise.all` of all engine imports at module
evaluation time, long before any user gesture. This ensures the browser's module registry
has them cached so the first play's `import()` is a sync microtask, not a network fetch.

```js
// js/core/engines.js — top of file, MUST stay
Promise.all([
  import('../../engines/mod/engine.js'),
  import('../../engines/mini/engine.js'),
  import('../../engines/ahx/engine.js'),
  import('../../engines/jssid/engine.js'),
  import('../../engines/spc/engine.js'),
  import('../../engines/vgm/engine.js'),
]).catch(() => {});
```

**Never remove or gate this block.** If a new engine is added, add it here too.

### 2. `isMobile()` must bypass chiptune3 (AudioWorklet) on iOS (do NOT remove)
`engines/mod/engine.js` uses `isMobile()` to force the chiptune2 (ScriptProcessorNode)
path on all mobile devices. Chiptune3 uses `context.audioWorklet.addModule(CDN_URL)` — a
cross-origin fetch that also breaks the activation window and fails on some iOS versions.

```js
// engines/mod/engine.js — MUST stay
function isMobile() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}
function supportsWorklet() {
  if (isMobile()) return false;   // ← never remove this guard
  return window.isSecureContext !== false && typeof AudioWorkletNode !== 'undefined';
}
```

### 3. Never create or resume an AudioContext from a setTimeout / outside gesture
`AudioContext` creation and `resume()` must trace back synchronously to a user event handler.
Wrapping them in `setTimeout`, `Promise.then` after a fetch, or module-startup code will
silently fail on iOS.

### 4. Never auto-play or auto-resume audio at startup without a gesture — mobile only
Calling `loadAndPlay()` (or any function that leads to `AudioContext.resume()`) from the
app init IIFE, a `DOMContentLoaded` handler, or any startup path that has no user gesture
will silently fail on **iOS and Android** (both enforce the user-activation constraint).

**Desktop** has no such restriction. The `auto-resume` localStorage flag is honoured
directly on desktop: if set, `doResume()` is called at startup without a prompt.

**iOS and Android** must always defer to a user gesture. The fix (`js/app.js`, `js/prompts.js`) detects
mobile and always shows `showResumePrompt` (a modal click = user gesture). The "Always resume
automatically" checkbox is hidden on mobile because it cannot work there.

```js
// js/app.js — resume branch pattern
const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
if (!isMobile && localStorage.getItem('auto-resume') === '1') {
  doResume();          // desktop: fine to call directly
} else {
  showResumePrompt(label, doResume, /* showAutoOption */ !isMobile);
}
```

Emergency escape hatch: `?clear-resume` in the URL removes the `auto-resume` flag
(handled at the top of `init()` in `js/app.js`).

**Never** show a toast that defers resume to an arbitrary next tap — the user can't tell
which tap will trigger it, and capturing all `pointerdown` events causes accidental
side-effects (e.g. a tap on an unrelated button also starting audio).

### 5. If adding a new engine
- Add its `import()` to the pre-warm block in `js/core/engines.js`.
- If it uses an AudioWorklet loaded from a CDN, add an `isMobile()` guard to skip that
  path and fall back to a ScriptProcessorNode implementation.

### 6. chiptune2 (libopenmpt) — always set `window.libopenmpt`, NOT `window.Module`
`engines/mod/vendor/chiptune2/libopenmpt.js` starts with:
```js
var Module = typeof libopenmpt !== 'undefined' ? libopenmpt : {};
```
It reads its configuration from `window.libopenmpt`, **not** `window.Module`. Setting
`window.Module` before loading the script is silently ignored — the script's own
`var Module = ...` declaration overwrites it at eval time, discarding all callbacks.

`resetV2Globals()` (called before each fallback attempt) deletes both `window.libopenmpt`
and `window.Module` to ensure a clean slate. After that call, always re-set
`window.libopenmpt` (not `window.Module`) before loading the script:

```js
// engines/mod/engine.js — initV2, MUST use window.libopenmpt
resetV2Globals();          // clears both globals
window.libopenmpt = {      // ← libopenmpt.js reads THIS, not window.Module
  locateFile: (path) => base + path,
  onRuntimeInitialized: () => { runtimeReady = true; },
};
await loadScript(base + 'libopenmpt.js');
```

Setting `window.Module` instead causes `onRuntimeInitialized` to never fire,
`runtimeReady` stays `false`, the 200-attempt / 20-second poll times out, and the
engine fails on all three fallback sources — the exact symptom seen on iPhone 12 mini.

This bug was introduced because older Emscripten modules use `window.Module` as the
config object; libopenmpt.js predates that convention and uses `window.libopenmpt`.
