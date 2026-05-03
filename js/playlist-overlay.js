// js/playlist-overlay.js — Playlist Manager overlay UI
import * as pm from './playlist-manager.js';
import { esc } from './utils.js';
import { S } from './state.js';

let _overlay = null;
let _content = null;
let _unsubscribe = null;
let _editorFilterPlaylistId = '__all__';
let _visibilityPanelOpen = false;

function keepPanelInViewport(panel) {
  if (!panel || panel.hidden) return;
  panel.style.transform = 'translateX(0)';
  const rect = panel.getBoundingClientRect();
  const pad = 8;
  const maxRight = (window.innerWidth || document.documentElement.clientWidth) - pad;
  let shift = 0;

  if (rect.left < pad) shift += (pad - rect.left);
  if (rect.right > maxRight) shift -= (rect.right - maxRight);

  if (shift) panel.style.transform = `translateX(${Math.round(shift)}px)`;
}

function el(id) {
  if (!_overlay) _overlay = document.getElementById('playlist-manager-overlay');
  return _overlay?.querySelector('#' + id) ?? document.getElementById(id);
}

export function openPlaylistOverlay() {
  _overlay = document.getElementById('playlist-manager-overlay');
  _content = document.getElementById('pm-content');
  if (!_overlay) return;
  _overlay.hidden = false;
  render();
  if (!_unsubscribe) _unsubscribe = pm.onChange(render);
}

export function closePlaylistOverlay() {
  if (_overlay) _overlay.hidden = true;
  _unsubscribe?.();
  _unsubscribe = null;
  _visibilityPanelOpen = false;
}

function buildEditorFilterCombo(lists) {
  const options = [
    { id: '__all__', label: 'Edit…' },
    ...lists.map(pl => ({ id: pl.id, label: pl.name })),
  ];

  if (_editorFilterPlaylistId !== '__all__' && !options.some(o => o.id === _editorFilterPlaylistId)) {
    _editorFilterPlaylistId = '__all__';
  }

  const selected = options.find(o => o.id === _editorFilterPlaylistId) || options[0];
  const wrap = document.createElement('div');
  wrap.className = 'pm-combo';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'pm-editor-filter';
  input.className = 'pm-combo-input';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'pm-editor-filter-list');
  input.value = selected.label;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'pm-combo-toggle';
  toggle.textContent = '▾';

  const panel = document.createElement('div');
  panel.id = 'pm-editor-filter-list';
  panel.className = 'pm-combo-panel';
  panel.hidden = true;

  let open = false;
  let visible = options;
  let activeIdx = -1;

  const setClosed = (restoreValue = true) => {
    open = false;
    panel.hidden = true;
    wrap.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
    if (restoreValue) {
      const cur = options.find(o => o.id === _editorFilterPlaylistId) || options[0];
      input.value = cur.label;
    }
  };

  const setOpen = () => {
    if (open) return;
    open = true;
    panel.hidden = false;
    wrap.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
  };

  const pick = (id) => {
    if (_editorFilterPlaylistId === id) {
      setClosed(true);
      return;
    }
    _editorFilterPlaylistId = id;
    render();
  };

  const renderOptions = () => {
    const q = input.value.trim().toLowerCase();
    visible = q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
    activeIdx = visible.findIndex(o => o.id === _editorFilterPlaylistId);
    panel.innerHTML = '';

    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'pm-combo-empty';
      empty.textContent = 'No matching playlists.';
      panel.appendChild(empty);
      return;
    }

    visible.forEach((opt, idx) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pm-combo-opt';
      if (opt.id === _editorFilterPlaylistId) row.classList.add('selected');
      if (idx === activeIdx) row.classList.add('active');
      row.textContent = opt.label;
      row.addEventListener('click', () => pick(opt.id));
      panel.appendChild(row);
    });
  };

  const syncActive = () => {
    const rows = panel.querySelectorAll('.pm-combo-opt');
    rows.forEach((row, idx) => row.classList.toggle('active', idx === activeIdx));
    const active = rows[activeIdx];
    if (active) active.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('focus', () => {
    setOpen();
    input.select();
    renderOptions();
  });
  input.addEventListener('input', () => {
    setOpen();
    renderOptions();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen();
      if (!visible.length) return;
      activeIdx = Math.min(visible.length - 1, activeIdx + 1);
      syncActive();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen();
      if (!visible.length) return;
      activeIdx = Math.max(0, activeIdx - 1);
      syncActive();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && visible.length) {
        const target = visible[Math.max(0, activeIdx)] || visible[0];
        pick(target.id);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setClosed(true);
    }
  });

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (open) {
      setClosed(true);
      return;
    }
    setOpen();
    input.focus();
    input.select();
    renderOptions();
  });

  panel.addEventListener('click', (e) => e.stopPropagation());
  wrap.addEventListener('focusout', (e) => {
    if (!wrap.contains(e.relatedTarget)) setClosed(true);
  });

  wrap.append(input, toggle, panel);
  renderOptions();
  return wrap;
}

async function render() {
  _content = _content || document.getElementById('pm-content');
  if (!_content) return;
  const lists = await pm.getAll();
  const defaults = getDefaultListsFromState();
  const hidden = pm.getHiddenListKeys();
  _content.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.id = 'pm-toolbar';

  const newBtn = document.createElement('button');
  newBtn.type = 'button'; newBtn.id = 'pm-new-btn'; newBtn.textContent = '+';
  newBtn.addEventListener('click', createNew);
  toolbar.appendChild(newBtn);
  toolbar.appendChild(buildEditorFilterCombo(lists));

  const visWrap = document.createElement('div');
  visWrap.className = 'pm-vis-wrap';

  const visOptions = [
    // System folders: hidden by default; checkbox = opt-in to show
    ...pm.SYSTEM_FOLDER_ENTRIES.map(e => ({
      key: e.key,
      label: e.label,
      kind: 'system',
    })),
    ...defaults.map(name => ({
      key: pm.hiddenListKeyForFolder(name),
      label: name,
      kind: 'default',
    })),
    ...lists.map(pl => ({
      key: pm.hiddenListKeyForPlaylist(pl.id),
      label: pl.name,
      kind: 'user',
    })),
  ].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

  const rowVisible = (row) =>
    row.kind === 'system' ? pm.isSystemKeyVisible(row.key) : !hidden.has(row.key);
  const allVisible = visOptions.length === 0 || visOptions.every(rowVisible);
  const noneVisible = visOptions.length > 0 && visOptions.every(r => !rowVisible(r));

  const visBtn = document.createElement('button');
  visBtn.type = 'button';
  visBtn.id = 'pm-visible-btn';
  visBtn.textContent = 'V';
  visBtn.classList.toggle('active', !allVisible);
  visBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _visibilityPanelOpen = !_visibilityPanelOpen;
    render();
  });
  visWrap.appendChild(visBtn);

  const visPanel = document.createElement('div');
  visPanel.id = 'pm-visible-panel';
  visPanel.hidden = !_visibilityPanelOpen;
  visPanel.addEventListener('click', (e) => e.stopPropagation());

  // Panel head: title + master * checkbox
  const visPanelHead = document.createElement('div');
  visPanelHead.className = 'panel-head';
  const visPanelTitle = document.createElement('div');
  visPanelTitle.className = 'panel-title';
  visPanelTitle.textContent = 'Visibility';
  visPanelHead.appendChild(visPanelTitle);
  const visMasterLabel = document.createElement('label');
  visMasterLabel.className = 'fmt-opt fmt-master';
  visMasterLabel.tabIndex = -1;
  const visMasterCb = document.createElement('input');
  visMasterCb.type = 'checkbox';
  visMasterCb.checked = allVisible;
  visMasterCb.indeterminate = !allVisible && !noneVisible;
  visMasterCb.classList.toggle('indeterminate', !allVisible && !noneVisible);
  visMasterCb.addEventListener('change', () => {
    const makeVisible = visMasterCb.checked;
    for (const row of visOptions) {
      if (row.kind === 'system') pm.setSystemFolderVisible(row.key, makeVisible);
      else pm.setListHidden(row.key, !makeVisible);
    }
  });
  visMasterLabel.appendChild(visMasterCb);
  visMasterLabel.appendChild(document.createTextNode('*'));
  visPanelHead.appendChild(visMasterLabel);
  visPanel.appendChild(visPanelHead);

  for (const row of visOptions) {
    const label = document.createElement('label');
    label.className = 'fmt-opt';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = rowVisible(row);
    if (row.kind === 'system') {
      cb.addEventListener('change', () => pm.setSystemFolderVisible(row.key, cb.checked));
    } else {
      cb.addEventListener('change', () => pm.setListHidden(row.key, !cb.checked));
    }

    const text = document.createElement('span');
    text.textContent = row.label;
    const kind = document.createElement('span');
    kind.className = 'pm-vis-kind';
    kind.textContent = row.kind === 'system' ? 'SYSTEM' : row.kind === 'default' ? 'DEFAULT' : 'PLAYLIST';

    label.append(cb, text, kind);
    visPanel.appendChild(label);
  }
  if (!visOptions.length) {
    const empty = document.createElement('div');
    empty.className = 'pm-vis-empty';
    empty.textContent = 'No lists available.';
    visPanel.appendChild(empty);
  }

  visWrap.appendChild(visPanel);
  toolbar.appendChild(visWrap);
  _content.appendChild(toolbar);

  if (_visibilityPanelOpen) {
    requestAnimationFrame(() => keepPanelInViewport(visPanel));
    document.addEventListener('click', onOutsideVisibilityClick, { once: true });
  }

  if (lists.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'pm-empty';
    empty.textContent = 'No playlists yet. Create one above.';
    _content.appendChild(empty);
    return;
  }

  const visibleCards = _editorFilterPlaylistId === '__all__'
    ? lists
    : lists.filter(pl => pl.id === _editorFilterPlaylistId);

  for (const pl of visibleCards) _content.appendChild(buildPlaylistCard(pl));
}

function onOutsideVisibilityClick() {
  if (!_visibilityPanelOpen) return;
  _visibilityPanelOpen = false;
  render();
}

function getDefaultListsFromState() {
  const folders = new Set();
  for (const p of (S.players || [])) {
    if (p.id === 'ahx') continue;
    const files = S.fileLists?.[p.id] || [];
    for (const name of files) {
      const slash = name.lastIndexOf('/');
      if (slash >= 0) folders.add(name.substring(0, slash));
    }
  }
  for (const t of (S._localUrllistTracks || [])) {
    if (t.playerId === 'ahx') continue;
    const slash = (t.name || '').lastIndexOf('/');
    if (slash >= 0) folders.add(t.name.substring(0, slash));
  }
  return [...folders].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function buildPlaylistCard(pl) {
  const div = document.createElement('div');
  div.className = 'pm-playlist';
  div.dataset.id = pl.id;

  // — header row —
  const header = document.createElement('div');
  header.className = 'pm-playlist-header';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'pm-playlist-name';
  nameSpan.textContent = pl.name;
  nameSpan.title = 'Click to rename';
  nameSpan.addEventListener('click', () => startRename(pl.id, nameSpan, pl.name));
  header.appendChild(nameSpan);

  const count = document.createElement('span');
  count.className = 'pm-playlist-count';
  count.textContent = pl.tracks.length + ' track' + (pl.tracks.length !== 1 ? 's' : '');
  header.appendChild(count);

  const actions = document.createElement('span');
  actions.className = 'pm-playlist-actions';

  const exportBtn = makeBtn('↓ CSV', 'Export as CSV', () => doExport(pl));
  const importBtn = makeBtn('↑ CSV', 'Import tracks from CSV', () => doImport(pl.id));
  const delBtn    = makeBtn('✕', 'Delete playlist', () => doDelete(pl.id, pl.name));
  delBtn.className = 'pm-del-btn';

  actions.append(exportBtn, importBtn, delBtn);
  header.appendChild(actions);
  div.appendChild(header);

  // — track list —
  if (pl.tracks.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'pm-track-list';
    for (const t of pl.tracks) {
      const li  = document.createElement('li');
      li.className = 'pm-track-item';
      const slash = (t.name || '').lastIndexOf('/');
      const disp  = slash >= 0 ? t.name.substring(slash + 1) : t.name;
      li.innerHTML = `<span class="pm-track-name">${esc(disp)}</span><span class="pm-track-ext">${esc(t.ext || '')}</span>`;
      const rmBtn = makeBtn('✕', 'Remove from playlist', () => pm.removeTrack(pl.id, pm.trackKey(t)));
      rmBtn.className = 'pm-rm-btn';
      li.appendChild(rmBtn);
      ul.appendChild(li);
    }
    div.appendChild(ul);
  }

  return div;
}

function makeBtn(text, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.title = title;
  b.className = 'pm-btn';
  b.addEventListener('click', onClick);
  return b;
}

async function createNew() {
  const name = prompt('Playlist name:');
  if (!name?.trim()) return;
  await pm.create(name.trim());
}

function startRename(id, span, currentName) {
  const input = document.createElement('input');
  input.type = 'text'; input.value = currentName; input.className = 'pm-rename-input';
  span.replaceWith(input);
  input.focus(); input.select();
  const commit = async () => {
    const n = input.value.trim();
    if (n && n !== currentName) await pm.rename(id, n);
    else render();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); render(); }
  });
}

async function doDelete(id, name) {
  if (!confirm(`Delete playlist "${name}"?`)) return;
  if (_editorFilterPlaylistId === id) _editorFilterPlaylistId = '__all__';
  await pm.remove(id);
}

function doExport(pl) {
  const csv  = pm.exportCsv(pl);
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = pl.name.replace(/[^a-z0-9_-]/gi, '_') + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function doImport(id) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.csv,text/csv';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const text   = await file.text();
    const tracks = pm.parseCsv(text);
    let added    = 0;
    for (const t of tracks) { if (await pm.addTrack(id, t)) added++; }
    alert(`Imported ${added} track${added !== 1 ? 's' : ''}.`);
  });
  input.click();
}
