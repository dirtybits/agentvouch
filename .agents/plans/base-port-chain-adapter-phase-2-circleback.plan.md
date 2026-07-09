---
name: base-port-chain-adapter-phase-2-circleback
overview: "Finish the deferred Phase 2 Solana adapter/wallet seam after Phase 6: add a behavior-preserving Solana ChainWallet, repoint the safest Solana callers through adapter/wallet seams, and keep x402/Solana-specific code explicitly isolated before Phase 7/8."
todos:
  - id: scope-current-surface
    content: "DONE 2026-07-01: audited current Phase 2 state after Phase 6 merge. useChainWallet/Base ChainWallet exist, but Solana still returns chainWallet=null; Solana write callers remain split across useReputationOracle/useMarketplaceOracle; server routes still import lib/onchain directly in several places."
    status: completed
  - id: extract-solana-write-helpers
    content: "DONE 2026-07-01: lib/solanaWrites.ts owns register/list/purchase, moved verbatim from the two hooks (near-duplicates that had already drifted in USDC-mint sourcing and error copy). PurchaseSkillResult/RegisterAgentResult extend TxResult in adapters/types.ts. Legacy hooks are thin wrappers with unchanged signatures (Number.isSafeInteger guard before BigInt; authorBond === 0n). Hooks shrank 2615→1940 / 690→300 lines; source tests re-pointed at the module."
    status: completed
  - id: add-solana-chain-wallet
    content: "DONE 2026-07-01: lib/adapters/solanaWallet.ts createSolanaChainWallet (facade over solanaWrites; paidGas derived from summary.feePayer; alreadyPurchased maps ref to the purchase PDA; buildX402Payment honestly rejects until Phase 2d) + hooks/useWritableChainWallet.ts (Base passkey wallet passthrough, Solana composed from useChainWallet + useAgentVouchTransactionSigner). WalletContextProvider untouched — header path stays lightweight. purchaseSolanaSkill gained optional expectedPriceUsdcMicros for Base-parity price-changed guard (facade-only; legacy callers unaffected)."
    status: completed
  - id: repoint-primary-write-callers
    content: "DONE 2026-07-01: SkillDetailClient Solana purchase and MarketplaceClient quick-purchase now use the writable ChainWallet (alreadyPurchased short-circuit, verify POST with ref, explorer URL from result, UI copy preserved). MarketplaceClient falls back to the legacy oracle path when no price quote is displayed (the facade requires a quote by design). Solana LISTING creation intentionally stays on useReputationOracle: the flow needs getSkillListingPDA after creation, which TxResult cannot express — extending the listing result type cross-chain is a future reviewed interface change. signMessage repo-publish/download auth untouched per plan."
    status: completed
  - id: repoint-safe-read-callers
    content: "DONE 2026-07-01: audit found ONE call site meeting both criteria (view fields only + cached reads acceptable): lib/metadataData.ts chain-skill metadata, now via getAdapter().fetchSkillListing. The skills-route enumeration and platformMetrics need totalDownloads/totalRevenue/timestamps that SkillListingView does not carry — per the plan's own rule they stay on lib/onchain until a reviewed view expansion; cache-bypass money paths untouched and guarded by test."
    status: completed
  - id: isolate-x402-seams
    content: "DONE 2026-07-01: browserX402.ts and x402ProtocolBridge.ts carry explicit SOLANA/SVM-ONLY seam headers; __tests__/lib/phase2-circleback.test.ts enforces the family guard (Base x402/verification/adapters never reference browserX402/x402ProtocolBridge/solanaWrites/@solana/kit/@x402/svm) plus provider bundle isolation; Solana ChainWallet.buildX402Payment rejects honestly until Phase 2d."
    status: completed
  - id: verify-phase2-circleback
    content: "DONE 2026-07-01: local gates ALL PASS — format:check, web lint, typecheck, vitest (84 files / 488 tests incl. 11 new phase-2 seam guards), next build --webpack. Browser smoke passed for the Phase 2 seam/refactor scope: Phantom connect/restore/disconnect worked; fresh Solana listing `DGmzFYKZkik8qtRBj5QmfDV9PzGutFDPhtqK4MptjSf1` created; buyer `A9tc...B8ZD` purchased it with tx `4dMaouu83DKcwz8Ps4kZ6UdMjgAhWokh897eGKBnFVxtGgc3aWwgxTxiqLSzS8MgmK5JP1xVD98wYB8oQ6tXshu`; entitlement verify + raw download returned success; fresh signed raw download also completed. Base passkey connect/disconnect worked as `0x3B63...C779`, and Preview env now has `NEXT_PUBLIC_BASE_CDP_PAYMASTER_RPC_URL` configured. Deferrals accepted: Base-only restore remains noisy in this Chrome profile because Phantom/Solana auto-restore wins the mutual-exclusion race after reload; Kora/Solana sponsored checkout setup-fee and fallback prompts are no longer Phase 2 blockers; Base list/purchase/raw-download is a Phase 5/9/Base-default smoke, not part of the Solana adapter circle-back closure. A fresh unpaid Solana fallback fixture exists for future Kora testing (`J9NJW9hyVvWdRfFrQrd2R8j964xckAfTTniSkchRFJRi`, repo skill `40a1c347-e3cb-4f67-b6cb-baf3eae377a9`)."
    status: completed
isProject: false
---

# Phase 2 Circle-Back - Solana Adapter Cleanup

> **Status: Completed/Historical — do not edit except corrections. Current status:** > `docs/MAINNET_READINESS.md` for launch gates; this plan remains Phase 2 closeout evidence.

## Goal

Complete the deferred Phase 2 work now that Phase 6 DB hardening has landed: route Solana reads and
the primary Solana write flows through the chain adapter/wallet seams without changing the live
Solana UX. This is a live-app refactor, so implementation should be incremental and behavior-first.

Branch setup for this pass: `feat/base-port-phase-2-circleback` was cut from `origin/main` after
Phase 6 merged as `a4dd3ea` on 2026-07-01. The first branch commit is
`b52c129 docs: record phase 6 db gate completion`.

## Current State

- `ChainAdapter` and `ChainWallet` interfaces already exist in `web/lib/adapters/types.ts`.
- `SolanaAdapter` implements server-safe Solana reads/formatting in `web/lib/adapters/solana.ts`,
  but no live callers were repointed in Phase 2a.
- `BaseAdapter` reads and Base passkey `ChainWallet` writes are already live from Phases 3-5.
- `WalletContextProvider.tsx` exports `useChainWallet()`, but when Solana is connected it currently
  returns `chainWallet: null`; Base returns `createBasePasskeyChainWallet(...)`.
- Solana writes still live in two large hooks:
  - `web/hooks/useReputationOracle.ts`: register agent, create/update/remove/close listing, bonds,
    vouches, disputes, and a Solana purchase path.
  - `web/hooks/useMarketplaceOracle.ts`: marketplace listing reads and Solana purchase path with
    sponsored checkout fallback.
- Primary UI callers:
  - `web/app/skills/[id]/SkillDetailClient.tsx`: already uses Base `activeChainWallet` for Base
    list/purchase, but still falls back to `useReputationOracle` for Solana list/purchase and direct
    signed-download auth.
  - `web/app/skills/MarketplaceClient.tsx`: still uses `useMarketplaceOracle().purchaseSkill`.
  - `web/app/skills/publish/page.tsx`, `web/app/dashboard/page.tsx`, and
    `web/app/author/[pubkey]/page.tsx`: still use `useReputationOracle` directly.
- Server/read call sites still importing `web/lib/onchain.ts` directly include
  `web/app/api/skills/route.ts`, `web/app/api/skills/[id]/route.ts`,
  `web/app/api/skills/[id]/install/route.ts`, `web/app/api/skills/[id]/raw/route.ts`,
  `web/app/api/skills/[id]/purchase/verify/route.ts`, `web/app/api/skills/[id]/update/route.ts`,
  `web/lib/skillRawAccess.ts`, `web/lib/metadataData.ts`, `web/lib/platformMetrics.ts`,
  `web/lib/x402ProtocolBridge.ts`, and `web/lib/sponsoredPurchase.ts`.

## Scope

In scope:

- A behavior-preserving Solana `ChainWallet` for the interface methods that already exist:
  `registerAgent`, `createSkillListing`, `purchaseSkill`, `disconnect`, and an honest
  `buildX402Payment` unsupported/rejected path until Phase 2d defines a real payment object.
- Shared Solana write helpers so legacy hooks and the new Solana wallet facade do not drift.
- Carefully selected caller repoints where the adapter/wallet interface already carries enough data.
- Source tests that prevent Solana from staying `chainWallet: null` and prevent Base paths from
  importing Solana PDA/ATA code.

Out of scope:

- Expanding `ChainWallet` to cover every Solana protocol operation. Dashboard-only actions such as
  vouching, disputes, bonds, listing removal/update/close, refund mechanics, and migrations should
  stay on `useReputationOracle` unless a later phase intentionally expands the interface.
- Phase 7 address-type sweep. Do not chase every `@solana/kit` import in this phase; only touch the
  ones needed for adapter/wallet seams.
- Base default-chain flip, Base mainnet, and any destructive DB schema changes.

## Implementation Plan

1. Extract Solana write helpers behind a client-only module.

   - Candidate files: `web/lib/adapters/solanaWallet.ts` plus smaller helper modules if needed.
   - Lift the existing logic for the three `ChainWallet` methods from
     `useReputationOracle`/`useMarketplaceOracle` into reusable functions.
   - Keep the legacy hooks calling those helpers first, then expose the helpers through the new
     Solana `ChainWallet`. This avoids a big-bang caller migration.
   - Preserve sponsored checkout behavior, preflight errors, `assertUsdcAccountReady`, transaction
     summaries, confirmation waiting, existing `alreadyPurchased` handling, and current network
     mismatch messages.
   - Make the purchase result type decision before moving callers. `ChainWallet.purchaseSkill`
     currently returns `TxResult`, which cannot express the existing `{ tx, alreadyPurchased }`
     Solana no-op path. Either add an explicit `PurchaseResult extends TxResult` return type for
     `purchaseSkill` or add an optional `alreadyPurchased?: boolean` field in a reviewed interface
     change. Do not route marketplace quick purchase through a side channel or drop the friendly
     already-owned short-circuit.
   - Watch the `CreateSkillListingInput.priceUsdcMicros` type: the interface uses `bigint`, while
     legacy `createSkillListing` takes a `number`. Convert only after an explicit safe-integer guard.
     Preserve free-listing semantics deliberately: the legacy branch checks
     `priceUsdcMicros === 0` before `BigInt(...)`; a bigint helper must use `priceUsdcMicros === 0n`
     so the free-listing `authorBond` account is still included.

2. Add a Solana `ChainWallet` without bloating the header wallet path.

   - Do not import `useReputationOracle` or `useMarketplaceOracle` inside
     `WalletContextProvider.tsx`; the provider is already the base wallet/status boundary and the
     header `ClientWalletButton` uses it.
   - Prefer a write-focused hook such as `web/hooks/useWritableChainWallet.ts` or a similarly named
     hook that composes the lightweight wallet context with the extracted Solana write helpers.
   - Existing `useChainWallet()` from `WalletContextProvider.tsx` can remain the status/session
     hook, or be renamed/re-exported deliberately in the implementation. Avoid accidental circular
     imports from provider -> oracle -> provider.
   - Base should continue returning the existing `createBasePasskeyChainWallet(...)`.

3. Repoint the primary write callers in small commits.

   - `SkillDetailClient.tsx`: use the active/writable `ChainWallet` for both Base and Solana list
     and purchase branches where possible. Keep `signMessage` for repo publish auth and raw download
     authorization; that is not replaced by `ChainWallet`.
   - `MarketplaceClient.tsx`: route quick Solana purchase through the Solana `ChainWallet` after the
     facade preserves `alreadyPurchased` and transaction display semantics.
   - `skills/publish/page.tsx`: only repoint the listing create path if the Solana `ChainWallet`
     exposes the same author-auth/PATCH flow cleanly. Leave repo publish auth on `signMessage`.
   - `dashboard/page.tsx` and `author/[pubkey]/page.tsx`: keep advanced Solana-only protocol actions
     on `useReputationOracle`; optionally repoint only `registerAgent` once the facade is proven.
     Before repointing any `registerAgent` caller, audit whether it consumes the legacy
     `{ tx, agentProfile }` return shape. If a caller needs `agentProfile`, make that an explicit
     result-type extension (for example `RegisterAgentResult extends TxResult`) rather than hiding
     the PDA through a facade side channel. Sponsored registration can map naturally to
     `paidGas: false`.

4. Repoint safe read/price callers.

   - Start with `web/app/api/skills/route.ts` chain listing enumeration and any call sites that only
     need `SkillListingView.priceUsdcMicros`, `active`, `author`, `uri`, or `revision`.
   - Use `getAdapter(getConfiguredSolanaChainContext())` for Solana rows. Preserve existing behavior
     for legacy aliases and configured Solana chain context.
   - Do not blindly replace call sites that need raw Solana-generated account fields such as
     settlements, vaults, or purchase PDA derivations. Either leave them explicitly Solana-specific
     or expand `ChainAdapter` in a separate, reviewed interface change that Base can implement too.
   - Treat cache semantics as load-bearing, not just return-field shape. Money paths that currently
     call `getOnChainUsdcPrice(addr, { useCache: false })` require a fresh chain read and must stay
     on explicit Solana helpers unless `ChainAdapter.fetchSkillListing` first grows reviewed fetch
     options such as `{ useCache?: boolean }`. Examples to avoid repointing blindly:
     `web/lib/skillRawAccess.ts`, `web/lib/sponsoredPurchase.ts`, `web/lib/x402ProtocolBridge.ts`,
     and `web/app/api/skills/[id]/route.ts`.

5. Isolate x402 seams.
   - `web/lib/browserX402.ts` and `web/lib/x402ProtocolBridge.ts` are Solana/SVM-specific today.
   - Add a named Solana x402 seam or explicit family guard so Base raw-access and Base x402 paths do
     not import Solana PDA/ATA/bridge code.
   - Mirror the Base passkey wallet’s honest unsupported behavior for `buildX402Payment` until there
     is a real browser/agent `X402Payment` abstraction behind `ChainWallet`.

## Verification

Minimum source/unit checks:

- Add focused tests under `web/__tests__/lib` or source-level tests where the harness lacks wallet
  providers:
  - Solana connected sessions no longer leave the writable wallet facade absent on write-heavy
    surfaces.
  - Base `createBasePasskeyChainWallet` behavior is untouched.
  - Solana `buildX402Payment` unsupported behavior is explicit until Phase 2d implements it.
  - Server read routes that move to `getAdapter(...)` still preserve Solana price/listing semantics.

Required commands before PR:

```bash
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm test --workspace @agentvouch/web
npm exec --workspace @agentvouch/web next -- build --webpack
```

Use the explicit webpack build as the production-parity gate for this branch, matching Phase 6 and
the current repo guidance. Do not silently swap back to plain `npm run build --workspace @agentvouch/web` unless the repo intentionally changes its production bundler gate first.

Browser smoke before marking Phase 2 complete:

- Solana Phantom extension connect/restore/disconnect still works.
- Solana repo skill listing creation still links `on_chain_address` and preserves signed author auth.
- Solana paid skill purchase still works, including entitlement verification.
- Signed raw download still works after purchase.
- Base passkey connect/disconnect still renders and does not regress.

Accepted deferrals after the 2026-07-01 smoke:

- Solana sponsored/Kora setup-fee and fallback prompts are not a Phase 2 blocker. Re-test them only
  if Solana remains first-class or before broadly enabling sponsored Solana checkout.
- Base list/purchase/raw-download is a Phase 5/9/Base-default smoke. It verifies the Base
  `ChainWallet`/paymaster path, not this Solana adapter circle-back.
- Base-only reload restore is noisy in the current Chrome profile because Phantom/Solana
  auto-restore wins the app's intentional Base/Solana mutual-exclusion policy. Revisit as wallet UX
  polish rather than Phase 2 correctness.

## Rollback

- If a write-caller repoint regresses, revert that caller to the legacy hook while keeping the shared
  helper extraction if tests prove helper behavior is equivalent.
- If the Solana `ChainWallet` facade causes bundle/circular-import issues, keep Base `useChainWallet`
  behavior as-is and move Solana writes behind a separate `useSolanaChainWallet` hook until the
  provider boundary is redesigned.
- If server read repointing exposes missing fields in `SkillListingView`, revert those read call
  sites to `lib/onchain.ts` and add the missing interface explicitly in a follow-up.

## Blockers And Judgment Calls

- A real wallet browser smoke was required before calling Phase 2 complete; source tests alone were
  not enough for this refactor. That smoke is recorded above.
- `useReputationOracle` is still the owner of many Solana-only protocol actions. Keep those explicit
  instead of pretending the current `ChainWallet` covers the whole protocol.
- Avoid changing UI address shortening in this phase. Existing call sites have mixed truncation
  lengths; Phase 7 can handle global address rendering.
- Result-type changes (`PurchaseResult`, `RegisterAgentResult`, or optional fields on `TxResult`)
  are part of the plan, not implementation improvisations. Update `web/lib/adapters/types.ts`,
  Base/Solana wallet implementations, and source tests together when making that interface change.
- Fresh-price reads are security-sensitive. If the adapter does not expose a cache-bypass option, do
  not use it for purchase verification, sponsored checkout validation, raw-access price checks, or
  x402 bridge settlement validation.
