// js/engines.js — Lazy engine loading + management
import { S, FIXED_VOLUME, SID_TRACK_PLAYER_ID, SID_ENGINE_PLAYER_ID } from './state.js';

// Set by player.js to break the circular dep at module evaluation time.
let _advanceTrack = null;
export function setAdvanceTrackCallback(fn) { _advanceTrack = fn; }

export async function getEngine(playerId) {
  if (!S.engines[playerId]) {
    const resolvedId = playerId === SID_TRACK_PLAYER_ID ? SID_ENGINE_PLAYER_ID : playerId;
    // Path is relative to this module (js/), so ../engines/ → root engines/
    const mod = await import(`../engines/${resolvedId}/engine.js`);
    await mod.init();
    mod.setVolume(FIXED_VOLUME);
    mod.onEnd(() => _advanceTrack?.());
    if (playerId === SID_TRACK_PLAYER_ID && resolvedId !== playerId) {
      console.log(`[sid] using ${resolvedId} engine`);
    }
    S.engines[playerId] = mod;
  }
  return S.engines[playerId];
}

// Pause all other engines then return (or create) the requested one.
export async function ensureEngine(playerId) {
  for (const [id, eng] of Object.entries(S.engines)) {
    if (id !== playerId) eng.pause();
  }
  S.activeEngine = playerId;
  return getEngine(playerId);
}
