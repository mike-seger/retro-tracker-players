#!/bin/bash
# Build compact remote module index from remote-mods.txt.gz
# Output: remote-index.json.gz (gzip-compressed)
# Format: { "base": "https://...", "formats": [...], "entries": [[fmtIdx, "Artist/file.ext"], ...] }
# The full path is: formats[fmtIdx] + "/" + entry[1]

INPUT="remote-mods.txt.gz"
OUTPUT="remote-index.json"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f "$INPUT" ]; then
  echo "Error: $INPUT not found" >&2
  exit 1
fi

node -e '
const fs = require("fs");
const zlib = require("zlib");
const buf = fs.readFileSync("'"$INPUT"'");
const lines = zlib.gunzipSync(buf).toString("utf8").trimEnd().split("\n");

const formatSet = new Map();
const entries = [];

for (const line of lines) {
  const tab = line.indexOf("\t");
  if (tab < 0) continue;
  const path = line.substring(tab + 1);
  const slash = path.indexOf("/");
  if (slash < 0) continue;

  const fmt = path.substring(0, slash);
  const rest = path.substring(slash + 1);

  if (!formatSet.has(fmt)) formatSet.set(fmt, formatSet.size);
  entries.push([formatSet.get(fmt), rest]);
}

const formats = Array.from(formatSet.keys());

const index = {
  base: "https://modland.com/pub/modules/",
  formats,
  entries,
};

const json = JSON.stringify(index);
fs.writeFileSync("'"$OUTPUT"'", json);

console.log("Formats:", formats.length);
console.log("Entries:", entries.length);
console.log("Output:", (json.length / 1024 / 1024).toFixed(1) + " MB raw");
'

# Compress output
gzip -9 -f "$OUTPUT"

echo "Wrote ${OUTPUT}.gz"
ls -lh "${OUTPUT}.gz"
