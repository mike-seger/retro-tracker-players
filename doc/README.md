# Retro Tracker Players — Help

A browser-based player for classic tracker module formats (MOD, XM, S3M, IT, AHX, SID) with local file lists and Modland search.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play / Pause |
| <kbd>←</kbd> / <kbd>→</kbd> | Seek back / forward 5 s |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Previous / next track |
| <kbd>Enter</kbd> | Play focused track |
| <kbd>Shift+Enter</kbd> | Toggle selection on focused track |
| <kbd>/</kbd> | Jump to search box |
| <kbd>Esc</kbd> | Close help / blur search |

---

## Modes

### Local mode
Shows tracks and playlists bundled with the app (MOD, AHX, SID files).  
Use **Folder**, **Artist**, and **Format** dropdowns to narrow the list.

### Modland mode
Searches the [Modland](https://modland.com) remote index (loaded once per session).  
Type at least 2 characters in the search box, or pick a folder from the dropdown.

- **+** button on a result: save it to your personal Modland list.
- **Add all**: save all current search results to your list.
- **Random**: browse a random shuffled slice of the full index.
- **Del all**: remove visible tracks from your list (with confirmation).

---

## Selection & Export

- Click the **checkbox** at the far left of any track to select it.
- Use the **bulk checkbox** (top-left of the list) to select all / none / restore previous selection.
- **C** button: copy selected file URLs to clipboard.
- **Z** button: download selected tracks as a **.zip** archive (with a `urllist.json` for remote tracks).

---

## Deep Links

The **S** (share) button generates a URL that encodes the current track and filter state.  
Sharing or bookmarking this URL lets you jump straight back to the same track and context.

---

## Touch Gestures

| Gesture | Action |
|---|---|
| Swipe left on playlist | Next track |
| Swipe right on playlist | Previous track |
| Pinch on playlist | Resize track list font |
| Long-press a track | Search Modland for that artist |
| Double-tap a track | Search Modland for that artist |

---

## Resume

When you reload the page, a prompt offers to resume where you left off.  
Check **Always resume automatically** to skip the prompt in future sessions.

---

## Debug Log

Double-click (or long-press) the transport bar to reveal a rolling debug/timing log.  
Long-press the log to copy or share its contents.

---

## Development

The source of this app is available here: [retro-tracker-players](https://github.com/mike-seger/retro-tracker-players)