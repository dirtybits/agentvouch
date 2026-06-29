---
name: base-port-chain-adapter-phase-3b
overview: "Phase 3b of the Base port: render one real Base Sepolia listing in the live /skills marketplace, fetched server-side through getAdapter(ctx).fetchSkillListing, with Solana listings still rendering. Reads only — NO wallet, NO writes (Phases 4/5), and do NOT repoint Solana callers (Phase 2c). Sub-plan of .agents/plans/base-port-chain-adapter.plan.md (Phase 3, base-adapter-readslice). Decision-locked before touching the live 849-line web/app/api/skills/route.ts."
todos:
  - id: lock-db-identifier
    content: "DECISION (needs user sign-off — live Neon migration): how Base's bytes32 listing-id is stored in the skills table. RECOMMEND adding explicit evm_listing_id/evm_contract_address/evm_tx_hash columns (minimal Phase 6 slice pulled forward); do NOT overload Solana-sized on_chain_address. Alternative: derive listingId(author, skillIdHash) on the fly (rejected — fragile, still needs the author EVM address stored). Record the chosen approach here, dated, before any code."
    status: pending
  - id: seed-base-listing
    content: "Seed ONE listing on AgentVouchEvm 0x6Fd9…D854 (Base Sepolia) via the base-poc harness (registerAgent author -> createSkillListing) with a funded EOA (+ CDP paymaster for gas-free). Capture the returned bytes32 listingId + tx hash. NEEDS EVM key / CDP creds — not available headless."
    status: pending
  - id: add-evm-columns
    content: "Add idempotent ALTER TABLE skills ADD COLUMN IF NOT EXISTS evm_listing_id VARCHAR(66), evm_contract_address VARCHAR(42), evm_tx_hash VARCHAR(66) in web/lib/db.ts (the repo's inline-migration pattern, alongside the existing ALTER TABLE skills statements). Insert/Update the seeded skill row: chain_context=eip155:84532, evm_listing_id=<bytes32>, evm_contract_address=0x6Fd9…D854, author_pubkey=<EVM addr> (display-only — per D4 the EVM author is NOT routed through /author/[pubkey] / Solana helpers), name/price/uri."
    status: pending
  - id: fetch-base-listings
    content: "Add fetchBaseChainListings(): ChainSkillRow[] in web/app/api/skills/route.ts (mirror fetchOnChainListings): select skills rows WHERE chain_context LIKE 'eip155:%', and for each call getAdapter(row.chain_context).fetchSkillListing(row.evm_listing_id) -> map to a CHAIN-AWARE ChainSkillRow (see D4): leave on_chain_address NULL, carry evm_listing_id + chain_context, mark the card non-purchasable, author as plain text (no /author/[pubkey] for EVM). Server-side read (publicnode RPC). Skip rows missing evm_listing_id."
    status: pending
  - id: wire-merge
    content: "Merge baseChainSkills into the existing mergeSkills call (route.ts ~L485-487): mergeSkills(normalizedPgSkills, [...chainSkills, ...baseChainSkills]). Confirm mergeSkills dedup key (skill_id / on_chain_address) so a Base DB row + its hydrated chain row reconcile (one card, not two). Solana fetchOnChainListings path untouched."
    status: pending
  - id: verify-render
    content: "Dev server (preview tools): /skills renders the seeded Base listing (price/name/author from the live contract) alongside the Solana listings; no Solana regression. Server-side fetch (no client RPC waterfall). Use https://base-sepolia-rpc.publicnode.com."
    status: pending
  - id: verify-gates
    content: "web typecheck + lint + vitest AND `npm run build --workspace @agentvouch/web` green (repo-required build gate — 3b changes web/lib/db.ts + web/app/api/skills/route.ts; Next may need network for Google Fonts). Confirm viem stays out of the client bundle (dynamically imported, BaseAdapter reads server-side only). One commit/PR off feat/base-port-chain-adapter."
    status: pending
isProject: false
---

# Phase 3b — Render a Base listing in the live /skills marketplace

Sub-plan of [`base-port-chain-adapter.plan.md`](./base-port-chain-adapter.plan.md) Phase 3
(`base-adapter-readslice`). Phase **3a is done + live-verified** (BaseAdapter reads decode `getListing`
against the deployed contract). 3b is the **first UI wiring of the seam** — and the first time any
frontend/route file calls `getAdapter`.

> **Updated 2026-06-29 per PR #58 review** (threads r3489645455 / r3489645457 / r3489645459 /
> r3489645462): the Base render must be **chain-aware + read-only** — `on_chain_address` stays NULL,
> cards non-purchasable, author plain-text (see **D4**) — and the repo build gate is added to Verification.

## Goal

One real Base Sepolia listing renders on `/skills`, fetched server-side through
`getAdapter("eip155:84532").fetchSkillListing(<bytes32>)`, with the existing Solana listings still
rendering unchanged. This proves the `ChainAdapter` seam generalizes to a second chain end-to-end
(contract → adapter → route → UI).

## Scope

- **In scope:** the minimal `skills`-table columns to carry a Base listing id; seeding one listing;
  a `fetchBaseChainListings()` hydration path in `web/app/api/skills/route.ts`; the render proof.
- **Out of scope (do NOT do here):** wallet connect / writes (Phases 4/5); repointing the Solana
  callers to `getAdapter` (Phase 2c); `listSkillListings` event enumeration (stays disabled —
  per-row `fetchSkillListing` is the marketplace path); the full Phase 6 DB generalization (only the
  columns 3b needs); Base mainnet (Sepolia only).

## Design decisions to LOCK (before code)

### D1 — Base listing-id storage  ⚠ needs user sign-off (live Neon migration)
Base listing ids are `bytes32` (66-char `0x…`), not Solana base58 PDAs, and `eba0b7c`'s reviewer
explicitly said not to overload `on_chain_address`.
- **Recommended:** add `evm_listing_id VARCHAR(66)` (+ `evm_contract_address VARCHAR(42)`,
  `evm_tx_hash VARCHAR(66)`) — the minimal slice of Phase 6 pulled forward. Explicit, durable, and
  `fetchSkillListing()` receives the exact bytes32 it needs.
- **Rejected for 3b:** deriving `listingId = keccak256(abiEncode(author, keccak256(skillId)))` on the
  fly. It still requires the author's EVM address stored on the row, must match the contract's keccak
  exactly, and hides the id from the DB — fragile for a value the seed already knows.
- **Why this gates code:** it's a migration on the **live** Neon project ([[neon-db-two-projects]] —
  use `agentvouch-postgres`, mind the branch limit). Confirm before running. _Decision recorded: ____ (date)._

### D2 — Seeding (needs creds)
Both `0x6Fd9…D854` and the older `0x5D90…` have **zero** listings (verified 2026-06-24), so a listing
must be created. Use the base-poc harness (`registerAgent` author → `createSkillListing`) against
`0x6Fd9…D854` with a funded EOA (CDP paymaster for gas-free, or pay Sepolia gas). Record the returned
`bytes32` `listingId` + tx hash. Pick a dedicated test author key + a clearly-labeled demo skill.
`listingId` derivation reference: `contracts/base-poc/ui/src/flow.ts` (`computeListingId`).

### D3 — Route merge (behavior-preserving)
Mirror the existing Solana pattern, don't replace it. `fetchOnChainListings()` (Solana
`getProgramAccounts`) stays; add `fetchBaseChainListings()` (DB-driven hydration) and merge both into
`mergeSkills`. The Base path is legitimately different (DB = discovery, chain = current state) — that
asymmetry is why the seam exists.

### D4 — Base card rendering: read-only + chain-aware  (PR #58 review, 2026-06-29)
`evm_listing_id` has its own column (D1), but it must NOT be mapped into the
`ChainSkillRow.on_chain_address` / card fields the existing UI treats as Solana:
- **`on_chain_address` stays NULL for Base rows.** Downstream the client purchase path runs it
  through `address(listingPubkey)` (`@solana/kit`), and `price_usdc_micros` + `on_chain_address`
  makes the card look like a purchasable Solana `direct-purchase-skill` listing. Carry the id in
  `evm_listing_id` + `chain_context`; add a chain-aware display field if the card needs it.
- **Render Base cards NON-PURCHASABLE** (disabled buy / no direct-purchase affordance) until Phase 5
  wires the Base `ChainWallet`. 3b is a read-only render proof.
- **Author is plain text / disabled for Base** — do NOT route an EVM `0x…` author through
  `/author/[pubkey]`, which runs it through Solana helpers (`address()`, Solana trust/vouch) and
  breaks. Chain-aware/disabled author until the author page/API resolves EVM profiles via
  `AgentVouchEvm.getProfile` (Phase 5 identity).

## Files To Change

- `web/lib/db.ts` — add the `ALTER TABLE skills ADD COLUMN IF NOT EXISTS evm_*` statements next to
  the existing inline migrations (~L165-200); extend the skills insert/select helpers + `ChainSkillRow`
  / `MergedSkillRow` types if they need the new fields.
- `web/app/api/skills/route.ts` — add `fetchBaseChainListings()` (mirrors `fetchOnChainListings()` at
  L134); call it and merge at the `mergeSkills(normalizedPgSkills, chainSkills)` site (~L485-487).
- (seed) `contracts/base-poc/harness/*` — run, don't necessarily edit; capture the listing id.
- No change to `web/lib/adapters/*` (3a is complete) and no Solana-caller repointing.

## Implementation Steps

1. **Lock D1** (user sign-off) and record it in this file.
2. **Seed** one Base listing (D2); note `evm_listing_id`, `evm_contract_address`, `evm_tx_hash`,
   author EVM address, skill metadata.
3. **Migrate + row** (`add-evm-columns`): add the columns; insert/Update the seeded skill row with
   `chain_context = eip155:84532` and the EVM fields.
4. **Hydrate** (`fetch-base-listings`): implement `fetchBaseChainListings()` — select `eip155:%` rows,
   `getAdapter(ctx).fetchSkillListing(evm_listing_id)` each, map to a **chain-aware** `ChainSkillRow`
   (D4): carry `name`, `description`, `price_usdc_micros`, `chain_context`, `evm_listing_id`; **leave
   `on_chain_address` NULL**, mark the card **non-purchasable**, and keep the author as a plain-text
   display value (no `/author/[pubkey]` link for EVM). Skip rows without `evm_listing_id`.
5. **Merge** (`wire-merge`): `mergeSkills(normalizedPgSkills, [...chainSkills, ...baseChainSkills])`;
   verify the dedup key reconciles the Base DB row with its hydrated chain row into one card.

## Verification

- **Render proof (the Done-when):** dev server up, `/skills` shows the seeded Base listing — name,
  price, author pulled live from `0x6Fd9…D854` via `fetchSkillListing` — **and** the Solana listings
  still render. Capture a screenshot.
- **No regression:** Solana `/skills` cards unchanged; `fetchOnChainListings` path untouched.
- **Bundle hygiene:** viem still dynamically imported; `BaseAdapter` only used server-side in the
  route handler (no `'use client'` import of the registry).
- **Gates:** `cd web && npm run typecheck && npm run lint && npm test` **and** `npm run build
  --workspace @agentvouch/web` green — the repo-required build gate (3b changes `web/lib/db.ts` +
  `web/app/api/skills/route.ts`; Next may need network for Google Fonts). (Markdown is not in
  `format:check` scope; `.ts` is.)

## Rollback

Per-PR revert. The `evm_*` columns are additive (`IF NOT EXISTS`, nullable) — harmless to existing
Solana rows even if the route change is reverted. No destructive DB changes.

## Blockers (gating — none resolvable in a headless worktree)

- **No app / DB env:** `web/.env.local` is missing → the dev server can't run `/skills` (DB queries
  fail). Get it via `vercel env pull web/.env.local` (pulls secrets — user's call) or have it provided.
- **No seed creds:** no EVM key / CDP paymaster creds to create the listing.
- **D1 sign-off:** the live Neon migration needs an explicit go before running.

## Open question for the executor

`mergeSkills` dedup/key semantics for Base: confirm against the running app that a Base **DB row**
(in `normalizedPgSkills`) and its **hydrated chain row** (from `fetchBaseChainListings`) collapse to a
single marketplace card. If `mergeSkills` keys on `on_chain_address`/`skill_id` and the Base chain row
carries `evm_listing_id` in a different field, adjust the mapping so they reconcile (or hydrate the DB
row in place instead of emitting a separate chain row).
