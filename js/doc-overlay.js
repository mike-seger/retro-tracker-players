// js/doc-overlay.js — Help overlay with lazy-fetched + rendered README
import { btnHelp } from './state.js';

let _helpCache = null;
let _uiMapPopup = null;
let _highlightedEl = null;

const overlay  = document.getElementById('help-overlay');
const closeBtn = document.getElementById('help-close');
const content  = document.getElementById('help-content');

function ensureHighlighterStyle() {
  if (document.getElementById('ui-doc-highlight-style')) return;
  const style = document.createElement('style');
  style.id = 'ui-doc-highlight-style';
  style.textContent = `
    .ui-doc-highlight {
      outline: 2px solid #ff8a3d !important;
      box-shadow: 0 0 0 3px rgba(255,138,61,0.35) !important;
      transition: box-shadow 120ms ease;
    }
    .ui-doc-section {
      margin-top: 10px;
    }
    #help-ui-map-inline-btn {
      border: 1px solid #666;
      border-radius: 4px;
      background: #1f1f1f;
      color: #ddd;
      font-size: 13px;
      padding: 6px 10px;
      cursor: pointer;
    }
    #help-ui-map-inline-btn:hover {
      border-color: #8af;
      color: #fff;
    }
    .ui-doc-table-wrap {
      margin-top: 10px;
      border: 1px solid #2f2f2f;
      border-radius: 6px;
      overflow: auto;
      max-height: 42vh;
    }
    .ui-doc-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .ui-doc-table th,
    .ui-doc-table td {
      border-bottom: 1px solid #262626;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    .ui-doc-table thead th {
      position: sticky;
      top: 0;
      background: #171717;
      z-index: 1;
    }
    .ui-doc-table .num {
      width: 3.5em;
      color: #9a9a9a;
      text-align: right;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .ui-doc-table .sel {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: #b7daff;
      font-size: 12px;
    }
    .ui-doc-note {
      margin-top: 8px;
      color: #9a9a9a;
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
}

function escapeHTML(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clearUIHighlight() {
  if (_highlightedEl) {
    _highlightedEl.classList.remove('ui-doc-highlight');
    _highlightedEl = null;
  }
}

function highlightByXPath(xpath) {
  if (!xpath) return;
  let target = null;
  try {
    target = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  } catch (_) {
    target = null;
  }
  if (!target || !(target instanceof Element)) return;

  clearUIHighlight();
  _highlightedEl = target;
  _highlightedEl.classList.add('ui-doc-highlight');
  _highlightedEl.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

function popupHTML() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UI Elements Inspector</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; font: 13px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; background: #121212; color: #ddd; }
  .top { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
  .top input { flex: 1; background: #1b1b1b; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 6px 8px; }
  .top button { background: #232323; color: #ddd; border: 1px solid #555; border-radius: 4px; padding: 6px 10px; cursor: pointer; }
  .top button:hover { border-color: #7ab3ff; }
  .meta { color: #888; margin-bottom: 8px; }
  .table-wrap { max-height: calc(100vh - 120px); overflow: auto; border: 1px solid #333; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #2b2b2b; padding: 6px 8px; text-align: left; vertical-align: top; }
  thead th { position: sticky; top: 0; background: #1a1a1a; z-index: 2; }
  tr:hover { background: #1c2530; }
  tr.active { background: #2a3e55; }
  .num { color: #666; text-align: right; width: 2.5em; user-select: none; }
  .cat { color: #a8c7ff; white-space: nowrap; }
  .code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #9ad2ff; font-size: 11px; }
</style>
</head>
<body>
  <div class="top">
    <input id="q" type="text" placeholder="Filter rows (name, selector, category)…">
    <button id="reload" type="button">Reload JSON</button>
  </div>
  <div id="meta" class="meta">Loading…</div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Category</th>
          <th>Name</th>
          <th>Selector</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
<script>
(() => {
  let all = [];
  let filtered = [];
  let selectedKey = '';
  const coordCache = new Map();
  const meta = document.getElementById('meta');
  const q = document.getElementById('q');
  const rows = document.getElementById('rows');

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function cacheKey(el) {
    return (el.key || '') + '::' + (el.xpath || '');
  }

  function measureCoords(el) {
    if (!window.opener || window.opener.closed) {
      return { y: Number.POSITIVE_INFINITY, x: Number.POSITIVE_INFINITY };
    }
    const key = cacheKey(el);
    if (coordCache.has(key)) return coordCache.get(key);

    let out = { y: Number.POSITIVE_INFINITY, x: Number.POSITIVE_INFINITY };
    try {
      const doc = window.opener.document;
      const node = doc.evaluate(el.xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (node && node.getBoundingClientRect) {
        const r = node.getBoundingClientRect();
        const y = r.top + (window.opener.scrollY || 0);
        const x = r.left + (window.opener.scrollX || 0);
        out = { y, x };
      }
    } catch (_) {}

    coordCache.set(key, out);
    return out;
  }

  function sortVisual(list) {
    list.sort((a, b) => {
      const ac = measureCoords(a);
      const bc = measureCoords(b);
      if (ac.y !== bc.y) return ac.y - bc.y;
      if (ac.x !== bc.x) return ac.x - bc.x;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return list;
  }

  function render() {
    rows.innerHTML = filtered.map((e, i) => {
      const active = e.key === selectedKey ? ' class="active"' : '';
      return '<tr data-i="' + i + '"' + active + '>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td class="cat">' + esc(e.category) + '</td>' +
        '<td>' + esc(e.name) + '</td>' +
        '<td class="code">' + esc(e.humanXPath || e.xpath) + '</td>' +
        '</tr>';
    }).join('');
    meta.textContent = filtered.length + ' shown / ' + all.length + ' total';
  }

  function applyFilter() {
    const needle = q.value.trim().toLowerCase();
    if (!needle) {
      filtered = all.slice();
    } else {
      filtered = all.filter((e) => {
        const hay = [e.category, e.name, e.humanXPath, e.xpath, e.notes].join(' ').toLowerCase();
        return hay.includes(needle);
      });
    }
    render();
  }

  function postHighlight(xpath) {
    if (!window.opener || window.opener.closed) return;
    window.opener.postMessage({ type: 'ui-doc-highlight', xpath }, window.location.origin);
  }

  function postClear() {
    if (!window.opener || window.opener.closed) return;
    window.opener.postMessage({ type: 'ui-doc-clear-highlight' }, window.location.origin);
  }

  function updateActiveClass() {
    // Toggle active class without rebuilding DOM (avoids spurious mouseover events)
    rows.querySelectorAll('tr.active').forEach((tr) => tr.classList.remove('active'));
    if (selectedKey) {
      const idx = filtered.findIndex((e) => e.key === selectedKey);
      if (idx !== -1) {
        const tr = rows.querySelector('tr[data-i="' + idx + '"]');
        if (tr) tr.classList.add('active');
      }
    }
  }

  function selectRow(el) {
    selectedKey = el ? el.key : '';
    updateActiveClass();
    // scroll selected row into view inside the table
    const activeRow = rows.querySelector('tr.active');
    if (activeRow) activeRow.scrollIntoView({ block: 'nearest' });
    if (el) postHighlight(el.xpath); else postClear();
  }

  async function load() {
    if (!window.opener || window.opener.closed) {
      meta.textContent = 'Cannot find opener window. Open this popup from the in-app help overlay.';
      return;
    }
    const url = new URL('doc/elements.json', window.opener.location.href).toString();
    meta.textContent = 'Loading ' + url;
    try {
      const data = await fetch(url, { cache: 'no-store' }).then((r) => r.ok ? r.json() : Promise.reject(r.status));
      all = Array.isArray(data.elements) ? data.elements : [];
      coordCache.clear();
      filtered = all.slice();
      render();
    } catch (err) {
      meta.textContent = 'Failed to load elements.json (' + err + ')';
    }
  }

  rows.addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-i]');
    if (!tr) return;
    const el = filtered[Number(tr.dataset.i)];
    if (!el) return;
    // clicking an already-selected row deselects it
    if (el.key === selectedKey) { selectRow(null); } else { selectRow(el); }
  });

  rows.addEventListener('mouseover', (ev) => {
    const tr = ev.target.closest('tr[data-i]');
    if (!tr) return;
    const el = filtered[Number(tr.dataset.i)];
    if (el) postHighlight(el.xpath);
  });

  rows.addEventListener('mouseleave', () => {
    // restore selected highlight (or clear) when mouse leaves the table
    const sel = filtered.find((e) => e.key === selectedKey);
    if (sel) postHighlight(sel.xpath); else postClear();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    if (!filtered.length) return;
    ev.preventDefault();
    const curIdx = filtered.findIndex((e) => e.key === selectedKey);
    let nextIdx;
    if (curIdx === -1) {
      nextIdx = ev.key === 'ArrowDown' ? 0 : filtered.length - 1;
    } else {
      nextIdx = ev.key === 'ArrowDown'
        ? Math.min(curIdx + 1, filtered.length - 1)
        : Math.max(curIdx - 1, 0);
    }
    selectRow(filtered[nextIdx]);
  });

  q.addEventListener('input', applyFilter);
  document.getElementById('reload').addEventListener('click', load);
  load();
})();
</script>
</body>
</html>`;
}

function openUIMapPopup() {
  if (_uiMapPopup && !_uiMapPopup.closed) {
    _uiMapPopup.focus();
    return;
  }
  _uiMapPopup = window.open('', 'retro-ui-elements-inspector', 'popup=yes,width=1100,height=760,resizable=yes,scrollbars=yes');
  if (!_uiMapPopup) return;
  _uiMapPopup.document.open();
  _uiMapPopup.document.write(popupHTML());
  _uiMapPopup.document.close();
}

function closeUIMapPopup() {
  if (_uiMapPopup && !_uiMapPopup.closed) {
    _uiMapPopup.close();
  }
  _uiMapPopup = null;
}

async function hydrateUISection() {
  if (!content) return;
  ensureHighlighterStyle();

  const screenshot = content.querySelector('img[alt="Annotated user interface map"]');
  if (!screenshot) return;
  if (content.querySelector('#help-ui-map-inline-btn')) return;

  const host = screenshot.closest('p') || screenshot;

  const section = document.createElement('div');
  section.className = 'ui-doc-section';

  const btn = document.createElement('button');
  btn.id = 'help-ui-map-inline-btn';
  btn.type = 'button';
  btn.textContent = 'User Interface Highlighter';
  btn.title = 'Open UI elements inspector popup';
  btn.addEventListener('click', openUIMapPopup);
  section.appendChild(btn);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'ui-doc-table-wrap';
  tableWrap.innerHTML = `
    <table class="ui-doc-table">
      <thead>
        <tr><th class="num">No</th><th>Name</th><th>Selector</th></tr>
      </thead>
      <tbody>
        <tr><td class="num">--</td><td>Loading…</td><td class="sel">doc/elements.json</td></tr>
      </tbody>
    </table>
  `;
  section.appendChild(tableWrap);

  const note = document.createElement('div');
  note.className = 'ui-doc-note';
  note.textContent = 'Numbers match the screenshot bubbles and inspector order.';
  section.appendChild(note);

  host.insertAdjacentElement('afterend', section);

  try {
    const data = await fetch('doc/elements.json', { cache: 'no-store' }).then((r) => r.ok ? r.json() : Promise.reject(r.status));
    const elements = Array.isArray(data.elements) ? data.elements : [];
    const digits = Math.max(2, String(elements.length).length);
    const rowsHTML = elements.map((e, i) => {
      const n = String(i + 1).padStart(digits, '0');
      const sel = e.humanXPath || e.xpath || '';
      return `<tr><td class="num">${n}</td><td>${escapeHTML(e.name || '')}</td><td class="sel">${escapeHTML(sel)}</td></tr>`;
    }).join('');

    const tbody = tableWrap.querySelector('tbody');
    tbody.innerHTML = rowsHTML || '<tr><td class="num">--</td><td>No elements</td><td class="sel">-</td></tr>';
  } catch (err) {
    const tbody = tableWrap.querySelector('tbody');
    tbody.innerHTML = `<tr><td class="num">--</td><td>Could not load elements</td><td class="sel">${escapeHTML(String(err))}</td></tr>`;
  }
}

window.addEventListener('message', (ev) => {
  if (ev.origin !== window.location.origin) return;
  const msg = ev.data || {};
  if (msg.type === 'ui-doc-highlight') {
    highlightByXPath(msg.xpath);
  } else if (msg.type === 'ui-doc-clear-highlight') {
    clearUIHighlight();
  }
});

window.addEventListener('beforeunload', () => {
  closeUIMapPopup();
});

function showHelp() {
  if (!overlay) return;
  overlay.hidden = false;
  btnHelp.classList.add('active');
  if (_helpCache !== null) {
    content.innerHTML = _helpCache;
    hydrateUISection();
    return;
  }

  content.innerHTML = '<p>Loading…</p>';
  fetch('doc/README.md')
    .then(r => r.ok ? r.text() : Promise.reject(r.status))
    .then(md => {
      // marked is loaded from CDN (window.marked)
      _helpCache = typeof marked !== 'undefined'
        ? marked.parse(md)
        : `<pre>${md.replace(/</g, '&lt;')}</pre>`;
      content.innerHTML = _helpCache;
      hydrateUISection();
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
