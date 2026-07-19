#!/usr/bin/env bash

# Create, verify, and back up exportable Foundry accounts for testnet Safe
# workflows. A Safe is a contract and has no private key; these keystores belong
# only to explicitly approved test owners, proposers, or executors.

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "Error: execute this script; do not source it." >&2
  return 1
fi

set -euo pipefail

OP_VAULT="${OP_VAULT:-pt_bastion_vault}"
KEYSTORE_DIR="${KEYSTORE_DIR:-$HOME/.foundry/keystores}"
PROJECT_TAG="${PROJECT_TAG:-agentvouch}"
TEMP_DIR=""
ACCOUNT_NAMES=()
ITEM_NAMES=()
ACCOUNT_ROLES=()

usage() {
  cat <<EOF
Usage: $(basename "$0") [options] --account ACCOUNT ITEM ROLE [...]

Create or verify encrypted Foundry keystores for a testnet Safe workflow and
back up each encrypted keystore to its matching 1Password item.

Options:
  --vault NAME          1Password vault (default: $OP_VAULT)
  --keystore-dir PATH   Foundry keystore directory (default: $KEYSTORE_DIR)
  --project-tag TAG     1Password project tag (default: $PROJECT_TAG)
  --account ACCOUNT ITEM ROLE
                        Add an account. Repeat for each approved test role.
  -h, --help            Show this help

Example:
  $(basename "$0") \\
    --vault pt_bastion_vault \\
    --project-tag agentvouch \\
    --account agentvouch-safe-test-owner-1 \\
      "AgentVouch Safe Test Owner 1" owner \\
    --account agentvouch-safe-test-executor \\
      "AgentVouch Safe Test Executor" executor

This helper is testnet-only. It never creates a "Safe keystore," never changes
Safe ownership, and never broadcasts a transaction. It refuses to overwrite an
existing keystore or pair one with a newly generated, mismatched password.
EOF
}

info() {
  printf '[INFO] %s\n' "$*" >&2
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
    --vault)
      [[ $# -ge 2 ]] || error "--vault requires a value"
      OP_VAULT="$2"
      shift 2
      ;;
    --keystore-dir)
      [[ $# -ge 2 ]] || error "--keystore-dir requires a value"
      KEYSTORE_DIR="$2"
      shift 2
      ;;
    --project-tag)
      [[ $# -ge 2 ]] || error "--project-tag requires a value"
      PROJECT_TAG="$2"
      shift 2
      ;;
    --account)
      [[ $# -ge 4 ]] || error "--account requires ACCOUNT ITEM ROLE"
      ACCOUNT_NAMES+=("$2")
      ITEM_NAMES+=("$3")
      ACCOUNT_ROLES+=("$4")
      shift 4
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

[[ ${#ACCOUNT_NAMES[@]} -gt 0 ]] || error "at least one --account is required"
[[ "$PROJECT_TAG" =~ ^[a-zA-Z0-9._-]+$ ]] ||
  error "--project-tag may contain only letters, digits, dots, underscores, and hyphens"

for ((index = 0; index < ${#ACCOUNT_NAMES[@]}; index++)); do
  case "${ITEM_NAMES[$index]}" in
    *'/'* | *$'\n'* | *$'\r'*)
      error "1Password item names cannot contain slashes or newlines"
      ;;
  esac

  for ((previous = 0; previous < index; previous++)); do
    [[ "${ACCOUNT_NAMES[$index]}" != "${ACCOUNT_NAMES[$previous]}" ]] ||
      error "duplicate account name: ${ACCOUNT_NAMES[$index]}"
    [[ "${ITEM_NAMES[$index]}" != "${ITEM_NAMES[$previous]}" ]] ||
      error "duplicate 1Password item: ${ITEM_NAMES[$index]}"
  done
done

for command_name in op cast mktemp cmp; do
  command -v "$command_name" >/dev/null 2>&1 ||
    error "required command not found: $command_name"
done

op vault get "$OP_VAULT" >/dev/null 2>&1 ||
  error "cannot access 1Password vault '$OP_VAULT'; run 'op signin' and retry"

mkdir -p "$KEYSTORE_DIR"
chmod 700 "$KEYSTORE_DIR"
umask 077

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/safe-test-accounts.XXXXXX")"
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

item_exists() {
  local item="$1"
  op item get "$item" --vault "$OP_VAULT" >/dev/null 2>&1
}

create_item() {
  local item="$1"
  local role="$2"

  info "Creating 1Password item '$item' in '$OP_VAULT'"
  op item create \
    --vault "$OP_VAULT" \
    --category password \
    --title "$item" \
    --generate-password='letters,digits,symbols,32' \
    --tags "$PROJECT_TAG,safe,multisig,testnet,$role" \
    >/dev/null
}

create_keystore() {
  local account="$1"
  local item="$2"
  local keystore="$KEYSTORE_DIR/$account"
  local secret_ref="op://$OP_VAULT/$item/password"

  [[ ! -e "$keystore" ]] ||
    error "refusing to overwrite existing keystore: $keystore"

  info "Creating encrypted Foundry keystore '$account'"
  CAST_PASSWORD="$secret_ref" op run -- \
    cast wallet new "$KEYSTORE_DIR" "$account" >&2
  chmod 600 "$keystore"
}

verify_keystore() {
  local account="$1"
  local item="$2"
  local keystore="$KEYSTORE_DIR/$account"
  local secret_ref="op://$OP_VAULT/$item/password"
  local password_file="$TEMP_DIR/$account.password"
  local error_file="$TEMP_DIR/$account.cast-error"
  local address

  op read -n "$secret_ref" >"$password_file" ||
    error "cannot read the password field from 1Password item '$item'"
  chmod 600 "$password_file"

  if ! address="$(cast wallet address \
    --keystore "$keystore" \
    --password-file "$password_file" \
    2>"$error_file")"; then
    if [[ -s "$error_file" ]]; then
      cat "$error_file" >&2
    fi
    error "keystore '$keystore' does not match 1Password item '$item'"
  fi

  rm -f -- "$password_file" "$error_file"

  [[ "$address" =~ ^0x[[:xdigit:]]{40}$ ]] ||
    error "Foundry returned an invalid address for '$account': $address"

  printf '%s' "$address"
}

back_up_keystore() {
  local account="$1"
  local item="$2"
  local item_created="$3"
  local keystore="$KEYSTORE_DIR/$account"
  local downloaded="$TEMP_DIR/$account.backup"
  local attachment_ref="op://$OP_VAULT/$item/keystore"

  if op read --out-file "$downloaded" "$attachment_ref" >/dev/null 2>&1; then
    if cmp -s "$keystore" "$downloaded"; then
      rm -f -- "$downloaded"
      info "Existing 1Password backup already matches '$account'"
      return
    fi
    rm -f -- "$downloaded"
    error "1Password backup for '$item' differs from '$keystore'; refusing to overwrite either copy"
  else
    rm -f -- "$downloaded"
    [[ "$item_created" == true ]] ||
      error "could not verify a keystore attachment on existing item '$item'; refusing to replace or create one"
  fi

  info "Attaching verified keystore '$account' to 1Password"
  op item edit \
    "$item" \
    --vault "$OP_VAULT" \
    "keystore[file]=$keystore" \
    >/dev/null

  op read --out-file "$downloaded" "$attachment_ref" >/dev/null ||
    error "could not read back the keystore attachment from '$item'"

  cmp -s "$keystore" "$downloaded" ||
    error "1Password attachment verification failed for '$item'"
  rm -f -- "$downloaded"
}

process_account() {
  local account="$1"
  local item="$2"
  local role="$3"
  local keystore="$KEYSTORE_DIR/$account"
  local has_item=false
  local has_keystore=false
  local item_created=false
  local address

  [[ "$account" =~ ^[a-zA-Z0-9._-]+$ ]] ||
    error "invalid account name '$account'"
  [[ "$role" =~ ^[a-zA-Z0-9._-]+$ ]] ||
    error "invalid role '$role'"

  if item_exists "$item"; then
    has_item=true
  fi
  if [[ -e "$keystore" ]]; then
    has_keystore=true
  fi

  if [[ "$has_item" == false && "$has_keystore" == true ]]; then
    error "keystore '$keystore' exists but 1Password item '$item' does not"
  fi

  if [[ "$has_item" == false ]]; then
    create_item "$item" "$role"
    item_created=true
  else
    info "Using existing 1Password item '$item'"
  fi

  if [[ "$has_keystore" == false ]]; then
    [[ "$item_created" == true ]] ||
      error "1Password item '$item' already exists but keystore '$keystore' does not; restore its backup or use a new account and item name"
    create_keystore "$account" "$item"
  else
    info "Using existing keystore '$keystore'"
    chmod 600 "$keystore"
  fi

  address="$(verify_keystore "$account" "$item")"
  info "Verified $role address: $address"
  back_up_keystore "$account" "$item" "$item_created"
  info "Verified 1Password backup for '$account'"

  printf '%s\t%s\t%s\t%s\n' "$role" "$account" "$address" "$item"
}

info "Preparing testnet Safe accounts"
printf 'ROLE\tACCOUNT\tADDRESS\tONEPASSWORD_ITEM\n'

for ((index = 0; index < ${#ACCOUNT_NAMES[@]}; index++)); do
  process_account \
    "${ACCOUNT_NAMES[$index]}" \
    "${ITEM_NAMES[$index]}" \
    "${ACCOUNT_ROLES[$index]}"
done

cat >&2 <<EOF

[INFO] Accounts are verified and their encrypted backups match 1Password.
[INFO] No Safe was deployed or changed, and no transaction was broadcast.
[INFO] Human approval is still required before using any address as a Safe owner.
EOF
