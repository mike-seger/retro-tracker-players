// js/playlist-manager.js — IndexedDB-backed user playlist CRUD

const DB_NAME    = 'retrotrap';
const DB_VERSION = 1;
const STORE      = 'playlists';
const HIDDEN_KEY = 'retrotrap-hidden-lists-v1';

// System folders: hidden from List panel by default; tracks always pass filter.
// All variants matching the pattern map to canonical key '__uncategorized__'.
const SYSTEM_FOLDER_PATTERN = /^-?\s*unknown$/i;
const SYSTEM_SHOWN_KEY = 'retrotrap-system-lists-shown-v1';

// Fixed entries shown in the Visibility panel for system folders.
export const SYSTEM_FOLDER_ENTRIES = [
  { key: '__uncategorized__', label: 'Uncategorized' },
];

/** Maps a raw folder name to its canonical system key, or null if not a system folder. */
function systemFolderKey(name) {
  const n = String(name ?? '');
  if (!n || SYSTEM_FOLDER_PATTERN.test(n)) return '__uncategorized__';
  return null;
}

function readSystemShownSet() {
  try {
    const raw = localStorage.getItem(SYSTEM_SHOWN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch (_) { return new Set(); }
}

function writeSystemShownSet(set) {
  localStorage.setItem(SYSTEM_SHOWN_KEY, JSON.stringify([...set]));
}

/** Returns true if the raw folder name is a system folder (hidden by default). */
export function isSystemFolder(name) {
  return systemFolderKey(name) !== null;
}

/** Returns the display label for a raw system folder name. */
export function getSystemFolderLabel(name) {
  const key = systemFolderKey(name);
  if (!key) return String(name ?? '');
  const entry = SYSTEM_FOLDER_ENTRIES.find(e => e.key === key);
  return entry ? entry.label : String(name ?? '');
}

/** Returns true if user has opted in to showing this (raw-named) system folder. */
export function isSystemFolderVisible(name) {
  const key = systemFolderKey(name);
  if (!key) return true; // not a system folder — always visible
  return readSystemShownSet().has(key);
}

/** Toggle visibility of a system folder by its canonical key (from SYSTEM_FOLDER_ENTRIES). */
export function setSystemFolderVisible(canonicalKey, visible) {
  const set = readSystemShownSet();
  if (visible) set.add(String(canonicalKey));
  else set.delete(String(canonicalKey));
  writeSystemShownSet(set);
  notify();
}

/** Returns true if a canonical system key is currently shown. */
export function isSystemKeyVisible(canonicalKey) {
  return readSystemShownSet().has(String(canonicalKey));
}

let _db = null;
const _listeners = new Set();

function extFromTrack(t) {
  const fromExt = String(t?.ext || '').toLowerCase();
  if (fromExt) return fromExt;
  const src = String(t?.name || t?.url || '').split('?')[0].split('#')[0];
  const dot = src.lastIndexOf('.');
  return dot >= 0 ? src.substring(dot + 1).toLowerCase() : '';
}

function normalizeLegacyPlayerId(playerId, t) {
  if (playerId !== 'gme') return playerId;
  const ext = extFromTrack(t);
  if (ext === 'spc') return 'spc';
  if (ext === 'vgm' || ext === 'vgz') return 'vgm';
  return playerId;
}

function normalizeLegacyTrack(track) {
  if (!track || typeof track !== 'object') return { track, changed: false };
  const nextPlayerId = normalizeLegacyPlayerId(track.playerId, track);
  if (nextPlayerId === track.playerId) return { track, changed: false };
  return {
    track: { ...track, playerId: nextPlayerId },
    changed: true,
  };
}

function normalizeLegacyTracks(tracks) {
  const src = Array.isArray(tracks) ? tracks : [];
  let changed = false;
  const normalized = src.map((t) => {
    const n = normalizeLegacyTrack(t);
    if (n.changed) changed = true;
    return n.track;
  });
  return { tracks: normalized, changed };
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = (e) => reject(e.target.error);
  });
}

function dbReq(idbReq) {
  return new Promise((res, rej) => {
    idbReq.onsuccess = () => res(idbReq.result);
    idbReq.onerror   = (e) => rej(e.target.error);
  });
}

function notify() {
  for (const fn of _listeners) fn();
}

function readHiddenSet() {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch (_) {
    return new Set();
  }
}

function writeHiddenSet(set) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
}

/** Subscribe to any change. Returns an unsubscribe function. */
export function onChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export async function init() {
  await openDB();
}

export async function getAll() {
  await openDB();
  const list = await dbReq(_db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  for (const pl of list) {
    const n = normalizeLegacyTracks(pl?.tracks);
    if (n.changed) {
      pl.tracks = n.tracks;
      await dbReq(_db.transaction(STORE, 'readwrite').objectStore(STORE).put(pl));
    }
  }
  list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return list;
}

export async function checkNameExists(name, excludeId = null) {
  await openDB();
  const all = await dbReq(_db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  const trimmedName = String(name || '').trim().toLowerCase();
  return all.some(pl => pl.id !== excludeId && (pl.name || '').toLowerCase() === trimmedName);
}

export async function create(name) {
  await openDB();
  const trimmedName = String(name || 'New playlist').trim();
  const exists = await checkNameExists(trimmedName);
  if (exists) {
    throw new Error(`Playlist name "${trimmedName}" already exists`);
  }
  const pl = { id: uid(), name: trimmedName, tracks: [] };
  await dbReq(_db.transaction(STORE, 'readwrite').objectStore(STORE).put(pl));
  notify();
  return pl;
}

export async function rename(id, name) {
  await openDB();
  const trimmedName = String(name || '').trim();
  if (!trimmedName) return;
  const exists = await checkNameExists(trimmedName, id);
  if (exists) {
    throw new Error(`Playlist name "${trimmedName}" already exists`);
  }
  const t = _db.transaction(STORE, 'readwrite');
  const s = t.objectStore(STORE);
  const pl = await dbReq(s.get(id));
  if (!pl) return;
  pl.name = trimmedName;
  await dbReq(s.put(pl));
  notify();
}

export async function remove(id) {
  await openDB();
  await dbReq(_db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  notify();
}

export async function addTrack(id, track) {
  await openDB();
  const t = _db.transaction(STORE, 'readwrite');
  const s = t.objectStore(STORE);
  const pl = await dbReq(s.get(id));
  if (!pl) return false;
  const normalizedTrack = normalizeLegacyTrack(track).track;
  const key = trackKey(normalizedTrack);
  if (pl.tracks.some(tr => trackKey(tr) === key)) return false;
  pl.tracks.push(normalizedTrack);
  await dbReq(s.put(pl));
  notify();
  return true;
}

export async function removeTrack(id, key) {
  await openDB();
  const t = _db.transaction(STORE, 'readwrite');
  const s = t.objectStore(STORE);
  const pl = await dbReq(s.get(id));
  if (!pl) return;
  pl.tracks = pl.tracks.filter(tr => trackKey(tr) !== key);
  await dbReq(s.put(pl));
  notify();
}

export async function getTracks(id) {
  await openDB();
  const pl = await dbReq(_db.transaction(STORE, 'readonly').objectStore(STORE).get(id));
  if (!pl) return [];
  const n = normalizeLegacyTracks(pl.tracks);
  if (n.changed) {
    pl.tracks = n.tracks;
    await dbReq(_db.transaction(STORE, 'readwrite').objectStore(STORE).put(pl));
  }
  return pl.tracks;
}

export function hiddenListKeyForFolder(folder) {
  return 'folder:' + String(folder || '');
}

export function hiddenListKeyForPlaylist(id) {
  return 'playlist:' + String(id || '');
}

export function getHiddenListKeys() {
  return readHiddenSet();
}

export function isListHidden(key) {
  return readHiddenSet().has(String(key || ''));
}

export function setListHidden(key, hidden) {
  const set = readHiddenSet();
  const k = String(key || '');
  if (!k) return;
  if (hidden) set.add(k);
  else set.delete(k);
  writeHiddenSet(set);
  notify();
}

/** Canonical string key for a track (for dedup & membership checks). */
export function trackKey(t) {
  return t.url || (t.playerId + ':' + t.name);
}

/** Build a Set of track keys for fast membership testing. */
export function buildTrackSet(tracks) {
  return new Set((tracks || []).map(trackKey));
}

// ── CSV ────────────────────────────────────────────────────────────────────

export function exportCsv(playlist) {
  const lines = ['name,ext,playerId,url'];
  for (const t of (playlist.tracks || [])) {
    lines.push([t.name, t.ext || '', t.playerId, t.url || '']
      .map(v => '"' + String(v || '').replace(/"/g, '""') + '"')
      .join(','));
  }
  return lines.join('\n');
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const tracks = [];
  let header = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!header) { header = cols.map(c => c.toLowerCase()); continue; }
    const obj = {};
    header.forEach((h, i) => { obj[h] = cols[i] || ''; });
    if (obj.name && obj.playerid) {
      const baseTrack = {
        name: obj.name,
        ext: obj.ext || '',
        playerId: obj.playerid,
        ...(obj.url ? { url: obj.url } : {}),
      };
      const normalized = normalizeLegacyTrack(baseTrack).track;
      tracks.push({
        ...normalized,
      });
    }
  }
  return tracks;
}

function parseCsvLine(line) {
  const cols = [];
  let i = 0, field = '';
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { field += line[i++]; }
      }
    } else if (line[i] === ',') {
      cols.push(field); field = ''; i++;
    } else {
      field += line[i++];
    }
  }
  cols.push(field);
  return cols;
}
