// js/prompts.js — Modal confirm overlays
import { esc } from './utils.js';

function showConfirm({ messageHtml, yesLabel, noLabel = 'Cancel', onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML =
    `<div class="confirm-box" role="dialog" aria-modal="true">` +
    `<div class="confirm-msg">${messageHtml}</div>` +
    `<div class="confirm-btns">` +
    `<button class="confirm-yes">${yesLabel}</button>` +
    `<button class="confirm-no">${noLabel}</button>` +
    `</div></div>`;
  document.body.appendChild(overlay);

  const yesBtn = overlay.querySelector('.confirm-yes');
  const noBtn = overlay.querySelector('.confirm-no');

  const close = () => overlay.remove();
  const confirm = () => {
    close();
    onConfirm?.();
  };

  yesBtn.addEventListener('click', confirm);
  noBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (document.activeElement !== yesBtn && document.activeElement !== noBtn) {
        yesBtn.focus();
      } else if (e.shiftKey) {
        if (document.activeElement === yesBtn) noBtn.focus();
        else yesBtn.focus();
      } else {
        if (document.activeElement === yesBtn) noBtn.focus();
        else yesBtn.focus();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (document.activeElement === noBtn) close();
      else confirm();
    }
  });

  yesBtn.focus();
}

export function hasOpenConfirm() {
  return document.querySelector('.confirm-overlay') !== null;
}

export function showDeleteConfirm(count, onConfirm) {
  showConfirm({
    messageHtml: `Delete ${count} track${count !== 1 ? 's' : ''}?`,
    yesLabel: 'Delete',
    onConfirm,
  });
}

export function showAddConfirm(count, onConfirm) {
  showConfirm({
    messageHtml: `Add ${count} track${count !== 1 ? 's' : ''} to your list?`,
    yesLabel: 'Add',
    onConfirm,
  });
}

export function showDeepLinkPrompt(trackName, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML =
    `<div class="confirm-box">` +
    `<div class="confirm-msg">Start linked track?<br><span class="confirm-detail">${esc(trackName)}</span></div>` +
    `<div class="confirm-btns">` +
    `<button class="confirm-yes">Play</button>` +
    `<button class="confirm-no">Cancel</button>` +
    `</div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.confirm-yes').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
  overlay.querySelector('.confirm-no').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

export function showResumePrompt(trackName, onConfirm, showAutoOption = false) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML =
    `<div class="confirm-box">` +
    `<div class="confirm-msg">Resume playback?<br><span class="confirm-detail">${esc(trackName)}</span></div>` +
    (showAutoOption
      ? `<div class="confirm-auto-opt"><label><input type="checkbox" id="auto-resume-cb"> Always resume automatically</label></div>`
      : '') +
    `<div class="confirm-btns">` +
    `<button class="confirm-yes">&#9654; Resume</button>` +
    `<button class="confirm-no">Cancel</button>` +
    `</div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.confirm-yes').addEventListener('click', () => {
    if (showAutoOption && overlay.querySelector('#auto-resume-cb').checked) {
      localStorage.setItem('auto-resume', '1');
    }
    overlay.remove();
    onConfirm();
  });
  overlay.querySelector('.confirm-no').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}


