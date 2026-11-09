#!/bin/sh
# Clear jsDelivr's cache of this plug-in at @latest, after a new tag: jsDelivr
# resolves @latest file by file and keeps each answer (a failure too) for up
# to a day. Run from the repository's root.
set -e
cd "$(dirname "$0")/.."
# jsDelivr caches each spelling of the owner separately: both are purged.
for owner_repo in ${1:-uplus-type/fontra-tutorials Uplus-Type/fontra-tutorials}; do
  for f in plugin.json init.js panel.js tour.js icon.svg tours/*.js; do
    printf '%s/%s: ' "$owner_repo" "$f"
    curl -sS "https://purge.jsdelivr.net/gh/$owner_repo@latest/$f" | grep -o '"status": *"[a-z]*"' || echo
  done
done
