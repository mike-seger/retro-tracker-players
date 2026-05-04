# Persistence Layer

ReTrap uses two browser storage mechanisms: **`localStorage`** for lightweight key/value state, and **`IndexedDB`** for user playlist data. There is no server-side storage.

---

## localStorage keys

| Key | Written by | Read by | Format | Description |
|-----|-----------|---------|--------|-------------|
| `app-context` | `persistence.js` `persistContext()` | `mode.js` on mode switch | JSON object | Active filter state: `mode`, `filter`, `folders[]`, `playlists[]`, `artists[]`, `formats[]`. Saved on every filter/mode change. |
| `current-track` | `player.js` `loadAndPlay()`, `persistence.js` `savePlayPos()` | `app.js` on startup, `player.js` on subsong change | JSON object | Last played track: `playerId`, `name`, `mode`, `wasPlaying`, `playPos` (seconds, updated on page hide). Used to restore playback position across reloads. |
| `auto-resume` | `prompts.js` (set to `'1'` when user accepts resume prompt) | `app.js` startup (desktop-only) | `'1'` or absent | Desktop-only flag. If set, app auto-resumes on reload without prompting. Cleared when user deliberately pauses. |
| `playlist-font-size` | `playlist.js` `setPlaylistFontSize()` | `app.js` startup | Number string (px) | Font size of the track list. Set via pinch-to-zoom or keyboard `z`/`Z`. |
| `selected-tracks` | `selection.js` `saveSelection()` | `selection.js` `restoreSelection()` | JSON array of `{playerId, name}` | Persisted checkbox selection in local mode. Restored after page reload. |
| `selected-modland` | `selection.js` `saveSelection()` | `selection.js` `restoreSelection()` | JSON array of `{playerId, name}` | Persisted checkbox selection in Modland mode. Separate key from local mode. |
| `remote-urls` | `modland.js` `saveModlandUrls()` | `modland.js` `loadModlandTracks()` | JSON array of URL strings | The user's Modland track list (all added remote URLs). Loaded on startup and after every add/delete. URLs are normalized on save to fix any historical double-encoding. |
| `retrotrap-hidden-lists-v1` | `playlist-manager.js` `setListHidden()` | `playlist-manager.js` `isListHidden()`, `getHiddenListKeys()` | JSON array of key strings | Set of hidden list keys. Keys are prefixed: `folder:<name>` for local folders, `playlist:<id>` for user playlists. Controls visibility in the folder/list panel and the merged track list. |
| `retrotrap-system-lists-shown-v1` | `playlist-manager.js` `setSystemFolderVisible()` | `playlist-manager.js` `isSystemFolderVisible()`, `isSystemKeyVisible()` | JSON array of canonical key strings | Opt-in set for system folders (e.g. `__uncategorized__`). System folders are hidden by default; adding their canonical key here makes them visible. |

---

## IndexedDB

**Database**: `retrotrap` (version 1)  
**Object store**: `playlists` (keyPath: `id`)  
**Managed by**: `js/playlist-manager.js`

### Record schema

```json
{
  "id": "lz3k2abc4",
  "name": "My Playlist",
  "tracks": [
    {
      "playerId": "mod",
      "name": "Artist/filename.mod",
      "url": "https://modland.com/…/filename.mod"
    }
  ]
}
```

- `id` — random alphanumeric UID (`Date.now().toString(36) + random`).
- `name` — display name. Must be unique (case-insensitive). `create()` and `rename()` throw `Error` on duplicate.
- `tracks` — ordered array of track objects. Deduplication is by `trackKey(t)` = `t.url` or `playerId + ':' + name`.

### API surface (`playlist-manager.js` exports)

| Function | Description |
|----------|-------------|
| `init()` | Opens the IndexedDB connection. Must be called before any other DB operation. |
| `getAll()` | Returns all playlists sorted by name. |
| `create(name)` | Creates a new playlist. Throws on duplicate name. |
| `rename(id, name)` | Renames a playlist. Throws on duplicate name. |
| `remove(id)` | Deletes a playlist and all its tracks. |
| `addTrack(id, track)` | Adds a track to a playlist. No-ops (returns `false`) if already present. |
| `removeTrack(id, key)` | Removes a track by `trackKey`. |
| `getTracks(id)` | Returns the track array for a playlist. |
| `checkNameExists(name, excludeId?)` | Returns `true` if a playlist with that name exists (excluding one ID for rename). |
| `onChange(fn)` | Subscribes to any DB or visibility change. Returns an unsubscribe function. |
| `trackKey(t)` | Canonical dedup key: `t.url` or `playerId + ':' + name`. |

---

## How state flows at startup

```
app.js init
  ├─ pm.init()                          — open IndexedDB
  ├─ refreshUserPlaylistTracks()        — load all playlist tracks into S._userPlaylistTracks
  ├─ load filelist.json + urllists.json — populate S.localFiles
  ├─ rebuildMergedFiles()               — merge local + user-playlist tracks; enrich with membership
  ├─ restoreContext() (from mode.js)    — read 'app-context' → restore filters & mode
  ├─ restoreSelection()                 — read 'selected-tracks' / 'selected-modland'
  ├─ loadModlandTracks()                — read 'remote-urls'
  └─ localStorage.getItem('current-track')
       ├─ desktop + auto-resume=1  → loadAndPlay() silently
       └─ mobile / no flag         → showResumePrompt() (modal tap required for iOS AudioContext)
```

---

## Notes

- All `localStorage` reads are wrapped in `try/catch`; failures are silently swallowed.
- `persistContext()` guards on `S._appReady` to avoid saving a blank state during init.
- `savePlayPos()` is triggered by `visibilitychange` (hidden) and `pagehide` to capture position before the page unloads.
- The `retrotrap-hidden-lists-v1` and `retrotrap-system-lists-shown-v1` keys are managed independently from the DB; changes to either call `notify()` so that `pm.onChange()` subscribers re-render.
