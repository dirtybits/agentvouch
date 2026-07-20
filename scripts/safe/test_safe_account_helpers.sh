#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/safe-account-helper-test.XXXXXX")"
MOCK_BIN="$TEST_DIR/bin"
KEYSTORE_DIR="$TEST_DIR/keystores"
MOCK_OP_LOG="$TEST_DIR/op.log"
MOCK_ITEM_STATE="$TEST_DIR/item-created"
MOCK_BACKUP="$TEST_DIR/keystore-backup"
STDOUT_FILE="$TEST_DIR/stdout"
STDERR_FILE="$TEST_DIR/stderr"

cleanup() {
  rm -rf -- "$TEST_DIR"
}
trap cleanup EXIT

fail() {
  printf '[FAIL] %s\n' "$*" >&2
  exit 1
}

mkdir -p "$MOCK_BIN"

cat >"$MOCK_BIN/op" <<'MOCK_OP'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$MOCK_OP_LOG"

case "$1 $2" in
  "vault get")
    [[ "$3" == "APPROVED_TESTNET_VAULT" ]]
    ;;
  "item get")
    [[ -e "$MOCK_ITEM_STATE" ]]
    ;;
  "item create")
    touch "$MOCK_ITEM_STATE"
    ;;
  "item edit")
    for argument in "$@"; do
      case "$argument" in
        keystore\[file\]=*)
          cp "${argument#*=}" "$MOCK_BACKUP"
          ;;
      esac
    done
    ;;
  "read -n")
    printf '%s' 'review-test-password-7f3a'
    ;;
  "read --out-file")
    [[ -e "$MOCK_BACKUP" ]]
    cp "$MOCK_BACKUP" "$3"
    ;;
  *)
    printf 'unexpected op invocation: %s\n' "$*" >&2
    exit 1
    ;;
esac
MOCK_OP

cat >"$MOCK_BIN/cast" <<'MOCK_CAST'
#!/usr/bin/env bash
set -euo pipefail

case "$1 $2" in
  "wallet new")
    [[ "${CAST_PASSWORD+x}" != x ]] ||
      { echo "CAST_PASSWORD must not be exported" >&2; exit 1; }
    ! env | grep -Fq 'review-test-password-7f3a' ||
      { echo "resolved password leaked through environment" >&2; exit 1; }
    [[ "$*" != *review-test-password-7f3a* ]] ||
      { echo "resolved password leaked through arguments" >&2; exit 1; }

    printf 'Enter secret:' >&2
    IFS= read -r first_password
    [[ "$first_password" == 'review-test-password-7f3a' ]]

    [[ "$3" == "--" ]]
    mkdir -p "$4"
    printf '%s' '{"encrypted":"mock"}' >"$4/$5"
    ;;
  "wallet address")
    password_file=""
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "--password-file" ]]; then
        password_file="$2"
        break
      fi
      shift
    done
    [[ -n "$password_file" ]]
    [[ "$(cat "$password_file")" == 'review-test-password-7f3a' ]]
    printf '%s\n' '0x1111111111111111111111111111111111111111'
    ;;
  *)
    printf 'unexpected cast invocation: %s\n' "$*" >&2
    exit 1
    ;;
esac
MOCK_CAST

chmod +x "$MOCK_BIN/op" "$MOCK_BIN/cast"
export MOCK_OP_LOG MOCK_ITEM_STATE MOCK_BACKUP

: >"$MOCK_OP_LOG"
if PATH="$MOCK_BIN:$PATH" OP_VAULT="" \
  "$SCRIPT_DIR/create_safe_test_accounts.sh" \
  --keystore-dir "$KEYSTORE_DIR" \
  --account test-owner "Test Owner" owner \
  >"$STDOUT_FILE" 2>"$STDERR_FILE"; then
  fail "account helper accepted a missing vault"
fi
[[ ! -s "$MOCK_OP_LOG" ]] ||
  fail "account helper accessed 1Password before rejecting a missing vault"
grep -Fq 'an explicit 1Password vault is required' "$STDERR_FILE" ||
  fail "missing-vault error was not reported"

: >"$MOCK_OP_LOG"
PATH="$MOCK_BIN:$PATH" OP_VAULT="" \
  "$SCRIPT_DIR/create_safe_test_accounts.sh" \
  --vault APPROVED_TESTNET_VAULT \
  --keystore-dir "$KEYSTORE_DIR" \
  --account test-owner "Test Owner" owner \
  >"$STDOUT_FILE" 2>"$STDERR_FILE"

grep -Fq '0x1111111111111111111111111111111111111111' "$STDOUT_FILE" ||
  fail "verified public address was not emitted"
keystore_mode="$(stat -f '%Lp' "$KEYSTORE_DIR/test-owner" 2>/dev/null ||
  stat -c '%a' "$KEYSTORE_DIR/test-owner")"
[[ "$keystore_mode" == "600" ]] ||
  fail "keystore permissions are not 0600"
! grep -Fq 'review-test-password-7f3a' "$STDOUT_FILE" "$STDERR_FILE" ||
  fail "resolved password appeared in helper output"

PATH="$MOCK_BIN:$PATH" OP_VAULT="APPROVED_TESTNET_VAULT" \
  "$SCRIPT_DIR/create_safe_test_accounts.sh" \
  --keystore-dir "$KEYSTORE_DIR" \
  --account test-owner "Test Owner" owner \
  >"$STDOUT_FILE" 2>"$STDERR_FILE"

grep -Fq "vault get APPROVED_TESTNET_VAULT" "$MOCK_OP_LOG" ||
  fail "explicit vault was not used"
grep -Fq "Existing 1Password backup already matches" "$STDERR_FILE" ||
  fail "idempotent verification path did not run"

printf '[PASS] safe account helper regression checks\n'
