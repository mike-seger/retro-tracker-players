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

### 4. Never auto-play or auto-resume audio at startup without a gesture
Calling `loadAndPlay()` (or any function that leads to `AudioContext.resume()`) from the
app init IIFE, a `DOMContentLoaded` handler, or any startup path that has no user gesture
will silently fail on iOS.

The auto-resume feature (`localStorage.getItem('auto-resume') === '1'`) was broken this way.
The fix (`js/prompts.js` `showResumeToast`, commit `60f1d0a`) defers the resume callback
until the **first user gesture** via a one-shot capture-phase listener:

```js
// js/prompts.js — pattern to use whenever audio must start at startup
const gestureEvents = ['pointerdown', 'touchstart', 'keydown'];
const onGesture = () => {
  gestureEvents.forEach(t => document.removeEventListener(t, onGesture, true));
  doResume(); // ← AudioContext.resume() now happens inside a real gesture
};
gestureEvents.forEach(t =>
  document.addEventListener(t, onGesture, { capture: true, once: true, passive: true })
);
```

Show a visible prompt/toast so the user knows to tap. **Never call `loadAndPlay()` or
`AudioContext.resume()` from startup code directly**, even if "auto" behaviour is intended.

### 5. If adding a new engine
- Add its `import()` to the pre-warm block in `js/engines.js`.
- If it uses an AudioWorklet loaded from a CDN, add an `isMobile()` guard to skip that
  path and fall back to a ScriptProcessorNode implementation.
