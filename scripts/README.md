# Scripts

## extract-ui-elements.mjs

Headless Playwright tool that visits a live URL, captures a screenshot, and writes an inventory of visible UI elements to `doc/elements.json`.

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
| `--window-size <WxH>` | `1366x900` | Browser viewport size |
| `--width <n>` | — | Override viewport width (alternative to `--window-size`) |
| `--height <n>` | — | Override viewport height (alternative to `--window-size`) |
| `--wait-ms <n>` | `1000` | Extra milliseconds to wait after page load before extracting |
| `--keep-modals` | *(off)* | Skip modal dismissal before screenshot |
| `--all-visible-list-items` | *(off)* | Include every visible list item; by default only the first visible item from each list is included |

### Example

Start a local server (e.g. VS Code Live Server or `npx serve .`), then run:

```bash
node scripts/extract-ui-elements.mjs --url "http://127.0.0.1:63706/index.html?play=https%3A%2F%2Fmodland.com%2Fpub%2Fmodules%2FFasttracker%25202%2F-%2520unknown%2Feagle%2520trance.xm&folders=trance" --window-size 640x480 --wait-ms 1200
```

Output:

```
Wrote 165 elements to /path/to/retro-tracker-players/doc/elements.json
Saved screenshot to /path/to/retro-tracker-players/doc/elements-view.png
```

Note: by default, the extractor keeps only the first visible `li` per list to reduce repetitive entries. Add `--all-visible-list-items` to restore the previous behavior and include every visible row/item.

### Output format

`doc/elements.json` contains a top-level object with metadata and an `elements` array sorted by visual position (top → left):

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-04-28T...",
  "sourceUrl": "http://...",
  "screenshotPath": "doc/elements-view.png",
  "viewport": { "width": 640, "height": 1024 },
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
