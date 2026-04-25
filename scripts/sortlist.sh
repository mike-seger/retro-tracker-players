#!/bin/bash

awk -F'/' '
{
orig = $0
n = split($0, p, "/")
key2 = p[n-1]
key1 = p[n]
gsub(/^[[:space:]]"/, "", key2)
gsub(/",?[[:space:]]$/, "", key1)
print key2 "/" key1 "\t" orig
}
' | sort -f -t$'\t' -k1,1 | uniq | cut -f2-