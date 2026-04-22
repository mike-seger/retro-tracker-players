#!/bin/bash
# Generate filelist.json from files/ directory
# Usage: bash generate-filelist.sh [player-dir]
#   No args → generates for all players registered in players.json

generate_one() {
  local dir="$1"
  cd "$dir" || return 1
  if [ ! -d files ]; then
    echo "[]" > filelist.json
    echo "  $dir: 0 entries (no files/ directory)"
    cd - > /dev/null
    return 0
  fi
  find files -type f -not -name '.*' | sort | sed 's|^files/||' | python3 -c "
import sys, json
files = [line.strip() for line in sys.stdin if line.strip()]
json.dump(files, sys.stdout, indent=2, ensure_ascii=False)
print()
" > filelist.json
  local count
  count=$(python3 -c "import json; print(len(json.load(open('filelist.json'))))")
  echo "  $dir: $count entries"
  cd - > /dev/null
}

root="$(cd "$(dirname "$0")/.." && pwd)"

if [ -n "$1" ]; then
  echo "Generating filelist.json for $1..."
  cd "$root" && generate_one "engines/$1"
else
  if [ ! -f "$root/players.json" ]; then
    echo "Error: players.json not found in $root" >&2
    exit 1
  fi
  dirs=$(python3 -c "import json; [print(p['id']) for p in json.load(open('$root/players.json'))]")
  echo "Generating filelist.json for all players..."
  for d in $dirs; do
    cd "$root" && generate_one "engines/$d"
  done
fi
