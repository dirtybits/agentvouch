---
name: base-port-chain-adapter-phase-6
overview: "Phase 6 of the Base port: harden Postgres persistence for Base/EVM and Solana by making listing, receipt, entitlement, and activity reads explicitly chain-qualified before the Base default flip."
todos:
  - id: preflight-current-schema
    content: "DONE 2026-07-01: inspected merged Phase 5 schema helpers and call sites; live Neon constraint/index snapshot skipped because this worktree has no DATABASE_URL or Base envs loaded."
    status: completed
  - id: harden-skill-evm-identity
    content: "DONE 2026-07-01: non-unique idx_skills_evm_listing + lowercase normalization added to runtime db.ts; Base listing persistence now lowercases evm_contract_address at write; partial UNIQUE variants live in web/scripts/phase6-chain-identity-migration.ts (preflight/migrate) with npm script db:phase6-chain-identity. Final gate is verify-phase6."
    status: completed
  - id: migrate-chain-qualified-entitlements
    content: "DONE 2026-07-01: Phase 5 runtime backfills + non-unique chain-buyer covering index confirmed present; receipt upsert defensive WHERE now also compares buyer_chain_context/buyer_address (D3, NULL-tolerant for pre-backfill rows); chain-qualified UNIQUE index ships via the standalone script; legacy (skill_db_id, buyer_pubkey) PK and ON CONFLICT kept. Caller routing handled under harden-chain-aware-callers."
    status: completed
  - id: harden-chain-aware-callers
    content: "DONE 2026-07-01: trust joins in marketplaceBrowse/skillDetailSnapshot now scope by row chain context (COALESCE to configured Solana for legacy NULL); trustSnapshots.ts drops 0x-shaped authors from Solana trust resolution/persistence at every entry point; activity route exposes buyer_chain_context/buyer_address + EVM listing/purchase fields and passes evmListingId to getSkillPaymentFlow (paid Base skills no longer show listing-required); MarketplaceClient prefers buyer_address+buyer_chain_context with buyer_pubkey fallback. Raw access, purchase verify, and x402 settle audited — already chain-safe from Phase 5 (Base branch precedes all ATA/PDA code)."
    status: completed
  - id: add-phase6-regression-tests
    content: "DONE 2026-07-01: web/__tests__/lib/phase6-chain-identity.test.ts (16 tests) — source assertions for runtime-vs-migration DDL split, D3 receipt guard, chain-scoped trust joins, EVM-author trust-pipeline exclusion, activity chain fields, raw-access ordering (Base branch before ATA derivation); behavioral tests for getSkillPaymentFlow with evmListingId."
    status: completed
  - id: verify-phase6
    content: "DONE 2026-07-01: format:check, web lint, typecheck (next typegen + tsc), vitest (82 files / 469 tests), and next build --webpack all pass locally. Post-merge DB gate also passed: disposable Neon branch rehearsal succeeded, live guarded migrate created both Phase 6 unique indexes on agentvouch-postgres main, and production API smoke returned 200."
    status: completed
isProject: false
---

# Phase 6 - Multichain Database Hardening

> **Status: Completed/Historical — do not edit except corrections. Current status:** > `docs/MAINNET_READINESS.md` for launch gates; this plan remains Phase 6 closeout evidence.

Sub-plan of [`base-port-chain-adapter.plan.md`](./base-port-chain-adapter.plan.md) Phase 6
(`db-multichain`).

## Goal

Make the database and read/write helpers honest about chain identity before AgentVouch defaults to
Base. After this phase, Base and Solana purchases carry chain-qualified buyer, recipient, and asset
identity; Base listing identity is explicit in EVM fields; and UI/API activity reads can render
either chain without treating EVM addresses as Solana PDAs. The legacy
`(skill_db_id, buyer_pubkey)` entitlement primary key stays in place for Phase 6; the destructive PK
swap is deferred until there is a real multi-EVM collision risk.

## Dependencies

- Phase 5 is merged on `main` as `a61f65d` / PR #67, with Base write and EVM x402 paths wired.
- Phase 5 already added additive chain-qualified fields in `web/lib/usdcPurchases.ts` and
  `web/lib/db.ts`. Phase 6 hardens that transitional model; it is not a from-zero schema addition.
- Use CAIP-2 chain labels. Base Sepolia remains `eip155:84532`; Base mainnet `eip155:8453` is still
  blocked until Phase 10.

## Scope

- **In scope:** additive/race-tolerant Postgres DDL in the existing idempotent schema helpers,
  standalone duplicate-detection/migration guidance for any unique indexes, EVM listing identity,
  chain-qualified receipt and entitlement semantics, chain-aware read/write call sites, regression
  tests, and local build/test verification.
- **Out of scope:** Base default-chain flip, Base mainnet schema policy, destructive entitlement
  primary-key swaps, deleting Solana columns, renaming every legacy `buyer_pubkey` field,
  disputes/slashing on Base, and the Phase 2 Solana adapter caller repoint. Phase 2 circles back
  after this phase.

## Current State To Preserve

- `skills.chain_context` is the chain discriminator.
- Base skill rows use `evm_listing_id`, `evm_contract_address`, and `evm_tx_hash`; Base listing ids
  must not be stored in `on_chain_address`.
- Solana rows still use `on_chain_address`, `on_chain_program_id`, `recipient_ata`, `currency_mint`,
  and `purchase_pda` fields.
- `web/lib/usdcPurchases.ts` currently has both legacy helpers such as
  `hasUsdcPurchaseEntitlement(skillDbId, buyerPubkey)` and chain-aware helpers such as
  `hasChainUsdcPurchaseEntitlement(skillDbId, buyer)`.
- `usdc_purchase_entitlements` still has `PRIMARY KEY (skill_db_id, buyer_pubkey)` and
  `ON CONFLICT (skill_db_id, buyer_pubkey)` paths. Keep that legacy key in Phase 6; the correctness
  target is additive chain-qualified lookup/write coverage, not a destructive key swap.

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
- 2026-07-01 implementation: Shipped on `feat/base-port-phase-6`. Runtime `db.ts` gained the
  non-unique `idx_skills_evm_listing`; the partial UNIQUE variants
  (`uidx_skills_evm_listing_identity`, `uidx_usdc_purchase_entitlements_chain_buyer`, both
  `WHERE ... IS NOT NULL`) live in `web/scripts/phase6-chain-identity-migration.ts`
  (`preflight`/`migrate`, npm script `db:phase6-chain-identity`), which aborts with a printed
  duplicate report and never touches the legacy PK. Base listing persistence now lowercases
  `evm_contract_address` at write. D3: the receipt upsert's defensive WHERE also compares
  `buyer_chain_context`/`buyer_address` (NULL-tolerant for pre-backfill rows).
- 2026-07-01 Codex review fixes: ALL data normalization of existing rows now lives in the
  standalone migration only (the runtime `LOWER(evm_contract_address)` backfill was moved out of
  `db.ts`); `migrate` also lowercases EVM `buyer_address` on entitlements and receipts before
  index creation, and preflight groups EVM buyers case-insensitively so it reports what the
  unique index will see; `migrate` refuses to run unless `EXPECTED_DATABASE_HOST` matches the
  `DATABASE_URL` host (wrong-Neon-project guard, see [[neon-db-two-projects]]), and both
  commands print the target host/database.
- 2026-07-01 live preflight (read-only, via Neon MCP against the live `agentvouch-postgres`
  project `calm-meadow-36819154`, default branch): ZERO duplicates on both identity keys —
  `(chain_context, evm_contract_address, evm_listing_id)` in `skills` and case-insensitive
  `(skill_db_id, buyer_chain_context, buyer_address)` in `usdc_purchase_entitlements`. Zero rows
  need lowercase normalization (skills 0, entitlements 0, receipts 0). Data shape: 1 Base-listed
  skill, 17 entitlements (all Solana-context, 0 EVM). `migrate` therefore reduces to creating the
  two partial unique indexes. DDL was NOT run — production DDL requires an explicit operator run
  of `db:phase6-chain-identity migrate` (or an explicitly approved session).
- 2026-07-01 post-merge DB gate: fixed local `neonctl` context to the Vercel-managed org
  `org-nameless-dawn-22327511` and project `agentvouch-postgres` (`calm-meadow-36819154`), with
  main branch `br-quiet-base-afn4qzxf`. Created disposable child branch
  `phase6-preprod-gate-codex-20260701` (`br-young-feather-af5t7y1c`, expires 2026-07-04) from main
  and ran the exact guarded `db:phase6-chain-identity migrate` command there. The rehearsal target
  was `ep-steep-waterfall-afa74v2q.c-2.us-west-2.aws.neon.tech/neondb`; duplicate checks were clean,
  all lowercase normalization updates touched 0 rows, both partial unique indexes were created, and
  a post-run `pg_indexes` check found `uidx_skills_evm_listing_identity` and
  `uidx_usdc_purchase_entitlements_chain_buyer`.
- 2026-07-01 live DB gate: ran the guarded `db:phase6-chain-identity migrate` against live
  `agentvouch-postgres` main (`ep-morning-firefly-afjzu0sp.c-2.us-west-2.aws.neon.tech/neondb`).
  Duplicate checks were clean, all lowercase normalization updates touched 0 rows, both partial
  unique indexes were created, and an independent live `pg_indexes` check found
  `uidx_skills_evm_listing_identity` and `uidx_usdc_purchase_entitlements_chain_buyer`. Production
  smoke after migration returned 200 for `/api/skills?mode=fast`, `/api/skills/activity`, and
  `/api/x402/supported`; the first `/api/skills?mode=fast` request was cold/slow at 9.78s, and a
  warm repeat returned 200 in 0.54s.
- 2026-07-01 implementation discovery: the author-trust snapshot pipeline
  (`lib/trustSnapshots.ts`) persisted every skill author under the configured _Solana_ chain
  context — including `0x…` Base authors, which would have attached bogus Solana-context trust to
  Base skills via the marketplace joins. Fixed by filtering EVM-shaped wallets at every entry
  point (`isEvmShapedWallet`), excluding `0x%` authors from the cron refresh query, and scoping
  the `author_trust_snapshots`/`owner_binding` joins in `marketplaceBrowse.ts` and
  `skillDetailSnapshot.ts` by `COALESCE(s.chain_context, configured Solana)`. Base author trust
  stays live-resolved (`resolveBaseAuthorTrust`); a persisted Base snapshot path is Phase 7+ work.
- 2026-07-01 implementation: activity feed fixes — `/api/skills/activity` now exposes
  `buyer_chain_context`/`buyer_address` and EVM listing/purchase ids, and passes `evmListingId`
  to `getSkillPaymentFlow` (paid Base skills previously rendered as `listing-required`).
  `MarketplaceClient` prefers the chain-qualified actor with `buyer_pubkey` fallback; its
  `ActorLink` already renders `eip155:` actors without a Solana author link. Regression coverage:
  `web/__tests__/lib/phase6-chain-identity.test.ts` (16 tests).
- 2026-07-01 review update: Defer the destructive entitlement PK swap. Today, Solana
  `buyer_pubkey` values are base58 and Base values are lowercased `0x...` hex, so their namespaces
  are disjoint. The real collision appears only when a second EVM chain is enabled, which is blocked
  until Phase 10/mainnet. Phase 6 should add chain-qualified indexes and read/write discipline
  additively, keep the legacy `(skill_db_id, buyer_pubkey)` PK/upsert path, and leave the destructive
  PK swap for a later multi-EVM migration.

## Design Decisions

### D1 - Chain-qualified buyer identity is canonical

Use `(skill_db_id, buyer_chain_context, buyer_address)` as the entitlement identity. For EVM chains,
normalize `buyer_address` to lowercase for lookup stability; for Solana, preserve case-sensitive
base58 strings.

Keep `buyer_pubkey` as a legacy compatibility alias for existing Solana-shaped code and API response
fields during this phase, but do not use it as the canonical entitlement key for new writes.

### D2 - Add chain-qualified uniqueness additively; defer the PK swap

Implementation should be staged:

1. Backfill missing chain-qualified fields from legacy fields.
2. Check for duplicate `(skill_db_id, buyer_chain_context, buyer_address)` groups in a standalone
   preflight/migration script, not inside `ensureUsdcPurchaseSchema()`.
3. If duplicates exist, abort the standalone migration and print/report the duplicate groups; do not
   throw from the request-time schema initializer.
4. Add the chain-qualified unique index additively through the standalone migration after preflight
   passes. If a non-unique covering index is useful before then, it may stay in the runtime helper.
5. Keep the old `(skill_db_id, buyer_pubkey)` primary key and `ON CONFLICT (skill_db_id, buyer_pubkey)`
   upsert semantics in Phase 6. Route new reads/writes through chain-qualified helpers where the
   caller has chain context, but defer the destructive PK swap until a later multi-EVM phase.

Runtime schema helpers may keep additive, race-tolerant `ADD COLUMN IF NOT EXISTS` and non-unique
`CREATE INDEX IF NOT EXISTS` work. Any duplicate scan, unique-index migration that can fail on live
data, `DROP CONSTRAINT`, primary-key swap, or other exclusive-lock migration belongs in a one-shot
guarded migration/preflight script that a human runs and reads.

### D3 - Receipts stay append-only by payment proof

`usdc_purchase_receipts.payment_tx_signature` remains the unique payment proof. Receipt upserts may
continue to conflict by payment signature, but the defensive checks must compare chain-qualified
buyer fields in addition to legacy buyer fields so one payment proof cannot unlock a different
chain/buyer pair.

### D4 - Base listing identity is `(chain_context, evm_contract_address, evm_listing_id)`

Add or verify a partial unique index for Base/EVM listings using those three fields when EVM fields
are present. Do not add a uniqueness rule that conflates Base rows with Solana
`on_chain_address`.

Before adding the unique index, run the same standalone duplicate-check discipline used for
entitlements. If multiple skill rows already point at the same `(chain_context, evm_contract_address, evm_listing_id)` tuple, stop and report the rows rather than creating an index from the request path.
Also backfill `evm_contract_address = lower(evm_contract_address)` and any stored EVM addresses that
feed indexes before creating the index. Display-layer checksumming can still happen at render time.

### D5 - Phase 6 is deploy-safe without live Base smoke

The schema and helper changes must be source/test/build verified locally. Because Phase 6 now avoids
the destructive entitlement PK swap, live Neon migration and Base purchase smoke are required only
when the intended `DATABASE_URL`, Base Sepolia RPC, paymaster, relayer, and funded-wallet envs are
present. If those envs are missing, record that as skipped live verification, not as a failure.

If a later implementation reintroduces a destructive PK swap, live verification is no longer
optional: it needs a disposable Neon branch smoke that runs the one-shot migration, confirms
constraints, and proves one Solana and one Base entitlement remain readable before merge.

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
- Duplicate detection for chain-qualified entitlements and EVM listing identity must live in a
  standalone preflight/migration script. Do not add duplicate scans or "stop and report" errors to
  `ensureUsdcPurchaseSchema()`; a thrown initializer would fail every request that touches receipts
  until data is manually repaired.
- Block the standalone index migration if the env points at the wrong Neon project or if duplicate
  chain-qualified entitlement or EVM listing identity rows already exist.

### 2. Harden `skills` EVM listing identity

- Keep `evm_listing_id VARCHAR(66)`, `evm_contract_address VARCHAR(42)`, and `evm_tx_hash VARCHAR(66)`.
- Add a one-time lower-case backfill for `evm_contract_address` before creating any EVM listing
  identity index. Apply the same lower-case storage rule to any EVM address that feeds an index.
  Formatted/checksummed addresses remain a display concern.
- Add/verify partial indexes:
  - `(chain_context, evm_contract_address, evm_listing_id)` for EVM rows.
  - existing `(chain_context, on_chain_program_id, on_chain_address)` for Solana rows.
- Run and review a duplicate report for `(chain_context, evm_contract_address, evm_listing_id)`
  before creating the EVM unique index; duplicate rows must be resolved intentionally.
- Add source/test coverage proving Base rows keep `on_chain_address = NULL` and Solana rows keep
  `evm_listing_id = NULL` unless a deliberate hybrid mapping is introduced later.

### 3. Add chain-qualified entitlement coverage without swapping the PK

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
  - `recipient_address = lower(AgentVouchEvm contract address)`, matching Phase 5's
    `verifyAndRecordBaseDirectPurchase` behavior where `recipientAta`, `recipientAddress`, and
    `authorProceedsVault` are all the AgentVouch contract/on-chain program id. Do not backfill this
    as the author address unless the live write path changes first.
  - `asset_chain_context = eip155:84532`
  - `asset_address = lower(native Base Sepolia USDC)`
  - `evm_listing_id` and `evm_purchase_id`
- Add the chain-qualified unique index only through the standalone migration after duplicate
  preflight passes; keep any non-unique covering index in the runtime helper if useful.
- Keep `ON CONFLICT (skill_db_id, buyer_pubkey)` in entitlement inserts/backfills for Phase 6 so a
  normal code revert still works against the legacy primary key.
- Keep `hasUsdcPurchaseEntitlement` as a Solana-compatible wrapper, but make new or mixed-chain call
  sites use `hasChainUsdcPurchaseEntitlement`.

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

- A Solana entitlement and a Base entitlement for the same `skill_db_id` continue to work with the
  legacy PK in place and with chain-qualified fields populated.
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

- Run the schema initializer against the target database and confirm additive helper DDL still works.
- If running the standalone index migration, first run its duplicate reports and capture the output.
- Verify one existing Solana entitlement remains readable.
- Verify one Base entitlement row can be inserted/read with `buyer_chain_context = eip155:84532`.
- If Base RPC/paymaster/relayer/funded wallet envs are also present, run a Base purchase or x402
  settlement smoke and confirm the persisted entitlement uses the chain-qualified key.

## Rollout

- Ship as one PR from `feat/base-port-phase-6`.
- Do not flip the default chain in this PR.
- Do not run destructive PK migrations from runtime schema helpers. If additive unique indexes are
  created through a standalone migration, capture the Neon branch/project, duplicate-report output,
  timestamp, and schema evidence in the PR or plan progress notes.
- After merge, circle back to Phase 2 caller/seam cleanup before Phase 7/8 default-chain work.

## Rollback

- Code rollback: revert the Phase 6 PR. The Phase 5 additive columns can remain.
- Database rollback should avoid dropping data-bearing columns. Phase 6 keeps the legacy
  `(skill_db_id, buyer_pubkey)` primary key, so a normal code revert should continue to have a
  matching `ON CONFLICT` target. If an additive chain-qualified index causes an issue, drop or disable
  that additive index through a controlled migration; do not delete payment evidence.
- Do not delete Base receipt/entitlement rows during rollback; they are payment evidence.

## Blockers

- Duplicate rows for `(skill_db_id, buyer_chain_context, buyer_address)` or
  `(chain_context, evm_contract_address, evm_listing_id)` in live data block unique-index migration,
  but should not block request-time schema initialization.
- Missing or ambiguous `DATABASE_URL` for live migration verification.
- Any caller that still needs to grant Base access through a Solana-only `buyer_pubkey` path.
- Discovery that dashboard/activity consumers depend on `buyer_pubkey` being Solana-shaped without a
  chain context.
