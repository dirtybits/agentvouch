---
name: base-port-chain-adapter-phase-6
overview: "Phase 6 of the Base port: harden Postgres persistence for Base/EVM and Solana by making listing, receipt, entitlement, and activity reads explicitly chain-qualified before the Base default flip."
todos:
  - id: preflight-current-schema
    content: "DONE 2026-07-01: inspected merged Phase 5 schema helpers and call sites; live Neon constraint/index snapshot skipped because this worktree has no DATABASE_URL or Base envs loaded."
    status: completed
  - id: harden-skill-evm-identity
    content: Add/verify EVM listing identity constraints and helpers so Base rows use chain_context + evm_contract_address + evm_listing_id, never Solana on_chain_address, and Solana rows keep their current PDA/program semantics.
    status: pending
  - id: migrate-chain-qualified-entitlements
    content: Backfill and enforce buyer_chain_context/buyer_address plus recipient_chain_context/recipient_address and asset_chain_context/asset_address, then move entitlement uniqueness/upserts/lookups from bare buyer_pubkey to the chain-qualified buyer key while preserving Solana compatibility.
    status: pending
  - id: harden-chain-aware-callers
    content: Audit and update raw access, purchase verification, x402 settlement, skill detail, marketplace activity, and dashboard/read paths so Base rows never flow through Solana PDA/ATA/pubkey assumptions.
    status: pending
  - id: add-phase6-regression-tests
    content: Add focused tests/source assertions for chain-qualified entitlement collisions, Base/Solana raw access separation, EVM listing persistence, and activity/dashboard rendering fields.
    status: pending
  - id: verify-phase6
    content: Run format, lint, typecheck, web tests, and Next build; run live Neon migration/smoke only when the intended DATABASE_URL and Base test envs are present.
    status: pending
isProject: false
---

# Phase 6 - Multichain Database Hardening

Sub-plan of [`base-port-chain-adapter.plan.md`](./base-port-chain-adapter.plan.md) Phase 6
(`db-multichain`).

## Goal

Make the database and read/write helpers honest about chain identity before AgentVouch defaults to
Base. After this phase, Base and Solana purchases for the same skill are keyed by
`(skill_db_id, buyer_chain_context, buyer_address)`, Base listings are identified by EVM fields, and
UI/API activity reads can render either chain without treating EVM addresses as Solana PDAs.

## Dependencies

- Phase 5 is merged on `main` as `a61f65d` / PR #67, with Base write and EVM x402 paths wired.
- Phase 5 already added additive chain-qualified fields in `web/lib/usdcPurchases.ts` and
  `web/lib/db.ts`. Phase 6 hardens that transitional model; it is not a from-zero schema addition.
- Use CAIP-2 chain labels. Base Sepolia remains `eip155:84532`; Base mainnet `eip155:8453` is still
  blocked until Phase 8b.

## Scope

- **In scope:** Postgres DDL in the existing idempotent schema helpers, EVM listing uniqueness,
  chain-qualified receipt and entitlement semantics, chain-aware read/write call sites, regression
  tests, and local build/test verification.
- **Out of scope:** Base default-chain flip, Base mainnet schema policy, deleting Solana columns,
  renaming every legacy `buyer_pubkey` field, disputes/slashing on Base, and the Phase 2 Solana
  adapter caller repoint. Phase 2 circles back after this phase.

## Current State To Preserve

- `skills.chain_context` is the chain discriminator.
- Base skill rows use `evm_listing_id`, `evm_contract_address`, and `evm_tx_hash`; Base listing ids
  must not be stored in `on_chain_address`.
- Solana rows still use `on_chain_address`, `on_chain_program_id`, `recipient_ata`, `currency_mint`,
  and `purchase_pda` fields.
- `web/lib/usdcPurchases.ts` currently has both legacy helpers such as
  `hasUsdcPurchaseEntitlement(skillDbId, buyerPubkey)` and chain-aware helpers such as
  `hasChainUsdcPurchaseEntitlement(skillDbId, buyer)`.
- `usdc_purchase_entitlements` still has transitional `PRIMARY KEY (skill_db_id, buyer_pubkey)` and
  `ON CONFLICT (skill_db_id, buyer_pubkey)` paths. This is the main correctness target for Phase 6.

## Progress Notes

- 2026-07-01: Preflight source inspection completed on `feat/base-port-phase-6` after Phase 5 merged
  on `main` as `a61f65d`. The local worktree has no `.env*` files beyond
  `contracts/base-poc/**/.env.example`, and the current shell has no `DATABASE_URL`, Base Sepolia
  RPC, paymaster, x402 relayer, or Base chain-context envs set. Live Neon index/constraint snapshot
  was therefore skipped.
- 2026-07-01: Confirmed Phase 5's additive groundwork exists, but the hardening work remains real:
  `web/lib/usdcPurchases.ts` still creates `usdc_purchase_entitlements` with
  `PRIMARY KEY (skill_db_id, buyer_pubkey)` and has `ON CONFLICT (skill_db_id, buyer_pubkey)` paths
  for entitlement backfill and write upsert. The chain-qualified entitlement index exists but is not
  yet authoritative.
- 2026-07-01: Confirmed `web/lib/db.ts` adds Base skill fields and receipt chain-buyer indexes, but
  its top-level schema initializer only creates/backfills `usdc_purchase_receipts`; entitlement DDL
  lives in `web/lib/usdcPurchases.ts`. Keep fresh-database and upgraded-database behavior aligned
  when Phase 6 changes constraints.
- 2026-07-01: Caller scan found the expected split: Base detail lookups already use
  `hasChainUsdcPurchaseEntitlement` when a buyer chain context/EVM address is present, while Solana
  and repo/x402 paths still use legacy `hasUsdcPurchaseEntitlement`. Activity responses still expose
  `buyer_pubkey` as the actor field. These are Phase 6 call-site audit targets.

## Design Decisions

### D1 - Chain-qualified buyer identity is canonical

Use `(skill_db_id, buyer_chain_context, buyer_address)` as the entitlement identity. For EVM chains,
normalize `buyer_address` to lowercase for lookup stability; for Solana, preserve case-sensitive
base58 strings.

Keep `buyer_pubkey` as a legacy compatibility alias for existing Solana-shaped code and API response
fields during this phase, but do not use it as the canonical entitlement key for new writes.

### D2 - Replace entitlement uniqueness only after backfill

Implementation should be staged:

1. Backfill missing chain-qualified fields from legacy fields.
2. Check for duplicate `(skill_db_id, buyer_chain_context, buyer_address)` groups.
3. If duplicates exist, stop and report them rather than guessing which entitlement wins.
4. Once clean, enforce non-null buyer chain/address on `usdc_purchase_entitlements`.
5. Replace the old `(skill_db_id, buyer_pubkey)` primary/upsert semantics with the chain-qualified
   key. Keep a non-unique legacy index on `(skill_db_id, buyer_pubkey)` while callers finish moving.

### D3 - Receipts stay append-only by payment proof

`usdc_purchase_receipts.payment_tx_signature` remains the unique payment proof. Receipt upserts may
continue to conflict by payment signature, but the defensive checks must compare chain-qualified
buyer fields in addition to legacy buyer fields so one payment proof cannot unlock a different
chain/buyer pair.

### D4 - Base listing identity is `(chain_context, evm_contract_address, evm_listing_id)`

Add or verify a partial unique index for Base/EVM listings using those three fields when EVM fields
are present. Do not add a uniqueness rule that conflates Base rows with Solana
`on_chain_address`.

### D5 - Phase 6 is deploy-safe without live Base smoke

The schema and helper changes must be source/test/build verified locally. Live Neon migration and
Base purchase smoke are required only when the intended `DATABASE_URL`, Base Sepolia RPC, paymaster,
relayer, and funded-wallet envs are present. If those envs are missing, record that as a skipped live
verification, not as a failure.

## Files To Inspect First

- `web/lib/db.ts`: top-level idempotent schema setup and duplicated purchase table DDL.
- `web/lib/usdcPurchases.ts`: receipt/entitlement DDL, backfill, upsert, lookup, and x402 attempt
  helpers.
- `web/lib/skillRawAccess.ts`: raw access checks for Solana and Base paid downloads.
- `web/app/api/skills/[id]/route.ts`: buyer lookup and detail response entitlement state.
- `web/app/api/skills/[id]/purchase/verify/route.ts`: Base and Solana verification persistence.
- `web/app/api/x402/verify/route.ts` and `web/app/api/x402/settle/route.ts`: EVM x402 entitlement
  and settlement attempt paths.
- `web/app/api/skills/activity/route.ts` and `web/app/skills/MarketplaceClient.tsx`: recent purchase
  activity fields and actor chain labels.
- `web/lib/marketplaceBrowse.ts` and `web/lib/skillDetailSnapshot.ts`: skill row projections and
  trust joins that still bias toward the configured Solana chain.
- Existing tests under `web/__tests__/api/*skills*`, `web/__tests__/lib/usdcPurchases-source.test.ts`,
  and `web/__tests__/lib/*Purchase*.test.ts`.

## Implementation Steps

### 1. Preflight schema and source truth

- Confirm the branch is `feat/base-port-phase-6` and based on current `origin/main`.
- Inspect current `web/lib/db.ts` and `web/lib/usdcPurchases.ts` DDL for duplicate table creation
  blocks; keep them aligned or centralize shared SQL so a fresh database and an upgraded database
  land on the same schema.
- If `DATABASE_URL` points at the intended Neon branch, snapshot existing constraints/indexes:
  - `skills`
  - `usdc_purchase_receipts`
  - `usdc_purchase_entitlements`
  - `usdc_x402_settlement_attempts`
- Block live migration if the env points at the wrong Neon project or if duplicate chain-qualified
  entitlement rows already exist.

### 2. Harden `skills` EVM listing identity

- Keep `evm_listing_id VARCHAR(66)`, `evm_contract_address VARCHAR(42)`, and `evm_tx_hash VARCHAR(66)`.
- Normalize persisted EVM contract addresses consistently, preferably lowercase at storage
  boundaries and formatted/checksummed only for display.
- Add/verify partial indexes:
  - `(chain_context, evm_contract_address, evm_listing_id)` for EVM rows.
  - existing `(chain_context, on_chain_program_id, on_chain_address)` for Solana rows.
- Add source/test coverage proving Base rows keep `on_chain_address = NULL` and Solana rows keep
  `evm_listing_id = NULL` unless a deliberate hybrid mapping is introduced later.

### 3. Move entitlement identity to chain-qualified keys

- Backfill `buyer_chain_context`, `buyer_address`, `recipient_chain_context`, `recipient_address`,
  `asset_chain_context`, and `asset_address` for existing rows.
- For Solana backfill:
  - `buyer_chain_context = chain_context`
  - `buyer_address = buyer_pubkey`
  - `recipient_address = recipient_ata`
  - `asset_address = currency_mint`
- For Base rows, ensure the Phase 5 persistence path writes:
  - `buyer_chain_context = eip155:84532`
  - `buyer_address = lower(buyer)`
  - `recipient_chain_context = eip155:84532`
  - `recipient_address = lower(author/recipient as applicable)`
  - `asset_chain_context = eip155:84532`
  - `asset_address = lower(native Base Sepolia USDC)`
  - `evm_listing_id` and `evm_purchase_id`
- Replace `ON CONFLICT (skill_db_id, buyer_pubkey)` in entitlement inserts/backfills with the
  chain-qualified key.
- Keep `hasUsdcPurchaseEntitlement` as a Solana-compatible wrapper, but make new or mixed-chain
  call sites use `hasChainUsdcPurchaseEntitlement`.

### 4. Guard call sites by chain context

- Raw access:
  - Solana paid raw access must still verify Solana purchase/auth proof.
  - Base raw access must use `buyer_chain_context` + `buyer_address` and must not pass `0x...`
    values into Solana PDA/ATA checks.
- Purchase verification:
  - Base persistence should use chain-qualified buyer/recipient/asset fields even if legacy response
    fields still expose `buyer_pubkey`.
  - Solana persistence should keep legacy fields populated while also populating chain-qualified
    fields.
- Activity and dashboards:
  - Prefer `buyer_address` + `buyer_chain_context` for actor display where present.
  - Keep `buyer_pubkey` only as a fallback for older Solana rows.
  - Include `evm_listing_id` / `evm_tx_hash` where Base activity links need explorer URLs.
- Snapshot/listing reads:
  - Keep trust joins scoped by the row chain context; do not hard-code the configured Solana chain
    for EVM rows.

### 5. Add regression coverage

Minimum test cases:

- A Solana entitlement and a Base entitlement for the same `skill_db_id` do not collide when buyer
  strings differ only by chain semantics.
- Base entitlement lookup succeeds only with matching `buyer_chain_context` and normalized
  `buyer_address`.
- Legacy Solana lookup still succeeds for existing callers.
- A reused payment proof for a different buyer chain/address is rejected.
- Base activity responses expose an EVM actor with an EVM chain context, not a Solana author link.
- Base skill rows persist `evm_listing_id` and leave `on_chain_address` untouched/null.

Use source assertions only where database-backed tests would be brittle in this workspace; prefer
real helper tests when the current test harness can exercise them.

## Verification

Required local checks:

```bash
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm test --workspace @agentvouch/web
npm exec --workspace @agentvouch/web -- next build --webpack
```

Optional live checks when envs are present and confirmed to target the intended Neon branch:

- Run the schema initializer against the target database and confirm the new indexes/constraints.
- Verify one existing Solana entitlement remains readable.
- Verify one Base entitlement row can be inserted/read with `buyer_chain_context = eip155:84532`.
- If Base RPC/paymaster/relayer/funded wallet envs are also present, run a Base purchase or x402
  settlement smoke and confirm the persisted entitlement uses the chain-qualified key.

## Rollout

- Ship as one PR from `feat/base-port-phase-6`.
- Do not flip the default chain in this PR.
- If the live migration is run before merge, capture the Neon branch/project, timestamp, and schema
  evidence in the PR or plan progress notes.
- After merge, circle back to Phase 2 caller/seam cleanup before Phase 7/8 default-chain work.

## Rollback

- Code rollback: revert the Phase 6 PR. The Phase 5 additive columns can remain.
- Database rollback should avoid dropping data-bearing columns. If a chain-qualified primary/unique
  key change causes a production issue, restore the legacy `(skill_db_id, buyer_pubkey)` upsert path
  in code first, then add a compatibility unique index only if needed.
- Do not delete Base receipt/entitlement rows during rollback; they are payment evidence.

## Blockers

- Duplicate rows for `(skill_db_id, buyer_chain_context, buyer_address)` in live data.
- Missing or ambiguous `DATABASE_URL` for live migration verification.
- Any caller that still needs to grant Base access through a Solana-only `buyer_pubkey` path.
- Discovery that dashboard/activity consumers depend on `buyer_pubkey` being Solana-shaped without a
  chain context.
