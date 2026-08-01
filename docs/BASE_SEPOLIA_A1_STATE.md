# Base Sepolia A1 Deployment State

This is the deployment-qualified evidence record for the proposed `base-v1-a1` paid-purchase report
release. Unknown or unexecuted fields remain `PENDING`; do not copy evidence from the pre-A1
deployment.

## Release identity

| Field                               | Value                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Candidate commit                    | `PENDING`                                                                 |
| Chain                               | Base Sepolia (`eip155:84532`)                                             |
| Protocol version                    | `base-v1-a1`                                                              |
| Compiler/link profile               | Solidity `0.8.28`; optimizer 200; `via_ir=true`; Cancun; no CBOR metadata |
| Native USDC                         | `0x036CbD53842c5426634e7929541eC2318f3dCF7e`                              |
| PaidPurchaseSettlement address      | `PENDING`                                                                 |
| PaidPurchaseSettlement runtime hash | `PENDING`                                                                 |
| AgentVouchEvm address               | `PENDING`                                                                 |
| AgentVouchEvm runtime hash          | `PENDING`                                                                 |
| Facade runtime size                 | 23,487 bytes                                                              |
| Library runtime size                | 5,939 bytes                                                               |
| Deployment transaction/block        | `PENDING`                                                                 |
| Explorer verification               | `PENDING`                                                                 |

## Approved configuration and authorities

| Field                                      | Value                    |
| ------------------------------------------ | ------------------------ |
| Slash percentage                           | `PENDING HUMAN APPROVAL` |
| Restitution recipient                      | `PENDING HUMAN APPROVAL` |
| Final default admin and custody            | `PENDING HUMAN APPROVAL` |
| Config authority and custody               | `PENDING HUMAN APPROVAL` |
| Resolver and recovery owner                | `PENDING HUMAN APPROVAL` |
| Settlement authority and custody           | `PENDING HUMAN APPROVAL` |
| Pause authority and custody                | `PENDING HUMAN APPROVAL` |
| Fallback cranker                           | `PENDING HUMAN APPROVAL` |
| Monitor owner / incident commander         | `PENDING HUMAN APPROVAL` |
| Exposure policy                            | `PENDING HUMAN APPROVAL` |
| External review or testnet risk acceptance | `PENDING HUMAN APPROVAL` |

### Gate-C isolated-smoke inputs

| Field                                                | Value                           |
| ---------------------------------------------------- | ------------------------------- |
| Founder decision / approver / timestamp              | `NO-GO` / `PENDING` / `PENDING` |
| Exact candidate commit                               | `PENDING`                       |
| Gate-B readback evidence                             | `PENDING`                       |
| Signing/custody method                               | `PENDING`                       |
| Fresh author fixture                                 | `PENDING`                       |
| Fresh upheld/rejected/expiry buyers                  | `PENDING`                       |
| At least two fresh voucher fixtures and exact stakes | `PENDING`                       |
| Exact author bond and paid-listing price             | `PENDING`                       |
| Eligible purchase lane (`Direct` or `Authorization`) | `PENDING`                       |
| Gross fixture-funding cap                            | `PENDING HUMAN APPROVAL`        |

The gross fixture-funding calculation is intentionally mechanical and does not choose an exposure
policy: `author bond + voucher stakes + 3 × (listing price + 5 USDC report bond)`. The approved cap
must be at least that amount. This is a test-USDC funding ceiling for the three isolated report
branches, not a Base mainnet or production-risk limit.

Locked values: 5 USDC report bond, 7-day filing window, 3-day review window, 7-day funded-credit
claim window, 60/40 purchase split, zero protocol fee, and zero reporter/keeper rewards.

## Gate decisions

| Gate                                 | State       | Approval/evidence                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: pre-broadcast candidate           | **NO-GO**   | The 2026-07-31 evidence refresh passes pinned Foundry format/build/121 tests/size/rehearsal, Forge/client paid-report ABI parity, format/lint/typecheck/chain-map, 867 web tests, UI, harness, and the 151-page production webpack build. Exact candidate commit/review, approved inputs, external review/risk acceptance, rollback review, and human GO remain pending |
| B1: deploy uninitialized             | **NO-GO**   | Explicit public-network approval required                                                                                                                                                                                                                                                                                         |
| B2: configure and remain paused      | **NO-GO**   | Separate explicit approval required                                                                                                                                                                                                                                                                                               |
| C: isolated lifecycle smoke          | **NO-GO**   | Separate explicit approval required                                                                                                                                                                                                                                                                                               |
| D: preview/shared Sepolia activation | **NO-GO**   | Separate explicit approval required                                                                                                                                                                                                                                                                                               |
| Base mainnet                         | **BLOCKED** | Outside this release and runbook                                                                                                                                                                                                                                                                                                  |

## Founder Gate-A decision record — added 2026-07-31

Gate A remains **NO-GO**. Copy this record into the reviewed release evidence and replace every
`PENDING` value only after rerunning the candidate with the pinned toolchain. This template is not an
authorization artifact; `executionAuthorized` remains `false`. A human-recorded Gate-A decision may
approve only deployment and paused configuration on Base Sepolia. It cannot authorize an isolated
smoke, app pointer, feature flag, paymaster change, shared Sepolia promotion, or Base mainnet.

```json
{
  "schemaVersion": 1,
  "decision": "NO-GO",
  "executionAuthorized": false,
  "approvedBy": "PENDING",
  "approvedAt": "PENDING ISO-8601",
  "approvalScope": "deploy and configure paused Base Sepolia candidate only",
  "candidateCommit": "PENDING reviewed 40-character Git SHA",
  "candidateBaseCommit": "ce3999574b085ba453beef5c36817fe53a1f06c9",
  "chainId": 84532,
  "protocolVersion": "base-v1-a1",
  "toolchain": {
    "foundry": "v1.7.1",
    "solc": "0.8.28",
    "optimizerRuns": 200,
    "viaIr": true,
    "evmVersion": "cancun",
    "bytecodeHash": "none",
    "cborMetadata": false
  },
  "artifacts": {
    "facadeRuntimeBytes": 23487,
    "libraryRuntimeBytes": 5939,
    "facadeRuntimeHash": "PENDING address-linked Base Sepolia candidate",
    "libraryRuntimeHash": "PENDING self-linked Base Sepolia candidate",
    "localRehearsalFacadeRuntimeHash": "0x35f6f60c2575e48650e5cc30b8691bb8430e03f68c2ef4900e35fece773e2812",
    "localRehearsalLibraryRuntimeHash": "0x0c7f706cc0e5a66e5581c7be4c62192c8e5eaf794c84e03b26c71027ec3ef603",
    "storageLayoutHash": "1d3551ad881bfe94fef5e709f3d4fe4b7827f743e54d76fd9fb1ddec802dbbeb",
    "libraryLinkReferences": 11,
    "usdcImmutableReferences": 13
  },
  "candidateVerification": {
    "forgeFormat": "PASS 2026-07-31: Foundry v1.7.1",
    "forgeTests": "PASS 2026-07-31: 121/121",
    "forgeBuildAndSizes": "PASS 2026-07-31: facade 23487 / library 5939 bytes",
    "baseRuntimeSize": "PASS 2026-07-31: EIP-170 headroom 1089 / soft headroom 13 bytes",
    "localAnvilRehearsal": "PASS 2026-07-31: LOCAL_A1_REHEARSAL_OK / LOCAL_A1_DRIVER_OK",
    "forgeClientAbiParity": "PASS 2026-07-31: inputs, outputs, mutability, indexed fields and errors",
    "chainCapabilityMap": "PASS 2026-07-31: 25 Solana / 22 Base / 26 rows",
    "focusedA1WebTests": "PASS 2026-07-31: 113/113",
    "fullWebTests": "PASS 2026-07-31: 867/867 across 123 files",
    "formatLintTypecheck": "PASS 2026-07-31",
    "isolatedBaseUiBuild": "PASS 2026-07-31",
    "baseHarnessTypecheck": "PASS 2026-07-31",
    "productionWebpackBuild": "PASS 2026-07-31: Next.js 16.1.6 webpack, 151/151 pages"
  },
  "approvedInputsReference": "PENDING slash, restitution, roles, custody, operators and exposure",
  "securityAcceptanceReference": "PENDING external review or explicit Base Sepolia risk acceptance",
  "rollbackReviewReference": "PENDING",
  "humanGoReference": "PENDING"
}
```

## Founder Gate-C decision record — added 2026-07-31

Gate C remains **NO-GO**. When Gate B has produced a fresh paused A1 deployment, copy the following
record to a non-secret operator JSON file and replace every `PENDING` value. Do not commit personal
custody details. `decision` may become `GO: isolated smoke` only after the founder approves the exact
commit, deployment, roles, risk-acceptance evidence, fixtures, lane, signing method, and exposure
cap. Approval for Gate C does not approve Gate D or Base mainnet.

```json
{
  "schemaVersion": 1,
  "decision": "NO-GO",
  "approvedBy": "PENDING",
  "approvedAt": "PENDING ISO-8601",
  "candidateCommit": "PENDING 40-character Git SHA",
  "chainId": 84532,
  "protocolVersion": "base-v1-a1",
  "contractAddress": "PENDING",
  "libraryAddress": "PENDING",
  "deploymentBlock": "PENDING",
  "usdcAddress": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "slashPercentage": "PENDING APPROVED INTEGER",
  "restitutionRecipient": "PENDING",
  "roleCustodyReference": "PENDING",
  "securityAcceptanceReference": "PENDING",
  "gateBReadbackReference": "PENDING",
  "signingMethod": "PENDING",
  "fallbackCranker": "PENDING",
  "monitorOwner": "PENDING",
  "incidentCommander": "PENDING",
  "exposure": {
    "policy": "PENDING",
    "capUsdcMicros": "PENDING",
    "authorBondUsdcMicros": "PENDING",
    "voucherStakeUsdcMicros": ["PENDING", "PENDING"],
    "listingPriceUsdcMicros": "PENDING",
    "purchaseLane": "PENDING Direct or Authorization"
  },
  "fixtures": {
    "author": "PENDING",
    "upheldBuyer": "PENDING",
    "rejectedBuyer": "PENDING",
    "expiryBuyer": "PENDING",
    "vouchers": ["PENDING", "PENDING"],
    "resolver": "PENDING observed RESOLVER_ROLE holder",
    "pauseAuthority": "PENDING observed PAUSE_ROLE holder"
  }
}
```

The read-only command below validates that record against the exact on-chain code/config/roles,
requires the candidate to remain paused, rejects Settlement-lane receipts, reads every fresh fixture
profile to prove it is unregistered, excludes role-bearing negative-test actors, checks the funding
cap, and writes `gate-c-readiness.json` with a 31-step transaction/evidence plan. A match is labeled
`READY_FOR_HUMAN_REVIEW`, never `GO`; the output always sets `executionAuthorized: false` and
`writeModesEnabled: false`. The unsigned local record is not an authorization artifact. The command
neither accepts a key nor signs, submits, or simulates a state-changing transaction.

```bash
export BASE_A1_GATE_C_DECISION_PATH="/absolute/path/to/gate-c-decision.json"
npm run base:a1:ops --workspace @agentvouch/web -- gate-c-readiness
```

The command derives the reviewed candidate from a clean local Git `HEAD`, proves the declared
facade creation boundary on-chain, and fully rescans events from that block instead of trusting a
mutable cached event file.

An actual write-capable executor remains blocked on the completed founder record, deployed A1
identity, approved signer/custody integration, funded fresh fixtures, and a separate explicit Gate-C
public-network approval. The resulting transaction/UserOp hashes and explicit-block balance deltas
remain future live evidence, not pre-broadcast claims.

## Live evidence

- Deployment: `PENDING`
- Paused staging and role handoff: `PENDING`
- Isolated lifecycle smoke: `PENDING`
- Reconciliation and repause: `PENDING`
- Preview activation and rollback exercise: `PENDING`
- Shared Sepolia promotion: `PENDING`

## Local pre-broadcast evidence — 2026-07-13

- `forge test`: 121 passed.
- Web Vitest: 679 passed across 103 files.
- Facade runtime: 23,487 bytes; EIP-170 headroom 1,089 bytes; project soft-limit headroom 13 bytes.
- PaidPurchaseSettlement runtime: 5,939 bytes.
- Format, lint, web typecheck, chain-capability map, isolated Base UI build, harness typecheck, and
  production webpack build passed.
- The final disposable-Anvil rehearsal verified exact linked-library/facade code hashes, paused
  staging and complete role handoff, paginated slashing, 15 USDC buyer credit, 5 USDC reserve credit,
  2 USDC voucher residual, and terminal liveness while paused; it emitted `LOCAL_A1_REHEARSAL_OK` and
  `LOCAL_A1_DRIVER_OK`.
- Read-only operations tooling and deployment-qualified report recovery are implemented. On
  2026-07-31, the tooling gained strict founder-record validation, exact full-config and fresh-profile
  readback, and a non-broadcast Gate-C transaction/evidence plan. Its unsigned output is explicitly
  non-authorizing. The public-network write executor remains human-gated and incomplete for the
  reasons recorded above.

## Current non-broadcast revalidation — 2026-07-31

- Evidence branch started from merged `main` at `ce3999574b085ba453beef5c36817fe53a1f06c9`;
  an exact reviewed candidate commit is still `PENDING` until this evidence diff is committed.
- `npm run format:check`, web lint, web typecheck, and `npm run verify:chain-map` passed. The chain
  map reported 25 Solana instructions, 22 Base state-changing functions, and 26 mapped rows.
- Focused Base/A1 tests passed 113/113. The full web suite passed 867/867 tests across 123 files.
- `npm run verify:base-a1-paid-report-abi` loaded the fresh Forge artifact and passed canonical parity for
  five buyer/read function inputs, outputs, and mutability across web/UI/harness; five operator
  functions across UI/harness with their required web omission; and 11 event indexed-field shapes
  plus 19 errors across all three clients. A missing-artifact negative check failed closed with the
  expected diagnostic.
- The isolated Base UI build and harness typecheck passed. The UI build retained existing Vite
  deprecation and bundle-size warnings.
- The initial production-build failure came from unreconciled copied `node_modules`, not repository
  code. The canonical clean root lockfile install completed without a source or lockfile change; the
  unchanged Next.js 16.1.6 webpack build then passed all 151 pages. The existing `ox`
  dynamic-dependency warning remained.
- The host had no existing Foundry installation. A checksum-verified official Foundry `v1.7.1`
  Apple Silicon archive was extracted only under `/private/tmp`; exact CI dependency tags were
  cloned only into the gitignored contract `lib/` directory. `forge fmt --check` passed; 121/121
  contract tests passed; `forge build --sizes` and `npm run verify:base-size` reproduced the 23,487
  byte facade, 5,939 byte library, frozen storage-layout hash, 11 library references, and 13 USDC
  immutable references. The build emitted existing timestamp and safe-cast lint warnings; no new
  contract diff was introduced.
- The disposable local Anvil rehearsal on chain ID 84532 passed with
  `LOCAL_A1_REHEARSAL_OK` / `LOCAL_A1_DRIVER_OK`. It reproduced exact expected/actual local linked
  code hashes, 15 USDC buyer credit, 5 USDC reserve credit, 2 USDC voucher residual, and terminal
  liveness while paused. Its standard test mnemonic and transactions remained local and gitignored.
  No public RPC write, public-network deployment, environment change, pointer change, paymaster
  change, feature-flag change, or live-funds action occurred.

The currently selected web deployment remains the historical pre-A1 `base-v1-candidate` until an
approved activation changes that pointer. A repository merge or testnet deployment alone is not an
activation claim.
