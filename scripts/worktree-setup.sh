#!/usr/bin/env bash
#
# worktree-setup.sh — make a fresh git worktree instantly usable.
#
# A new worktree shares git history but NOT gitignored artifacts: node_modules,
# Rust target/, and .env files are all absent. Cold-populating them (npm install
# + cargo build) costs minutes and dwarfs most agent tasks. This script instead
# reflink-clones them (APFS copy-on-write): near-instant, near-zero disk until
# files actually diverge, and fully isolated — safe even if the worktree's
# branch changes dependencies.
#
# Usage:
#   scripts/worktree-setup.sh <worktree-dir>   # explicit target
#   scripts/worktree-setup.sh                   # defaults to $PWD
#
# Env flags:
#   WT_RUST=1     also clone Rust target/ (~1G; skip for web-only tasks — default off)
#   WT_KEYS=1     also copy .agent-keys/ + on-chain keypairs (only for devnet/on-chain tasks)
#
set -euo pipefail

# Main repo = this script's repo root. Resolve regardless of CWD.
MAIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && git rev-parse --show-toplevel)"
DEST="$(cd "${1:-$PWD}" && pwd)"

if [[ "$DEST" == "$MAIN" ]]; then
  echo "Refusing to run against the main worktree ($MAIN)." >&2
  exit 1
fi

# Prefer APFS reflink (cp -c): instant + copy-on-write. Fall back to a plain
# recursive copy only if reflink is unavailable.
clone() {
  local src="$1" dst="$2"
  [[ -e "$src" ]] || return 0
  [[ -e "$dst" ]] && { echo "  skip (exists): $dst"; return 0; }
  if cp -c -R "$src" "$dst" 2>/dev/null; then
    echo "  reflink: $src -> $dst"
  else
    cp -R "$src" "$dst"
    echo "  copy:    $src -> $dst"
  fi
}

echo "Setting up worktree: $DEST"

# 1. node_modules — root + web workspace. The expensive one.
echo "node_modules:"
clone "$MAIN/node_modules"     "$DEST/node_modules"
clone "$MAIN/web/node_modules" "$DEST/web/node_modules"

# 2. env files — what makes `npm run dev` actually boot.
echo "env files:"
for f in web/.env.local web/.vercel/.env.preview.local web/.vercel/.env.production.local; do
  if [[ -f "$MAIN/$f" ]]; then
    mkdir -p "$DEST/$(dirname "$f")"
    cp "$MAIN/$f" "$DEST/$f"
    echo "  copy: $f"
  fi
done

# 3. Rust target/ — opt-in, only when the task touches the Anchor program.
if [[ "${WT_RUST:-0}" == "1" ]]; then
  echo "rust target (WT_RUST=1):"
  clone "$MAIN/target" "$DEST/target"
fi

# 4. On-chain keypairs — opt-in, only for devnet/on-chain smoke tests.
if [[ "${WT_KEYS:-0}" == "1" ]]; then
  echo "keys (WT_KEYS=1):"
  clone "$MAIN/.agent-keys" "$DEST/.agent-keys"
fi

echo "Done. \`npm run dev\` should boot without an install."
