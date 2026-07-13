---
name: base-paid-report-activation-sepolia
overview: "Activate the merged base-v1-a1 PaidPurchaseReport mechanism on Base Sepolia through a fresh linked deployment, explicit paused staging, a purchase-bound buyer client, isolated lifecycle smoke, and reversible preview/production cutover—without enabling Base mainnet."
todos:
  - id: lock-activation-inputs
    content: "Record the approved slash percentage, restitution-reserve recipient, testnet role holders, fallback cranker/monitor owner, external-review or explicit human-acceptance evidence, and the exact Base Sepolia exposure policy before any broadcast."
    status: pending
  - id: harden-dormant-deploy-sequence
    content: "Update the Base deploy runbook and rehearsal so the linked facade is deployed uninitialized with ADMIN_ADDRESS separated from the broadcaster, PAUSE_ROLE pauses it before initializeConfig, and initialization completes while paused; prove no configured unpaused interval and no client pointer change."
    status: pending
  - id: implement-paid-report-client
    content: "Add a Base-only optional PaidPurchaseReport open/claim wallet capability and exact base-v1-a1 ABI/event handling for Coinbase Smart Wallet and supported injected wallets without reviving the removed general-report API or changing the required cross-chain ChainWallet surface."
    status: pending
  - id: implement-purchase-bound-ui
    content: "Move the Base report entry point to an eligible paid-purchase surface, bind author/listing/purchase/evidence, disclose the 5 USDC bond and centralized resolution, and cover approve/open/pending/error states while preserving the Solana author-report path."
    status: pending
  - id: persist-report-index
    content: "Expose the exact deployment-qualified EVM purchase summary and add an additive report index populated only from a verified PaidPurchaseReportOpened event so report status and credit claims recover safely after reload."
    status: pending
  - id: add-operator-smoke-and-monitoring
    content: "Build a restart-safe Base Sepolia paid-report smoke/operations driver that records linked code hashes, roles/config, deadlines, explicit-block USDC deltas, multi-page crank progress, liabilities, reserve credit, pause state, and machine-readable transaction evidence."
    status: pending
  - id: deploy-verify-paused-sepolia
    content: "HUMAN GATE — After explicit broadcast approval, deploy and explorer-verify the linked library and fresh facade, stage it initialized and paused with approved roles/config, verify bytecode/linking/selectors, and leave all app env pointers unchanged."
    status: pending
  - id: smoke-and-activate-sepolia
    content: "HUMAN GATE — Run isolated fresh fixtures, unpause only for the approved lifecycle smoke, repause and reconcile, then activate preview before any shared Sepolia pointer/paymaster update; promote only after buyer, operator, rollback, and Solana regression gates pass."
    status: pending
  - id: record-live-evidence
    content: "After actual deployment and activation, update capability, readiness, deployment, production-runbook, Phase 9, and agent-facing docs with exact addresses, blocks, hashes, role owners, protocol version, enabled client surfaces, rollback tuple, and remaining mainnet blockers."
    status: pending
isProject: false
---

# Base Paid-Purchase Report Activation — Base Sepolia

## Goal

Move the merged `base-v1-a1` source from implementation-complete to a fresh, verified, and deliberately activated Base Sepolia deployment. The release must expose only receipt-bound `PaidPurchaseReport` filing, preserve centralized resolver disclosure, prove the complete settlement and exit lifecycle, and remain reversible at the client and pause boundaries.

This plan separates implementation, deployment, configuration, activation, live smoke, and public launch claims. Completing one stage does not imply the next.

## Current State — verified 2026-07-13

- PR #102 merged the clean-break `base-v1-a1` contract, linked `PaidPurchaseSettlement` library, tests, synchronized ABI consumers, deployment rehearsal, and runtime-size gate into `main` at `ce219b86`.
- The facade runtime is 23,487 bytes and the linked library runtime is 5,939 bytes under the pinned production profile. The 23,500-byte project soft limit leaves 13 bytes of facade headroom; this plan adds no contract selector, storage field, proxy, module router, or paid-report-only on-chain flag.
- The live Base Sepolia contract remains the pre-A1 candidate at `0x5992dD52Ee2015f558D0A690777C55e27b05B7d1` with `PROTOCOL_VERSION=base-v1-candidate`. It does not implement the merged paid-report surface.
- The merged web client deliberately throws for removed general Base reports and does not expose paid-report writes.
- `AgentVouchEvm` has a global `setPaused` control, not a paid-report-only feature flag. A configured, unpaused deployment is directly callable even if the UI hides the feature. A client env flag is therefore UX gating only.
- The old Base Sepolia deployment and all deployment-qualified receipts/entitlements remain valid historical state. A fresh A1 contract is a new deployment identity, not an upgrade.
- Existing pre-A1 purchases are not reportable on the fresh A1 contract. Client eligibility must require the receipt/entitlement’s contract address and protocol version to match the selected `base-v1-a1` deployment.
- Base mainnet (`eip155:8453`) remains stop-the-line blocked by `docs/MAINNET_READINESS.md`.

## Activation Decision — 2026-07-13

Use an atomic A1 contract cutover rather than adding a paid-report-only contract flag:

1. Deploy the linked facade with `ADMIN_ADDRESS` set to the approved testnet role owner rather than the broadcaster. The existing script then leaves the facade uninitialized.
2. From the `PAUSE_ROLE` holder, call `setPaused(true)` before `initializeConfig`.
3. Initialize the exact locked economics while the facade is paused.
4. Verify code hashes, link map, protocol version, config, roles, pause state, and deployment identity without changing any web environment pointer.
5. Unpause only for an explicitly approved isolated smoke or cutover.

This ordering avoids a configured/unpaused interval without spending runtime bytes. Global pause also blocks ordinary listings, purchases, vouches, and bond changes, so the A1 contract cannot provide “commerce live, reports disabled.” Deployment, smoke, and client activation must therefore be treated as one controlled release sequence.

## Scope

### In scope

- Fresh linked `base-v1-a1` deployment on Base Sepolia only.
- Dormant deployment/configuration choreography using the existing global pause.
- A receipt-bound Base paid-report client for supported Base wallets.
- Buyer filing UX from the purchased skill/receipt context.
- Deployment-qualified purchase/report persistence and reload recovery.
- Resolver, permissionless crank, buyer-credit, restitution-reserve, and residual-reclaim operator paths.
- Preview-first environment cutover, CDP paymaster allowlist update, rollback, monitoring, and evidence capture.
- Current-state documentation and exact deployment-identity updates.

### Out of scope

- Base mainnet deployment or enabling `eip155:8453`.
- A proxy, upgrade key, new on-chain feature flag, ABI compatibility wrapper, or additional contract module.
- General or reputation-only Base reports.
- A2 governance, appeals, reporter/keeper rewards, insurance/backstop, or changed A1 economics.
- Rewriting existing pre-A1 receipts, entitlements, reports, or contract-bound rows.
- Treating testnet deployment as external security approval or mainnet readiness.

## Locked Protocol Behavior

This plan may not change the A1 plan’s locked economics or lifecycle:

- eligible buyer-owned Direct or Authorization receipt only;
- one permanent report per purchase and one active report per buyer/listing/author;
- filing within seven days of purchase;
- fixed 5 USDC report bond;
- three-day resolver review window;
- seven-day rejected/dismissed buyer cooldown and expired-report author cooldown;
- filing-time listing/collateral membership lock;
- acceptance-time author-wide purchase lock;
- author-bond-first percentage slash followed by author-wide voucher percentage slash;
- initiating-buyer-only credit capped at purchase price plus bond return;
- seven-day funded credit claim window;
- excess, rejected/dismissed bonds, and expired credits routed to the immutable restitution recipient;
- no reporter reward, keeper reward, proceeds debit, treasury sweep, or protocol backstop.

Any deviation requires explicit operator approval and an amendment to the authoritative A1 plan before implementation.

## Preconditions And Human Gates

Before any Base Sepolia broadcast, record:

- final `SLASH_PERCENTAGE`;
- immutable `TREASURY_RECIPIENT` / restitution-reserve recipient;
- holders and custody method for `DEFAULT_ADMIN_ROLE`, `CONFIG_ROLE`, `RESOLVER_ROLE`, `SETTLEMENT_ROLE`, and `PAUSE_ROLE`;
- named resolver recovery owner, fallback cranker, accepted-report age alarm owner, and incident commander;
- exact compiler, optimizer, `via_ir`, EVM target, metadata, remappings, library link map, and expected code hashes;
- external security pass or explicit human-recorded testnet risk acceptance;
- Base Sepolia exposure policy and whether activation is isolated fixtures, preview users, or the shared default;
- explicit approval for each public-network write phase: deploy/configure, isolated smoke, preview activation, and shared Sepolia promotion.

The API-key nonce/object-binding PR is an independent security change and is explicitly out of this plan’s scope. Neither PR certifies or blocks the other. As with any intervening merge, update the activation implementation onto the final `main` and rerun affected gates before activation.

## Files Expected To Change During Execution

- `contracts/base-poc/script/Deploy.s.sol`: retain exact economics/link checks and make the paused staging sequence explicit or fail closed when the broadcaster would initialize an unpaused release candidate.
- `contracts/base-poc/script/RehearseA1.s.sol` and deployment tests: prove deploy-uninitialized → pause → initialize-while-paused → verify → approved unpause ordering.
- `docs/BASE_DEPLOY.md`: replace the pre-A1-centric broadcast steps with linked A1 dormant deployment, separate activation, verification, and rollback gates.
- `web/lib/adapters/agentVouchEvmAbi.ts`: expose the exact paid-report reads/events needed by the client without legacy report selectors.
- `web/lib/adapters/types.ts` plus a focused Base paid-report capability module: add an optional capability/type guard rather than a required method on every `ChainWallet` implementation.
- `web/lib/adapters/baseWallet.ts` and `web/lib/adapters/baseInjectedWallet.ts`: implement supported-wallet buyer registration, approval/open, claim, and receipt verification against the selected A1 deployment identity.
- `web/app/skills/[id]/SkillDetailClient.tsx`: add the purchase-bound entry, disclosures, evidence input, and transaction state.
- `web/app/author/[pubkey]/page.tsx`: keep Solana reporting intact while ensuring Base does not offer the removed general author-report flow.
- `web/lib/usdcPurchases.ts` plus a focused paid-report verification helper/route: expose the existing EVM receipt identity and persist a report index only after exact on-chain event verification.
- `web/scripts/base-paid-report-e2e-smoke.ts`: capture machine-readable deployment and lifecycle evidence with restart-safe stages.
- Focused adapter, UI-source, route/helper, and deployment tests under `web/__tests__/` and `contracts/base-poc/test/`.
- `docs/CHAIN_CAPABILITY_MAP.md`, `docs/MAINNET_READINESS.md`, `docs/PRODUCTION_RUNBOOK.md`, `.agents/plans/base-port-chain-adapter-phase-9.plan.md`, and `web/public/skill.md`: update only after corresponding behavior is actually deployed or activated.

The exact client seam may be adjusted during implementation if repository types have changed, but the implementation must not silently reuse `openAuthorReport` for the incompatible paid-purchase lifecycle or make the capability mandatory for Solana.

## Implementation Sequence

### 1. Lock inputs and release evidence

Create one public deployment record containing the proposed facade/library addresses, compiler/link profile, code hashes, roles, config, pause state, deploy block, activation block, environment pointer, paymaster policy, and rollback contract. Unknown fields remain visibly pending.

### 2. Prove dormant deployment choreography locally

Rehearse the production-shaped sequence on Anvil chain ID 84532:

1. Deploy/link the expected library.
2. Deploy the facade with an `ADMIN_ADDRESS` different from the broadcaster.
3. Prove `configInitialized == false` and risk-creating calls fail closed.
4. Pause from the approved role owner.
5. Initialize the exact config while paused.
6. Grant each final role, verify it, then revoke the staging holder’s corresponding role. Retain
   `DEFAULT_ADMIN_ROLE` until every grant is verified; transfer/revoke it last and prove no unintended
   admin remains.
7. Prove filing, purchases, listings, vouches, and bond mutations remain blocked.
8. Prove permitted registration/terminal paths have the documented pause behavior.
9. Unpause from `PAUSE_ROLE` and execute the full A1 rehearsal.

Deployment tooling must reject a zero, missing-code, wrong-code-hash, or wrongly linked library and must not print private keys.

### 3. Build the paid-report client

Use a Base-only optional capability with `openPaidPurchaseReport` and `claimPaidPurchaseReportCredit`:

- input: author, listing ID, purchase ID, evidence URI, expected 5 USDC bond, chain ID, and contract address;
- preflight: `PROTOCOL_VERSION == base-v1-a1`, exact selected deployment, eligible wallet/account, buyer and author profile state, current purchase/listing relationship, filing deadline, USDC balance/allowance, pause state, and code presence;
- registration: ensure the buyer is registered on the selected A1 deployment before approval/open. Add a normal injected-wallet `registerAgent` path or explicitly mark injected buyers unsupported until that path is verified; purchasing alone does not register the buyer;
- admission errors: because consumed-purchase, active-report, and cooldown mappings have no public getters in the frozen ABI, simulate the exact `openPaidPurchaseReport` call and decode its custom error. The event/DB index may improve UX but is never authority for admissibility;
- submit: exact USDC approval plus `openPaidPurchaseReport`;
- receipt verification: selected contract address and exact `PaidPurchaseReportOpened` event fields;
- claim: exact deployment/report state, funded credit, initiating buyer, open deadline, and `PaidPurchaseReportCreditClaimed` receipt verification;
- failure: no fallback to the pre-A1 contract, Solana report path, another deployment, or unsigned server mutation.

Support Coinbase Smart Wallet and any injected-wallet path already capable of the underlying Base purchase. If a wallet cannot sign/send the required transaction safely, show a precise unsupported state rather than routing around the wallet.

### 4. Build the purchase-bound UX

Expose “Report this purchase” only when the connected buyer has an eligible paid Base receipt associated with the selected A1 contract. The confirmation must show:

- purchase/listing and author identity;
- evidence URI and 256-byte limit;
- 5 USDC bond and approval requirement;
- seven-day filing limit;
- founder/operator centralized review;
- possible rejection, dismissal, expiry, upheld slashing, collateral-limited credit, seven-day claim, and no guarantee of full recovery;
- transaction/userOp hash and report ID after confirmation.

After reload, show the deployment-qualified report state and a buyer-credit claim action only when
the exact on-chain settlement read says the credit is funded, unhandled, and within its claim window.

Do not show a Base author-wide/general report CTA. Preserve the existing Solana report path and terminology.

### 5. Add operator and liveness tooling

The smoke/operations driver must:

- refuse the wrong chain, protocol version, facade, library code hash, link map, USDC, pause state, role holder, or config;
- create fresh registered buyer, author, and at least two voucher fixtures;
- create and purchase a fresh paid listing through an eligible lane;
- use separate fresh eligible receipts for rejection/expiry and accept/uphold branches, prove each consumed receipt cannot reopen, and crank multiple voucher pages for the upheld branch;
- claim buyer credit, pull reserve credit, reclaim voucher residual, and prove premature/duplicate operations fail;
- record transaction hashes, blocks, deadlines, event fields, and USDC balances at explicit block numbers;
- query recent Base Sepolia logs in chunks of at most 1,999 blocks and resume without double-processing;
- expose accepted-report age, remaining snapshotted stake, funded/unpaid credit, reserve credit, pause state, and fallback-cranker alerts.

Public Sepolia cannot time-warp. Prove time-expiry branches locally; on Sepolia record deadlines and premature-close reverts.

### 6. Persist verified report identity

The current EVM entitlement path does not expose enough purchase identity to recover a report flow after reload, and the contract has no public purchase-to-report-ID getter. Add an additive report index keyed by chain context, contract address, buyer address, purchase ID, and report ID.

- Populate it only after reading a confirmed `PaidPurchaseReportOpened` event from the exact selected deployment and matching buyer, author, listing, purchase, and report ID.
- Treat receipts and reports from different contracts on the same chain as different objects.
- Reject client-supplied report IDs or transaction hashes that do not resolve to the exact event.
- Preserve append-only purchase receipts and the existing entitlement primary key; do not retrofit pre-A1 purchases as A1-eligible.
- Use additive, race-tolerant runtime schema initialization only. Any risky backfill or constraint belongs in a guarded one-shot migration with database-host preflight.
- Treat the report index as UX/recovery metadata only. On reload, derive claim/status authority from the exact deployment’s public report reads and exact-call simulation, never from the index or stale UI state alone.

### 7. Deploy, verify, and keep dormant

Only after explicit approval:

1. Broadcast the linked deployment.
2. Pause before initialization and initialize while paused.
3. Verify library and facade separately on the explorer with the identical compiler and link map.
4. Compare deployed runtime code hashes and linked caller artifact.
5. Execute and verify ordered role grants/revocations while retaining the staging default admin until last.
6. Read back protocol version, USDC, config, roles, pause state, and deployment block.
7. Leave `NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS` and CDP policies unchanged.

A deployed/verified/paused contract is not activated and must not be described as live.

### 8. Isolated smoke, preview, and promotion

Each stage needs separate approval:

- **Isolated smoke:** unpause, run only fresh fixtures, complete and reconcile all liabilities, then repause. Do not change shared env pointers.
- **Preview activation:** update the preview contract pointer and CDP allowlist, unpause, run Coinbase/injected wallet filing plus buyer-credit and operator regressions, and verify no cache or receipt crosses deployment identities.
- **Shared Sepolia promotion:** only after preview evidence, update the shared Sepolia pointer/paymaster policy, unpause in the approved order, and run the deployed app smoke.

At every stage, run one old-deployment historical read, one new-deployment write/read, and one Solana purchase/trust regression.

## Verification

Before any deployment candidate is approved:

    export PATH="$HOME/.nvm/versions/node/v24.1.0/bin:$PATH"
    forge fmt --check --root contracts/base-poc
    forge test --root contracts/base-poc -vv
    forge build --root contracts/base-poc --sizes
    npm run verify:base-size
    npm run verify:chain-map
    npm run format:check
    npm run lint --workspace @agentvouch/web
    npm run typecheck --workspace @agentvouch/web
    npm test --workspace @agentvouch/web
    npm exec --workspace @agentvouch/web -- next build --webpack
    npm run build --prefix contracts/base-poc/ui
    npm run typecheck --prefix contracts/base-poc/harness

Required regression evidence:

- facade remains under EIP-170 and the 23,500-byte project soft limit;
- ABI selectors, tuples, events, errors, storage layout, linked code hash, isolated UI ABI, harness ABI, and generated client surfaces agree;
- deployment rehearsal proves the dormant pause-before-init ordering;
- wrong contract, protocol version, chain, USDC, library, pause state, role, purchase, buyer, listing, lane, deadline, bond, or evidence fails closed;
- same entity IDs on old and new Base Sepolia contracts do not contaminate cache, DB, indexer, or UI state;
- duplicate report, crank page, credit claim, reserve claim, and smoke replay are idempotent or reject safely;
- pause blocks new exposure while rejection, expiry, dismissal, uphold cleanup, crank, credit claim, reserve claim, and residual reclaim retain their locked liveness;
- browser smoke covers the supported Base wallets; Solana remains selectable and functional.

## Evidence Record

For every public-network step, record:

- git commit and reviewed artifact;
- chain ID, contract/library addresses, deploy/config/activation blocks, and explorer links;
- solc/optimizer/`via_ir`/EVM/metadata/remapping/link profile;
- runtime/initcode sizes and code hashes;
- role holders and config values, without secret material;
- environment variable names changed and previous/new public address values;
- transaction or userOp hashes, decoded events, deadlines, and explicit-block USDC deltas;
- DB receipt/entitlement rows with chain and contract deployment identity;
- buyer success, non-buyer rejection, duplicate/replay behavior, and rollback smoke;
- known skipped gates and the human acceptance that allowed progression.

## Rollout And Rollback

### Before pointer activation

Keep the new contract paused and unreferenced by the app. Abandoning it requires no migration; record the failed candidate and continue using the pre-A1 deployment.

### After preview activation

1. Pause the new contract to stop new exposure.
2. Restore the preview contract address for new commerce, but retain the A1 facade and its terminal
   buyer-claim selector on the CDP allowlist until every smart-account liability is claimed or expired.
   A buyer-only credit cannot be claimed by an operator, and removing sponsorship can strand a
   zero-ETH smart-account buyer.
3. Redeploy/promote the prior web artifact.
4. Keep the new contract and all accrued claims reachable through deployment-qualified buyer claim
   tooling plus operator settlement tooling; verify a zero-ETH Coinbase smart account can still claim.
5. Reconcile pending reports, crank work, buyer credits, reserve credit, and voucher residuals before declaring rollback complete.

### After shared Sepolia promotion

Use the same pause-and-pointer rollback, but publish an incident note and continue serving deployment-qualified historical reads. Never delete or reinterpret old receipts, entitlements, or liabilities.

Rollback does not authorize reclaiming user liabilities, changing the reserve recipient, or deploying to mainnet.

## Blockers

- Any unresolved A1 deployment input listed above.
- Facade runtime above the 23,500-byte soft limit or 24,576-byte EIP-170 hard limit.
- Contract/library code-hash or explorer-verification mismatch.
- No approved pause/resolver/admin custody or no fallback cranker/monitor owner.
- Client or DB state that is keyed only by chain/entity and not the selected contract deployment.
- No explicit inventory and policy for pre-A1 listings, vouches, bonds, proceeds, open reports, receipts, entitlements, and exit paths before the shared pointer changes.
- No external security pass and no explicit human-recorded testnet acceptance.
- No explicit approval for the next public-network stage.
- Any code or configuration that enables `eip155:8453`.
