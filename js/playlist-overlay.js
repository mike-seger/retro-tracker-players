// js/playlist-overlay.js — Playlist Manager overlay UI
import * as pm from './playlist-manager.js';
import { S } from './state.js';
import { askConfirm, askText, showInfo } from './prompts.js';

let _overlay = null;
let _content = null;
let _unsubscribe = null;
let _currentPlaylistId = null;

export function openPlaylistOverlay() {
  _overlay = document.getElementById('playlist-manager-overlay');
  _content = document.getElementById('pm-content');
  if (!_overlay) return;
  _overlay.hidden = false;
  render();
  if (!_unsubscribe) _unsubscribe = pm.onChange(render);
  _overlay.addEventListener('keydown', onOverlayKey);
  requestAnimationFrame(() => _overlay.focus());
}

export function closePlaylistOverlay() {
  if (_overlay) {
    _overlay.hidden = true;
    _overlay.removeEventListener('keydown', onOverlayKey);
  }
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

async function render() {
  _content = _content || document.getElementById('pm-content');
  if (!_content) return;
  const lists = await pm.getAll();
  const defaults = getDefaultListsFromState();
  const hidden = pm.getHiddenListKeys();
  _content.innerHTML = '';

  // Toolbar: + button only
  const toolbar = document.createElement('div');
  toolbar.id = 'pm-toolbar';
  const newBtn = document.createElement('button');
  newBtn.type = 'button'; newBtn.id = 'pm-new-btn'; newBtn.textContent = '+';
  newBtn.addEventListener('click', createNew);
  toolbar.appendChild(newBtn);
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

  // List header row (first <li> in the ul for column alignment)
  const listHeader = document.createElement('li');
  listHeader.className = 'pm-list-header';
  listHeader.appendChild(document.createElement('span')); // idx col spacer
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
  listHeader.appendChild(masterLabel);
  const lhContent = document.createElement('div');
  lhContent.className = 'pm-lh-content';
  const lhName = document.createElement('span');
  lhName.className = 'pm-lh-name';
  lhName.textContent = 'Name';
  const lhActions = document.createElement('span');
  lhActions.className = 'pm-lh-actions';
  lhActions.textContent = 'Actions';
  lhContent.append(lhName, lhActions);
  listHeader.appendChild(lhContent);

  const list = document.createElement('ul');
  list.id = 'pm-playlist-list';
  list.appendChild(listHeader);

  // ── User playlists section ───────────────────────────
  const userHead = document.createElement('li');
  userHead.className = 'pm-section-head';
  userHead.textContent = 'User playlists';
  list.appendChild(userHead);
  if (lists.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'pm-section-empty';
    empty.textContent = 'No playlists yet. Create one with ‘+’.';
    list.appendChild(empty);
  } else {
    for (let i = 0; i < lists.length; i++) {
      list.appendChild(buildPlaylistRow(lists[i], i, lists.length, hidden));
    }
  }

  // ── Default playlists section ────────────────────────
  const defHead = document.createElement('li');
  defHead.className = 'pm-section-head';
  defHead.textContent = 'Default playlists';
  list.appendChild(defHead);
  for (let i = 0; i < defaults.length; i++) {
    list.appendChild(buildDefaultRow(defaults[i], 'default', hidden));
  }
  for (const e of pm.SYSTEM_FOLDER_ENTRIES) {
    list.appendChild(buildDefaultRow(e.label, 'system', null, e.key));
  }

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

function buildPlaylistRow(pl, idx, totalCount, hidden) {
  const li = document.createElement('li');
  li.className = 'pm-playlist-row';
  li.dataset.id = pl.id;
  li.tabIndex = 0;
  if (_currentPlaylistId === pl.id) li.classList.add('current');

  const pad = Math.max(2, String(totalCount).length);
  const idxSpan = document.createElement('span');
  idxSpan.className = 'idx pm-idx';
  idxSpan.textContent = String(idx + 1).padStart(pad, '\u2007');

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

  const count = document.createElement('span');
  count.className = 'folder pm-playlist-count';
  count.textContent = pl.tracks.length + ' track' + (pl.tracks.length !== 1 ? 's' : '');
  actions.appendChild(count);

  const exportBtn = makeBtn('↓ CSV', 'Export as CSV', () => doExport(pl));
  const importBtn = makeBtn('↑ CSV', 'Import tracks from CSV', () => doImport(pl.id));
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

  li.append(idxSpan, visCb, top);
  return li;
}

function buildDefaultRow(displayName, kind, hidden, systemKey) {
  const li = document.createElement('li');
  li.className = 'pm-playlist-row pm-default-row';
  li.tabIndex = -1;

  const idxSpan = document.createElement('span');
  idxSpan.className = 'idx pm-idx';
  idxSpan.textContent = '\u2007\u2007';

  const key = kind === 'system' ? systemKey : pm.hiddenListKeyForFolder(displayName);
  const visCb = buildVisCheckbox(key, kind, hidden);

  const top = document.createElement('div');
  top.className = 'row-top';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'pm-playlist-name pm-default-name';
  nameSpan.textContent = displayName;
  top.appendChild(nameSpan);

  li.append(idxSpan, visCb, top);
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
  if (!name) return;
  try {
    await pm.create(name);
  } catch (e) {
    showInfo({ message: 'Error: ' + e.message });
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
    showInfo({ message: `Imported ${added} track${added !== 1 ? 's' : ''}.` });
  });
  input.click();
}
