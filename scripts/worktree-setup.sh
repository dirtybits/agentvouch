#!/usr/bin/env bash
#
# worktree-setup.sh — manually prime a fresh git worktree.
#
# A new worktree shares git history but NOT gitignored artifacts: node_modules,
# Rust target/, and .env files are all absent. Cold-populating node_modules from
# scratch (npm install) costs minutes and dwarfs most agent tasks.
#
# Strategy: when explicitly requested, reflink-clone warm artifacts from the main
# worktree (APFS copy-on-write: near-instant, near-zero disk until files diverge).
# A reconciling `npm install` is also explicit because it may take time, touch a
# large tree, or reach the network. Reflink alone can leave stale dependencies
# when the branch's lockfile differs, so use `--install` when dependency
# correctness matters.
#
# Usage:
#   scripts/worktree-setup.sh --web [worktree-dir]
#   scripts/worktree-setup.sh --node-modules --install --env [worktree-dir]
#
# Options:
#   --web           shorthand for --node-modules --install --env
#   --node-modules  reflink root + web node_modules from the main worktree
#   --install       run npm install after any selected copies
#   --env           copy local env files if missing
#   --rust          also clone Rust target/ (~1G; skip for web-only tasks)
#   --keys          also copy .agent-keys/ (only for devnet/on-chain tasks)
#   -h, --help      print usage
#
# Env equivalents for non-interactive shells:
#   WT_NODE_MODULES=1  same as --node-modules
#   WT_INSTALL=1       same as --install
#   WT_COPY_ENV=1      same as --env
#   WT_RUST=1          same as --rust
#   WT_KEYS=1          same as --keys
#
set -euo pipefail

usage() {
  awk '
    NR == 1 { next }
    /^set -euo pipefail$/ { exit }
    /^#/ { sub(/^# ?/, ""); print; next }
    /^$/ { print; next }
  ' "$0"
}

DO_NODE_MODULES=0
DO_INSTALL=0
DO_ENV=0
DO_RUST=0
DO_KEYS=0
DEST_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --web)
      DO_NODE_MODULES=1
      DO_INSTALL=1
      DO_ENV=1
      shift
      ;;
    --node-modules)
      DO_NODE_MODULES=1
      shift
      ;;
    --install)
      DO_INSTALL=1
      shift
      ;;
    --env | --copy-env)
      DO_ENV=1
      shift
      ;;
    --rust)
      DO_RUST=1
      shift
      ;;
    --keys)
      DO_KEYS=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      if [[ $# -gt 1 ]]; then
        echo "Expected at most one worktree directory after --." >&2
        exit 2
      fi
      DEST_ARG="${1:-}"
      shift "$#"
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$DEST_ARG" ]]; then
        echo "Expected at most one worktree directory; got '$DEST_ARG' and '$1'." >&2
        exit 2
      fi
      DEST_ARG="$1"
      shift
      ;;
  esac
done

[[ "${WT_NODE_MODULES:-0}" == "1" ]] && DO_NODE_MODULES=1
[[ "${WT_INSTALL:-0}" == "1" ]] && DO_INSTALL=1
[[ "${WT_COPY_ENV:-0}" == "1" ]] && DO_ENV=1
[[ "${WT_RUST:-0}" == "1" ]] && DO_RUST=1
[[ "${WT_KEYS:-0}" == "1" ]] && DO_KEYS=1

if [[ "$DO_NODE_MODULES$DO_INSTALL$DO_ENV$DO_RUST$DO_KEYS" == "00000" ]]; then
  usage
  echo
  echo "No setup actions selected; exiting without changing this worktree." >&2
  exit 0
fi

# Main repo root = parent of the shared (common) git dir. Resolves correctly
# whether run from the main checkout OR from inside a linked worktree, where
# --show-toplevel would wrongly return the worktree itself.
MAIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
DEST="$(cd "${DEST_ARG:-$PWD}" && pwd)"

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
if [[ "$DO_NODE_MODULES" == "1" ]]; then
  echo "node_modules:"
  clone "$MAIN/node_modules"     "$DEST/node_modules"
  clone "$MAIN/web/node_modules" "$DEST/web/node_modules"
fi

# 2. Reconcile against THIS worktree's lockfile. Reflinking main alone is stale
#    whenever the branch's deps differ — the new package is simply absent, so the
#    server boots and then 500s with a cryptic module-not-found. With node_modules
#    pre-warmed this is a fast delta install, not a cold one, and it is idempotent:
#    a near-no-op when the tree is already in sync.
if [[ "$DO_INSTALL" == "1" ]]; then
  echo "install: reconciling against package-lock.json"
  ( cd "$DEST" && npm install --no-audit --no-fund --prefer-offline )
fi

# 3. env files — the other thing `npm run dev` needs to boot. Copy-if-missing so
#    re-runs never clobber a worktree-local override.
if [[ "$DO_ENV" == "1" ]]; then
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
fi

# 4. Rust target/ — opt-in, only when the task touches the Anchor program.
if [[ "$DO_RUST" == "1" ]]; then
  echo "rust target:"
  clone "$MAIN/target" "$DEST/target"
fi

# 5. On-chain keypairs — opt-in, only for devnet/on-chain smoke tests.
if [[ "$DO_KEYS" == "1" ]]; then
  echo "keys:"
  clone "$MAIN/.agent-keys" "$DEST/.agent-keys"
fi

echo "Done."
