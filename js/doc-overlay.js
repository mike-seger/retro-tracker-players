// js/doc-overlay.js — Help overlay with lazy-fetched + rendered README
import { btnHelp } from './state.js';

let _helpCache = null;

const overlay  = document.getElementById('help-overlay');
const closeBtn = document.getElementById('help-close');
const content  = document.getElementById('help-content');

function showHelp() {
  if (!overlay) return;
  overlay.hidden = false;
  btnHelp.classList.add('active');
  if (_helpCache !== null) { content.innerHTML = _helpCache; return; }

  content.innerHTML = '<p>Loading…</p>';
  fetch('doc/README.md')
    .then(r => r.ok ? r.text() : Promise.reject(r.status))
    .then(md => {
      // marked is loaded from CDN (window.marked)
      _helpCache = typeof marked !== 'undefined'
        ? marked.parse(md)
        : `<pre>${md.replace(/</g, '&lt;')}</pre>`;
      content.innerHTML = _helpCache;
    })
    .catch(err => {
      content.innerHTML = `<p>Could not load help (${err}).</p>`;
    });
}

function hideHelp() {
  if (!overlay) return;
  overlay.hidden = true;
  btnHelp.classList.remove('active');
}

btnHelp.addEventListener('click', () => {
  if (overlay?.hidden === false) hideHelp(); else showHelp();
});

closeBtn?.addEventListener('click', hideHelp);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !overlay?.hidden) {
    e.preventDefault();
    hideHelp();
  }
});
