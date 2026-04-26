// js/prompts.js — Modal confirm overlays + resume toast
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

export function showResumePrompt(trackName, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML =
    `<div class="confirm-box">` +
    `<div class="confirm-msg">Resume playback?<br><span class="confirm-detail">${esc(trackName)}</span></div>` +
    `<div class="confirm-auto-opt">` +
    `<label><input type="checkbox" id="auto-resume-cb"> Always resume automatically</label>` +
    `</div>` +
    `<div class="confirm-btns">` +
    `<button class="confirm-yes">&#9654; Resume</button>` +
    `<button class="confirm-no">Cancel</button>` +
    `</div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.confirm-yes').addEventListener('click', () => {
    if (overlay.querySelector('#auto-resume-cb').checked) {
      localStorage.setItem('auto-resume', '1');
    }
    overlay.remove();
    onConfirm();
  });
  overlay.querySelector('.confirm-no').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

export function showResumeToast(trackName, onResume) {
  const toast = document.createElement('div');
  toast.className = 'resume-toast';
  toast.innerHTML =
    `<span>&#9654; Tap to resume <em>${esc(trackName)}</em></span>` +
    `<button class="resume-toast-close" title="Turn off auto-resume">&times;</button>`;
  document.body.appendChild(toast);

  const dismiss = () => { clearTimeout(timer); toast.remove(); };

  // Fire resume on the first tap anywhere so AudioContext.resume() is called
  // inside a real user gesture on iOS Safari (activation window constraint).
  const closeBtn = toast.querySelector('.resume-toast-close');

  const gestureEvents = ['pointerdown', 'touchstart', 'keydown'];
  const onGesture = (e) => {
    // If the user tapped the × button, let its own click handler do the cleanup.
    if (e.target === closeBtn || closeBtn.contains(e.target)) return;
    gestureEvents.forEach(t => document.removeEventListener(t, onGesture, true));
    dismiss();
    onResume?.();
  };
  gestureEvents.forEach(t => document.addEventListener(t, onGesture, { capture: true, passive: true }));

  const timer = setTimeout(() => {
    gestureEvents.forEach(t => document.removeEventListener(t, onGesture, true));
    toast.remove();
  }, 8000);

  closeBtn.addEventListener('click', () => {
    gestureEvents.forEach(t => document.removeEventListener(t, onGesture, true));
    dismiss();
    localStorage.removeItem('auto-resume');
  });
}
