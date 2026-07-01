#!/usr/bin/env bash
# Reproduce the vendored Foundry deps (gitignored). Run from contracts/base-poc/.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p lib
[ -d lib/forge-std ] || git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
[ -d lib/openzeppelin-contracts ] || git clone --depth 1 --branch release-v5.1 \
  https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
# ERC-4337 v0.7 (EntryPoint, SimpleAccount) for the gas-free UX proof in test/gasless.
[ -d lib/account-abstraction ] || git clone --depth 1 --branch v0.7.0 \
  https://github.com/eth-infinitism/account-abstraction lib/account-abstraction
echo "deps ready. Foundry: install via https://getfoundry.sh then 'foundryup'."
