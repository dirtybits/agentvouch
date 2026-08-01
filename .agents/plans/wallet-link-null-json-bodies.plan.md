---
name: wallet-link-null-json-bodies
overview: "Return the established 400 client-error response, without wallet-link side effects, when authenticated wallet-link endpoints receive a literal JSON null body."
todos:
  - id: add-null-body-regressions
    content: Add route-level regressions proving literal null returns the existing 400 response and invokes no challenge or verification helper
    status: completed
  - id: normalize-null-bodies
    content: Normalize literal JSON null to an empty object in both wallet-link mutation routes before property access
    status: completed
  - id: verify-wallet-link-routes
    content: Run the focused wallet-link Vitest suite and whitespace/format validation
    status: completed
isProject: false
---

# Normalize Literal-Null Wallet-Link Bodies

## Goal

Ensure the authenticated buyer wallet-link challenge and verification endpoints reject a valid JSON literal `null` using their established client-error contracts instead of throwing when they access body properties.

## Scope

- In scope: `POST /api/account/wallet-links/challenge` and `POST /api/account/wallet-links/verify` body normalization and their shared route test file.
- Out of scope: authentication, rate limits, database schema, challenge-signature semantics, wallet-chain support, and Base mainnet policy.

## Verified Gap — 2026-08-01

- `web/app/api/account/wallet-links/challenge/route.ts` parses into a typed object at line 54 and immediately reads `body.chainContext` at line 60.
- `web/app/api/account/wallet-links/verify/route.ts` parses into a typed object at line 61 and immediately reads `body.challengeId` at line 66.
- `request.json()` legitimately returns `null` for the body `null`; TypeScript casts do not normalize runtime input. Both routes can therefore throw before their existing 400 validation paths.
- `web/__tests__/api/buyer-wallet-link-routes.test.ts` covers invalid field values and malformed JSON handling indirectly, but has no literal-null regression for either mutation route.

## Files To Change

- `web/app/api/account/wallet-links/challenge/route.ts`: coalesce parsed JSON to `{}` before validating the target.
- `web/app/api/account/wallet-links/verify/route.ts`: coalesce parsed JSON to `{}` before validating the proof.
- `web/__tests__/api/buyer-wallet-link-routes.test.ts`: add literal-null assertions for both routes, including absence of downstream side effects.

## Implementation Steps

1. Change each route's successful `request.json()` result to `(await request.json()) ?? {}` while retaining its existing malformed-JSON catch and response text.
2. Add a focused test for the challenge endpoint asserting a literal `null` body responds `400` with its existing invalid-target payload and does not create a challenge.
3. Add a focused test for the verify endpoint asserting a literal `null` body responds `400` with its existing invalid-proof payload and does not fetch, verify, or consume a challenge.

## Verification

1. Run `. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; } && npm test --workspace @agentvouch/web -- __tests__/api/buyer-wallet-link-routes.test.ts --maxWorkers=1 --no-fileParallelism`.
2. Run `npm run format:check` and `git diff --check`.
3. Review the diff to verify only the two null-normalizations, regression assertions, and this execution plan are included.

## Rollout

Ship as a small server-route fix. No database migration, deployment setting, wallet transaction, or chain behavior change is required.

## Rollback

Revert the focused commit. The prior behavior only affects malformed client input and has no data migration to unwind.

## Verification Note — 2026-08-01

- RED: the new literal-null regression failed before the fix with `TypeError: Cannot read properties of null (reading 'chainContext')` from the challenge route.
- Focused route suite passed: 1 file / 6 tests.
- Full web Vitest suite passed: 125 files / 888 tests.
- `npm run format:check`, `npm run lint:web`, `npm run typecheck`, and `npm exec --workspace @agentvouch/web -- next build --webpack` passed under Node v24.10.0.
- The production build retained the existing viem Tempo dynamic-import warning and expected offline `DATABASE_URL` static-generation fallbacks; it completed successfully.
- `git diff --check` passed.

## Blockers

- None expected. If the focused route suite indicates a different established response contract, preserve the test-proven contract and update this plan with a dated divergence note before committing.
