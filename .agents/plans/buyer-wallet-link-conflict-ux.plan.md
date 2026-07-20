---
name: buyer-wallet-link-conflict-ux
overview: "Prevent redundant wallet signatures after provider switching and surface cross-account wallet ownership conflicts as terminal, actionable UI states."
todos:
  - id: diagnose-production-hang
    content: Correlate the reported Coinbase-from-Solana and cross-account hangs with production wallet-link route logs and current client state transitions.
    status: completed
  - id: implement-terminal-link-states
    content: Skip verification when a newly connected target is already linked to the current buyer account, and make signed cross-account conflicts explicit and terminal.
    status: completed
  - id: add-regression-coverage
    content: Add behavioral response/error tests plus route and client-wiring coverage for already-linked and owned-by-other-account outcomes.
    status: completed
  - id: verify-wallet-link-fix
    content: Run targeted tests, the substantive web gate, browser verification where wallet automation permits, and a production-auth monitoring snapshot.
    status: completed
  - id: publish-wallet-link-fix
    content: Record verification, create a signed commit, push the isolated branch, and open a focused pull request.
    status: completed
isProject: false
---

# Buyer Wallet-Link Conflict UX

## Goal

Make provider switching settle cleanly: connecting a wallet already linked to the current buyer account must not request another signature, while a signed attempt to attach a wallet owned by a different buyer account must stop progress and show an actionable error.

## Scope

- In scope: `/account` wallet-link client state, the wallet verification conflict payload, and regression coverage.
- In scope: Phantom/Solana to Coinbase Smart Wallet transition behavior on Base Sepolia.
- Out of scope: wallet transfer/unlink semantics, linking one wallet to multiple buyer accounts, payment activation, Base mainnet, and wallet SDK replacement.

## Files To Change

- `web/components/BuyerWalletLinks.tsx`: skip redundant verification after a target connection settles; render success and error notices with accessible terminal states.
- `web/lib/buyerWalletLinkClient.ts`: centralize safe API error decoding and actionable conflict copy.
- `web/app/api/account/wallet-links/verify/route.ts`: return a stable conflict code for a wallet owned by another buyer account.
- `web/__tests__/lib/buyerWalletLinkClient.test.ts`: behaviorally cover JSON, malformed, and cross-account errors.
- `web/__tests__/api/buyer-wallet-link-routes.test.ts`: cover the stable cross-account conflict code.
- `web/__tests__/components/buyer-wallet-links-source.test.ts`: guard the provider-settlement wiring that skips redundant signatures.

## Implementation

1. Detect `currentWalletLinked` when the pending provider target becomes active. Clear pending state and report that the wallet is already linked instead of issuing a challenge or signature request.
2. Give the server's cross-account ownership response a stable machine-readable code without changing its HTTP 409 fail-closed behavior.
3. Decode that response into guidance to sign in to the owning AgentVouch account or connect a different wallet.
4. Render errors prominently with `role="alert"`; always clear linking/pending state in terminal success and failure paths.

## Verification

- Targeted Vitest coverage for wallet-link route, client helper, and wiring behavior.
- `npm run format:check`, web lint, typecheck, Vitest, and `npm exec --workspace @agentvouch/web -- next build --webpack` under Node 24.
- Browser verification of `/account` rendering and absence of console/error overlays. Human passkey signing remains required for the final provider interaction.
- Vercel runtime-error snapshot for production buyer-auth and wallet-link routes; payment paths remain disabled.

## Rollout And Rollback

- Ship through a dedicated PR from current `main`.
- Rollback is the fix PR revert; no schema, environment, custody, economic, or onchain state changes are involved.

## Evidence

- **2026-07-20:** Production deployment `dpl_CCmoeHT4k5UmSbpuoyvegFueeGTY` recorded wallet-link challenges at `19:22:32Z`, `19:39:05Z`, and `19:42:52Z`. Verification returned HTTP 200 for the first two attempts and HTTP 409 at `19:42:58Z` for the cross-account Coinbase Smart Wallet attempt. No wallet-link runtime error cluster was present. The server correctly enforced unique wallet ownership; the remaining defect is client/provider-settlement UX.
- **2026-07-20:** Current client wiring automatically calls `linkConnectedWallet()` after a provider target settles without checking whether that wallet is already present in the current account's links. This explains the redundant Coinbase signature when switching from an active Solana wallet to an already-linked Base wallet.
- **2026-07-20:** Targeted wallet-link coverage passed: 3 Vitest files / 20 tests. The static chain-capability verifier also passed with 25 Solana instructions, 22 Base state-changing functions, and 26 mapped rows.
- **2026-07-20:** The substantive web gate passed: repository format check, web ESLint, Next route type generation plus `tsc --noEmit`, 121 Vitest files / 785 tests, and the webpack production build. The first build attempt could not resolve Google Fonts inside the restricted network; the approved network-enabled rerun compiled successfully and produced `web/.next/BUILD_ID`.
- **2026-07-20:** Anonymous production browser smoke at `https://www.agentvouch.xyz/account` rendered the buyer-account page and sign-in affordances with no console warnings or errors. A local authenticated render was unavailable because this checkout intentionally has no Clerk keys; the Vercel preview remains the final UI smoke target. Production monitoring over the prior six hours showed no runtime error clusters on account, sign-in, or wallet-link routes; the observed cross-account attempt remained the expected HTTP 409.
- **2026-07-20:** Signed implementation commit `b6d62b6` opened PR #113. GitHub `test` and `contracts` checks passed, and Vercel produced deployment `dpl_86hkigdqrC1Esjnpr5BMJdwJVCy4`. The preview intentionally returned 404 for `/account` because buyer-auth preview flags remain off; this confirms the dormant preview boundary rather than exercising the auth UI. Final Coinbase passkey signing and the exact cross-account alert remain a human smoke after the fix reaches the auth-enabled production environment.
