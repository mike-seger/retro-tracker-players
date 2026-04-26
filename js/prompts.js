// js/prompts.js — Modal confirm overlays
import { esc } from './utils.js';

export function showDeleteConfirm(count, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML =
    `<div class="confirm-box">` +
    `<div class="confirm-msg">Delete ${count} track${count !== 1 ? 's' : ''}?</div>` +
    `<div class="confirm-btns">` +
    `<button class="confirm-yes">Delete</button>` +
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


