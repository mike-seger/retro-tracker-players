// js/keyboard.js — Keyboard shortcuts + share button
import { S, elFilter, elSearchMode, btnShare } from './state.js';
import { scrub, playPrevNext } from './player.js';
import { toggleSelect } from './selection.js';
import { buildDeepLink } from './deeplink.js';
import { showSharePanel } from './share-panel.js';

document.addEventListener('keydown', (e) => {
  const focused = document.activeElement;
  const inInput = focused && (focused.tagName === 'INPUT' || focused.tagName === 'SELECT' || focused.tagName === 'TEXTAREA' || focused.isContentEditable);

  if (e.key === '/' && !inInput) {
    e.preventDefault();
    elFilter.focus();
    elFilter.select();
    return;
  }

  if (inInput) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      document.getElementById('btn-play')?.click();
      break;

    case 'ArrowRight':
      e.preventDefault();
      scrub(5);
      break;

    case 'ArrowLeft':
      e.preventDefault();
      scrub(-5);
      break;

    case 'ArrowDown':
      e.preventDefault();
      playPrevNext(1);
      break;

    case 'ArrowUp':
      e.preventDefault();
      playPrevNext(-1);
      break;

    case 'Enter': {
      e.preventDefault();
      const idx = S.focusedIdx >= 0 ? S.focusedIdx : S.currentIdx;
      if (idx >= 0) {
        if (e.shiftKey) toggleSelect(idx);
        else {
          import('./player.js').then(m => m.loadAndPlay(idx));
        }
      }
      break;
    }
  }
});

// Share button
btnShare.addEventListener('click', () => {
  showSharePanel(btnShare, () => buildDeepLink(true));
});
