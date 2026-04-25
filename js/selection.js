// js/selection.js — Track selection, bulk state machine, copy/zip
import { S, elBulkCb, elSelCount, elSelBulk, btnCopy, btnZip, elInfo, elList } from './state.js';
import { trackUrl } from './utils.js';
import { activeFiles, activeSelected, setActiveSelected } from './playlist.js';

// ── toggle / save / restore ───────────────────────────
export function toggleSelect(idx, force) {
  const sel = activeSelected();
  const on = force !== undefined ? force : !sel.has(idx);
  if (on) sel.add(idx); else sel.delete(idx);
  const li = elList.children[idx];
  const cb = li?.querySelector('.sel-cb');
  if (cb) cb.checked = on;
  updateSelCount();
  saveSelection();
  if (!S.suppressBulkSnapshot && isPartialSelection()) {
    S.bulkRestoreSelection = new Set(sel);
  }
}

export function saveSelection() {
  const sel = activeSelected();
  const files = activeFiles();
  const items = Array.from(sel).map(i => {
    const f = files[i];
    return f ? { playerId: f.playerId, name: f.name } : null;
  }).filter(Boolean);
  const key = S.searchMode === 'local' ? 'selected-tracks' : 'selected-modland';
  localStorage.setItem(key, JSON.stringify(items));
}

export function restoreSelection() {
  const key = S.searchMode === 'local' ? 'selected-tracks' : 'selected-modland';
  const sel = activeSelected();
  const files = activeFiles();
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (!Array.isArray(saved)) return;
    saved.forEach(s => {
      const idx = files.findIndex(f => f.playerId === s.playerId && f.name === s.name);
      if (idx >= 0) {
        sel.add(idx);
        const li = elList.children[idx];
        const cb = li?.querySelector('.sel-cb');
        if (cb) cb.checked = true;
      }
    });
    updateSelCount();
    if (isPartialSelection()) S.bulkRestoreSelection = new Set(sel);
  } catch (_) {}
}

// ── counts + bulk state ───────────────────────────────
export function updateSelCount() {
  const sel = activeSelected();
  const n = sel.size;
  if (n > 0) {
    elSelCount.textContent = n + ' selected';
    elSelCount.dataset.short = n;
  } else {
    elSelCount.textContent = '';
    elSelCount.dataset.short = '';
  }
  btnCopy.disabled = n === 0;
  btnZip.disabled = n === 0;
  syncBulkState();
}

export function isPartialSelection() {
  const sel = activeSelected();
  const files = activeFiles();
  return sel.size > 0 && sel.size < files.length;
}

export function setBulkState(next) {
  S.bulkState = next;
  if (next === 'all') {
    elBulkCb.checked = true;
    elBulkCb.indeterminate = false;
    elBulkCb.classList.remove('indeterminate');
  } else if (next === 'none') {
    elBulkCb.checked = false;
    elBulkCb.indeterminate = false;
    elBulkCb.classList.remove('indeterminate');
  } else {
    elBulkCb.checked = false;
    elBulkCb.indeterminate = true;
    elBulkCb.classList.add('indeterminate');
  }
}

export function syncBulkState() {
  const sel = activeSelected();
  const files = activeFiles();
  if (!files.length) { setBulkState('none'); return; }
  if (sel.size === 0) setBulkState('none');
  else if (sel.size === files.length) setBulkState('all');
  else setBulkState('restore');
}

function applySelectionSet(nextSet) {
  setActiveSelected(nextSet);
  const items = elList.children;
  for (let i = 0; i < items.length; i++) {
    const cb = items[i].querySelector('.sel-cb');
    if (cb) cb.checked = nextSet.has(i);
  }
  updateSelCount();
  saveSelection();
}

function selectAll() {
  const nextSet = new Set();
  const files = activeFiles();
  for (let i = 0; i < files.length; i++) nextSet.add(i);
  applySelectionSet(nextSet);
}

function selectNone() {
  applySelectionSet(new Set());
}

function restoreBulkSelection() {
  const nextSet = new Set();
  S.bulkRestoreSelection.forEach(i => {
    if (i >= 0 && i < S.mergedFiles.length) nextSet.add(i);
  });
  applySelectionSet(nextSet);
}

// ── event listeners ───────────────────────────────────
elSelBulk.addEventListener('click', (e) => {
  e.preventDefault();
  let next;
  if (S.bulkState === 'none') next = 'all';
  else if (S.bulkState === 'all') next = 'none';
  else next = 'all'; // partial → all

  if ((next === 'all' || next === 'none') && isPartialSelection()) {
    S.bulkRestoreSelection = new Set(activeSelected());
  }

  S.suppressBulkSnapshot = true;
  setBulkState(next);
  if (next === 'all') selectAll();
  else if (next === 'none') selectNone();
  else restoreBulkSelection();
  S.suppressBulkSnapshot = false;
});

elInfo.addEventListener('click', (e) => {
  const label = e.target.closest('.label[data-copy]');
  if (!label) return;
  navigator.clipboard.writeText(label.dataset.copy).then(() => {
    label.classList.add('copied');
    setTimeout(() => label.classList.remove('copied'), 1200);
  }).catch(() => {});
});

btnCopy.addEventListener('click', () => {
  const sel = activeSelected();
  const files = activeFiles();
  if (sel.size === 0) return;
  const csv = Array.from(sel).sort((a, b) => a - b)
    .map(i => {
      const f = files[i];
      return f.url || `engines/${f.playerId}/files/${f.name}`;
    })
    .join('\n');
  navigator.clipboard.writeText(csv).then(() => {
    btnCopy.classList.add('copied');
    setTimeout(() => btnCopy.classList.remove('copied'), 1500);
  });
});

btnZip.addEventListener('click', async () => {
  const sel = activeSelected();
  const files = activeFiles();
  if (sel.size === 0) return;
  btnZip.textContent = '…';
  try {
    const zip = new JSZip(); // loaded from CDN
    const entries = Array.from(sel).sort((a, b) => a - b).map(i => files[i]);
    const usedNames = new Set();
    const urls = [];
    await Promise.all(entries.map(async (f) => {
      const url = trackUrl(f);
      const resp = await fetch(url);
      if (!resp.ok) return;
      const blob = await resp.blob();
      const decoded = decodeURIComponent(f.name);
      const slash = decoded.lastIndexOf('/');
      const artist = slash >= 0 ? decoded.substring(0, slash).split('/').pop() : '';
      const baseName = slash >= 0 ? decoded.substring(slash + 1) : decoded;
      const dotPos = baseName.lastIndexOf('.');
      const title = dotPos >= 0 ? baseName.substring(0, dotPos) : baseName;
      const ext = dotPos >= 0 ? baseName.substring(dotPos) : '';
      let flatName = artist ? `${artist} - ${title}${ext}` : `${title}${ext}`;
      let finalName = flatName;
      let dup = 1;
      while (usedNames.has(finalName.toLowerCase())) {
        finalName = artist ? `${artist} - ${title} (${++dup})${ext}` : `${title} (${++dup})${ext}`;
      }
      usedNames.add(finalName.toLowerCase());
      zip.file(finalName, blob);
      if (f.url) urls.push(f.url);
    }));
    if (urls.length) zip.file('urllist.json', JSON.stringify(urls, null, 2));
    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = 'tracks.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.error('Zip failed:', e);
  }
  btnZip.textContent = 'Z';
});
