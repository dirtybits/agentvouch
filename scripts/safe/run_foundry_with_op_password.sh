#!/usr/bin/env bash

# Run one cast or forge command with a 1Password-backed Foundry password file.
# The password is never copied to the clipboard or exported to child commands.

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "Error: execute this script; do not source it." >&2
  return 1
fi

set -euo pipefail

PASSWORD_REF=""
TEMP_DIR=""
COMMAND=()
PASSWORD_PLACEHOLDER_COUNT=0

usage() {
  cat <<'EOF'
Usage:
  run_foundry_with_op_password.sh --password-ref OP_REF -- cast ...
  run_foundry_with_op_password.sh --password-ref OP_REF -- forge ...

Replace the literal {password_file} argument with the temporary password-file
path. OP_REF must use the op://vault/item/field form.

Example:
  scripts/safe/run_foundry_with_op_password.sh \
    --password-ref 'op://APPROVED_TESTNET_VAULT/AgentVouch Safe Test Owner 1/password' \
    -- cast wallet address \
      --keystore "$HOME/.foundry/keystores/agentvouch-safe-test-owner-1" \
      --password-file {password_file}

This wrapper does not decide whether a transaction is approved. A command that
contains --broadcast or cast send can create an external side effect.
EOF
}

error() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --password-ref)
      [[ $# -ge 2 ]] || error "--password-ref requires a value"
      PASSWORD_REF="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      error "unknown option: $1"
      ;;
  esac
done

[[ "$PASSWORD_REF" == op://*/*/* ]] ||
  error "--password-ref must use op://vault/item/field form"
case "$PASSWORD_REF" in
  *$'\n'* | *$'\r'*) error "--password-ref cannot contain newlines" ;;
esac
[[ $# -gt 0 ]] || error "a cast or forge command is required after --"

case "$(basename "$1")" in
  cast | forge) ;;
  *) error "only cast or forge commands are supported" ;;
esac

for command_name in op mktemp; do
  command -v "$command_name" >/dev/null 2>&1 ||
    error "required command not found: $command_name"
done

for argument in "$@"; do
  if [[ "$argument" == "{password_file}" ]]; then
    PASSWORD_PLACEHOLDER_COUNT=$((PASSWORD_PLACEHOLDER_COUNT + 1))
  fi
done

[[ "$PASSWORD_PLACEHOLDER_COUNT" -eq 1 ]] ||
  error "the command must contain exactly one {password_file} argument"

umask 077
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/foundry-password.XXXXXX")"
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

PASSWORD_FILE="$TEMP_DIR/password"
op read -n "$PASSWORD_REF" >"$PASSWORD_FILE" ||
  error "cannot read the requested 1Password field"
chmod 600 "$PASSWORD_FILE"

for argument in "$@"; do
  if [[ "$argument" == "{password_file}" ]]; then
    COMMAND+=("$PASSWORD_FILE")
  else
    COMMAND+=("$argument")
  fi
done

"${COMMAND[@]}"
