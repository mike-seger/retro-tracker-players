// js/keyboard.js — Keyboard shortcuts + share button
import { S, elFilter, elSearchMode, btnShare, btnCopy, btnZip, elMlRandom,
  elRefineFolderBtn, elRefineArtistBtn, elRefineFormatBtn, btnHelp, elFilterClr,
  elMlAddAll, elMlDelAll } from './state.js';
import { scrub, playPrevNext } from './player.js';
import { toggleSelect } from './selection.js';
import { buildDeepLink } from './deeplink.js';
import { showSharePanel } from './share-panel.js';
import { isDropdownOpen } from './dropdown-keys.js';
import { hasOpenConfirm } from './prompts.js';

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

  // Let modal confirms handle Enter/Escape/Tab without player hotkeys interfering.
  if (hasOpenConfirm()) return;

  // Let the open dropdown's own keydown handler take over for navigation keys
  if (isDropdownOpen()) return;

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

    case 's': btnShare.click(); break;
    case 'c': btnCopy?.click(); break;
    case 'z': btnZip?.click(); break;
    case 'r': if (elMlRandom.offsetParent !== null) elMlRandom.click(); break;
    case '+': if (elMlAddAll.offsetParent !== null) elMlAddAll.click(); break;
    case '-': if (elMlDelAll.offsetParent !== null) elMlDelAll.click(); break;
    case 'f': if (!elRefineFolderBtn.hidden) elRefineFolderBtn.click(); break;
    case 'a': if (!elRefineArtistBtn.hidden) elRefineArtistBtn.click(); break;
    case 't': if (!elRefineFormatBtn.hidden) elRefineFormatBtn.click(); break;
    case '?': e.preventDefault(); btnHelp.click(); break;
    case 'x': elFilterClr?.click(); break;
  }
});

// Share button
btnShare.addEventListener('click', () => {
  showSharePanel(btnShare, () => buildDeepLink(true));
});
