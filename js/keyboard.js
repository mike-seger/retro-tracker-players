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

function getActiveRow() {
  const idx = S.focusedIdx >= 0 ? S.focusedIdx : S.currentIdx;
  if (idx < 0) return null;
  const list = document.getElementById('playlist');
  return list?.children?.[idx] || null;
}

function isAddKey(e) {
  return e.key === '+' || e.code === 'NumpadAdd' || (e.code === 'Equal' && e.shiftKey);
}

function isDelKey(e) {
  return e.key === '-' || e.key === '_' || e.key === 'Subtract' || e.key === '−' || e.key === '–' ||
    e.code === 'NumpadSubtract' || e.code === 'Minus';
}

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

  if (isAddKey(e)) {
    e.preventDefault();
    elMlAddAll.click();
    return;
  }

  if (isDelKey(e)) {
    e.preventDefault();
    elMlDelAll.click();
    return;
  }

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
      // In Modland search results, Enter mirrors the row [+] button.
      if (S._inSearchResults) {
        const addBtn = getActiveRow()?.querySelector('.r-add');
        if (addBtn) {
          e.preventDefault();
          addBtn.click();
          break;
        }
      }

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

    case 'Backspace':
    case 'Delete': {
      // In Modland list rows, Backspace mirrors the row [X] remove button.
      const delBtn = getActiveRow()?.querySelector('.r-del');
      if (delBtn) {
        e.preventDefault();
        delBtn.click();
      }
      break;
    }

    case 's': btnShare.click(); break;
    case 'c': btnCopy?.click(); break;
    case 'z': btnZip?.click(); break;
    case 'r': if (elMlRandom.offsetParent !== null) elMlRandom.click(); break;
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
