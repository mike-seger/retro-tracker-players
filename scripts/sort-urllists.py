#!/usr/bin/env python3
"""
Sort and deduplicate all urllists.json files under engines/.
Sort key: last two URL path segments (artist/filename), case-insensitive.
This matches the algorithm in scripts/sortlist.sh.
"""

import json
import os
import glob

def sort_key(url):
    parts = url.rstrip('/').split('/')
    if len(parts) >= 2:
        return (parts[-2] + '/' + parts[-1]).lower()
    return url.lower()

def sort_dedup(urls):
    seen = set()
    unique = []
    for url in urls:
        if url not in seen:
            seen.add(url)
            unique.append(url)
    unique.sort(key=sort_key)
    return unique

def process_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    changed = False
    for key in data:
        if isinstance(data[key], list):
            original = data[key]
            processed = sort_dedup(original)
            if processed != original:
                data[key] = processed
                changed = True

    if changed:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
            f.write('\n')
        print(f"Updated:    {path}")
    else:
        print(f"No changes: {path}")

script_dir = os.path.dirname(os.path.abspath(__file__))
engines_dir = os.path.join(os.path.dirname(script_dir), 'engines')
files = sorted(glob.glob(os.path.join(engines_dir, '*/urllists.json')))

if not files:
    print("No urllists.json files found under engines/")
else:
    for path in files:
        process_file(path)
