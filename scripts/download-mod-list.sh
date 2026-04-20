#!/bin/bash

cat allmods.txt | grep -E "\.(ahx|mod|xm|it|s3m|sid)$" | sort | gzip>remote-mods.txt.gz