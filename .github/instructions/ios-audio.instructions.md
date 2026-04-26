---
description: "Use when editing engine files, audio initialization, dynamic imports, resume/autoplay logic, or the player/engines/prompts modules. Covers the iOS Safari AudioContext user-activation constraint that broke chiptune playback and auto-resume after modularization."
applyTo: ["engines/**", "js/engines.js", "js/player.js", "js/prompts.js", "js/app.js"]
---
# iOS Safari AudioContext – Hard Constraints

## The Problem (commit ff4b7d9)

iOS Safari grants `AudioContext.resume()` only inside an active **user activation window**
(the call stack started by a tap/click). Any async I/O — including a `fetch()` triggered by
a dynamic `import()` cache miss — terminates that window. After modularization, engine
modules were loaded lazily on first play. On a fresh visit the `import('../engines/mod/engine.js')`
triggered a network fetch, by which time `resumeContext()` was called outside the activation
window and silently failed, so audio never played.

## Rules

### 1. Pre-warm ALL engine modules at startup (do NOT remove)
`js/engines.js` runs a fire-and-forget `Promise.all` of all engine imports at module
evaluation time, long before any user gesture. This ensures the browser's module registry
has them cached so the first play's `import()` is a sync microtask, not a network fetch.

```js
// js/engines.js — top of file, MUST stay
Promise.all([
  import('../engines/mod/engine.js'),
  import('../engines/ahx/engine.js'),
  import('../engines/jssid/engine.js'),
  import('../engines/websid/engine.js'),
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

### 4. Never auto-play or auto-resume audio at startup without a gesture — iOS only
Calling `loadAndPlay()` (or any function that leads to `AudioContext.resume()`) from the
app init IIFE, a `DOMContentLoaded` handler, or any startup path that has no user gesture
will silently fail on iOS.

**Desktop** has no such restriction. The `auto-resume` localStorage flag is honoured
directly on desktop: if set, `doResume()` is called at startup without a prompt.

**iOS** must always defer to a user gesture. The fix (`js/app.js`, `js/prompts.js`) detects
iOS and always shows `showResumePrompt` (a modal click = user gesture). The "Always resume
automatically" checkbox is hidden on iOS because it cannot work there.

```js
// js/app.js — resume branch pattern
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
if (!isIOS && localStorage.getItem('auto-resume') === '1') {
  doResume();          // desktop: fine to call directly
} else {
  showResumePrompt(label, doResume, /* showAutoOption */ !isIOS);
}
```

Emergency escape hatch: `?clear-resume` in the URL removes the `auto-resume` flag
(handled at the top of `init()` in `js/app.js`).

**Never** show a toast that defers resume to an arbitrary next tap — the user can't tell
which tap will trigger it, and capturing all `pointerdown` events causes accidental
side-effects (e.g. a tap on an unrelated button also starting audio).

### 5. If adding a new engine
- Add its `import()` to the pre-warm block in `js/engines.js`.
- If it uses an AudioWorklet loaded from a CDN, add an `isMobile()` guard to skip that
  path and fall back to a ScriptProcessorNode implementation.
