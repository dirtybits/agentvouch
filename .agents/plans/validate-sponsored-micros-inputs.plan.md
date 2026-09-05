---
name: validate-sponsored-micros-inputs
overview: "Reject non-finite and non-integer JSON number inputs for sponsored purchase micro-USDC fields with client-error responses before transaction preparation."
todos:
  - id: reproduce-invalid-micros-response
    content: Add a focused failing regression showing an overflowing JSON numeric micro-USDC value reaches BigInt conversion and throws a generic error
    status: completed
  - id: validate-numeric-micros
    content: Validate numeric inputs before BigInt conversion and preserve the sponsored route's client-error classification
    status: completed
  - id: cover-helper-and-route-contract
    content: Add behavioral helper coverage and route-level no-downstream-side-effect coverage for invalid numeric micro-USDC input
    status: completed
  - id: verify-focused-change
    content: Run focused tests, format, lint, typecheck, full web tests, webpack build, and whitespace checks
    status: completed
isProject: false
---

# Validate Sponsored Micro-USDC Inputs

## Goal

Make `POST /api/transactions/sponsored/purchase/prepare` reject invalid JSON numeric values for micro-USDC fields with a `400` response before sponsored transaction preparation, rather than leaking a `BigInt` conversion failure as a `500`.

## Scope

- In scope: sponsored purchase preparation's `expectedPriceUsdcMicros` and `maxSetupFeeUsdcMicros` numeric parsing, its shared `parseNonNegativeBigInt` helper, and focused regression coverage.
- Out of scope: sponsored checkout economics, feature flags, rate-limit policy, transaction-account construction, database changes, wallet behavior, and Base mainnet enablement.

## Verified Gap (2026-09-02)

- `web/app/api/transactions/sponsored/purchase/prepare/route.ts:21-26` accepts every JavaScript `number` from JSON and forwards it to `prepareSponsoredPurchase` at lines 64-71.
- `web/lib/sponsoredPurchase.ts:117-124` passes numeric input directly to `BigInt(value)`. Valid JSON `1e309` parses as `Infinity`; `BigInt(Infinity)` throws a `RangeError`.
- The route's handler maps only expected validation messages to `400` (`route.ts:73-83`), so that conversion error becomes a generic `500`.
- Existing `web/__tests__/api/sponsored-transaction-routes.test.ts` covers literal `null` bodies but not invalid numeric micro-USDC values.

## Files To Change

- `web/lib/sponsoredPurchase.ts`: reject non-finite, fractional, and unsafe numeric inputs with a stable validation error before invoking `BigInt`.
- `web/app/api/transactions/sponsored/purchase/prepare/route.ts`: classify that stable input-validation error as a `400`.
- `web/__tests__/lib/sponsoredPurchase.test.ts`: add behavioral regressions for invalid numbers at the pure parsing boundary.
- `web/__tests__/api/sponsored-transaction-routes.test.ts`: assert an overflowing numeric request returns `400` and never calls `prepareSponsoredPurchase`.

## Implementation Steps

1. Add a route-level RED regression with a valid buyer/listing payload and `expectedPriceUsdcMicros: 1e309`; assert a client error and no transaction helper invocation.
2. Add pure helper regressions for `Infinity`, fractional values, and unsafe numeric integers, while preserving valid integer/string input behavior.
3. Validate numbers with `Number.isSafeInteger` before `BigInt` conversion. Use an error message whose existing route classification consistently returns `400`.
4. Keep strings as the canonical representation for arbitrarily large micro-USDC values, so exact high-value client input remains supported.
5. Re-run focused tests and repository quality gates.

## Verification

Run with Node 24 as required by `AGENTS.md`:

```bash
. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; }
npm test --workspace @agentvouch/web -- __tests__/api/sponsored-transaction-routes.test.ts __tests__/lib/sponsoredPurchase.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria: invalid numeric JSON values receive a `400` without invoking sponsored transaction preparation; the shared helper fails with a stable validation error before `BigInt`; valid exact string values remain supported.

## Rollout

Ship as a narrow API input-hardening PR. No data migration, deployment configuration, wallet transaction, or on-chain state change is required.

## Execution Note (2026-09-02)

- RED: `npm test --workspace @agentvouch/web -- __tests__/lib/sponsoredPurchase.test.ts --maxWorkers=1 --no-fileParallelism` failed before the fix because `BigInt(Infinity)` threw `The number Infinity cannot be converted to a BigInt because it is not an integer` instead of a stable validation error.
- The implementation rejects unsafe numeric inputs at the route boundary before `prepareSponsoredPurchase` runs, and the shared parser independently rejects non-finite, fractional, and unsafe numeric values. Exact high-value values remain supported as decimal strings.
- Passed under Node `v24.10.0`: focused sponsored tests (2 files / 27 tests), `npm run format:check`, `npm run lint:web`, `npm run typecheck`, full web Vitest (128 files / 930 tests), `npm exec --workspace @agentvouch/web -- next build --webpack`, and `git diff --check`.
- The build retained the repository's existing `ox`/`viem` dynamic-import warning and expected static-generation `DATABASE_URL` fallback logs. No live sponsored transaction, database, wallet, or deployment flow was run.

## Rollback

Revert the focused commit. The patch changes only invalid request handling and associated tests.

## Blockers

- None known. Do not broaden the shared parser's accepted types or alter sponsored fee economics.
