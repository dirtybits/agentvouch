---
name: base-port-chain-adapter-phase-8a
overview: "Flip the default AgentVouch experience to Base Sepolia behind an explicit rollback switch, without enabling Base mainnet or deleting Solana fallback paths."
todos:
  - id: classify-default-chain-surfaces
    content: Audit every current default-chain surface and classify it as new-user default, legacy Solana fallback, Solana-only protocol, or explicit Base Sepolia path before editing.
    status: pending
  - id: add-default-chain-seam
    content: Add a getDefaultChainContext-style seam that defaults to Base Sepolia, supports an env rollback to configured Solana, and refuses Base mainnet until Phase 8b.
    status: pending
  - id: wire-wallet-default
    content: Repoint wallet/default-selection behavior so fresh users are guided to Base Sepolia first while Solana remains selectable and the Strict Mode restore race stays deterministic.
    status: pending
  - id: wire-paid-publish-default
    content: Repoint paid publish/listing creation through ChainWallet.createSkillListing and existing Base/Solana link verification so Base Sepolia is the default paid listing path.
    status: pending
  - id: protect-trust-and-legacy-fallbacks
    content: Keep Solana trust snapshots, legacy null chain_context rows, Solana-only protocol modules, and trust sorting honest; do not synthesize Base trust.
    status: pending
  - id: verify-phase8a
    content: Run source/behavior tests plus format, lint, typecheck, vitest, webpack build, and browser smokes proving Base Sepolia default + Solana rollback.
    status: pending
isProject: false
---

# Phase 8a - Base Sepolia Default

## Goal

Make Base Sepolia (`eip155:84532`) the default **new-user writable path** for AgentVouch while
keeping Solana selectable and preserving all legacy Solana fallbacks. This is Phase 8a only:
flagged, reversible, Sepolia-only. Base mainnet (`eip155:8453`) stays blocked behind the separate
Phase 8b gate plan (`.agents/plans/base-port-chain-adapter-phase-8b.plan.md`) until its
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
  - Rollback value: configured Solana context via `AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana` and
    `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana`.
  - The server and client env values must be set or unset **together**. If they disagree, SSR
    renders one default and the client hydrates the other — the same #418-class hydration
    mismatch PR #65 fixed for dates. Add a test/assertion that both resolve identically, or have
    the seam read a single source per runtime with an agreement check.
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

2. Add the default-chain seam.

   - Add `getDefaultChainContext()` in `web/lib/chains.ts`.
   - Default to `BASE_SEPOLIA_CHAIN_CONTEXT`.
   - Support env rollback through both server and client-visible env names:
     `AGENTVOUCH_DEFAULT_CHAIN_CONTEXT` and `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT`.
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
  - rollback: set both `AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana` and
    `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana`, then redeploy.
- Do not set `eip155:8453` in any env for Phase 8a.

## Rollback

- Set `AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana` and
  `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana`, **then redeploy** — `NEXT_PUBLIC_*`
  values are inlined at build time, so setting the env alone is not a runtime switch.
- If paid publish regresses, revert only the publish-page repoint while keeping the default-chain seam
  and tests if they are sound.
- If dual wallet restore regresses, temporarily restore Solana priority under rollback env and leave a
  dated note in this plan.

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
