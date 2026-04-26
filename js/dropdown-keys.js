// js/dropdown-keys.js — shared open/close/keyboard-navigation for refine dropdown panels

const _registered = new Map(); // panel -> { btn, saveState, restoreState }

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
  closeAllDropdowns();
  if (wasHidden) {
    _registered.get(panel)?.saveState?.();
    panel.hidden = false;
    getNavItems(panel)[0]?.focus();
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
  _registered.set(panel, { btn, saveState, restoreState });

  panel.addEventListener('keydown', (e) => {
    const items = getNavItems(panel);
    const focused = document.activeElement;
    const idx = items.findIndex(item => item === focused || item.contains(focused));

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
