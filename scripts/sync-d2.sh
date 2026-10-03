#!/usr/bin/env bash
# Copies seals.report's pure Featured files into src/shell/d2/ so the Rotators tab (and the RAD assistant's loot
# tables) match the site. Usage: scripts/sync-d2.sh [path to the d2-seals-report checkout]
# The browser needs ".js" on relative imports (Next.js doesn't), so those are added; nothing else changes.
set -euo pipefail
SITE="${1:-../d2-seals-report}"
OUT="$(dirname "$0")/../src/shell/d2"
for f in rotations rotators featured-sections live-rotations featured-week loot-tables; do
  sed -E 's#(from "\./[a-z-]+)";#\1.js";#' "$SITE/lib/$f.js" > "$OUT/$f.js"
done
echo "Copied into $OUT: rotations, rotators, featured-sections, live-rotations, featured-week, loot-tables"
