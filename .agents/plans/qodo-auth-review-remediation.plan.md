---
name: qodo-auth-review-remediation
overview: "Address Qodo findings from PRs #112 and #113 by redacting unnecessary production identifiers and preventing wallet-link signatures before the authoritative link inventory loads."
todos:
  - id: establish-remediation
    content: Reproduce both review findings on current main, define the minimal remediation scope, and create an isolated follow-up branch.
    status: completed
  - id: fix-loading-race
    content: Fail closed until the buyer wallet-link inventory loads successfully, disable link actions during that boundary, and add regression coverage.
    status: completed
  - id: redact-operational-identifiers
    content: Remove exact opaque production platform, deployment, database-host, branch, and disposable-account identifiers from committed plan evidence while retaining useful public proof.
    status: completed
  - id: verify-remediation
    content: Run targeted tests, chain-map verification, the full substantive web gate, and identifier scans.
    status: completed
  - id: publish-and-resolve
    content: Create a signed commit and focused PR, wait for required checks, then reply to and resolve both original Qodo review threads.
    status: in_progress
isProject: false
---

# Qodo Authentication Review Remediation

## Goal

Close the two actionable Qodo findings on PRs #112 and #113 without changing production feature flags, payment behavior, wallet ownership semantics, or chain readiness.

## Scope

- In scope: buyer wallet-link client settlement, its helper and regression tests, and operational-evidence redaction in the production-auth and wallet-link plans.
- Out of scope: database changes, environment changes, production deployment, wallet unlink/transfer, buyer-card access, Stripe checkout, Base protocol writes, and Base mainnet.

## Files

- `web/components/BuyerWalletLinks.tsx`: distinguish a successfully loaded wallet inventory from a stopped loading spinner and disable link actions until it is authoritative.
- `web/lib/buyerWalletLinkClient.ts`: make the pending provider transition wait for the inventory-loaded boundary.
- `web/__tests__/lib/buyerWalletLinkClient.test.ts`: behaviorally cover the load boundary.
- `web/__tests__/components/buyer-wallet-links-source.test.ts`: guard client wiring and disabled controls.
- `.agents/plans/walletless-production-auth-rollout.plan.md`: retain outcomes while redacting opaque production topology and disposable-user identifiers.
- `.agents/plans/buyer-wallet-link-conflict-ux.plan.md`: remove exact deployment identifiers from evidence.

## Implementation

1. Track successful wallet-inventory loading separately from `loading`; a failed request must leave link actions disabled.
2. Make the pending provider action return `wait` until the inventory is loaded, then decide between `already-linked` and `link` using authoritative data.
3. Disable every manual link action until the same boundary passes.
4. Preserve public PR/commit references, domains, route/status evidence, dates, environment-variable names, and behavioral outcomes. Redact exact Vercel/Clerk/Neon/deployment/branch/host and disposable-account identifiers.
5. Do not rewrite Git history: the reviewed values are operational metadata, not credentials, and the remediation removes unnecessary disclosure from current source.

## Verification

- `npm exec --workspace @agentvouch/web -- vitest run __tests__/lib/buyerWalletLinkClient.test.ts __tests__/components/buyer-wallet-links-source.test.ts`
- `npm run verify:chain-map`
- `npm run format:check`
- `npm run lint --workspace @agentvouch/web`
- `npm run typecheck --workspace @agentvouch/web`
- `npm run test --workspace @agentvouch/web`
- `npm exec --workspace @agentvouch/web -- next build --webpack`
- `git diff --check`
- Repository scans confirm the redacted identifier classes no longer appear in the two evidence plans.

## Rollout And Rollback

- Ship as a focused follow-up PR from current `main`.
- Resolve the original review threads only after the PR and required checks are green.
- Rollback is a normal revert; there are no schema, environment, deployment, economic, custody, or onchain changes.

## Stop Conditions

- The fix would require weakening unique wallet ownership or allowing a wallet inventory fetch failure to proceed.
- The source branch is no longer based on the merged PR #112/#113 state.
- Verification exposes a payment, Base-mainnet, or cross-chain seam regression.

## Dated Notes

- **2026-07-20:** Both findings reproduce on current `origin/main`: the production-auth plan includes exact opaque infrastructure identifiers, and the wallet provider-settlement helper can act before the initially empty link inventory has loaded. The remediation is intentionally limited to current-source redaction plus a fail-closed client loading boundary.
- **2026-07-20:** The client now distinguishes a successfully loaded wallet inventory from a stopped spinner. Provider settlement and every manual link control wait for that successful boundary, so a slow or failed fetch cannot trigger a redundant signature. Targeted helper/wiring coverage passed (2 files / 17 tests), and the static chain-capability verifier passed with 25 Solana instructions, 22 Base state-changing functions, and 26 mapped rows.
- **2026-07-20:** Current plan evidence retains public commit, PR, domain, route, time, status-code, and behavioral proof while removing exact opaque Vercel, Clerk, Neon, deployment, database-host/branch, and disposable-account identifiers. Historical Git rewriting is intentionally unnecessary because the reviewed values were operational metadata, not credentials.
- **2026-07-20:** The substantive gate passed under Node 24: repository format check, web ESLint, Next route type generation plus `tsc --noEmit`, 121 Vitest files / 787 tests, and the webpack production build with all 151 static pages generated. The first build attempt could not resolve Google Fonts inside the restricted network; the approved network-enabled rerun succeeded. `git diff --check` and targeted identifier scans also passed.
