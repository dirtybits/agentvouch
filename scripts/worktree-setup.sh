#!/usr/bin/env bash
#
# worktree-setup.sh — make a fresh git worktree instantly usable.
#
# A new worktree shares git history but NOT gitignored artifacts: node_modules,
# Rust target/, and .env files are all absent. Cold-populating node_modules from
# scratch (npm install) costs minutes and dwarfs most agent tasks.
#
# Strategy: reflink-clone the warm artifacts from the main worktree (APFS
# copy-on-write: near-instant, near-zero disk until files diverge), then run a
# reconciling `npm install` so THIS worktree's package-lock.json wins. The clone
# turns that install into a fast delta (seconds) instead of a cold build; the
# install is what stays correct when the branch's deps differ from main's.
# Reflink alone would silently ship a stale tree — a newly added package missing,
# which boots fine but then 500s at runtime.
#
# Usage:
#   scripts/worktree-setup.sh <worktree-dir>   # explicit target
#   scripts/worktree-setup.sh                   # defaults to $PWD
#
# Env flags:
#   WT_RUST=1        also clone Rust target/ (~1G; skip for web-only tasks — default off)
#   WT_KEYS=1        also copy .agent-keys/ + on-chain keypairs (only for devnet/on-chain tasks)
#   WT_NO_INSTALL=1  skip the reconciling npm install (only when deps already match main)
#
set -euo pipefail

# Main repo root = parent of the shared (common) git dir. Resolves correctly
# whether run from the main checkout OR from inside a linked worktree, where
# --show-toplevel would wrongly return the worktree itself.
MAIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
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

# 1. node_modules — root + web workspace. Reflink main's warm tree as a cache
#    primer (the expensive bit to build cold), then reconcile in step 2.
echo "node_modules:"
clone "$MAIN/node_modules"     "$DEST/node_modules"
clone "$MAIN/web/node_modules" "$DEST/web/node_modules"

# 2. Reconcile against THIS worktree's lockfile. Reflinking main alone is stale
#    whenever the branch's deps differ — the new package is simply absent, so the
#    server boots and then 500s with a cryptic module-not-found. With node_modules
#    pre-warmed this is a fast delta install, not a cold one, and it is idempotent:
#    a near-no-op when the tree is already in sync.
if [[ "${WT_NO_INSTALL:-0}" == "1" ]]; then
  echo "install: skipped (WT_NO_INSTALL=1)"
else
  echo "install: reconciling against package-lock.json"
  ( cd "$DEST" && npm install --no-audit --no-fund --prefer-offline )
fi

# 3. env files — the other thing `npm run dev` needs to boot. Copy-if-missing so
#    re-runs never clobber a worktree-local override.
echo "env files:"
for f in web/.env.local web/.vercel/.env.preview.local web/.vercel/.env.production.local; do
  [[ -f "$MAIN/$f" ]] || continue
  if [[ -e "$DEST/$f" ]]; then
    echo "  skip (exists): $f"
    continue
  fi
  mkdir -p "$DEST/$(dirname "$f")"
  cp "$MAIN/$f" "$DEST/$f"
  echo "  copy: $f"
done

# 4. Rust target/ — opt-in, only when the task touches the Anchor program.
if [[ "${WT_RUST:-0}" == "1" ]]; then
  echo "rust target (WT_RUST=1):"
  clone "$MAIN/target" "$DEST/target"
fi

# 5. On-chain keypairs — opt-in, only for devnet/on-chain smoke tests.
if [[ "${WT_KEYS:-0}" == "1" ]]; then
  echo "keys (WT_KEYS=1):"
  clone "$MAIN/.agent-keys" "$DEST/.agent-keys"
fi

echo "Done. \`npm run dev\` should boot clean."
