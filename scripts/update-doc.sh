#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
README_PATH="${REPO_ROOT}/doc/README.md"
ROOT_README_PATH="${REPO_ROOT}/README.md"
ELEMENTS_PATH="${REPO_ROOT}/doc/elements.json"
PLAIN_SHOT_REL="doc/app-screensot.png"

if [[ ! -f "${README_PATH}" ]]; then
  echo "Missing file: ${README_PATH}" >&2
  exit 1
fi

if [[ ! -f "${ROOT_README_PATH}" ]]; then
  echo "Missing file: ${ROOT_README_PATH}" >&2
  exit 1
fi

if [[ ! -f "${ELEMENTS_PATH}" ]]; then
  echo "Missing file: ${ELEMENTS_PATH}" >&2
  exit 1
fi

version="$(git -C "${REPO_ROOT}" describe --tags --always --abbrev=7 2>/dev/null || git -C "${REPO_ROOT}" rev-parse --short HEAD)"
version="$(printf '%s' "${version}" | sed -E 's/-g[0-9a-f]+$//')"
stamp="$(date '+%Y-%m-%d %H:%M')"
screenshot_rel="$(node -e 'const fs=require("node:fs"); const p=process.argv[1]; const j=JSON.parse(fs.readFileSync(p,"utf8")); let s=String(j.screenshotPath||"elements-view.png").trim(); s=s.replace(/^\.\//,"").replace(/^doc\//,""); if(!s) s="elements-view.png"; process.stdout.write(s);' "${ELEMENTS_PATH}")"

meta_tmp="$(mktemp)"
table_tmp="$(mktemp)"
work_tmp="$(mktemp)"

server_pid=''
started_server=0
cleanup() {
  rm -f "${meta_tmp}" "${table_tmp}" "${work_tmp}"
  if [[ "${started_server}" -eq 1 && -n "${server_pid}" ]]; then
    kill "${server_pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Refresh screenshot + element map on each run.
if curl -fsS "http://127.0.0.1:8080/index.html" >/dev/null 2>&1; then
  base_url="http://127.0.0.1:8080/index.html"
else
  (cd "${REPO_ROOT}" && python3 -m http.server 8080 >/tmp/retrap-doc-server.log 2>&1) &
  server_pid=$!
  started_server=1
  base_url="http://127.0.0.1:8080/index.html"
  # Give the temporary server a moment to accept connections.
  for _ in {1..20}; do
    if curl -fsS "${base_url}" >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
fi

node "${REPO_ROOT}/scripts/extract-ui-elements.mjs" --url "${base_url}" --wait-ms 1200 --plain-screenshot "${REPO_ROOT}/${PLAIN_SHOT_REL}"

cat > "${meta_tmp}" <<EOF
<!-- AUTO:DOC_META:START -->
| Version | Updated |
|:--|:--|
| ${version} | ${stamp} |
<!-- AUTO:DOC_META:END -->
EOF

node - "${ELEMENTS_PATH}" > "${table_tmp}" <<'NODE'
const fs = require('node:fs');

const elementsPath = process.argv[2];
const data = JSON.parse(fs.readFileSync(elementsPath, 'utf8'));
const rows = Array.isArray(data.elements) ? data.elements : [];
const digits = Math.max(2, String(rows.length).length);

function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escMd(v) {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

const out = [];
out.push('<!-- AUTO:UI_ELEMENT_TABLE:START -->');
out.push('<div id="ui-element-list" style="max-height: 400px; overflow-y: auto; overflow-x: visible;">');
out.push('');
out.push('| # | Name | Selector |');
out.push('|:--|:--|:--|');

for (let i = 0; i < rows.length; i++) {
  const row = rows[i] || {};
  const no = String(i + 1).padStart(digits, '0');
  const name = escMd(row.name || row.key || '');
  const selector = escMd(row.humanXPath || row.xpath || '');
  out.push(`| ${no} | ${name} | ${selector} |`);
}

out.push('');
out.push('</div>');
out.push('<!-- AUTO:UI_ELEMENT_TABLE:END -->');

process.stdout.write(out.join('\n') + '\n');
NODE

normalize_title() {
  local file="$1"
  awk '
    NR == 1 { print "# ReTrap"; next }
    { print }
  ' "${file}" > "${work_tmp}"
  mv "${work_tmp}" "${file}"
}

sync_ui_image_line() {
  local file="$1"
  local image_path="$2"

  if grep -qE '^[[:space:]]*![[]Annotated user interface map[]]\([^)]*\)[[:space:]]*$' "${file}"; then
    awk -v img="${image_path}" '
      BEGIN { replaced = 0 }
      {
        if ($0 ~ /^[[:space:]]*![[]Annotated user interface map[]]\([^)]*\)[[:space:]]*$/) {
          if (!replaced) {
            print "![Annotated user interface map](" img ")"
            replaced = 1
          }
          next
        }
        print
      }
    ' "${file}" > "${work_tmp}"
  else
    awk -v img="${image_path}" '
      BEGIN { inserted = 0 }
      {
        print
        if (!inserted && $0 == "## User Interface") {
          print ""
          print "![Annotated user interface map](" img ")"
          inserted = 1
        }
      }
    ' "${file}" > "${work_tmp}"
  fi

  mv "${work_tmp}" "${file}"
}

sync_app_image_line() {
  local file="$1"
  local image_path="$2"

  if grep -qE '^[[:space:]]*![[]ReTrap app screenshot[]]\([^)]*\)[[:space:]]*$' "${file}"; then
    awk -v img="${image_path}" '
      BEGIN { replaced = 0 }
      {
        if ($0 ~ /^[[:space:]]*![[]ReTrap app screenshot[]]\([^)]*\)[[:space:]]*$/) {
          if (!replaced) {
            print "![ReTrap app screenshot](" img ")"
            replaced = 1
          }
          next
        }
        print
      }
    ' "${file}" > "${work_tmp}"
  else
    awk -v img="${image_path}" '
      BEGIN { inserted = 0 }
      {
        print
        if (!inserted && $0 ~ /^Demo:[[:space:]]/) {
          print ""
          print "![ReTrap app screenshot](" img ")"
          inserted = 1
        }
      }
      END {
        if (!inserted) {
          print ""
          print "![ReTrap app screenshot](" img ")"
        }
      }
    ' "${file}" > "${work_tmp}"
  fi

  mv "${work_tmp}" "${file}"
}

normalize_title "${README_PATH}"
sync_ui_image_line "${README_PATH}" "${screenshot_rel}"
sync_app_image_line "${ROOT_README_PATH}" "${PLAIN_SHOT_REL}"

insert_after_first_heading_if_missing() {
  local file="$1"
  local marker="$2"
  local block_file="$3"

  if grep -q "${marker}" "${file}"; then
    return
  fi

  awk -v bf="${block_file}" '
    NR == 1 {
      print
      print ""
      while ((getline line < bf) > 0) print line
      close(bf)
      print ""
      next
    }
    { print }
  ' "${file}" > "${work_tmp}"
  mv "${work_tmp}" "${file}"
}

insert_before_keyboard_if_missing() {
  local file="$1"
  local marker="$2"
  local block_file="$3"

  if grep -q "${marker}" "${file}"; then
    return
  fi

  awk -v bf="${block_file}" '
    BEGIN { inserted = 0 }
    /^## Keyboard Shortcuts$/ && !inserted {
      while ((getline line < bf) > 0) print line
      close(bf)
      print ""
      inserted = 1
    }
    { print }
    END {
      if (!inserted) {
        print ""
        while ((getline line < bf) > 0) print line
        close(bf)
      }
    }
  ' "${file}" > "${work_tmp}"
  mv "${work_tmp}" "${file}"
}

replace_block() {
  local file="$1"
  local start_marker="$2"
  local end_marker="$3"
  local block_file="$4"

  awk -v start="${start_marker}" -v end="${end_marker}" -v bf="${block_file}" '
    BEGIN {
      in_block = 0
      replaced = 0
      block = ""
      while ((getline line < bf) > 0) block = block line ORS
      close(bf)
    }
    {
      if ($0 == start) {
        printf "%s", block
        in_block = 1
        replaced = 1
        next
      }
      if (in_block) {
        if ($0 == end) in_block = 0
        next
      }
      print
    }
    END {
      if (!replaced) {
        print ""
        printf "%s", block
      }
    }
  ' "${file}" > "${work_tmp}"
  mv "${work_tmp}" "${file}"
}

insert_after_first_heading_if_missing "${README_PATH}" "AUTO:DOC_META:START" "${meta_tmp}"
insert_before_keyboard_if_missing "${README_PATH}" "AUTO:UI_ELEMENT_TABLE:START" "${table_tmp}"
insert_after_first_heading_if_missing "${ROOT_README_PATH}" "AUTO:DOC_META:START" "${meta_tmp}"

replace_block "${README_PATH}" "<!-- AUTO:DOC_META:START -->" "<!-- AUTO:DOC_META:END -->" "${meta_tmp}"
replace_block "${README_PATH}" "<!-- AUTO:UI_ELEMENT_TABLE:START -->" "<!-- AUTO:UI_ELEMENT_TABLE:END -->" "${table_tmp}"
replace_block "${ROOT_README_PATH}" "<!-- AUTO:DOC_META:START -->" "<!-- AUTO:DOC_META:END -->" "${meta_tmp}"

echo "Updated ${README_PATH}"
echo "Updated ${ROOT_README_PATH}"
