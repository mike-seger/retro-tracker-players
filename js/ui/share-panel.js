// js/share-panel.js — Share panel popup
let _removeOutsideClick = null;

export function showSharePanel(anchor, getDeepLink) {
  const panel = document.getElementById('share-panel');
  if (!panel) return;

  // Clean up any existing outside-click listener
  if (_removeOutsideClick) { _removeOutsideClick(); _removeOutsideClick = null; }

  // Toggle: if already open, close it
  if (!panel.hidden) { panel.hidden = true; return; }

  // Reset button labels in case a previous 'Copied!' was shown
  for (const btn of panel.querySelectorAll('.share-opt')) {
    if (btn.dataset.action === 'copy') btn.textContent = 'Copy deep link';
  }

  panel.hidden = false;

  function closePanel() {
    panel.hidden = true;
    if (_removeOutsideClick) { _removeOutsideClick(); _removeOutsideClick = null; }
  }

  // Register outside-click/touch after current event loop tick so the opening
  // click doesn't immediately fire the outside-click handler
  setTimeout(() => {
    function onOutside(e) {
      if (!panel.contains(e.target) && e.target !== anchor) closePanel();
    }
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('touchstart', onOutside, { capture: true, passive: true });
    _removeOutsideClick = () => {
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('touchstart', onOutside, true);
    };
  }, 0);

  // Replace buttons to drop stale event listeners
  for (const btn of [...panel.querySelectorAll('.share-opt')]) {
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
    fresh.addEventListener('click', async (e) => {
      e.preventDefault();
      const action = fresh.dataset.action;
      const url = getDeepLink();
      if (action === 'copy') {
        try { await navigator.clipboard.writeText(url); } catch (_) {}
        fresh.textContent = 'Copied!';
        setTimeout(closePanel, 900);
      } else if (action === 'twitter') {
        window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}`, '_blank');
        closePanel();
      } else if (action === 'facebook') {
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
        closePanel();
      }
    });
  }
}
