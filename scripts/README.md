# Scripts

## UI Elements Extractor
Use the extractor script to generate a machine-readable UI element inventory with stable XPath locators and human-readable paths.

It is a headless Playwright tool that visits a live URL, captures a screenshot, and writes an inventory of visible UI elements to `doc/elements.json`.

### Prerequisites

```bash
cd scripts
npm install
npx playwright install chromium
```

### Usage

```
node scripts/extract-ui-elements.mjs --url <url> [options]
```

### Options

| Flag | Default | Description |
|:--------|:-----------|:---------------|
| `--url <url>` | *(required)* | URL to analyse |
| `--out <path>` | `doc/elements.json` | Output JSON path |
| `--screenshot <path>` | `doc/elements-view.png` | Output screenshot path |
| `--wait-ms <n>` | `800` | Extra milliseconds to wait after page load before extracting |
| `--width <n>` | `640` | Accepted for compatibility, but ignored because viewport width is fixed |
| `--height <n>` | `480` | Accepted for compatibility, but ignored because viewport height is fixed |
| `--window-size <WxH>` | `640x480` | Accepted for compatibility, but ignored because viewport is fixed |
| `--plain-screenshot <path>` | `doc/app-screensot.png` | Output plain app screenshot path (no numbering bubbles), captured at fixed `700x900` |
| `--keep-modals` | *(off)* | Skip modal dismissal before screenshot |
| `--all-visible-list-items` | *(off)* | Include every visible list item; by default only the first visible item from each list is included |

Viewport is fixed to `640x480` for element extraction and annotated screenshot generation. The plain screenshot is captured at fixed `700x900`. The sizing flags above are currently ignored so extraction and annotated screenshot output stay stable across runs.

### Example

Start a local server (e.g. VS Code Live Server or `npx serve .`), then run:

```bash
node scripts/extract-ui-elements.mjs --url "http://127.0.0.1:63706/index.html?play=https%3A%2F%2Fmodland.com%2Fpub%2Fmodules%2FFasttracker%25202%2F-%2520unknown%2Feagle%2520trance.xm&folders=trance" --wait-ms 1200
```

Output:

```
Wrote 30 elements to /path/to/retro-tracker-players/doc/elements.json
Saved screenshot to /path/to/retro-tracker-players/doc/elements-view.png
```

Note: by default, the extractor keeps only the first visible `li` per list to reduce repetitive entries. Add `--all-visible-list-items` to restore the previous behavior and include every visible row/item.

The extractor also injects `doc/styles.css` into the page while annotating the screenshot, so the numbering bubbles in `doc/elements-view.png` match the documentation styling.

## Documentation Refresh Script
`scripts/update-doc.sh` rebuilds the generated parts of `doc/README.md` from the current app UI.

It performs these steps:
- Reuses `http://127.0.0.1:8080/index.html` if a local server is already running
- Otherwise starts a temporary `python3 -m http.server 8080` from the repo root
- Runs `scripts/extract-ui-elements.mjs` against that page with `--wait-ms 1200`
- Captures a plain screenshot at `doc/app-screensot.png` (same setup, no bubbles, fixed `700x900` viewport)
- Refreshes `doc/elements.json` and `doc/elements-view.png`
- Updates the generated metadata block in `doc/README.md`
- Updates the generated UI element table in `doc/README.md`
- Normalizes the doc title to `# ReTrap`
- Syncs the screenshot reference in the `## User Interface` section
- Syncs the top-level `README.md` app screenshot line to `![ReTrap app screenshot](doc/app-screensot.png)`

### Usage

```bash
scripts/update-doc.sh
```

### Requirements
- `node` for the extractor and JSON processing
- `python3` for the temporary local HTTP server fallback
- `curl` for local server detection
- Playwright Chromium installed as described above

### Output

Typical output looks like this:

```text
Wrote 30 elements to /path/to/retro-tracker-players/doc/elements.json
Saved screenshot to /path/to/retro-tracker-players/doc/elements-view.png
Saved plain screenshot to /path/to/retro-tracker-players/doc/app-screensot.png
Updated /path/to/retro-tracker-players/doc/README.md
Updated /path/to/retro-tracker-players/README.md
```

## Git Hook Automation
This repo currently has a local `pre-push` hook at `.git/hooks/pre-push` with this behavior:

- Runs `./scripts/update-doc.sh`
- Stages `doc/README.md`

That means a push refreshes the generated documentation first and includes the updated `doc/README.md` in the push.

Git hooks inside `.git/hooks/` are local to your clone. They are not shared through the repository history, so if you want this behavior in another clone you need to install the hook there as well.

Example installation:

```bash
cat > .git/hooks/pre-push <<'EOF'
#!/usr/bin/env bash
set -e
./scripts/update-doc.sh
git add doc/README.md
EOF
chmod +x .git/hooks/pre-push
```

### Output format

`doc/elements.json` contains a top-level object with metadata and an `elements` array sorted by visual position (top → left):

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-04-28T...",
  "sourceUrl": "http://...",
  "screenshotPath": "doc/elements-view.png",
  "viewport": { "width": 640, "height": 480 },
  "stats": { "total": 165 },
  "elements": [
    {
      "key": "button-play",
      "name": "Play",
      "category": "control",
      "tag": "button",
      "id": "btn-play",
      "xpath": "//button[@id='btn-play']",
      "humanXPath": "button#btn-play",
      "notes": ""
    }
  ]
}
```

Each element has:
- `category` — `"control"` (interactive) or `"information"` (text/label)
- `xpath` — absolute XPath for programmatic targeting
- `humanXPath` — CSS-selector-style shorthand for readability
