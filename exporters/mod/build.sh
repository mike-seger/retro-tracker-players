#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

c++ -std=c++17 -O2 -Wall -Wextra -pedantic \
  export_openmpt_stems.cpp \
  -o export_openmpt_stems \
  $(pkg-config --cflags --libs libopenmpt)

echo "Built exporters/mod/export_openmpt_stems"