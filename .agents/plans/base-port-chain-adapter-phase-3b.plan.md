---
name: base-port-chain-adapter-phase-3b
overview: "Phase 3b of the Base port: render one real Base Sepolia listing in the live /skills marketplace, fetched server-side through getAdapter(ctx).fetchSkillListing, with Solana listings still rendering. Reads only — NO wallet, NO writes (Phases 4/5), and do NOT repoint Solana callers (Phase 2c). Sub-plan of .agents/plans/base-port-chain-adapter.plan.md (Phase 3, base-adapter-readslice). Decision-locked before touching the live 849-line web/app/api/skills/route.ts."
todos:
  - id: lock-db-identifier
    content: "DONE 2026-06-29: store Base bytes32 listing ids in explicit nullable skills.evm_listing_id / evm_contract_address / evm_tx_hash columns; do NOT overload Solana on_chain_address. Live Neon accepted the additive columns via initializeDatabase()."
    status: completed
  - id: seed-base-listing
    content: "DONE 2026-06-29: seeded one Base Sepolia listing on AgentVouchEvm 0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854. listingId=0x658b604e9f71b05d580d1fe24891b2686c46ba4fc1961f3027d908a8ad2bcb11, tx=0x31e858a4916c50f6e50f11d704ed19604c2139152358a0d03b9d6b0f1bfdc548, author=0xF75dc589B5df4bf4F2995Fc0e5E3639ECD721f03."
    status: completed
  - id: add-evm-columns
    content: "DONE 2026-06-29: added nullable evm_* columns and RepoSkillRow fields; upserted the seeded live Neon row at /skills/base-phase-3b/phase-3b-demo-skill with chain_context=eip155:84532, on_chain_address=NULL, price_usdc_micros=1000000, and the seeded EVM metadata."
    status: completed
  - id: fetch-base-listings
    content: "DONE 2026-06-29: implemented hydrateEvmRepoSkillRows() in marketplaceBrowse.ts and wired it into the /skills server snapshot, /api/skills full path, and /api/skills/hydrate. It calls getAdapter(ctx).fetchSkillListing(evm_listing_id), overlays live fields in place, keeps on_chain_address=NULL, and fails soft on Base RPC errors."
    status: completed
  - id: wire-merge
    content: "DONE 2026-06-29: intentionally avoided a separate Base ChainSkillRow merge because mergeSkills dedupes Solana rows by on_chain_address. Base hydration is in-place on the repo row, yielding one marketplace card while leaving Solana fetchOnChainListings untouched."
    status: completed
  - id: verify-render
    content: "DONE 2026-06-29: local dev server on http://localhost:3001 rendered /skills?q=Phase%203b with the Base card, live activity row, Base Sepolia chip, plain-text EVM author, 1 USDC price, and on_chain_address=NULL. A local Playwright screenshot was captured during verification."
    status: completed
  - id: verify-gates
    content: "DONE 2026-06-29: web typecheck, lint, vitest, and `npm run build --workspace @agentvouch/web` are green after the final activity-strip plain-text EVM actor patch + plan status updates."
    status: completed
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
  in-place Base row hydration through `hydrateEvmRepoSkillRows()`; the render proof.
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
`getProgramAccounts`) stays. Base uses DB-driven discovery and in-place row hydration instead of
on-chain enumeration. The Base path is legitimately different (DB = discovery, chain = current state)
— that asymmetry is why the seam exists.

**Divergence — hydrate-in-place (2026-06-29):** do NOT emit a separate Base `ChainSkillRow` + merge.
`ChainSkillRow.on_chain_address` is required-non-null and `getSkillPaymentFlow` keys purchasability off
it, while D4 mandates NULL for Base — so merging a Base chain row on `on_chain_address` can't work
(the plan's "Open question" anticipated this). Instead, in the route, for each loaded PG skill row with
`chain_context` `eip155:%` + `evm_listing_id`, call `getAdapter(ctx).fetchSkillListing(evm_listing_id)`
and overlay the live name/description/price onto that one row, marked non-purchasable (D4). One row =
one card; the adapter is still exercised in the route (the seam proof). `fetchOnChainListings` (Solana)
stays untouched. The `fetch-base-listings`/`wire-merge` todos below fold into this.

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
- `web/lib/marketplaceBrowse.ts` — `hydrateEvmRepoSkillRows()` hydrates `eip155:*` repo rows by
  calling `getAdapter(ctx).fetchSkillListing(evm_listing_id)` and overlaying live fields in place.
- `web/app/api/skills/route.ts`, `web/app/api/skills/hydrate/route.ts`, `web/app/skills/page.tsx` —
  call the shared hydration helper from the full API, client hydrate API, and server snapshot paths.
- (seed) `contracts/base-poc/harness/*` — run, don't necessarily edit; capture the listing id.
- No change to `web/lib/adapters/*` (3a is complete) and no Solana-caller repointing.

## Implementation Steps

1. **Lock D1** (user sign-off) and record it in this file.
2. **Seed** one Base listing (D2); note `evm_listing_id`, `evm_contract_address`, `evm_tx_hash`,
   author EVM address, skill metadata.
3. **Migrate + row** (`add-evm-columns`): add the columns; insert/Update the seeded skill row with
   `chain_context = eip155:84532` and the EVM fields.
4. **Hydrate** (`fetch-base-listings`): done via `hydrateEvmRepoSkillRows()` — for each `eip155:%`
   repo row with `evm_listing_id`, call `getAdapter(ctx).fetchSkillListing(evm_listing_id)` and
   overlay `name`, `description`, `skill_uri`, `price_usdc_micros`, and `current_version` in place.
   **Leave `on_chain_address` NULL**, render the card **non-purchasable**, and keep the author as
   plain-text display (no `/author/[pubkey]` link for EVM).
5. **Merge** (`wire-merge`): resolved by not merging a separate Base chain row. `mergeSkills()` stays
   Solana-only; Base remains one DB row hydrated in place.

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

- **Resolved 2026-06-29:** `web/.env.local` was pulled from Vercel for this worktree; the seeded Base
  listing row was upserted into live Neon; the read-only `/skills` render proof passed locally.

## Open question for the executor

Resolved 2026-06-29: use in-place hydration, not a separate Base chain row. `mergeSkills` remains
Solana-only and keyed by `on_chain_address`; Base rows keep `on_chain_address` NULL and hydrate live
contract fields directly onto their repo row.
