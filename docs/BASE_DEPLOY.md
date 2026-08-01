# AgentVouch Base Sepolia A1 Deployment Runbook

This runbook covers the fresh linked `AgentVouchEvm` `base-v1-a1` candidate. Deployment,
configuration, smoke, and activation are separate human-gated stages. Completing one does not
authorize the next.

## Scope and current state

- Target: Base Sepolia (`eip155:84532`) only.
- Native test USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- Facade: `contracts/base-poc/src/AgentVouchEvm.sol`.
- Linked library: `contracts/base-poc/src/libraries/PaidPurchaseSettlement.sol`.
- Protocol version: `base-v1-a1`.
- Current selected deployment: `0x5992dD52Ee2015f558D0A690777C55e27b05B7d1`,
  `base-v1-candidate` (pre-A1).
- A1 deployment record: [`BASE_SEPOLIA_A1_STATE.md`](./BASE_SEPOLIA_A1_STATE.md).
- Authoritative activation gates:
  [`.agents/plans/base-paid-report-activation-sepolia.plan.md`](../.agents/plans/base-paid-report-activation-sepolia.plan.md).

No A1 public-network transaction is currently authorized. Base mainnet (`eip155:8453`) is not
supported by these scripts and remains blocked by `docs/MAINNET_READINESS.md`.

## Safety model

The release uses three independent stages:

1. `Deploy.s.sol` deploys the facade with a non-broadcaster staging admin. It does not initialize,
   pause, unpause, or transfer a role.
2. `StageA1.s.sol` verifies the exact facade/library/USDC artifacts, pauses first, initializes while
   paused, hands off every final role, removes every staging-admin role, and leaves the contract
   paused.
3. A later, separately approved operator action may unpause only for an isolated smoke or activation.

The deploy broadcaster must never hold an AgentVouch role. The staging admin must be distinct from
the broadcaster and every final role holder. `DEFAULT_ADMIN_ROLE` is transferred and revoked last.

## Gate A: local pre-broadcast proof

Run from the repository root with Node 24:

```bash
. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; }
forge fmt --root contracts/base-poc --check
forge test --root contracts/base-poc -vv
forge build --root contracts/base-poc --sizes
npm run verify:base-size
npm run verify:base-a1-paid-report-abi
npm run verify:chain-map
contracts/base-poc/scripts/local-a1-rehearsal.sh
```

The local driver starts a disposable Anvil node on chain ID `84532`, derives local-only test keys,
broadcasts the full lifecycle, and stops the node. Success requires both sentinels:

```text
LOCAL_A1_REHEARSAL_OK
LOCAL_A1_DRIVER_OK
```

The rehearsal proves:

- exact linked-library and facade runtime code hashes;
- uninitialized/unpaused fresh deployment with no broadcaster role;
- pause before initialization and complete final-role handoff;
- no staging role remains;
- approved unpause before new exposure;
- re-pause after report acceptance; and
- resolution, paginated slashing, buyer credit, reserve credit, and voucher residual remain live
  while paused.

Do not proceed until Gate A in the activation plan is explicitly approved.

`verify:base-a1-paid-report-abi` requires the fresh
`contracts/base-poc/out/AgentVouchEvm.sol/AgentVouchEvm.json` artifact. It fails closed when the
artifact is absent and compares canonical function inputs, outputs, and mutability; event parameter
types and indexed fields; and error inputs against the web, isolated UI, and harness clients. The web
client must continue to omit the five operator-only methods.
This command covers the curated paid-report surface only; tuple-heavy non-report read APIs are out
of scope and must not be described as covered by this gate.

### Temporary pinned Foundry toolchain when the host has none

The repository pins `solc = "0.8.28"` and the Solidity dependency versions used in CI, but the
GitHub workflow currently requests Foundry `stable`. Gate A should use Foundry `v1.7.1`, matching
the version recorded for the original Base implementation and the official stable release verified
on 2026-07-31. On Apple Silicon, the official archive is
`foundry_v1.7.1_darwin_arm64.tar.gz` with SHA-256
`eacdc67718fac857cad9e19c7f6729dd80de731d09df81856391d093cfcab547`.

The following is a reviewable, non-system installation recipe. It keeps the binaries in a new
temporary directory and does not modify `~/.foundry`, shell profiles, or system package state. The
archive checksum and extracted `forge`/`cast`/`anvil` versions were verified during the 2026-07-31
non-broadcast pass:

```bash
A1_FOUNDRY_DIR="$(mktemp -d /private/tmp/agentvouch-foundry-v1.7.1.XXXXXX)"
curl -fL \
  https://github.com/foundry-rs/foundry/releases/download/v1.7.1/foundry_v1.7.1_darwin_arm64.tar.gz \
  -o "$A1_FOUNDRY_DIR/foundry_v1.7.1_darwin_arm64.tar.gz"
printf '%s  %s\n' \
  eacdc67718fac857cad9e19c7f6729dd80de731d09df81856391d093cfcab547 \
  "$A1_FOUNDRY_DIR/foundry_v1.7.1_darwin_arm64.tar.gz" | shasum -a 256 -c -
mkdir -p "$A1_FOUNDRY_DIR/bin"
tar -xzf "$A1_FOUNDRY_DIR/foundry_v1.7.1_darwin_arm64.tar.gz" \
  -C "$A1_FOUNDRY_DIR/bin"
export PATH="$A1_FOUNDRY_DIR/bin:$PATH"
forge --version
cast --version
anvil --version
```

Vendor the exact CI dependencies rather than using an unpinned setup clone:

```bash
git clone --depth 1 --branch v1.16.1 \
  https://github.com/foundry-rs/forge-std.git contracts/base-poc/lib/forge-std
git clone --depth 1 --branch v5.1.0 \
  https://github.com/OpenZeppelin/openzeppelin-contracts.git \
  contracts/base-poc/lib/openzeppelin-contracts
git clone --depth 1 --branch v0.7.0 \
  https://github.com/eth-infinitism/account-abstraction.git \
  contracts/base-poc/lib/account-abstraction
```

Downloading this toolchain or the vendored dependencies is a separate network action. It does not
authorize a script dry run, local rehearsal, signer access, or public-network broadcast. Pinning the
GitHub workflow itself to `v1.7.1` changes the build toolchain and requires explicit human approval.

### Read-only deployment preflight, monitor, and Gate-C readiness

The operations driver has `preflight` (default), `monitor`, and `gate-c-readiness` modes. Every mode
is read-only. It never loads a private key or constructs a wallet client; `--apply`, write modes, and
secret-bearing command arguments are hard failures. Configure the exact candidate explicitly—there
is no fallback to the currently selected web contract:

```bash
export BASE_A1_OPS_RPC_URL="https://..."
export BASE_A1_OPS_CONTRACT_ADDRESS="0x..."
export BASE_A1_OPS_LIBRARY_ADDRESS="0x..."
export BASE_A1_OPS_DEPLOYMENT_BLOCK="..."
export BASE_A1_EXPECTED_FACADE_RUNTIME_HASH="0x..."
export BASE_A1_EXPECTED_LIBRARY_RUNTIME_HASH="0x..."
export BASE_A1_EXPECTED_USDC_ADDRESS="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
export BASE_A1_EXPECTED_PAUSED="true"
export BASE_A1_EXPECTED_ROLE_HOLDERS_JSON='{"DEFAULT_ADMIN_ROLE":["0x..."],"CONFIG_ROLE":["0x..."],"RESOLVER_ROLE":["0x..."],"SETTLEMENT_ROLE":["0x..."],"PAUSE_ROLE":["0x..."]}'

npm run base:a1:ops --workspace @agentvouch/web -- preflight
npm run base:a1:ops --workspace @agentvouch/web -- monitor
```

The driver scans deployment events in inclusive chunks of at most 1,999 blocks, reconstructs the
complete AccessControl holder sets, verifies a checkpoint block hash before resuming, validates
fallback voucher candidates through `getVouch`, and records only machine-readable, non-secret
artifacts under `.agent-keys/base-paid-report/<deployment>/`. Reserve credit is explicitly labeled
event-derived because the frozen contract has no public reserve-credit getter. Reports, pause state,
and buyer-credit status are re-read from the exact deployment; the DB/index is never authority.

After Gate B and the founder decision sheet are complete, `gate-c-readiness` adds two required public
inputs:

```bash
export BASE_A1_GATE_C_DECISION_PATH="/absolute/path/to/gate-c-decision.json"
npm run base:a1:ops --workspace @agentvouch/web -- gate-c-readiness
```

The canonical record shape and all currently pending fields are in
[`BASE_SEPOLIA_A1_STATE.md`](./BASE_SEPOLIA_A1_STATE.md). A matching record produces
`gate-c-readiness.json` with `assessment: READY_FOR_HUMAN_REVIEW`,
`executionAuthorized: false`, and an ordered 31-step transaction/evidence plan. The unsigned local
record is input validation, not proof of approval: the command never emits `GO`, produces calldata,
invokes a signer, simulates a write, submits a transaction, or authorizes Gate C. A mismatch produces
`BLOCKED`, records exact blockers, and exits nonzero.

Gate-C mode derives the candidate commit from a clean local Git `HEAD`, proves the declared facade
creation boundary by reading code at the deployment block and the preceding block, and rescans the
complete on-chain event history from that boundary. It deliberately ignores cached event/checkpoint
files for role reconstruction.

## Gate B1: deploy uninitialized

This section is an operator reference, not current broadcast authorization.

Set inputs without printing secrets:

```bash
export BASE_SEPOLIA_RPC_URL="https://..."
export DEPLOYER_PRIVATE_KEY="0x..."
export ADMIN_ADDRESS="<distinct staging admin>"
export USDC_ADDRESS="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
```

Confirm the chain, broadcaster, balance, nonce, approved staging admin, expected library address,
facade address, and artifact hashes in `docs/BASE_SEPOLIA_A1_STATE.md`. The dry run must print:

- exact expected/actual library code hash;
- exact expected/actual facade code hash;
- `config initialized: false`;
- `paused: false`;
- a broadcaster distinct from the staging admin.

```bash
cd contracts/base-poc
forge script script/Deploy.s.sol:Deploy --rpc-url "$BASE_SEPOLIA_RPC_URL" -vvvv
```

Only after the exact Gate B1 broadcast is explicitly approved:

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast \
  --slow \
  -vvvv
```

Immediately record transaction hash, block, nonce, library/facade addresses, both runtime code
hashes, USDC, broadcaster, staging admin, `configInitialized == false`, `paused == false`, and all
five staging-admin roles. Do not change any client, Vercel, indexer, or paymaster pointer.

## Gate B2: verify, pause, initialize, and hand off

Explorer/source verification and independent bytecode checks must finish before staging. Record the
verification URLs and exact compiler/link inputs.

Set the already approved values:

```bash
export STAGING_ADMIN_PRIVATE_KEY="0x..."
export AGENTVOUCH_ADDRESS="0x..."
export PAID_PURCHASE_SETTLEMENT_ADDRESS="0x..."
export FINAL_ADMIN_ADDRESS="0x..."
export CONFIG_AUTHORITY_ADDRESS="0x..."
export RESOLVER_ADDRESS="0x..."
export SETTLEMENT_AUTHORITY_ADDRESS="0x..."
export PAUSE_AUTHORITY_ADDRESS="0x..."
export SLASH_PERCENTAGE="<approved 1-100 integer>"
export TREASURY_RECIPIENT="<approved immutable restitution recipient>"
```

`StageA1.s.sol` rejects a missing/wrong facade, library, USDC, protocol artifact, initialized
contract, paused contract, missing staging admin, zero role holder, or retained staging role. Its
locked config fixes the 5 USDC bond, 7-day credit claim window, 60/40 purchase split, zero protocol
fee, and zero reporter/keeper reward.

Dry run first:

```bash
forge script script/StageA1.s.sol:StageA1 --rpc-url "$BASE_SEPOLIA_RPC_URL" -vvvv
```

Only after a separate Gate B2 approval:

```bash
forge script script/StageA1.s.sol:StageA1 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast \
  --slow \
  -vvvv
```

Success requires `A1_STAGED_PAUSED_OK`. Independently read back:

- `PROTOCOL_VERSION == base-v1-a1`;
- exact USDC and config;
- `configInitialized == true`;
- `paused == true`;
- each intended final role present;
- no staging-admin or broadcaster role; and
- default admin handoff transaction last.

The deployment is now only **deployed, verified, configured, and paused**. It is not active.

## Gate C: isolated lifecycle smoke

Gate C requires a new approval that names the fixtures, unpause signer, resolver, cranker, exposure
cap, and monitoring owner. Use fresh Direct or Authorization receipts on the new deployment. Lane-C
settlement receipts and every pre-A1 receipt are ineligible.

The smoke must record exact transaction/UserOp hashes, blocks, block hashes, events, deadlines,
multi-page slash progress, and USDC balances at explicit block numbers for:

```text
purchase -> open -> review -> resolve -> slash pages
         -> buyer credit -> reserve credit -> voucher residual
```

Rejection, expiry, replay, duplicate, wrong-role, wrong-deployment, paused-entry, premature claim,
and settlement-lane paths must also be checked. Re-pause and reconcile every liability before any
preview pointer change.

## Gate D: client activation

Deployment does not authorize an app pointer, indexer, Vercel, paymaster, or shared-testnet change.
Preview activation is approved separately after Gate C. Shared Sepolia promotion is another explicit
decision after preview rollback has been exercised.

The purchase-bound client is additionally hidden unless
`NEXT_PUBLIC_BASE_PAID_PURCHASE_REPORTS_ENABLED=true`. This is a UX exposure flag only; the exact A1
deployment address and its on-chain pause state remain authoritative. Gate D must update and verify
the deployment pointer, paymaster policy, and this flag as separate recorded changes. Merging this
code leaves the flag off by default.

Rollback order:

1. Pause new exposure with the final `PAUSE_ROLE` holder.
2. Restore the previous deployment-qualified client pointer.
3. Preserve direct access and sponsorship for terminal reports and funded buyer claims on the A1
   deployment.
4. Reconcile reports, remaining slash work, credits, reserve, and residual exits.
5. Record the incident and abandoned/paused deployment state; never delete or relabel history.

Do not print or commit private keys. Do not describe a paused deployment as active. Do not enable
Base mainnet from this runbook.
