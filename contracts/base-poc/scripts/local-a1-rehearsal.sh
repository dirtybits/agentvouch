#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${LOCAL_A1_ANVIL_PORT:-8547}"
RPC_URL="http://127.0.0.1:${PORT}"
ANVIL_LOG="${TMPDIR:-/tmp}/agentvouch-a1-anvil-${PORT}.log"

for command in anvil cast forge; do
  command -v "$command" >/dev/null || {
    echo "missing required command: $command" >&2
    exit 1
  }
done

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port ${PORT} is already in use; choose LOCAL_A1_ANVIL_PORT" >&2
  exit 1
fi

MNEMONIC="test test test test test test test test test test test junk"
anvil --host 127.0.0.1 --port "$PORT" --chain-id 84532 --mnemonic "$MNEMONIC" --silent >"$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!

cleanup() {
  kill "$ANVIL_PID" >/dev/null 2>&1 || true
  wait "$ANVIL_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in $(seq 1 40); do
  if cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if [[ "$(cast chain-id --rpc-url "$RPC_URL")" != "84532" ]]; then
  echo "local rehearsal chain id mismatch" >&2
  exit 1
fi

# These are disposable local-only keys derived from Anvil's standard test mnemonic.
# They are never printed, persisted in the repo, or valid for a public deployment.
export LOCAL_A1_REHEARSAL=true
export LOCAL_A1_BROADCASTER_PRIVATE_KEY="$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 0)"
export LOCAL_A1_STAGING_ADMIN_PRIVATE_KEY="$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 1)"
export LOCAL_A1_FINAL_ADMIN_PRIVATE_KEY="$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 2)"
export LOCAL_A1_AUTHOR_PRIVATE_KEY="$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 3)"
export LOCAL_A1_BUYER_PRIVATE_KEY="$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 4)"
export LOCAL_A1_VOUCHER_ONE_PRIVATE_KEY="$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 5)"
export LOCAL_A1_VOUCHER_TWO_PRIVATE_KEY="$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 6)"
export LOCAL_A1_RESOLVER_PRIVATE_KEY="$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 7)"
export LOCAL_A1_PAUSE_AUTHORITY_PRIVATE_KEY="$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 8)"

if ! OUTPUT="$({
    cd "$ROOT_DIR"
    forge script script/RehearseA1.s.sol:RehearseA1 \
      --rpc-url "$RPC_URL" \
      --broadcast \
      --private-key "$LOCAL_A1_BROADCASTER_PRIVATE_KEY" \
      -vv
  } 2>&1)"; then
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

printf '%s\n' "$OUTPUT"
grep -q "LOCAL_A1_REHEARSAL_OK" <<<"$OUTPUT" || {
  echo "local A1 rehearsal did not emit its success sentinel" >&2
  exit 1
}

echo "LOCAL_A1_DRIVER_OK"
