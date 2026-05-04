// js/playlist-overlay.js — Playlist Manager overlay UI
import * as pm from './playlist-manager.js';
import { S } from './state.js';
import { askConfirm, askText, showInfo } from './prompts.js';
import { trackUrl } from './utils.js';

let _overlay = null;
let _content = null;
let _unsubscribe = null;
let _currentPlaylistId = null;
let _downloadType = 'csv';
let _downloadTypePanel = null;

function formatDownloadTypeLabel(type) {
  return String(type || 'csv').toUpperCase() + ' ▼';
}

function onDocumentClick(e) {
  if (!_overlay || _overlay.hidden || !_downloadTypePanel || _downloadTypePanel.hidden) return;
  const wrap = document.getElementById('pm-download-type-wrap');
  if (wrap && !wrap.contains(e.target)) _downloadTypePanel.hidden = true;
}

export function openPlaylistOverlay() {
  _overlay = document.getElementById('playlist-manager-overlay');
  _content = document.getElementById('pm-content');
  if (!_overlay) return;
  _overlay.hidden = false;
  render();
  if (!_unsubscribe) _unsubscribe = pm.onChange(render);
  _overlay.addEventListener('keydown', onOverlayKey);
  document.addEventListener('click', onDocumentClick, true);
  requestAnimationFrame(() => _overlay.focus());
}

export function closePlaylistOverlay() {
  if (_overlay) {
    _overlay.hidden = true;
    _overlay.removeEventListener('keydown', onOverlayKey);
  }
  document.removeEventListener('click', onDocumentClick, true);
  _unsubscribe?.();
  _unsubscribe = null;
}

function onOverlayKey(e) {
  const focused = document.activeElement;
  const inInput = focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.isContentEditable);
  if (inInput) return;

  const isNew = e.key === 'n' || e.key === 'N' || e.key === '+' || e.code === 'NumpadAdd' || (e.code === 'Equal' && e.shiftKey);
  if (isNew) {
    e.preventDefault();
    e.stopPropagation();
    createNew();
    return;
  }
}

function restoreOverlayHotkeyFocus() {
  if (!_overlay || _overlay.hidden) return;
  // Ensure key events bubble through the overlay again after modal prompts close.
  requestAnimationFrame(() => {
    if (_overlay && !_overlay.hidden) _overlay.focus();
  });
}

async function render() {
  _content = _content || document.getElementById('pm-content');
  if (!_content) return;
  const lists = await pm.getAll();
  const defaults = getDefaultListsFromState();
  const hidden = pm.getHiddenListKeys();
  _content.innerHTML = '';

  // Toolbar: + button and download format selector
  const toolbar = document.createElement('div');
  toolbar.id = 'pm-toolbar';

  const newBtn = document.createElement('button');
  newBtn.type = 'button'; newBtn.id = 'pm-new-btn'; newBtn.textContent = '+';
  newBtn.addEventListener('click', createNew);
  toolbar.appendChild(newBtn);

  const dlWrap = document.createElement('div');
  dlWrap.id = 'pm-download-type-wrap';

  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.id = 'pm-download-type-btn';
  dlBtn.textContent = formatDownloadTypeLabel(_downloadType);
  dlBtn.title = 'Download type';

  const dlPanel = document.createElement('div');
  dlPanel.id = 'pm-download-type-panel';
  dlPanel.hidden = true;

  const dlTitle = document.createElement('div');
  dlTitle.className = 'panel-title';
  dlTitle.textContent = 'Download type';
  dlPanel.appendChild(dlTitle);

  for (const type of ['csv', 'json']) {
    const opt = document.createElement('div');
    opt.className = 'src-opt' + (type === _downloadType ? ' selected' : '');
    opt.tabIndex = 0;
    opt.dataset.value = type;
    opt.textContent = type.toUpperCase();
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      _downloadType = type;
      dlBtn.textContent = formatDownloadTypeLabel(type);
      for (const item of dlPanel.querySelectorAll('.src-opt')) {
        item.classList.toggle('selected', item.dataset.value === _downloadType);
      }
      dlPanel.hidden = true;
    });
    opt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        opt.click();
      }
    });
    dlPanel.appendChild(opt);
  }

  dlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dlPanel.hidden = !dlPanel.hidden;
  });

  dlWrap.append(dlBtn, dlPanel);
  toolbar.appendChild(dlWrap);
  _downloadTypePanel = dlPanel;

  _content.appendChild(toolbar);

  // Collect all vis options for master checkbox
  const userVisOpts = lists.map(pl => ({
    key: pm.hiddenListKeyForPlaylist(pl.id), kind: 'user',
    visible: !hidden.has(pm.hiddenListKeyForPlaylist(pl.id)),
  }));
  const defaultVisOpts = defaults.map(name => ({
    key: pm.hiddenListKeyForFolder(name), kind: 'default',
    visible: !hidden.has(pm.hiddenListKeyForFolder(name)),
  }));
  const systemVisOpts = pm.SYSTEM_FOLDER_ENTRIES.map(e => ({
    key: e.key, kind: 'system',
    visible: pm.isSystemKeyVisible(e.key),
  }));
  const allVisOpts = [...userVisOpts, ...defaultVisOpts, ...systemVisOpts];
  const allVisible = allVisOpts.length === 0 || allVisOpts.every(o => o.visible);
  const noneVisible = allVisOpts.length > 0 && allVisOpts.every(o => !o.visible);

  // List header row (column titles, checkbox first)
  const listHeader = document.createElement('div');
  listHeader.className = 'pm-list-header';
  const masterLabel = document.createElement('label');
  masterLabel.className = 'pm-lh-cb';
  masterLabel.title = 'Toggle all visibility';
  const masterCb = document.createElement('input');
  masterCb.type = 'checkbox';
  masterCb.checked = allVisible;
  masterCb.indeterminate = !allVisible && !noneVisible;
  masterCb.addEventListener('change', () => {
    const makeVisible = masterCb.checked;
    for (const o of allVisOpts) {
      if (o.kind === 'system') pm.setSystemFolderVisible(o.key, makeVisible);
      else pm.setListHidden(o.key, !makeVisible);
    }
  });
  masterLabel.appendChild(masterCb);
  const lhContent = document.createElement('div');
  lhContent.className = 'pm-lh-content';
  const lhName = document.createElement('span');
  lhName.className = 'pm-lh-name';
  lhName.textContent = 'Name';
  const lhActions = document.createElement('span');
  lhActions.className = 'pm-lh-actions';
  lhActions.textContent = 'Actions';
  lhContent.append(lhName, lhActions);
  listHeader.append(masterLabel, lhContent);

  const list = document.createElement('div');
  list.id = 'pm-playlist-list';
  list.appendChild(listHeader);

  // ── User playlists section ───────────────────────────────────────
  const userWrap = document.createElement('div');
  userWrap.className = 'pm-section-wrap';
  const userList = document.createElement('ul');
  userList.className = 'pm-section-list';
  const userHead = document.createElement('li');
  userHead.className = 'pm-section-head';
  userHead.textContent = 'User playlists';
  userList.appendChild(userHead);
  if (lists.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'pm-section-empty';
    empty.textContent = "No playlists yet. Create one with '+'."; 
    userList.appendChild(empty);
  } else {
    for (let i = 0; i < lists.length; i++) {
      userList.appendChild(buildPlaylistRow(lists[i], hidden));
    }
  }
  userWrap.appendChild(userList);
  list.appendChild(userWrap);

  // ── Default playlists section ────────────────────────────────────
  const defWrap = document.createElement('div');
  defWrap.className = 'pm-section-wrap';
  const defList = document.createElement('ul');
  defList.className = 'pm-section-list';
  const defHead = document.createElement('li');
  defHead.className = 'pm-section-head';
  defHead.textContent = 'Default playlists';
  defList.appendChild(defHead);
  for (let i = 0; i < defaults.length; i++) {
    defList.appendChild(buildDefaultRow(defaults[i], 'default', hidden));
  }
  for (const e of pm.SYSTEM_FOLDER_ENTRIES) {
    defList.appendChild(buildDefaultRow(e.label, 'system', null, e.key));
  }
  defWrap.appendChild(defList);
  list.appendChild(defWrap);

  _content.appendChild(list);
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

function setCurrentPlaylistRow(li) {
  const parent = li.parentElement;
  if (!parent) return;
  for (const row of parent.querySelectorAll('li.current')) row.classList.remove('current');
  li.classList.add('current');
  _currentPlaylistId = li.dataset.id || null;
}

function buildVisCheckbox(key, kind, hidden) {
  const label = document.createElement('label');
  label.className = 'pm-vis-cb';
  label.title = 'Toggle visibility';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = kind === 'system' ? pm.isSystemKeyVisible(key) : !hidden.has(key);
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    if (kind === 'system') pm.setSystemFolderVisible(key, cb.checked);
    else pm.setListHidden(key, !cb.checked);
  });
  label.appendChild(cb);
  return label;
}

function buildPlaylistRow(pl, hidden) {
  const li = document.createElement('li');
  li.className = 'pm-playlist-row';
  li.dataset.id = pl.id;
  li.tabIndex = 0;
  if (_currentPlaylistId === pl.id) li.classList.add('current');

  const visCb = buildVisCheckbox(pm.hiddenListKeyForPlaylist(pl.id), 'user', hidden);

  const top = document.createElement('div');
  top.className = 'row-top';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'artist pm-playlist-name';
  nameSpan.textContent = pl.name;
  nameSpan.title = 'Click to rename';
  nameSpan.addEventListener('click', () => startRename(pl.id, nameSpan, pl.name));
  top.appendChild(nameSpan);

  const actions = document.createElement('span');
  actions.className = 'pm-playlist-actions';

  const exportBtn = makeBtn(
    '▼',
    'Export as ' + _downloadType.toUpperCase(),
    () => doExport(pl)
  );
  const importBtn = makeBtn('▲', 'Import tracks from CSV', () => doImport(pl.id));
  const delBtn = makeBtn('✕', 'Delete playlist', () => doDelete(pl.id, pl.name));
  delBtn.className = 'pm-del-btn';

  actions.append(exportBtn, importBtn, delBtn);
  top.appendChild(actions);

  li.addEventListener('click', (e) => {
    if (e.target.closest('button, input, label')) return;
    setCurrentPlaylistRow(li);
  });
  li.addEventListener('focusin', () => {
    setCurrentPlaylistRow(li);
  });

  li.append(visCb, top);
  return li;
}

function buildDefaultRow(displayName, kind, hidden, systemKey) {
  const li = document.createElement('li');
  li.className = 'pm-playlist-row pm-default-row';
  li.tabIndex = -1;

  const key = kind === 'system' ? systemKey : pm.hiddenListKeyForFolder(displayName);
  const visCb = buildVisCheckbox(key, kind, hidden);

  const top = document.createElement('div');
  top.className = 'row-top';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'pm-playlist-name pm-default-name';
  nameSpan.textContent = displayName;
  top.appendChild(nameSpan);

  li.append(visCb, top);
  return li;
}

function makeBtn(text, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.title = title;
  b.className = 'pm-btn';
  b.addEventListener('click', onClick);
  return b;
}

async function createNew() {
  const name = await askText({
    message: 'Playlist name:',
    yesLabel: 'Create',
    placeholder: 'New playlist',
  });
  if (!name) {
    restoreOverlayHotkeyFocus();
    return;
  }
  try {
    await pm.create(name);
  } catch (e) {
    showInfo({ message: 'Error: ' + e.message });
  } finally {
    restoreOverlayHotkeyFocus();
  }
}

function startRename(id, span, currentName) {
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.gap = '4px';
  
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.className = 'pm-rename-input';
  
  const errorSpan = document.createElement('span');
  errorSpan.style.color = '#ff6b6b';
  errorSpan.style.fontSize = '11px';
  errorSpan.style.whiteSpace = 'nowrap';
  errorSpan.hidden = true;
  
  container.appendChild(input);
  container.appendChild(errorSpan);
  span.replaceWith(container);
  
  input.focus();
  input.select();
  
  const commit = async () => {
    const n = input.value.trim();
    if (!n || n === currentName) {
      container.replaceWith(span);
      return;
    }
    
    try {
      await pm.rename(id, n);
      container.replaceWith(span);
    } catch (e) {
      errorSpan.textContent = '✗ ' + e.message;
      errorSpan.hidden = false;
      input.focus();
      input.select();
    }
  };
  
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); container.replaceWith(span); }
  });
}

async function doDelete(id, name) {
  const ok = await askConfirm({
    message: `Delete playlist "${name}"?`,
    yesLabel: 'Delete',
  });
  if (!ok) return;
  await pm.remove(id);
}

function doExport(pl) {
  const a = document.createElement('a');
  let blob;
  let ext;

  if (_downloadType === 'json') {
    const payload = {
      [pl.name]: (pl.tracks || []).map(t => trackUrl(t)),
    };
    blob = new Blob([JSON.stringify(payload, null, 4)], { type: 'application/json' });
    ext = '.json';
  } else {
    const csv = pm.exportCsv(pl);
    blob = new Blob([csv], { type: 'text/csv' });
    ext = '.csv';
  }

  a.href = URL.createObjectURL(blob);
  a.download = pl.name.replace(/[^a-z0-9_-]/gi, '_') + ext;
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
    showInfo({ message: `Imported ${added} track${added !== 1 ? 's' : ''}.` });
  });
  input.click();
}
