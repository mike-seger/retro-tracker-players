# Retro Tracker Players — Help

A browser-based player for classic tracker module formats (MOD, XM, S3M, IT, AHX, SID) with local file lists and Modland search.

---

## Keyboard Shortcuts

### Playback & Navigation

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play / Pause |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Previous / next track |
| <kbd>←</kbd> / <kbd>→</kbd> | Seek back / forward 5 s |
| <kbd>Enter</kbd> | Play focused track |
| <kbd>Shift+Enter</kbd> | Toggle selection on focused track |
| <kbd>/</kbd> | Focus the search / filter box |
| <kbd>s</kbd> | Share / copy link |
| <kbd>c</kbd> | Copy selected filenames to clipboard |
| <kbd>z</kbd> | Download selected tracks as ZIP |
| <kbd>r</kbd> | Random Modland track (Modland mode) |
| <kbd>f</kbd> | Toggle Folder filter dropdown |
| <kbd>a</kbd> | Toggle Artist filter dropdown |
| <kbd>t</kbd> | Toggle Format / Type filter dropdown |
| <kbd>x</kbd> | Clear search filter |
| <kbd>?</kbd> | Help overlay |
| <kbd>Esc</kbd> | Blur search / close help / close dropdown |

> Shortcuts are suppressed while the cursor is inside a text input, select, or textarea.

### Inside a Dropdown (F / A / T / Range)

| Key | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>↓</kbd> | Navigate between items (wraps) |
| <kbd>Space</kbd> | Toggle focused checkbox; select focused range entry |
| <kbd>Enter</kbd> | Accept selection and close dropdown |
| <kbd>Esc</kbd> | Undo all changes since the dropdown opened and close |

Opening a dropdown automatically closes any other open dropdown.

### Toolbar

| Key | Action |
|---|---|
| <kbd>S</kbd> | Share (copy deep-link URL) |
| <kbd>C</kbd> | Copy selected file URLs to clipboard |
| <kbd>Z</kbd> | Download selected tracks as ZIP |
| <kbd>R</kbd> | Random (shuffle a slice of the index) |
| <kbd>+</kbd> | Add all visible Modland results to saved list |
| <kbd>-</kbd> | Delete all visible saved Modland tracks |
| <kbd>F</kbd> | Open / close Folder filter |
| <kbd>A</kbd> | Open / close Artist filter |
| <kbd>T</kbd> | Open / close Format filter |
| <kbd>?</kbd> | Open / close Help |
| <kbd>X</kbd> | Clear active filter |

### Modland Rows

| Key | Action |
|---|---|
| <kbd>Enter</kbd> | Add focused search-result row to saved list |
| <kbd>Backspace</kbd> / <kbd>Delete</kbd> | Remove focused saved-list row |

### Dropdown Panels

| Key | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>↓</kbd> | Move focus between options |
| <kbd>Space</kbd> | Toggle checkbox / select option |
| <kbd>Enter</kbd> | Accept selection and close panel |
| <kbd>Esc</kbd> | Undo changes and close panel |

### Confirmation Dialogs

| Key | Action |
|---|---|
| <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> | Cycle between Yes and No buttons |
| <kbd>←</kbd> / <kbd>→</kbd> | Move between Yes and No buttons |
| <kbd>Enter</kbd> | Activate focused button |
| <kbd>Esc</kbd> | Cancel (same as No) |

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
- Double-tap or long-press a track to search Modland for that artist.

---

## Selection & Export

- Click the **checkbox** at the far left of any track to select it.
- Use <kbd>Enter</kbd> / <kbd>Shift+Enter</kbd> to play or toggle selection on the focused track.
- Use the **bulk checkbox** (top-left of the list) to cycle: all → none → restore previous selection.
- **C** button: copy selected file links to clipboard (double-quoted, comma-separated).
- **Z** button: download selected tracks as a **.zip** archive (remote tracks include a `urllist.json`).

---

## Deep Links

The **S** (share) button generates a URL that encodes the current track and filter state.  
Sharing or bookmarking this URL lets you jump straight back to the same track and context.

| Parameter | Description | Example |
|---|---|---|
| `play` | URL of the track to load | `play=engines/mod/files/…` |
| `source` | Pre-select source mode | `source=modland` |
| `folder` | Pre-select the Folder dropdown | `folder=trance` |
| `artist` | Pre-select the Artist dropdown | `artist=dct2` |
| `search` | Pre-fill the search / filter input | `search=trance` |

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