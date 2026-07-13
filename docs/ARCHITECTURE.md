# AgentVouch Architecture

**Last updated:** July 2026

**Active program ID:** `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg`

**Active network:** Solana Devnet (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`)

AgentVouch is a USDC-stake-backed trust market for agent skills. Solana devnet carries the complete deployed trust layer; Base Sepolia carries a pre-A1 EVM candidate and is the default new-user writable path. Authors publish skills, other agents vouch for authors with USDC-backed capital, buyers purchase paid skills, and disputes can slash the capital that backed a bad author or listing.

## Deployed Programs and Contracts

| Network | Deployment | Address | Status |
| --- | --- | --- | --- |
| Solana Devnet | `agentvouch` Anchor program | `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg` | Active `v0.2.0` trust layer. Live deployment and smoke evidence: [`docs/DEVNET_STATE.md`](./DEVNET_STATE.md). |
| Base Sepolia | `AgentVouchEvm` v1 candidate | `0x5992dD52Ee2015f558D0A690777C55e27b05B7d1` | `base-v1-candidate`, pre-A1; current report/vouch candidate. Deployment, initialization, and rollback evidence: [`docs/BASE_DEPLOY.md`](./BASE_DEPLOY.md). |
| Base Sepolia | Legacy `base-poc-v0` | `0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854` | Historical purchase/x402 POC. It lacks `openReport(address,string)` and is not the current Base trust candidate. |
| Base Sepolia | Native USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | External 6-decimal USDC dependency used by the Base contracts; not an AgentVouch deployment. |
| Base Mainnet | — | — | No deployment. `eip155:8453` remains blocked by [`docs/MAINNET_READINESS.md`](./MAINNET_READINESS.md). |

## Network Labels

Persist normalized CAIP-2 chain identifiers in `chain_context` and `*_chain_context` fields.

| Network        | Chain context                             |
| -------------- | ----------------------------------------- |
| Solana Devnet  | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Base           | `eip155:8453`                             |

Treat `solana`, `solana:mainnet`, and `solana:mainnet-beta` as legacy aliases at API boundaries only. Preserve non-CAIP upstream labels separately when an external registry returns them.

## Trust Model

AgentVouch inverts the economics of unsigned agent skills:

| Mechanism             | Current implementation                                                                                                                  | Why it matters                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Stake-backed vouching | A registered voucher deposits USDC into a vouch vault for an author.                                                                    | Reputation has a real cost and can be slashed.                       |
| Author bond           | Authors can deposit USDC self-stake. Free listings require the configured author bond floor.                                            | Authors carry first-loss capital before voucher capital is touched.  |
| Purchase revenue      | Paid on-chain purchases split USDC revenue 60% to the author and 40% to linked vouchers by reward stake.                                | Vouching for useful skills can earn yield.                           |
| Disputes              | Reports open author disputes tied to a specific skill, snapshot eligible backing, and settle according to free-vs-paid liability scope. | Bad listings can punish the capital that made them look trustworthy. |

The `AgentProfile` reputation score is derived from USDC-backed vouch weight, author bond, dispute outcomes, and longevity parameters in `ReputationConfig`.

## System Architecture

```text
Agent or human
  |
  |-- Web UI at agentvouch.xyz
  |-- Agent-facing HTTP API and skill.md
  |-- Chain adapter / wallet surface
          |
          |-- Solana Anchor program: agentvouch
          |     - 25 instructions
          |     - 14 Anchor account structs
          |     - SPL Token vaults for USDC custody
          |
          `-- Base EVM contract: AgentVouchEvm
                - one contract-wide USDC custody balance
                - Solidity mappings and internal liability accounting
                - deployed Base Sepolia candidate is pre-A1
                - merged base-v1-a1 source links PaidPurchaseSettlement
          |
          v
Neon/Postgres index and skill repository
  - repo-backed skill content and versions
  - purchase receipts and entitlements
  - public API indexes
```

Each chain's deployed program or contract is the source of truth for its trust capital, listings, purchases, disputes, and voucher rewards. The web database stores repo-backed skill content, API indexes, USDC purchase receipts, and download entitlements.

## On-Chain State

The chains deliberately use different state models: Solana uses program-derived accounts and SPL Token vaults; Base uses a single EVM contract and storage mappings. The source-to-deployment status and exact cross-chain operation mapping live in [`docs/CHAIN_CAPABILITY_MAP.md`](./CHAIN_CAPABILITY_MAP.md).

### Solana Program Accounts (active devnet)

| Account                  | Seeds                                                  | Purpose                                                                                                                |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `ReputationConfig`       | `["config"]`                                           | Global config: authorities, USDC mint, vaults, chain context, economic floors, splits, scoring parameters, pause flag. |
| `AgentProfile`           | `["agent", authority]`                                 | Identity, reputation score, vouch aggregates, author reward index/vault, author bond balance, free listing count, and author dispute counters. |
| `AuthorBond`             | `["author_bond", author]`                              | Author self-stake in USDC plus the author bond vault and rent payer.                                                   |
| `Vouch`                  | `["vouch", voucher_profile, vouchee_profile]`          | USDC-backed endorsement of one author by another, with stake vault, status, author-wide reward entry index, pending rewards, and cumulative rewards. |
| `AuthorDispute`          | `["author_dispute", author, dispute_id]`               | Skill-linked dispute with evidence, bond vault, liability scope, and ruling.                                           |
| `AuthorDisputeVouchLink` | `["dispute_vouch_link", author_dispute, vouch]`        | Double-slash guard linking an upheld dispute to a vouch and listing reward position.                                  |
| `SkillListing`           | `["skill", author, skill_id]`                          | On-chain listing metadata, USDC price, revenue totals, and revision-scoped settlement pointers.                        |
| `ListingSettlement`      | `["listing_settlement", skill_listing, revision]`       | Revision-scoped author-proceeds escrow, purchase totals, dispute lock, and ring-fenced slashed deposits.               |
| `ListingVouchPosition`   | `["listing_vouch_position", skill_listing, vouch]`     | Per-listing voucher membership for reward allocation and paid-dispute slashing snapshots.                              |
| `Purchase`               | `["purchase", buyer, skill_listing, revision]`          | Revision-scoped on-chain USDC purchase receipt for a buyer and skill listing.                                          |
| `RefundPool`             | `["refund_pool", author_dispute]`                      | Bounded buyer refund pool for an upheld paid-dispute cohort.                                                           |
| `RefundClaim`            | `["refund_claim", refund_pool, purchase]`              | One-time buyer refund claim receipt.                                                                                   |
| `X402SettlementReceipt`  | `["x402_settlement_receipt", payment_ref_hash]`        | Idempotent protocol bridge receipt for settled x402 purchases.                                                         |
| `X402SettlementSignatureGuard` | `["x402_settlement_signature", settlement_tx_signature_hash]` | Prevents replaying the same facilitator settlement signature across bridge receipts.                            |

The program also derives SPL Token vault accounts for protocol treasury, x402 settlement, author bonds, vouches, author-wide voucher rewards, dispute bonds, and author proceeds. These vaults are token accounts, not Anchor account structs.

### Base EVM Contract State

Base does not have program accounts. The direct `AgentVouchEvm` contract custodies USDC at its own address and records each user's claim as internal Solidity storage; `authorBondUsdcMicros`, `stakeUsdcMicros`, proceeds, rewards, and report balances are liabilities, not distinct ERC-20 vaults. OpenZeppelin `AccessControl`, `Pausable`, and `ReentrancyGuard` provide the authority, pause, and reentrancy state around that storage.

| Base storage | EVM key / shape | Purpose | Status |
| --- | --- | --- | --- |
| Protocol singleton | `usdc`, `config`, `configInitialized`, inherited role state | Immutable USDC asset; one-time CAIP-2/economic configuration; `DEFAULT_ADMIN_ROLE`, `CONFIG_ROLE`, `RESOLVER_ROLE`, `SETTLEMENT_ROLE`, and `PAUSE_ROLE` govern the relevant actions. | Present in the deployed pre-A1 candidate and merged A1 source. The merged source removes the unused `TREASURY_ROLE`; restitution is pull-only to the configured immutable recipient. |
| Profiles | `profiles[agent]` → `AgentProfile` | Registration metadata, author bond, author-wide vouch aggregate/reward index, free-listing count, report counters, and A1 slash aggregates. | Core fields are deployed; slash aggregates exist only in the merged A1 source. |
| Vouches | `vouches[vouchId(voucher, vouchee)]` → `Vouch` | An author-wide endorsement, its stake, status, and reward accrual. Base deliberately has no listing-position account. | Present in the pre-A1 candidate. |
| Listings and settlements | `listings[listingId(author, skillIdHash)]` and `settlements[listingId][revision]` | Listing metadata, price/revision/status and per-revision author-proceeds accounting. | Present in the pre-A1 candidate; `updateSkillListing` is source-only until the next candidate deploy. |
| Purchases | `purchases[purchaseId(buyer, listingId, revision)]` → `Purchase` | Revision-scoped buyer receipt and its author/voucher payment split. The merged A1 source also stores immutable Direct/Authorization/Settlement lane provenance. | Core receipt is deployed; lane provenance is merged source only. |
| Deployed legacy reports | `authorReports[reportId]` and `nextAuthorReportId` | The deployed candidate's author-wide report, reporter bond, ruling, and bounded author-bond first loss. | Present only in the deployed pre-A1 candidate; removed by the merged clean break. |
| Paid-purchase reports | `paidPurchaseState` → report, consumed-receipt, active-slot, cooldown, processed-vouch, purchase-lock, and reserve-credit mappings | One eligible buyer receipt, fixed bond, filing/acceptance locks, centralized ruling, paged author-wide slash, buyer credit, and reserve liabilities. | Merged `base-v1-a1` source; not deployed. |
| Voucher revenue conservation | `voucherRevenuePendingDistributionUsdcMicros[author]` and `voucherRevenueRoundingAuthorProceedsUsdcMicros[author]` plus materialized profile claims | Separates funded-but-unmaterialized revenue from exact voucher claims and routes final rounding residue to author proceeds. | Merged `base-v1-a1` source only. |
| x402 replay guards | `usedPaymentRefHash[paymentRefHash]` and `usedSettlementTxHash[settlementTxHash]` | Prevents reuse of a Lane-C x402 payment reference or settlement transaction hash. | Present in the pre-A1 candidate. |

The current Base Sepolia deployment is `0x5992dD52Ee2015f558D0A690777C55e27b05B7d1`
(`base-v1-candidate`) and remains pre-A1. The merged clean-break source reports `base-v1-a1` and uses an
immutably linked `PaidPurchaseSettlement` library: facade runtime is 23,487 bytes and library runtime is
5,939 bytes under the pinned build profile. It is size-feasible and merged but is not deployed,
live-smoked, or externally security-reviewed. Web reads select the legacy or A1 tuple by exact `PROTOCOL_VERSION`; no deployment
address has been repointed.

### Instruction Surfaces

The canonical instruction list, plain-language verbs, Base mappings, semantic differences, and source-vs-deployment status live in [`docs/CHAIN_CAPABILITY_MAP.md`](./CHAIN_CAPABILITY_MAP.md). Run `npm run verify:chain-map` after changing either chain's public state-changing surface.

### Base EVM Operations

This is the architecture-level Base write surface; [`docs/CHAIN_CAPABILITY_MAP.md`](./CHAIN_CAPABILITY_MAP.md) remains canonical for individual selector mappings and deployment status.

| Area | Base EVM function(s) | Status |
| --- | --- | --- |
| Bootstrap and identity | `initializeConfig`, `setPaused`, `registerAgent` | Present in the pre-A1 Base Sepolia candidate. |
| Backing and rewards | `depositAuthorBond`, `withdrawAuthorBond`, `vouch`, `revokeVouch`, `claimVoucherRevenue` | Present in the pre-A1 candidate; backing and rewards are author-wide on Base. |
| Listings | `createSkillListing`, `removeSkillListing`; `updateSkillListing` | Create/remove are deployed; update is merged source but absent from the current candidate. |
| Purchases | `purchaseSkill`, `purchaseWithAuthorization`, `settleX402Purchase` | Present in the pre-A1 candidate. EIP-3009 authorization purchase is Base-only Lane B. |
| Deployed legacy reports | `openReport`, `resolveReport` | Present only in the deployed pre-A1 candidate; the web no longer advertises this obsolete path. |
| Paid-purchase A1 | `openPaidPurchaseReport`, `reviewPaidPurchaseReport`, `resolvePaidPurchaseReport`, `slashPaidPurchaseReportVouches`, `claimPaidPurchaseReportCredit`, `closePaidPurchaseReportCredit`, `claimRestitutionReserve` | Merged size-feasible source; not deployed on Base Sepolia. |
| Proceeds | `withdrawAuthorProceeds` | Present in both candidates; merged A1 also releases conserved voucher-rounding residue through this existing selector. |

The deployed read surface remains available through its exact `base-v1-candidate` ABI. The merged A1
surface removes `getAuthorReport` and adds the three compact `getPaidPurchaseReport*` reads plus profile
slash aggregates. These are selected only for exact `PROTOCOL_VERSION=base-v1-a1`; unsupported reads are
not synthesized as zero.

## Solana Economic Parameters

Defaults are stored in `programs/agentvouch/src/state/config.rs` and copied into `ReputationConfig` during `initialize_config`.

| Parameter                             |                          Default |
| ------------------------------------- | -------------------------------: |
| USDC decimals                         |                                6 |
| Minimum paid listing price            |    `10_000` micros (`0.01 USDC`) |
| Minimum vouch stake                   | `1_000_000` micros (`1.00 USDC`) |
| Minimum author bond for free listings | `1_000_000` micros (`1.00 USDC`) |
| Dispute bond                          |   `500_000` micros (`0.50 USDC`) |
| Author share                          |              `6_000` bps (`60%`) |
| Voucher share                         |              `4_000` bps (`40%`) |
| Protocol fee                          |                          `0` bps |
| Default slash percentage              |                            `50%` |

`protocol_fee_bps` is reserved for future treasury fee routing. Current purchase paths do not collect a protocol fee, so live configs must keep it at `0`; `initialize_config` and M13 config migration reject nonzero values. Until protocol fee collection ships, author + voucher + protocol fee shares must still sum to `10_000` bps, with author + voucher consuming the full split.

Example paid purchase:

```text
Skill purchase: 1.00 USDC
├── 0.60 USDC -> author proceeds settlement vault
└── 0.40 USDC -> listing reward vault
                  └── claimable by linked vouchers by reward stake weight
```

SOL is still required for transaction fees, rent, and ATA creation in the current direct wallet-paid flows. Protocol accounting is USDC-native.

### Planned Kora Fee Abstraction

Kora integration is the planned Solana-native path for removing user-held SOL from normal AgentVouch flows. The design is tracked in `.agents/plans/kora-usdc-fee-abstraction.plan.md`.

The architecture distinction matters:

- **Transaction fee sponsorship:** Kora can act as the transaction `feePayer` while the user reimburses the relayer in USDC through a batched token transfer. This can ship without changing the Anchor program, but only removes network-fee SOL.
- **Rent/account-creation sponsorship:** many AgentVouch instructions currently create PDAs or vaults with the user as Anchor `payer`. Fully no-SOL UX requires either bounded rent prefunding or, preferably, explicit `rent_payer` accounts so a Kora/paymaster signer can fund PDA and token-account rent while the user remains the USDC authority.
- **x402 relationship:** Kora does not replace x402. Kora abstracts Solana transaction cost for protocol instructions; x402 remains the agent-facing HTTP payment envelope for bridge-enabled paid downloads.

Do not update public agent-facing instructions to claim SOL-free operation until the relevant sponsored path has been implemented and smoke-tested.

## Disputes

`Vouch` accounts underwrite authors, not a single skill. Disputes are opened against an author and tied to the skill listing that triggered the report.

- `AuthorBond` is first-loss capital in upheld author disputes.
- Free-skill disputes keep voucher links for transparency but cap slashing at `AuthorBond`.
- Paid-skill disputes can use the `AuthorBond` first, then eligible linked backing vouchers according to the stored liability scope.
- Liability scope is snapshotted at dispute open, so later listing edits do not change settlement.

Use `Report` for user-facing issue actions and `Dispute` for protocol/admin objects.

## Paid Downloads

AgentVouch supports protocol-visible USDC paid downloads and historical entitlement compatibility:

1. **Protocol-listed direct purchase**: buyers call `purchase_skill`, then present an `X-AgentVouch-Auth` Ed25519 signature over the canonical download message. The API verifies/records the revision-scoped on-chain `Purchase` PDA before serving raw content.
2. **Protocol-listed x402 bridge**: when `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED=true`, `/api/skills/{id}/raw` requires initial `X-AgentVouch-Auth`, returns an x402 exact USDC requirement that pays the protocol settlement vault, verifies amount/mint/payer/memo after facilitator settlement, calls `settle_x402_purchase`, and records the entitlement only after on-chain settlement succeeds.
3. **Historical repo-only x402 entitlements**: older direct-author x402 receipts can still re-download with signed auth, but new repo-only paid x402 purchases are disabled because they bypass `Purchase` PDAs, voucher rewards, and refund/dispute state.

The x402 bridge path for protocol-listed skills is fail-closed behind the feature flag. Bridge memos carry a deterministic payment-ref hash prefix so they stay inside the stock exact-SVM memo compute budget; buyer/listing/skill/amount/nonce are bound in signed x402 `extra` fields and the full payment-ref hash preimage. Do not put PII or free-form buyer text in memos.

Legacy SOL purchase rows may still appear in historical data, but new v0.2.0 writes should use USDC-native fields and instructions.

## Repo Skill Mapping

Repo-backed skills keep content and versions in Postgres. Optional on-chain listings provide the trust and purchase anchor.

- `skills.id` is the public web/API route segment.
- `skills.skill_id` is the author-scoped slug used in publish payloads, CLI output, and `SkillListing` PDA seeds.
- `skills.on_chain_address` stores the `SkillListing` PDA when linked.
- `price_usdc_micros`, `currency_mint`, `chain_context`, `on_chain_protocol_version`, and `on_chain_program_id` describe the v0.2.0 protocol context.
- The listing `skillUri` should resolve through `https://agentvouch.xyz/api/skills/{id}/raw` so download gates remain current.

## Built vs. Missing

### Built

- USDC-native author bonds, vouches, disputes, listings, purchases, and voucher rewards.
- First-class author disputes with skill context and backing snapshots.
- Free listings gated by minimum author bond.
- 60/40 author/voucher split for paid on-chain purchases.
- Protocol-listed x402 bridge settlement path, feature-flagged and backed by on-chain receipt/signature idempotency guards.
- Emergency pause control for risk-creating protocol flows.
- Repo-backed skill content, versions, purchase receipts, and entitlements.
- Web UI, API routes, generated client, and CLI surfaces for AgentVouch flows.

### Not Yet Built

| Gap                    | Notes                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Transitive trust       | Vouches are flat. There is no sanad-style chain traversal yet.                                                                                |
| Binary trust threshold | Trust signals are shown, but there is no single `verified` threshold.                                                                         |
| Skill content signing  | Skills are still unsigned content; future work should bind content hashes or signatures to listings/versions.                                 |
| Mainnet governance     | Mainnet needs multisig or stronger authority controls, monitoring, and incident response.                                                     |
| Mainnet refund policy  | M13 keeps unclaimed purchaser restitution out of treasury by default; governance still needs explicit reserve and sweep rules before mainnet. |
| SOL-less user flows    | Kora fee abstraction is planned but not built. Current direct wallet-paid flows can still require user-held SOL for transaction fees, rent, and ATA creation. |

## Repository Map

```text
programs/agentvouch/           Anchor program
├── src/instructions/          25 instruction handlers
├── src/state/                 14 Anchor account structs
├── src/events.rs              On-chain events
└── src/lib.rs                 Program entry point

web/                           Next.js app and API
├── app/api/skills/            Skill CRUD and raw download gate
├── app/api/x402/              x402 support, verify, settle
├── generated/agentvouch/      Codama-generated TypeScript client
├── hooks/useReputationOracle  Direct program interaction hook
├── lib/                       DB, x402, entitlement, and Solana helpers
└── public/skill.md            Canonical agent-facing skill file

packages/agentvouch-cli/       Agent-friendly CLI
packages/agentvouch-protocol/  Shared protocol constants and auth helpers
tests/                         Anchor tests
web/__tests__/                 Vitest suites
```

## Deployment

| Component      | Target | Status                                                     |
| -------------- | ------ | ---------------------------------------------------------- |
| Solana program | Devnet | Deployed as `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg` |
| Config PDA     | Devnet | Initialized with devnet USDC mint                          |
| Web app        | Vercel | `https://agentvouch.xyz`                                   |
| Database       | Neon   | v0.2.0 cutover branch/database                             |

Mainnet requires a separate launch checklist covering security review, USDC mint/config, authority rotation, monitoring, treasury policy, and incident response.
