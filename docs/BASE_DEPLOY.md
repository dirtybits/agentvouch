# AgentVouch Base Deploy Runbook

This runbook covers the Base Sepolia `AgentVouchEvm` v1-candidate deployment under
`contracts/base-poc`. It mirrors `docs/DEPLOY.md` for the Solana program, but this path is a fresh
EVM contract deploy, not an in-place upgrade.

## Current Scope

- Target chain: Base Sepolia (`eip155:84532`)
- Contract source: `contracts/base-poc/src/AgentVouchEvm.sol`
- Deploy script: `contracts/base-poc/script/Deploy.s.sol`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Expected protocol version after this deploy: `base-v1-candidate`

This is still **testnet only**. Do not deploy Base mainnet (`eip155:8453`) from this runbook. Base
mainnet remains blocked by the Phase 10 gate: custody, security review, chain parameterization, and
mainnet-specific readiness must pass first.

## What This Deploy Fixes

The earlier configured Base Sepolia contract address (`0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854`)
supports the purchase/x402 POC flow but does not contain the Phase 9 report selector
`openReport(address,string)` (`0x92e928f4`). A v1-candidate redeploy is required before Base author
reports can smoke successfully.

## Preflight

Run from the repo root:

```bash
cd /Users/andysustic/Repos/agentvouch
export PATH="$HOME/.nvm/versions/node/v24.1.0/bin:$PATH"
```

Confirm the worktree and intended branch:

```bash
git status --short
git branch --show-current
```

Confirm Foundry is available:

```bash
forge --version
cast --version
```

Set deployment environment variables without printing secret values:

```bash
export BASE_SEPOLIA_RPC_URL="https://..."
export DEPLOYER_PRIVATE_KEY="0x..."
export USDC_ADDRESS="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
```

For the Phase 9 smoke deploy, leave `ADMIN_ADDRESS` unset unless you intentionally want an
uninitialized contract and have a separate `initializeConfig` transaction ready. When
`ADMIN_ADDRESS` is unset, the deployer becomes the temporary Sepolia admin and
`Deploy.s.sol` calls `initializeConfig(...)` in the same broadcast.

Confirm the deployer address and balance:

```bash
export DEPLOYER_ADDRESS="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
echo "$DEPLOYER_ADDRESS"
cast balance "$DEPLOYER_ADDRESS" --rpc-url "$BASE_SEPOLIA_RPC_URL" --ether
cast chain-id --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

The chain id must be `84532`.

## Build And Test

Run the Base contract suite before any public broadcast:

```bash
forge test --root contracts/base-poc -vv
```

Optionally inspect size and protocol-version references:

```bash
forge build --root contracts/base-poc --sizes
rg 'PROTOCOL_VERSION|openReport|resolveReport|getAuthorReport' contracts/base-poc/src contracts/base-poc/script
```

## Dry Run

Dry-run the deployment script first. This simulates the deploy and config initialization without
broadcasting a transaction:

```bash
cd /Users/andysustic/Repos/agentvouch/contracts/base-poc
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  -vvvv
```

Review the printed address, USDC address, admin address, and `config initialized: true`. If config
would not initialize, stop and fix the admin/config plan before broadcasting.

Return to repo root after the dry run:

```bash
cd /Users/andysustic/Repos/agentvouch
```

## Deploy

Broadcast only after the dry run and tests are green, and after the human operator has explicitly
accepted the testnet transaction.

```bash
cd /Users/andysustic/Repos/agentvouch/contracts/base-poc
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast \
  --slow \
  -vvvv
```

Record:

- deployed `AgentVouchEvm` address
- deploy transaction hash
- block number
- deployer/admin address
- USDC address
- whether config was initialized

Then return to repo root:

```bash
cd /Users/andysustic/Repos/agentvouch
export BASE_V1_AGENTVOUCH_ADDRESS="0x..."
```

## Post-Deploy Verification

Confirm code exists and the Phase 9 selectors are present:

```bash
cast code "$BASE_V1_AGENTVOUCH_ADDRESS" --rpc-url "$BASE_SEPOLIA_RPC_URL" | wc -c
cast sig 'openReport(address,string)'
cast sig 'getAuthorReport(uint64)'

CODE="$(cast code "$BASE_V1_AGENTVOUCH_ADDRESS" --rpc-url "$BASE_SEPOLIA_RPC_URL")"
case "$CODE" in
  *92e928f4*) echo "openReport selector present" ;;
  *) echo "openReport selector missing"; exit 1 ;;
esac
```

Confirm version, pause state, and config:

```bash
cast call "$BASE_V1_AGENTVOUCH_ADDRESS" \
  'PROTOCOL_VERSION()(string)' \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"

cast call "$BASE_V1_AGENTVOUCH_ADDRESS" \
  'paused()(bool)' \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"

cast call "$BASE_V1_AGENTVOUCH_ADDRESS" \
  'configInitialized()(bool)' \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Expected:

- protocol version is `base-v1-candidate`
- paused is `false`
- configInitialized is `true`

## Web Env Pointer

Point local web at the new Base Sepolia contract and restart the dev server:

```bash
perl -0pi -e 's/^NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS=.*/NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS='"$BASE_V1_AGENTVOUCH_ADDRESS"'/m' web/.env.local
rg '^NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS=' web/.env.local
```

If `NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS` is missing, append it:

```bash
printf '\nNEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS=%s\n' "$BASE_V1_AGENTVOUCH_ADDRESS" >> web/.env.local
```

For Vercel preview/prod, update only after the local smoke passes. Use the Vercel dashboard or CLI
from the `web/` project context; do not run `vercel env pull` over an active local smoke env unless
you intend to replace it.

```bash
cd /Users/andysustic/Repos/agentvouch/web
printf '%s\n' "$BASE_V1_AGENTVOUCH_ADDRESS" | vercel env add NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS preview
printf '%s\n' "$BASE_V1_AGENTVOUCH_ADDRESS" | vercel env add NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS production
```

Do not print or paste private keys into PR comments, plan files, logs, or screenshots.

## Fresh-State Smoke Setup

A fresh Base contract has no profiles, vouches, listings, purchases, or reports. Do not reuse old
contract state as evidence.

For the report smoke, create at least two registered actors on the new contract:

1. Reporter: the Coinbase/passkey smart account used by the web UI.
2. Target author: any separate Base Sepolia account you control, such as the deployer or a test EOA.

Register a target author EOA with gas-paid `cast send`:

```bash
export TARGET_AUTHOR_PRIVATE_KEY="0x..."
export TARGET_AUTHOR_ADDRESS="$(cast wallet address --private-key "$TARGET_AUTHOR_PRIVATE_KEY")"

cast send "$BASE_V1_AGENTVOUCH_ADDRESS" \
  'registerAgent(string)' \
  'agentvouch://base-v1-smoke-author' \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --private-key "$TARGET_AUTHOR_PRIVATE_KEY"
```

The web/passkey reporter can be registered by any UI flow that calls `registerAgent`, such as the
Base paid publish path. If it is already registered on the new contract, duplicate registration will
fail with `AlreadyRegistered()` and should be treated as harmless by ensure-registered flows.

## Report Smoke

After local web points at the new contract:

1. Open `/author/$TARGET_AUTHOR_ADDRESS` on `localhost:3000`.
2. Connect the Coinbase/passkey Base wallet as the reporter.
3. Vouch for the target author with a small stake (at least 1 USDC if using the contract default).
4. Open a report with an evidence URI.
5. Record:
   - report transaction/userOp hash
   - `AuthorReportOpened` event fields
   - reporter USDC delta (`5` USDC bond by default)
   - target author's `openDisputes` increment
   - UI success message and explorer link

Read back the target profile:

```bash
cast call "$BASE_V1_AGENTVOUCH_ADDRESS" \
  'getProfile(address)((bool,string,uint256,uint64,uint64,uint256,uint256,uint64,uint64,uint64,uint64,uint256,uint256,uint64))' \
  "$TARGET_AUTHOR_ADDRESS" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

## Web Verification

After env pointer and smoke:

```bash
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm test --workspace @agentvouch/web
npm exec --workspace @agentvouch/web next -- build --webpack
```

For docs-only updates, record which web gates were skipped and why. For any code/env change that
affects Base writes, run the relevant browser smoke before marking the Phase 9 item complete.

## Rollback

Local rollback:

```bash
git diff -- web/.env.local
```

Restore `NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS` to the previous contract address and restart the dev
server.

Preview/prod rollback:

1. Restore the previous `NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS` value in Vercel.
2. Redeploy or promote the last known-good deployment.
3. Confirm Base report UI fails closed if the previous contract lacks report selectors.

Do not delete the new contract; it is immutable on-chain. Instead, stop pointing app envs at it and
record why it was abandoned.

## Common Failure Modes

### `openReport` Reverts Immediately / Selector Missing

The app is pointed at a contract that does not implement the Phase 9 report surface.

```bash
cast sig 'openReport(address,string)'
cast code "$NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS" --rpc-url "$BASE_SEPOLIA_RPC_URL" | grep -i 92e928f4
```

If the selector is absent, deploy the v1-candidate contract or update the env pointer.

### `NotInitialized()`

The contract deployed but `initializeConfig` was not called. For the current deploy script this
happens when `ADMIN_ADDRESS` is set to an address different from the deployer. Either redeploy for
the smoke path with `ADMIN_ADDRESS` unset or submit a reviewed config-initialization transaction from
the `CONFIG_ROLE` holder.

### `NotRegistered()`

One of the actors is not registered on the fresh contract. Register both the reporter and target
author on the new contract before vouching or reporting.

### `Insufficient Base Sepolia USDC`

The reporter needs enough Base Sepolia USDC for the report bond and any vouch stake. Confirm:

```bash
cast call "$USDC_ADDRESS" 'balanceOf(address)(uint256)' "$REPORTER_ADDRESS" --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call "$USDC_ADDRESS" 'allowance(address,address)(uint256)' "$REPORTER_ADDRESS" "$BASE_V1_AGENTVOUCH_ADDRESS" --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

### Sponsored UserOp Fails

Confirm the CDP paymaster policy allowlists:

- the new `AgentVouchEvm` address
- Base Sepolia USDC `approve`
- any other called contract/function in the batched UserOp

If the policy still points at the old contract, the wallet flow can fail even though direct
`cast call` reads pass.
