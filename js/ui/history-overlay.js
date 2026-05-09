// js/ui/history-overlay.js — Search & Deep Link History overlay
import {
  getHistory, deleteEntry as deleteHistoryEntry, clearHistory,
  getMaxHistory, setMaxHistory,
  getDeepLinkHistory, deleteDeepLinkEntry, clearDeepLinkHistory,
  getMaxDeepLinkHistory, setMaxDeepLinkHistory,
} from '../settings/search-history.js';

let _overlay = null;
let _content = null;

function ensureEls() {
  _overlay = _overlay || document.getElementById('history-overlay');
  _content = _content || document.getElementById('history-content');
  return !!_overlay && !!_content;
}

function formatDate(ts) {
  try {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (_) { return ''; }
}

// ── Search History column ─────────────────────────────

function renderSearchRows(container) {
  container.innerHTML = '';
  const history = getHistory();
  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sh-empty';
    empty.textContent = 'No searches recorded yet.';
    container.appendChild(empty);
    return;
  }
  for (const entry of history) {
    const row = document.createElement('div');
    row.className = 'sh-row';
    row.tabIndex = 0;
    row.title = 'Press Enter to search in Modland';

    const dateEl = document.createElement('span');
    dateEl.className = 'sh-date';
    dateEl.textContent = formatDate(entry.ts);

    const termEl = document.createElement('span');
    termEl.className = 'sh-term';
    termEl.textContent = entry.term;

    const countEl = document.createElement('span');
    countEl.className = 'sh-count';
    countEl.textContent = entry.count != null ? String(entry.count) : '';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'sh-del';
    delBtn.textContent = '×';
    delBtn.title = 'Delete this entry';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteHistoryEntry(entry.ts);
      renderSearchRows(container);
    });

    const runSearch = () => {
      closeHistoryOverlay();
      Promise.all([
        import('../browse/modland.js'),
        import('../core/mode.js'),
        import('../core/state.js'),
      ]).then(([m, mode, { S, elFilter: ef }]) => {
        if (S.searchMode !== 'modland') mode.switchMode('modland');
        ef.value = entry.term;
        m.doModlandSearch();
      });
    };
    row.addEventListener('click', runSearch);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
    });

    row.append(dateEl, termEl, countEl, delBtn);
    container.appendChild(row);
  }
}

function buildSearchColumn() {
  const col = document.createElement('div');
  col.className = 'hist-col';

  const hdrRow = document.createElement('div');
  hdrRow.className = 'settings-row';
  const hdrLabelWrap = document.createElement('div');
  const hdrLabel = document.createElement('div');
  hdrLabel.className = 'settings-label';
  hdrLabel.textContent = 'Search History';
  const hdrHint = document.createElement('div');
  hdrHint.className = 'settings-hint';
  hdrHint.textContent = 'Modland searches (≥3 chars, <5000 results). Press Enter on a row to re-run it.';
  hdrLabelWrap.append(hdrLabel, hdrHint);

  const hdrControls = document.createElement('div');
  hdrControls.className = 'sh-hdr-controls';

  const maxLabel = document.createElement('label');
  maxLabel.className = 'sh-max-label';
  maxLabel.textContent = 'Max:';
  const maxInput = document.createElement('input');
  maxInput.className = 'settings-input sh-max-input';
  maxInput.type = 'number';
  maxInput.min = '1';
  maxInput.max = '10000';
  maxInput.step = '1';
  maxInput.value = String(getMaxHistory());
  maxInput.title = 'Maximum number of history entries to keep';
  const commitMax = () => {
    const n = Math.max(1, Math.min(10000, parseInt(maxInput.value, 10) || 100));
    maxInput.value = String(n);
    setMaxHistory(n);
    renderSearchRows(rowsContainer);
  };
  maxInput.addEventListener('blur', commitMax);
  maxInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); maxInput.blur(); } });
  maxLabel.appendChild(maxInput);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'settings-btn';
  clearBtn.textContent = 'Clear all';
  clearBtn.addEventListener('click', () => {
    clearHistory();
    renderSearchRows(rowsContainer);
  });

  hdrControls.append(maxLabel, clearBtn);
  hdrRow.append(hdrLabelWrap, hdrControls);
  col.appendChild(hdrRow);

  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'sh-rows hist-col-rows';
  renderSearchRows(rowsContainer);
  col.appendChild(rowsContainer);

  return col;
}

// ── Deep Link History column ──────────────────────────

function renderDeepLinkRows(container) {
  container.innerHTML = '';
  const history = getDeepLinkHistory();
  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sh-empty';
    empty.textContent = 'No links shared yet.';
    container.appendChild(empty);
    return;
  }
  for (const entry of history) {
    const row = document.createElement('div');
    row.className = 'sh-row dl-hist-row';
    row.tabIndex = 0;
    row.title = entry.url;

    const dateEl = document.createElement('span');
    dateEl.className = 'sh-date';
    dateEl.textContent = formatDate(entry.ts);

    const labelEl = document.createElement('span');
    labelEl.className = 'sh-term';
    labelEl.textContent = entry.label || entry.url;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'sh-copy';
    copyBtn.textContent = 'C';
    copyBtn.title = 'Copy link to clipboard';
    copyBtn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(entry.url).catch(() => {});
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'sh-del';
    delBtn.textContent = '×';
    delBtn.title = 'Delete this entry';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      deleteDeepLinkEntry(entry.ts);
      renderDeepLinkRows(container);
    });

    const open = () => window.open(entry.url, '_blank');
    row.addEventListener('click', open);
    row.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); open(); } });

    row.append(dateEl, labelEl, copyBtn, delBtn);
    container.appendChild(row);
  }
}

function buildDeepLinkColumn() {
  const col = document.createElement('div');
  col.className = 'hist-col';

  const hdrRow = document.createElement('div');
  hdrRow.className = 'settings-row';
  const hdrLabelWrap = document.createElement('div');
  const hdrLabel = document.createElement('div');
  hdrLabel.className = 'settings-label';
  hdrLabel.textContent = 'Deep Link History';
  const hdrHint = document.createElement('div');
  hdrHint.className = 'settings-hint';
  hdrHint.textContent = 'Links shared via the S button. Click a row to open it in a new tab.';
  hdrLabelWrap.append(hdrLabel, hdrHint);

  const hdrControls = document.createElement('div');
  hdrControls.className = 'sh-hdr-controls';

  const maxLabel = document.createElement('label');
  maxLabel.className = 'sh-max-label';
  maxLabel.textContent = 'Max:';
  const maxInput = document.createElement('input');
  maxInput.className = 'settings-input sh-max-input';
  maxInput.type = 'number';
  maxInput.min = '1';
  maxInput.max = '10000';
  maxInput.step = '1';
  maxInput.value = String(getMaxDeepLinkHistory());
  const commitMax = () => {
    const n = Math.max(1, Math.min(10000, parseInt(maxInput.value, 10) || 50));
    maxInput.value = String(n);
    setMaxDeepLinkHistory(n);
    renderDeepLinkRows(rowsContainer);
  };
  maxInput.addEventListener('blur', commitMax);
  maxInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); maxInput.blur(); } });
  maxLabel.appendChild(maxInput);

  const copyAllBtn = document.createElement('button');
  copyAllBtn.type = 'button';
  copyAllBtn.className = 'settings-btn';
  copyAllBtn.textContent = 'Copy All';
  copyAllBtn.title = 'Copy all links to clipboard';
  copyAllBtn.addEventListener('click', () => {
    const urls = getDeepLinkHistory().map(e => e.url).join('\n');
    if (urls) navigator.clipboard.writeText(urls).catch(() => {});
  });

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'settings-btn';
  clearBtn.textContent = 'Clear all';
  clearBtn.addEventListener('click', () => {
    clearDeepLinkHistory();
    renderDeepLinkRows(rowsContainer);
  });

  hdrControls.append(maxLabel, copyAllBtn, clearBtn);
  hdrRow.append(hdrLabelWrap, hdrControls);
  col.appendChild(hdrRow);

  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'sh-rows hist-col-rows';
  renderDeepLinkRows(rowsContainer);
  col.appendChild(rowsContainer);

  return col;
}

// ── render ────────────────────────────────────────────

function render() {
  if (!ensureEls()) return;
  _content.innerHTML = '';
  _content.appendChild(buildSearchColumn());
  _content.appendChild(buildDeepLinkColumn());
}

// ── keyboard ──────────────────────────────────────────

function onKey(e) {
  if (e.key !== 'Escape') return;
  if (_overlay?.hidden) return;
  e.preventDefault();
  closeHistoryOverlay();
}

// ── public API ────────────────────────────────────────

export function openHistoryOverlay() {
  if (!ensureEls()) return;
  render();
  _overlay.hidden = false;
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => _overlay?.focus());
}

export function closeHistoryOverlay() {
  if (!ensureEls()) return;
  _overlay.hidden = true;
  document.removeEventListener('keydown', onKey);
}
