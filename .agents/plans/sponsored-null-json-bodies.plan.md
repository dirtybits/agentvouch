---
name: sponsored-null-json-bodies
overview: "Normalize literal JSON null request bodies at the four sponsored transaction routes so they retain their established 400 validation contracts without invoking transaction helpers."
todos:
  - id: add-null-body-regressions
    content: Add route-level literal-null regressions for sponsored purchase and registration prepare/submit endpoints, including no downstream helper invocation
    status: completed
  - id: normalize-null-bodies
    content: Coalesce successful JSON parsing to an empty object in all four sponsored transaction handlers before property access
    status: completed
  - id: verify-sponsored-routes
    content: Run focused route tests plus formatting, lint, typecheck, complete web Vitest suite, webpack build, and whitespace checks
    status: completed
isProject: false
---

# Normalize Literal-Null Sponsored Transaction Bodies

## Goal

Make valid JSON `null` a normal missing-input request at every sponsored transaction prepare/submit boundary, returning its existing `400` required-field response rather than throwing before validation.

## Scope

- In scope: the four sponsor-backed transaction API routes and a focused route-test suite.
- Out of scope: sponsored transaction semantics, rate-limit policy, auth, chain interaction, database changes, feature flags, and Base mainnet enablement.

## Verified Gap — 2026-08-13

- Each handler casts `await request.json()` to an object and immediately reads a property: purchase prepare `web/app/api/transactions/sponsored/purchase/prepare/route.ts:44-56`; purchase submit `.../purchase/submit/route.ts:33-47`; registration prepare `.../register-agent/prepare/route.ts:41-52`; registration submit `.../register-agent/submit/route.ts:33-47`.
- `request.json()` returns runtime `null` for the valid body `null`; a TypeScript cast does not change it. The property read therefore throws and bypasses the handlers' established `400` required-field contracts.
- Existing route coverage resides in helper suites only (`web/__tests__/lib/sponsoredPurchase.test.ts`, `web/__tests__/lib/sponsoredCheckout.test.ts`), leaving these HTTP boundaries without literal-null regression coverage.

## Files To Change

- `web/app/api/transactions/sponsored/purchase/prepare/route.ts`: normalize a successfully parsed null body.
- `web/app/api/transactions/sponsored/purchase/submit/route.ts`: normalize a successfully parsed null body.
- `web/app/api/transactions/sponsored/register-agent/prepare/route.ts`: normalize a successfully parsed null body.
- `web/app/api/transactions/sponsored/register-agent/submit/route.ts`: normalize a successfully parsed null body.
- `web/__tests__/api/sponsored-transaction-routes.test.ts`: mock downstream transaction helpers and assert literal-null responses and no side effects.

## Implementation Steps

1. Add route-level tests for a literal `null` body to each handler. Assert the endpoint's current missing-field `400` payload and that its underlying prepare/submit helper did not run.
2. Run the focused suite to confirm the tests fail because the existing handlers dereference `null`.
3. Change only each successful parser result to `(await request.json()) ?? {}`, retaining the existing malformed-JSON catches and response texts.
4. Re-run focused tests and the normal web quality gates.

## Verification

1. `. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; } && npm test --workspace @agentvouch/web -- __tests__/api/sponsored-transaction-routes.test.ts --maxWorkers=1 --no-fileParallelism`
2. `npm run format:check && npm run lint:web && npm run typecheck`
3. `npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism`
4. `npm exec --workspace @agentvouch/web -- next build --webpack`
5. `git diff --check`

## Verification Note — 2026-08-13

- RED: the new route tests failed before the fix: all four endpoints threw `TypeError: Cannot read properties of null` at their first body-property access.
- Focused route suite passed: 1 file / 4 tests.
- Full web Vitest suite passed: 126 files / 908 tests.
- `npm run format:check`, `npm run lint:web`, `npm run typecheck`, `npm exec --workspace @agentvouch/web -- next build --webpack`, and `git diff --check` passed under Node v24.10.0.
- The production build retained the pre-existing viem Tempo dynamic-import warning. No live sponsored transaction was run; this patch rejects invalid input before any transaction helper is invoked.

## Rollout

Ship as a narrow server-route hardening PR. No schema migration, deployment configuration, wallet transaction, or chain-state change is required.

## Rollback

Revert the focused commit. This change only affects malformed/missing client input and stores no data.

## Blockers

- None expected. Preserve existing status/error contracts if the focused route tests prove a difference from this plan.
