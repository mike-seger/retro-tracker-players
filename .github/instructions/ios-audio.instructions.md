---
description: "Use when editing engine files, audio initialization, dynamic imports, or the player/engines modules. Covers the iOS Safari AudioContext user-activation constraint that broke chiptune playback after modularization."
applyTo: ["engines/**", "js/engines.js", "js/player.js"]
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

### 4. If adding a new engine
- Add its `import()` to the pre-warm block in `js/engines.js`.
- If it uses an AudioWorklet loaded from a CDN, add an `isMobile()` guard to skip that
  path and fall back to a ScriptProcessorNode implementation.
