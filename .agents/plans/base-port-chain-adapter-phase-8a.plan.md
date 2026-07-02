---
name: base-port-chain-adapter-phase-8a
overview: "Flip the default AgentVouch experience to Base Sepolia behind an explicit rollback switch, without enabling Base mainnet or deleting Solana fallback paths."
todos:
  - id: classify-default-chain-surfaces
    content: Audit every current default-chain surface and classify it as new-user default, legacy Solana fallback, Solana-only protocol, or explicit Base Sepolia path before editing.
    status: completed
  - id: add-default-chain-seam
    content: Add a getDefaultChainContext-style seam that defaults to Base Sepolia, supports an env rollback to configured Solana, and refuses Base mainnet until Phase 10.
    status: completed
  - id: wire-wallet-default
    content: Repoint wallet/default-selection behavior so fresh users are guided to Base Sepolia first while Solana remains selectable and the Strict Mode restore race stays deterministic.
    status: completed
  - id: wire-paid-publish-default
    content: Repoint paid publish/listing creation through ChainWallet.createSkillListing and existing Base/Solana link verification so Base Sepolia is the default paid listing path.
    status: completed
  - id: protect-trust-and-legacy-fallbacks
    content: Keep Solana trust snapshots, legacy null chain_context rows, Solana-only protocol modules, and trust sorting honest; do not synthesize Base trust.
    status: completed
  - id: verify-phase8a
    content: "DONE 2026-07-02 (updated after PR #74 P1/P2 fixes): format:check, web lint, typecheck, vitest 89 files / 541 tests (15 chains incl. one-sided-env P2 cases, 5 evmAuth, 12 phase-8a source incl. Base null-mint P1, 3 baseListing-currency), next build --webpack all pass. Browser smokes: default-on shows Base Sepolia first in connect menu, Base listing renders Basescan Sepolia tx link + Connect-Base-wallet copy + Review (not Trusted) verdict, Solana listing renders devnet Explorer PDA link; rollback env shows Solana first with Base still selectable. Live Base passkey connect not smoked — Base wallet env unconfigured locally (see Blockers)."
    status: completed
isProject: false
---

# Phase 8a - Base Sepolia Default

## Goal

Make Base Sepolia (`eip155:84532`) the default **new-user writable path** for AgentVouch while
keeping Solana selectable and preserving all legacy Solana fallbacks. This is Phase 8a only:
flagged, reversible, Sepolia-only. Base mainnet (`eip155:8453`) stays blocked behind the separate
Phase 10 gate plan (`.agents/plans/base-port-chain-adapter-phase-10.plan.md`) until its
contract/RPC/USDC/paymaster/security prerequisites exist.

## Context

- Umbrella plan: `.agents/plans/base-port-chain-adapter.plan.md`.
- Branch to implement from: `feat/base-port-phase-8`.
- Phase 7 merged 2026-07-02 via PR #73. It made chain-aware address validation, explorer links, and
  EVM buyer API boundaries safe enough for the default flip.
- Claude review 2026-07-02 called out the two hard caveats this plan must preserve:
  - Base currently has the cleaner buyer/payment rails, but Solana still owns the strongest trust
    surface. Base rows must not be presented as stake-backed unless Base trust exists.
  - Base mainnet readiness is not the same as Base Sepolia defaulting. The current contract is still
    the `base-poc-v0` spike.

## Decision

Phase 8a changes the default chain for **fresh user intent**:

- Default wallet/network affordance: Base Sepolia first.
- Default paid publish/list path: Base Sepolia through the `ChainWallet` seam.
- Default buyer status/request chain context when the UI has a Base wallet or no prior Solana choice:
  Base Sepolia.

Phase 8a does **not** mean:

- Hide Solana listings from `/skills`.
- Rewrite old DB rows with missing `chain_context` to Base.
- Route Solana trust snapshots through Base.
- Enable `eip155:8453`.
- Claim Base rows are "Trusted" without Base trust data.

## Scope

In scope:

- A single default-chain helper in `web/lib/chains.ts`, for example:

```ts
export function getDefaultChainContext(): string;
export function isBaseSepoliaDefaultEnabled(): boolean;
```

- Env-controlled rollback:
  - Default with no env: `BASE_SEPOLIA_CHAIN_CONTEXT` (`eip155:84532`).
  - Rollback value: configured Solana context via `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana`.
  - **Single render source (PR #74 P2, fixed 2026-07-02):** the seam reads ONLY
    `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT` — the one var inlined identically at SSR and
    hydration — so a one-sided env can never split SSR vs client (#418 class, cf. PR #65). A
    server-only `AGENTVOUCH_DEFAULT_CHAIN_CONTEXT` is intentionally ignored for anything that
    renders; do not reintroduce a `serverValue || clientValue` fallback here.
  - Accept exact CAIP-2 values and existing aliases (`base-sepolia`, `solana:devnet`).
  - Reject or ignore `eip155:8453` in Phase 8a with an explicit test.
- Wallet/provider defaults in `web/components/WalletContextProvider.tsx` and
  `web/components/ClientWalletButton.tsx`.
- Paid publish/listing creation in `web/app/skills/publish/page.tsx`.
- Source and behavioral tests under `web/__tests__/`.
- Optional small copy fixes discovered during Phase 7 smoke, including the missing space in
  `Base Sepoliaaddress` if that copy is touched.

Out of scope:

- Base mainnet.
- New contract deployment.
- Base trust/vouch/dispute UX. That is Phase 9.
- Solana sponsored checkout prompt polish.
- Removing Solana imports from Solana-only modules.
- Destructive DB migration.

## Files To Inspect / Likely Change

- `web/lib/chains.ts`
  - Add the default-chain seam.
  - Keep `getConfiguredSolanaChainContext()` unchanged; it remains the Solana environment helper.
  - Keep `normalizePersistedChainContext(null)` as a legacy Solana fallback unless a caller
    explicitly wants the new default.
- `web/components/WalletContextProvider.tsx`
  - Make active wallet precedence follow the default chain.
  - Today Solana disconnects Base on dual restore. With Base default, Base should win when both restore
    unless rollback env selects Solana. Preserve the cancelled-flag Strict Mode restore guard.
- `web/components/ClientWalletButton.tsx`
  - Keep Base Sepolia first in the connect menu for default-on.
  - With rollback env, make Solana/Phantom the primary/default path without deleting Base.
- `web/hooks/useWritableChainWallet.ts`
  - Confirm write selection follows the same default precedence as the provider.
- `web/app/skills/publish/page.tsx`
  - Paid publish currently still calls the Solana `oracle.createSkillListing` + PDA patch path.
  - Repoint paid listing creation to `useWritableChainWallet().createSkillListing(...)`.
  - After Base `TxResult`, PATCH `/api/skills/{id}` with the existing `baseListing` payload:

```ts
{
  baseListing: {
    txHash: result.ref,
    authorAddress: chainWallet.address,
    chainContext: chainWallet.chainContext,
    expectedPriceUsdcMicros: usdcPriceMicros
  }
}
```

- Keep the existing Solana patch path for Solana wallets/rollback.
- `web/app/api/skills/route.ts`
  - For unauthenticated free GitHub publishes, be careful: not every free skill should become a Base
    wallet skill. Use explicit publisher context, not the global default, when no wallet exists.
  - For paid publishes, ensure Base-authored rows are created with `chain_context=eip155:84532` and
    EVM `author_pubkey`.
- `web/app/skills/[id]/SkillDetailClient.tsx`
  - Confirm buyer context defaults to the active/default chain without overriding the skill's actual
    chain.
- `web/lib/site.ts`, `web/lib/protocolMetadata.ts`, `web/lib/metadataData.ts`
  - Audit default-chain copy/metadata. Do not change protocol metadata to Base mainnet. If these
    constants remain Solana protocol metadata, name that explicitly rather than treating them as the
    product default.
- `web/lib/marketplaceBrowse.ts`, `web/lib/skillDetailSnapshot.ts`, `web/lib/trustSnapshots.ts`
  - Do not make trust joins default to Base. Existing null/legacy rows and cached trust snapshots are
    Solana-context data.

## Implementation Steps

1. Classify default-chain surfaces.

   Run:

   ```bash
   rg -n "getConfiguredSolanaChainContext|getAgentVouchChainContext|SITE_CHAIN_CONTEXT|BASE_SEPOLIA_CHAIN_CONTEXT|chain_context|useWritableChainWallet|createSkillListing" web/app web/components web/hooks web/lib -g '!web/generated/**'
   ```

   Classify each hit:

   - `new-user default`: should move to `getDefaultChainContext()`.
   - `legacy Solana fallback`: should stay Solana, and comments/tests should say why.
   - `explicit Solana protocol`: stays Solana.
   - `explicit Base Sepolia`: stays Base Sepolia.

   **Classification result (2026-07-02):**

   - `new-user default` (the only surfaces that move): `WalletContextProvider.tsx` dual-restore
     precedence, `ClientWalletButton.tsx` connect-menu ordering, `web/app/skills/publish/page.tsx`
     paid listing path. `useWritableChainWallet` already prefers the Base ChainWallet when
     connected; provider-level precedence governs it.
   - `legacy Solana fallback` (unchanged): `normalizePersistedChainContext(null)`, the
     `configuredSolanaChainContext` legacy-row/trust joins in `db.ts`, `marketplaceBrowse.ts`,
     `skillDetailSnapshot.ts`, `trustSnapshots.ts`, `metadataData.ts`, and the
     `?? getAgentVouchChainContext()` fallbacks in `skillRawAccess.ts`/`directPurchaseVerification.ts`.
   - `explicit Solana protocol` (unchanged): `site.ts` `SITE_CHAIN_CONTEXT`,
     `protocolMetadata.ts` `getAgentVouchChainContext()` (Solana protocol metadata by definition),
     sponsored purchase/register, Solana x402, `solanaAgentRegistry`, `agentIdentity`,
     `agentDiscovery`, `platformMetrics`, `reputation8004`, `mirror/sync`, seed route.
   - `explicit Base Sepolia` (unchanged): x402 settle/verify/supported routes, `base*` libs,
     `adapters/baseWallet*`, EVM author inference in `/api/author/[pubkey]`, and the existing
     Base listing-link path in `SkillDetailClient.tsx` (lines ~596-641) — which is the pattern the
     publish page repoint mirrors.

2. Add the default-chain seam.

   - Add `getDefaultChainContext()` in `web/lib/chains.ts`.
   - Default to `BASE_SEPOLIA_CHAIN_CONTEXT`.
   - Support env rollback through the client-visible name ONLY:
     `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT` (PR #74 P2 — render-affecting, so the private
     `AGENTVOUCH_DEFAULT_CHAIN_CONTEXT` is ignored here to keep SSR and hydration identical).
   - Normalize aliases with existing `normalizeChainContext`, passing
     `{ defaultLegacySolanaChainContext: getConfiguredSolanaChainContext() }`. A bare
     `normalizeChainContext("solana")` returns `null` (the alias only resolves through that
     option), so the canonical rollback value `solana` would silently fall through to the Base
     default — a no-op rollback.
   - If configured value normalizes to `BASE_CHAIN_CONTEXT` (`eip155:8453`), return Solana or throw in
     tests? Prefer fail-closed with a visible console/server warning and Solana fallback; do not
     silently default to mainnet.
   - Add tests proving default, rollback, alias, invalid, and mainnet-blocked behavior.

3. Wire wallet defaults.

   - Replace hard-coded Solana priority in `WalletContextProvider.tsx` with default-chain-aware
     priority.
   - If default is Base and both Base/Solana sessions restore, disconnect or de-prioritize Solana,
     not Base. If default is Solana, preserve the Phase 4 behavior.
   - Keep only one active wallet in `useChainWallet()`.
   - Make `ClientWalletButton` menu/labels line up with the default. Base should remain first when
     `getDefaultChainContext() === BASE_SEPOLIA_CHAIN_CONTEXT`; rollback should not hide Base.
   - Add source/behavioral tests around default precedence where possible.

4. Wire paid publish/listing defaults.

   - In `web/app/skills/publish/page.tsx`, move paid listing creation behind the
     `ChainWallet` interface.
   - For Base:
     - call `chainWallet.createSkillListing({ skillId, uri, name, description, priceUsdcMicros })`.
     - PATCH with `baseListing` and rely on `verifyBaseSkillListing` to re-read live chain state.
   - For Solana:
     - keep the existing Solana `oracle.createSkillListing` + `getSkillListingPDA` + signed patch.
   - Do not require a Solana AgentProfile gate for a Base paid listing. Base `registerAgent` lives on
     the Base `ChainWallet`; if the Base contract requires registration, surface a Base registration
     step/copy instead of the Solana profile modal.
   - Keep free GitHub publishing wallet-optional and do not stamp it as Base-authored unless a Base
     wallet actually signs.

5. Protect trust and sorting semantics.

   - Base rows without trust must show `Review`/unknown trust, not `Trusted`.
   - If the default sort currently over-promotes rows with null trust after the Base flip, adjust only
     the ranking/copy needed to keep it honest. Do not synthesize trust.
   - Keep `/author/0x...` internal navigation deferred unless the Phase 8 implementation explicitly
     adds and tests chain-aware author routing.

6. Verify and update statuses as work proceeds.

   - Follow the plan-writing skill: move each todo to `in_progress` when starting and `completed`
     after verification for that slice.

## Verification

Required local commands before PR:

```bash
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm test --workspace @agentvouch/web
npm exec --workspace @agentvouch/web next -- build --webpack
```

Focused tests to add:

- `web/lib/chains.ts` default-chain tests:
  - no env => `eip155:84532`.
  - `solana` / `solana:devnet` env => configured Solana context.
  - `base-sepolia` env => `eip155:84532`.
  - `eip155:8453` env does not enable mainnet.
  - `normalizePersistedChainContext(null)` still resolves legacy rows to configured Solana, not Base.
- Wallet/default source tests:
  - Base default keeps Base as active chain when both sessions exist.
  - Solana rollback keeps Solana as active chain when both sessions exist.
- Publish source tests:
  - paid Base publish path calls `ChainWallet.createSkillListing`.
  - paid Base link patch sends `baseListing`, not Solana `on_chain_address`.
  - Solana rollback path still uses the Solana link patch.

Browser smokes:

- With empty localStorage and no rollback env:
  - Header/connect affordance guides to Base Sepolia first.
  - A Base listing page shows `Connect Base wallet to pay with USDC`.
  - A Solana listing remains renderable and points to Solana Explorer.
- With rollback env set to Solana:
  - Fresh session presents Solana as default.
  - Base remains selectable.
- Optional if wallet is available:
  - Base passkey connect/restore/disconnect.
  - Paid publish dry-run through Base Sepolia until wallet confirmation or successful listing link.

## Rollout

- One PR from `feat/base-port-phase-8`.
- Deploy preview with Base Sepolia default enabled.
- Production rollout should set or omit the default env intentionally:
  - default/no env: Base Sepolia.
  - rollback: set `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana`, then redeploy.
- Do not set `eip155:8453` in any env for Phase 8a.

## Rollback

- Set `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana`, **then redeploy** — `NEXT_PUBLIC_*`
  values are inlined at build time, so setting the env alone is not a runtime switch. (Single var
  as of the PR #74 P2 fix; the private `AGENTVOUCH_DEFAULT_CHAIN_CONTEXT` no longer affects render.)
- If paid publish regresses, revert only the publish-page repoint while keeping the default-chain seam
  and tests if they are sound.
- If dual wallet restore regresses, temporarily restore Solana priority under rollback env and leave a
  dated note in this plan.

## Implementation Notes (2026-07-02)

Divergences and additions relative to the original plan body:

- **EVM publisher auth was required, not just a UI repoint.** `POST /api/skills` only accepted
  Ed25519 (Solana) signature auth, and `PATCH baseListing` requires the row to already carry the
  EVM `author_pubkey` + Base Sepolia `chain_context`. Added `web/lib/evmAuth.ts`
  (`verifyEvmWalletSignature` via viem `publicClient.verifyMessage`, which covers EOA ecrecover
  plus ERC-1271/6492 smart-account signatures), an optional `ChainWallet.signMessage` seam
  (implemented by the Base passkey wallet), and an EVM publisher branch in
  `resolvePublisherAuth` that stamps `walletChainContext = eip155:84532`. GitHub/free publishes
  keep the configured Solana context.
- **Base registration is ensured inline, not via a modal.** The paid Base path polls
  `/api/author/{address}?chainContext=eip155:84532` and, when unregistered, calls
  `chainWallet.registerAgent(buildBaseAgentMetadataUri(address))` with a non-empty metadata URI
  pointing at that chain-qualified author JSON route. If that write reverts with
  `AlreadyRegistered()` because the cached trust read lagged the chain, the ensure step treats it as
  idempotent success and keeps polling. The server paid gate mirrors Solana parity: unregistered
  Base authors get a 403 with register-first copy. Note the server trust read caches ~30s, so the
  client polls up to 60s after registering.
- **Base listing linkage is now retried and repairable.** The paid publish path retries the
  `baseListing` PATCH after short chain/RPC indexing lag, so a just-mined `createSkillListing`
  transaction does not strand a repo-only paid row. If a paid Base row is already stranded, the
  detail-page author action tries `baseListing.relinkExisting=true` before any wallet write; the
  server derives the listing ID from `(author, skill_id)`, verifies the live Base listing against the
  repo row, and links the DB row without submitting another transaction. If the relink read confirms
  no live listing exists yet, the UI falls back to `createSkillListing`; a later `ListingExists()`
  revert is also treated as a relink signal.
- **Connect menu: ordering only, no "Recommended" label** (open question resolved toward minimal
  UI change). Dual-restore precedence and `useChainWallet()` selection follow
  `isBaseSepoliaDefaultEnabled()`; deliberate cross-connects cannot collide because the connect
  menu only renders when neither chain is connected.
- **`Base Sepoliaaddress` copy**: the literal string does not exist in source (likely a rendered
  concatenation observed in the Phase 7 smoke); left untouched.
- `.claude/launch.json` gained a "Next.js Web App (Solana rollback)" config that starts the dev
  server with both rollback envs set, used for the rollback browser smoke.

## Blockers And Open Questions

- Base Sepolia paymaster/bundler env must be present for live write smokes. If not available locally,
  implementation can still merge after source/unit checks plus preview smoke, but Phase 9 must own the
  full funded passkey run.
- Decide during implementation whether the connect menu should visually label Base as "Recommended"
  or simply order it first. Avoid broad UI redesign.
- "Trusted" sort policy must be explicit. Recommended default: do not boost Base rows with null trust;
  keep their trust verdict as Review until Phase 9 adds Base trust.
- Base mainnet remains blocked. Any code that enables `eip155:8453` in Phase 8a is a stop-the-line
  bug.
