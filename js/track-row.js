import { parseTrackDisplay, safeDecodeURIComponent } from './utils.js';

export function createTrackRow({
  entry,
  indexLabel = '',
  selected = false,
  showCheckbox = false,
  actions = [],
}) {
  const li = document.createElement('li');
  const actionButtons = new Map();

  const decodedName = safeDecodeURIComponent(entry.name);
  const slash = decodedName.lastIndexOf('/');
  const baseName = slash >= 0 ? decodedName.substring(slash + 1) : decodedName;
  const { artist, title, folder } = parseTrackDisplay(entry);

  if (entry.url) li.classList.add('remote');

  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.setAttribute('aria-label', 'Track index');
  idx.textContent = indexLabel;
  li.appendChild(idx);

  let checkbox = null;
  if (showCheckbox) {
    checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'sel-cb';
    checkbox.tabIndex = -1;
    checkbox.checked = selected;
    checkbox.setAttribute('aria-label', 'Track selector checkbox');
    li.appendChild(checkbox);
  }

  const rowTop = document.createElement('div');
  rowTop.className = 'row-top';

  const artistEl = document.createElement('span');
  artistEl.className = 'artist';
  artistEl.setAttribute('aria-label', 'Track artist');
  artistEl.textContent = artist;
  rowTop.appendChild(artistEl);

  if (folder) {
    const folderEl = document.createElement('span');
    folderEl.className = 'folder';
    folderEl.setAttribute('aria-label', 'Track group');
    folderEl.textContent = folder;
    rowTop.appendChild(folderEl);
  }

  li.appendChild(rowTop);

  const rowBot = document.createElement('div');
  rowBot.className = 'row-bot';

  const titleEl = document.createElement('span');
  titleEl.className = 'title';
  titleEl.setAttribute('aria-label', 'Track title');
  titleEl.textContent = title;
  rowBot.appendChild(titleEl);

  const extEl = document.createElement('span');
  extEl.className = 'ext';
  extEl.setAttribute('aria-label', 'Track format');
  extEl.textContent = entry.ext;
  rowBot.appendChild(extEl);

  for (const action of actions) {
    const button = document.createElement('button');
    button.className = action.className;
    button.textContent = action.text;
    if (action.title) button.title = action.title;
    if (action.ariaLabel) button.setAttribute('aria-label', action.ariaLabel);
    rowBot.appendChild(button);
    if (action.key) actionButtons.set(action.key, button);
  }

  li.appendChild(rowBot);

  return {
    li,
    checkbox,
    actionButtons,
    baseName,
    searchArtist: artist || folder,
  };
}

export function isTrackRowControlTarget(target) {
  return target instanceof Element && !!target.closest('button, input.sel-cb');
}