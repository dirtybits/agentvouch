#!/usr/bin/env bash
# Reproduce the vendored Foundry deps (gitignored). Run from contracts/base-poc/.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p lib
[ -d lib/forge-std ] || git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
[ -d lib/openzeppelin-contracts ] || git clone --depth 1 --branch release-v5.1 \
  https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
echo "deps ready. Foundry: install via https://getfoundry.sh then 'foundryup'."
