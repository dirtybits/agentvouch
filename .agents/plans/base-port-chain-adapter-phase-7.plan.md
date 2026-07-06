---
name: base-port-chain-adapter-phase-7
overview: "Replace cross-chain UI/API assumptions that treat every wallet, listing, tx, and explorer URL as Solana-shaped with chain-tagged address helpers, while leaving explicitly Solana-only protocol code behind its adapter/wallet seams."
todos:
  - id: classify-address-surface
    content: "DONE 2026-07-01: verified the plan's inventory live with rg. Cross-chain boundaries: skills/hydrate/dashboard-purchases routes (Solana isAddress on buyers), 6/4 shorteners in SkillPreviewCard/SkillDetailClient/author page. Bespoke non-address truncation kept local: 4/4 wallet pill, 12/6 identity panel, 8/8 tx sig. Everything else classified explicit Solana protocol."
    status: completed
  - id: add-chain-address-helpers
    content: "DONE 2026-07-01: web/lib/chainAddress.ts — isValidChainAddress, normalizeChainAddressForStorage (EVM lowercase / Solana case-preserved, Phase 6 invariant), formatChainAddressForDisplay (checksum), shortenChainAddress (adapter-delegated 6/4 with safe generic fallback), chainExplorerAddressUrl/TxUrl (null-degrading adapter resolution — Base mainnet degrades instead of throwing), isEvmShapedAddress (named Phase 6 heuristic with caveat). 18 behavioral tests using real deployed addresses."
    status: completed
  - id: repoint-ui-formatting
    content: "DONE 2026-07-01: SkillPreviewCard author display uses shortenChainAddress with the row's chain_context; SkillDetailClient and author-page local shortAddr delegate to the shared helper (generic path — 6/4 output unchanged). ClientWalletButton 4/4, AgentIdentityPanel 12/6, tx-signature 8/8, and authorDisplay compact 4/4 intentionally stay bespoke. No EVM actor navigation added (deferred per plan)."
    status: completed
  - id: repoint-api-boundaries
    content: "DONE 2026-07-01: /api/skills browse and /api/skills/hydrate accept buyerChainContext and resolve EVM buyers via normalizeChainAddressForStorage + hasChainUsdcPurchaseEntitlement (mirroring the [id] route pattern); Solana buyers keep the untouched preflight path. /api/dashboard/purchases returns empty purchases/listings for EVM-shaped buyers instead of a 400 (the view enumerates Solana PDAs, which EVM buyers cannot have). Raw access / purchase verification untouched."
    status: completed
  - id: preserve-solana-modules
    content: "DONE 2026-07-01: phase2-circleback family guard extended with @/lib/onchain and @/lib/agentvouchUsdc markers (Base files verified clean); phase7-chain-boundaries.test.ts locks the API boundary wiring and asserts formatChainAddressForDisplay is never used at storage boundaries (usdcPurchases, db, the three routes)."
    status: completed
  - id: verify-phase7
    content: "DONE 2026-07-01/02: format:check, web lint, typecheck, vitest 86 files / 512 tests, and next build --webpack passed. Browser smoke-render completed before merge: one Solana listing rendered with Solana Explorer PDA link; one Base listing rendered with Base Sepolia Basescan tx link plus display-only EVM author. Env note: use Node 24 (.nvmrc) — Node 20.17 fails vitest with ERR_REQUIRE_ESM through the worktree symlinked node_modules."
    status: completed
isProject: false
---

# Phase 7 - Chain Address And Explorer Sweep

## Goal

Make address validation, shortening, and explorer-link rendering chain-aware before the Base default
flip. Phase 7 should remove Solana-shaped assumptions from mixed-chain UI/API boundaries while
preserving explicit Solana protocol modules. This is mostly mechanical, but it is easy to overreach:
do not try to eliminate every `@solana/kit` import in modules that still derive PDAs, build Solana
instructions, read Solana accounts, or settle Solana x402.

## Context

- Umbrella plan: `.agents/plans/base-port-chain-adapter.plan.md`.
- Branch: `feat/base-port-phase-7`, cut from `origin/main` after Phase 2 circle-back merged
  (2026-07-01).
- Completed prerequisites:
  - Phase 2 circle-back completed the Solana write facade and Solana/SVM x402 seam isolation.
  - Phase 5 merged Base passkey `ChainWallet` writes, Base listing/purchase verification, and Base
    x402 settlement.
  - Phase 6 hardened chain-qualified DB semantics and raw-access separation.
- Canonical chain labels are CAIP-2 strings from `web/lib/chains.ts`: Solana devnet is
  `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`; Base Sepolia is `eip155:84532`.

## Scope

In scope:

- Mixed-chain UI formatting for author/wallet/listing/transaction identifiers.
- Mixed-chain API route validation where the request includes `chain_context`, `buyerChainContext`,
  `buyer`, `author`, `on_chain_address`, or EVM listing ids.
- Explorer URL generation for both Solana and Base through existing `ChainAdapter` helpers or a thin
  helper that delegates to them.
- Behavioral unit tests for the pure chain-address helper, plus source-level import guards preventing
  future Solana-only validation from leaking back into Base surfaces.

Out of scope:

- Removing `@solana/kit` from explicitly Solana-only protocol modules:
  - `web/lib/onchain.ts`
  - `web/lib/agentvouchUsdc.ts`
  - `web/lib/solanaWrites.ts`
  - `web/lib/sponsoredPurchase.ts`
  - `web/lib/sponsoredRegisterAgent.ts`
  - `web/lib/browserX402.ts`
  - `web/lib/x402ProtocolBridge.ts`
  - `web/hooks/useReputationOracle.ts`
  - `web/hooks/useMarketplaceOracle.ts`
- Base default flip (Phase 8).
- Base mainnet support (`eip155:8453` still requires mainnet RPC/contract/USDC/paymaster config).
- UI redesign, route renames, or destructive DB schema changes.

## Current Address Surface

Verified 2026-07-01 with `rg`:

Primary cross-chain candidates:

- `web/app/api/skills/route.ts`: imports Solana `address/isAddress`; validates `buyer` for browse and
  hydration. Must accept EVM buyers when `buyerChainContext=eip155:84532`.
- `web/app/api/skills/[id]/route.ts`: already has both Solana and viem validation; review for
  remaining Solana-first checks around author and buyer status.
- `web/app/api/skills/hydrate/route.ts`: imports Solana `address/isAddress`; buyer/listing hydration
  must be chain-aware.
- `web/app/api/dashboard/purchases/route.ts`: imports Solana `address/isAddress`; dashboard purchase
  filters must not reject EVM buyers.
- `web/components/ClientWalletButton.tsx`: mixes `shortenEvmAddress` and an inline 4/4 Solana
  truncation.
- `web/components/SkillPreviewCard.tsx`: has local `shortChainAddress` for author display.
- `web/components/AgentIdentityPanel.tsx`: uses bespoke 12/6 truncation for identity details.
- `web/app/skills/[id]/SkillDetailClient.tsx`: local `shortAddress`, tx truncation, Solana casts,
  and mixed Base/Solana author comparisons.
- `web/app/author/[pubkey]/page.tsx`: local `shortAddress`.
- `web/app/skills/MarketplaceClient.tsx`: uses `shortWalletAddress` for transaction and wallet
  display.
- `web/lib/authorDisplay.ts`: `shortWalletAddress` assumes generic 4/4 slicing.
- `web/lib/chains.ts`: Solana explorer helpers exist; consider adding chain-generic wrappers here or
  a sibling helper instead of creating a `web/lib/chains/` directory.
- `web/lib/adapters/{base,solana}.ts`: already expose `shortenAddress`, `explorerTxUrl`, and
  `explorerAddressUrl`.

Explicitly Solana-only candidates to preserve:

- `web/lib/onchain.ts`, `web/lib/agentvouchUsdc.ts`, `web/lib/solanaWrites.ts`,
  `web/lib/purchasePreflight.ts`, `web/lib/skillRawAccess.ts` Solana purchase/read sections,
  `web/hooks/useReputationOracle.ts`, `web/hooks/useMarketplaceOracle.ts`, and Solana x402/sponsor
  modules. Keep their Solana `Address` types local to those modules unless a mixed-chain caller is
  currently importing them.

## Proposed Design

Add one small server-safe helper module, preferably `web/lib/chainAddress.ts`:

```ts
export type ChainAddressRef = {
  chainContext: string | null | undefined;
  value: string | null | undefined;
};

export function isValidChainAddress(ref: ChainAddressRef): boolean;
export function normalizeChainAddressForStorage(
  ref: ChainAddressRef
): string | null;
export function formatChainAddressForDisplay(
  ref: ChainAddressRef
): string | null;
export function shortenChainAddress(
  ref: ChainAddressRef,
  opts?: { fallback?: string }
): string;
export function chainExplorerAddressUrl(ref: ChainAddressRef): string | null;
export function chainExplorerTxUrl(input: {
  chainContext: string | null | undefined;
  tx: string | null | undefined;
}): string | null;
export function isEvmShapedAddress(value: string | null | undefined): boolean;
```

Implementation guidance:

- Use `normalizeInputChainContext` / `normalizePersistedChainContext` from `web/lib/chains.ts`.
- Delegate validation/shortening/explorer links to `getAdapter(normalizedContext)` when possible.
- Preserve the Phase 6 normalization invariant: storage and lookup boundaries use
  `normalizeChainAddressForStorage` (`eip155:*` addresses lowercased, Solana case-preserved);
  display boundaries use `formatChainAddressForDisplay` and may checksum EVM addresses.
- Return `null` rather than throwing for unknown/missing chain contexts on display helpers; throwing is
  fine only in explicit validation helpers used by API write paths.
- Do not export a generic `normalizeChainAddress` name from the new module; `web/lib/usdcPurchases.ts`
  already has a private Phase 6 helper with storage semantics. During implementation, either have
  `usdcPurchases.ts` delegate to `normalizeChainAddressForStorage` or keep the private helper only
  until the shared helper is proven equivalent by tests.
- For EVM display formatting, use `viem` only inside functions that need checksum normalization, or
  keep it in Base-specific modules if adding a top-level `viem` import would affect client/server
  bundles. If imported, ensure `web/lib/chainAddress.ts` remains safe for both server and client call
  sites.
- Make `isEvmShapedAddress` the named home for the temporary Phase 6 `0x`-shape heuristic. Add a
  short comment explaining that this is sound only while supported non-Solana chains are EVM chains
  with `0x` addresses; a future non-EVM chain or an EVM-like namespace would require chain-context
  discrimination instead. Prefer this helper over scattered `startsWith("0x")` checks in TypeScript
  call sites. SQL filters such as trust snapshot cron queries may remain literal but should reference
  the same caveat in nearby comments if touched.
- Do not create `web/lib/chains/index.ts` or any `web/lib/chains/` directory; the repo already has
  `web/lib/chains.ts`, and the umbrella plan explicitly warns against sibling import ambiguity.

## Implementation Steps

1. Classify before editing.

   - Produce a local checklist from:
     - `rg -l "@solana/kit" web/app web/components web/hooks web/lib -g '!web/generated/**'`
     - `rg -n "explorer\\.solana|basescan|shorten.*Address|slice\\(0, [0-9]+\\).*slice\\(-" web/app web/components web/hooks web/lib`
   - Mark each file as one of:
     - `cross-chain display/API boundary`
     - `explicit Solana protocol`
     - `non-address truncation` (hashes, CIDs, commit SHAs; leave alone)

2. Add the chain-address helper.

   - Add `web/lib/chainAddress.ts` or an equivalent single file.
   - Add real behavioral tests under `web/__tests__/lib/chainAddress.test.ts`. Do not satisfy this
     helper coverage with source-text assertions; the helper is pure and should be tested by passing
     real Solana/Base/invalid values in and asserting normalized values, display values, short forms,
     explorer URLs, and `null` fallbacks out.
   - Test Solana devnet, Base Sepolia, legacy aliases, invalid addresses, missing chain contexts,
     explorer URL construction, and the fallback behavior for display helpers.
   - Prove `normalizeChainAddressForStorage` lowercases EVM addresses, leaves Solana addresses
     case-preserved, and matches the Phase 6 `usdcPurchases` storage/lookup invariant.
   - Prove `formatChainAddressForDisplay` is not used at API/DB storage boundaries.

3. Repoint chain-agnostic display surfaces.

   - Prefer `shortenChainAddress({ chainContext, value })` where the row/skill already carries
     `chain_context`.
   - Keep Phase 7 EVM actor navigation display-only: do not introduce internal `/author/0x...`
     links in `ActorLink` yet. EVM actor rows may remain unlinked, while explicit explorer affordances
     can point to Basescan through `chainExplorerAddressUrl`. Defer internal Base author-page
     navigation policy to the Base-default UX pass.
   - Keep bespoke formatting only when it is intentionally not an address abstraction:
     transaction sigs on settlement links, CID/hash truncation, commit SHAs, file tree hashes.
   - Candidate UI files:
     - `web/components/SkillPreviewCard.tsx`
     - `web/components/ClientWalletButton.tsx`
     - `web/components/AgentIdentityPanel.tsx`
     - `web/app/skills/[id]/SkillDetailClient.tsx`
     - `web/app/author/[pubkey]/page.tsx`
     - `web/app/skills/MarketplaceClient.tsx`
     - `web/lib/authorDisplay.ts`

4. Repoint mixed-chain API validation.

   - `web/app/api/skills/route.ts`: when `buyerChainContext` is EVM, validate the buyer as EVM, not
     Solana; keep Solana `address(...)` conversion only for Solana purchase/status paths.
   - `web/app/api/skills/[id]/route.ts`: verify no Solana `isAddress` branch prevents EVM buyer or
     EVM author status checks.
   - `web/app/api/skills/hydrate/route.ts`: make buyer validation and hydration chain-aware.
   - `web/app/api/dashboard/purchases/route.ts`: make wallet filters chain-aware; if dashboard still
     has Solana-only live PDA enrichment, gate that enrichment on Solana chain context.
   - At every API/DB write or lookup boundary, use `normalizeChainAddressForStorage`, not
     `formatChainAddressForDisplay`.
   - Avoid changing raw access or purchase verification semantics unless a failing test proves the
     boundary still rejects EVM inputs.

5. Guard Solana-only modules.

   - Add or update source tests to assert Base-facing files do not import:
     - `@solana/kit`
     - `web/lib/onchain`
     - `web/lib/agentvouchUsdc`
     - `web/lib/solanaWrites`
     - `web/lib/browserX402`
     - `web/lib/x402ProtocolBridge`
   - Keep comments in Solana-only modules clear: these imports are intentional protocol code, not
     Phase 7 misses.

6. Update plan status as work proceeds.
   - Per the `plan-writing` skill, move each todo to `in_progress` when starting and `completed` only
     after verification for that slice passes.

## Verification

Required local commands before PR:

```bash
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm test --workspace @agentvouch/web
npm exec --workspace @agentvouch/web next -- build --webpack
```

Focused checks to add or run:

- Behavioral unit tests proving:
  - Base Sepolia EVM address validates under `eip155:84532`.
  - EVM storage normalization lowercases addresses and display formatting may checksum them.
  - Solana storage/display normalization preserves the address string.
  - `isEvmShapedAddress` covers the accepted `0x` syntax heuristic and rejects obvious Solana-shaped
    / garbage values.
  - The same EVM address does not get rejected by Solana `isAddress` at `/api/skills` buyer
    boundaries.
  - Solana devnet address still validates and receives Solana Explorer URLs with the configured
    cluster.
  - Base Explorer URLs use `https://sepolia.basescan.org`.
- Source/import-guard tests proving:
  - Base-facing adapter/API/x402 files do not import Solana-only modules.
- If a dev server/browser is available, render:
  - one Solana listing detail page and confirm author/listing/tx links still point to Solana Explorer.
  - one Base listing detail page and confirm author/listing/tx links point to Base Sepolia/Basescan
    or intentionally have no link when the field is an EVM listing id rather than an address.

## Rollout

- This should be one PR from `feat/base-port-phase-7`.
- It is safe to merge before Phase 8 because it should not change default chain selection.
- Do not require live Base purchase smoke for Phase 7; that belongs to Phase 5/9. Phase 7 should only
  prove that display/API address handling no longer blocks Base-shaped values.

## Rollback

- If a UI display repoint regresses formatting, revert that call site to its previous local
  shortener while keeping the helper and tests.
- If an API validation repoint changes purchase/raw-access behavior, revert only that route and add a
  follow-up test describing the missing chain-context semantics.
- If bundle/type issues appear from the helper, split EVM checksum normalization behind a dynamic
  import or move chain-specific normalization into the adapters.

## Blockers And Open Questions

- The sweep should not proceed by blindly removing all Solana imports. Many remaining imports are
  correct because Solana remains selectable and owns PDA/ATA/protocol instructions.
- Decide during implementation whether `shortenChainAddress` should support optional length styles
  (`4/4`, `6/4`, `12/6`) or whether call sites with intentional bespoke lengths should remain local.
  Default should be the adapter format (`6/4`) unless changing a compact control would visibly
  regress layout.
- EVM actor navigation is intentionally deferred. Phase 7 should not invent internal `/author/0x...`
  links; keep EVM actors unlinked in generic actor rows or link only to Basescan in explicit explorer
  contexts, then revisit internal author routing during the Base-default UX pass.
- Base mainnet is still out of scope. Do not add `eip155:8453` acceptance to `BaseAdapter` until the
  Phase 10 mainnet config exists.
