// js/prompts.js — Modal confirm overlays
import { esc } from './utils.js';
import { isAutoplayAudioEnabled, setAppSettings } from './settings.js';

function showConfirm({
  messageHtml,
  yesLabel,
  noLabel = 'Cancel',
  onConfirm,
  onCancel,
  extraHtml = '',
  onReady,
}) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  const hasNo = !!noLabel;
  overlay.innerHTML =
    `<div class="confirm-box" role="dialog" aria-modal="true">` +
    `<div class="confirm-msg">${messageHtml}</div>` +
    extraHtml +
    `<div class="confirm-btns">` +
    `<button class="confirm-yes">${yesLabel}</button>` +
    (hasNo ? `<button class="confirm-no">${noLabel}</button>` : '') +
    `</div></div>`;
  document.body.appendChild(overlay);

  const yesBtn = overlay.querySelector('.confirm-yes');
  const noBtn = overlay.querySelector('.confirm-no');
  const focusables = () => [...overlay.querySelectorAll('input, button')]
    .filter((el) => !el.disabled && el.offsetParent !== null);

  const remove = () => overlay.remove();
  const close = () => {
    remove();
    onCancel?.();
  };
  const confirm = () => {
    remove();
    onConfirm?.();
  };

  yesBtn.addEventListener('click', confirm);
  noBtn?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  onReady?.({ overlay, yesBtn, noBtn, close, confirm });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const f = focusables();
      if (!f.length) return;
      const idx = f.indexOf(document.activeElement);
      if (idx < 0) {
        f[0].focus();
        return;
      }
      const next = e.shiftKey
        ? (idx - 1 + f.length) % f.length
        : (idx + 1) % f.length;
      f[next].focus();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (document.activeElement !== yesBtn && document.activeElement !== noBtn) {
        yesBtn.focus();
      } else if (noBtn) {
        if (document.activeElement === yesBtn) noBtn.focus();
        else yesBtn.focus();
      } else {
        yesBtn.focus();
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
      if (noBtn && document.activeElement === noBtn) close();
      else confirm();
    }
  });

  yesBtn.focus();
}

export function askConfirm({ message, messageHtml, yesLabel = 'OK', noLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    showConfirm({
      messageHtml: messageHtml ?? esc(message ?? ''),
      yesLabel,
      noLabel,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

export function askText({
  message,
  messageHtml,
  initialValue = '',
  placeholder = '',
  yesLabel = 'OK',
  noLabel = 'Cancel',
}) {
  return new Promise((resolve) => {
    let input = null;
    let done = false;
    showConfirm({
      messageHtml: messageHtml ?? esc(message ?? ''),
      yesLabel,
      noLabel,
      onConfirm: () => {
        if (done) return;
        done = true;
        resolve((input?.value || '').trim());
      },
      onCancel: () => {
        if (done) return;
        done = true;
        resolve(null);
      },
      extraHtml:
        `<div class="confirm-input-wrap">` +
        `<input class="confirm-input" type="text" value="${esc(initialValue)}" placeholder="${esc(placeholder)}">` +
        `</div>`,
      onReady: ({ overlay, yesBtn, close, confirm }) => {
        input = overlay.querySelector('.confirm-input');
        const sync = () => {
          const ok = !!input.value.trim();
          yesBtn.disabled = !ok;
        };
        const submit = () => {
          if (yesBtn.disabled) return;
          confirm();
        };
        input.addEventListener('input', sync);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        });
        sync();
        input.focus();
        input.select();
      },
    });
  });
}

export function showInfo({ message, messageHtml, okLabel = 'OK' }) {
  showConfirm({
    messageHtml: messageHtml ?? esc(message ?? ''),
    yesLabel: okLabel,
    noLabel: null,
  });
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
  showConfirm({
    messageHtml: `Start linked track?<br><span class="confirm-detail">${esc(trackName)}</span>`,
    yesLabel: 'Play',
    onConfirm,
  });
}

export function showResumePrompt(trackName, onConfirm, showAutoOption = false) {
  let autoResumeCb = null;
  showConfirm({
    messageHtml: 'Resume playback?',
    yesLabel: '&#9654; Resume',
    extraHtml: showAutoOption
      ? `<div class="confirm-auto-opt"><label><input type="checkbox" id="auto-resume-cb"> Always resume automatically</label></div>` +
        `<div class="confirm-help">If autoplay is blocked on this device, click Resume once or allow sound/autoplay for this site in your browser settings.</div>`
      : '',
    onReady: ({ overlay }) => {
      autoResumeCb = overlay.querySelector('#auto-resume-cb');
      if (autoResumeCb) autoResumeCb.checked = isAutoplayAudioEnabled();
    },
    onConfirm: () => {
      if (showAutoOption) {
        setAppSettings({ autoplayAudio: !!autoResumeCb?.checked });
        // keep legacy key in sync for older app versions
        if (autoResumeCb?.checked) localStorage.setItem('auto-resume', '1');
        else localStorage.removeItem('auto-resume');
      }
      onConfirm();
    },
  });
}

export function showAudioResumeDialog(onConfirm) {
  showConfirm({
    messageHtml: 'Audio is suspended.<br><span class="confirm-detail">Tap to resume playback.</span>',
    yesLabel: 'Resume Audio',
    onConfirm: () => onConfirm?.(),
  });
}

