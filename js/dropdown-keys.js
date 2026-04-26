// js/dropdown-keys.js — shared open/close/keyboard-navigation for refine dropdown panels

const _registered = new Map(); // panel -> { btn, saveState, restoreState, lastIdx }

/** Returns true if any registered dropdown is currently open. */
export function isDropdownOpen() {
  for (const [panel] of _registered) if (!panel.hidden) return true;
  return false;
}

/** Close every registered dropdown panel. */
export function closeAllDropdowns() {
  for (const [panel] of _registered) panel.hidden = true;
}

/**
 * Toggle a dropdown open.  Closes all other dropdowns first, saves state for
 * potential Esc undo, then focuses the first navigable item.
 */
export function openDropdown(btn, panel) {
  const wasHidden = panel.hidden;
  // Close all OTHER dropdowns without touching this one
  for (const [p] of _registered) if (p !== panel) p.hidden = true;
  if (wasHidden) {
    const reg = _registered.get(panel);
    reg?.saveState?.();
    if (reg) reg.lastIdx = 0;
    panel.hidden = false;
    // Use setTimeout so the panel is rendered before focus
    setTimeout(() => getNavItems(panel)[0]?.focus(), 0);
  } else {
    panel.hidden = true;
  }
}

/**
 * Register a dropdown panel for keyboard navigation.
 * Call once per panel at module-init time (not on every rebuild).
 *
 * @param {object} opts
 * @param {HTMLElement} opts.btn         – the toggle button
 * @param {HTMLElement} opts.panel       – the dropdown panel
 * @param {Function}   [opts.saveState]    – snapshot current selection
 * @param {Function}   [opts.restoreState] – revert to snapshot and update UI
 */
export function registerDropdown({ btn, panel, saveState, restoreState }) {
  const reg = { btn, saveState, restoreState, lastIdx: 0 };
  _registered.set(panel, reg);

  // Track which item index has focus so we can restore it on re-entry
  panel.addEventListener('focusin', (e) => {
    const items = getNavItems(panel);
    const idx = items.findIndex(item => item === e.target || item.contains(e.target));
    if (idx >= 0) reg.lastIdx = idx;
  });

  // If something outside our control (e.g. applyFilter re-render) steals focus
  // while the panel is still open, pull focus back to the last known item.
  panel.addEventListener('focusout', (e) => {
    if (!panel.hidden && !panel.contains(e.relatedTarget)) {
      setTimeout(() => {
        if (!panel.hidden) getNavItems(panel)[reg.lastIdx]?.focus();
      }, 0);
    }
  });

  panel.addEventListener('keydown', (e) => {
    const items = getNavItems(panel);
    const focused = document.activeElement;
    const rawIdx = items.findIndex(item => item === focused || item.contains(focused));
    const idx = rawIdx >= 0 ? rawIdx : reg.lastIdx;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        items[(idx + 1) % items.length]?.focus();
        break;

      case 'ArrowUp':
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
        break;

      case ' ': {
        e.preventDefault();
        const item = items[idx];
        if (item?.classList.contains('range-opt')) {
          item.click();
        } else {
          const cb = item?.querySelector('input[type="checkbox"]') ??
                     (focused?.type === 'checkbox' ? focused : null);
          if (cb) {
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
            // focusout handler will restore focus if it's lost; no extra setTimeout needed
          }
        }
        break;
      }

      case 'Enter': {
        e.preventDefault();
        const item = items[idx];
        if (item?.classList.contains('range-opt')) {
          item.click();
        } else {
          panel.hidden = true;
        }
        btn.focus();
        break;
      }

      case 'Escape': {
        e.preventDefault();
        restoreState?.();
        panel.hidden = true;
        btn.focus();
        break;
      }
    }
  });
}

function getNavItems(panel) {
  return [...panel.querySelectorAll('.fmt-opt, .range-opt')];
}
