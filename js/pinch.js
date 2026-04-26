// js/pinch.js — Pinch-to-zoom font size + swipe for prev/next
import { S, elList, MIN_FONT, MAX_FONT } from './state.js';
import { setPlaylistFontSize, getPlaylistFontSize } from './playlist.js';
import { playPrevNext } from './player.js';

let pinchStartDist  = 0;
let pinchStartSize  = 0;
let swipeStartX     = 0;
let swipeStartY     = 0;
let swipeTracking   = false;

function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

elList.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault(); // prevent iOS native page zoom during pinch
    pinchStartDist = getTouchDist(e.touches);
    pinchStartSize = getPlaylistFontSize();
    swipeTracking  = false;
  } else if (e.touches.length === 1) {
    swipeStartX   = e.touches[0].clientX;
    swipeStartY   = e.touches[0].clientY;
    swipeTracking = true;
  }
}, { passive: false });

elList.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault(); // prevent iOS native page zoom during pinch
    swipeTracking = false;
    const dist = getTouchDist(e.touches);
    if (pinchStartDist === 0) return;
    const ratio   = dist / pinchStartDist;
    const newSize = Math.min(MAX_FONT, Math.max(MIN_FONT, pinchStartSize * ratio));
    setPlaylistFontSize(newSize);
  } else if (swipeTracking && e.touches.length === 1) {
    const dx = e.touches[0].clientX - swipeStartX;
    const dy = e.touches[0].clientY - swipeStartY;
    if (Math.abs(dx) > Math.abs(dy) * 1.5) {
      e.preventDefault(); // block scroll so horizontal swipe reaches touchend
    }
  }
}, { passive: false });

elList.addEventListener('touchend', (e) => {
  if (!swipeTracking || e.changedTouches.length === 0) { swipeTracking = false; return; }
  const dx = e.changedTouches[0].clientX - swipeStartX;
  const dy = e.changedTouches[0].clientY - swipeStartY;
  swipeTracking = false;
  if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    playPrevNext(dx < 0 ? 1 : -1);
  }
}, { passive: true });

elList.addEventListener('touchcancel', () => {
  swipeTracking  = false;
  pinchStartDist = 0;
}, { passive: true });
