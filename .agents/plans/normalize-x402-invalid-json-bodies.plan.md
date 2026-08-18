---
name: normalize-x402-invalid-json-bodies
overview: "Reject malformed and literal-null JSON bodies at both authenticated x402 facilitator endpoints with their established 400 contracts before payment verification or settlement work."
todos:
  - id: harden-x402-body-parsing
    content: Normalize malformed and literal-null JSON request bodies to an empty object in the x402 verify and settle routes
    status: completed
  - id: add-route-regressions
    content: Add route-level regressions proving invalid bodies return 400 and invoke no payment verification or settlement helpers
    status: completed
  - id: verify-x402-hardening
    content: Run focused Vitest, formatting, lint, typecheck, full Vitest, webpack build, and whitespace checks
    status: completed
isProject: false
---

# Normalize Invalid x402 JSON Bodies

## Goal
Make authenticated `POST /api/x402/verify` and `POST /api/x402/settle` treat malformed JSON and valid JSON literal `null` as an empty request body, so they return their existing missing-proof `400` response instead of falling into the broad `500` handler.

## Scope
- In scope: request-body normalization and targeted no-side-effect regressions for the two x402 facilitator endpoints.
- Out of scope: changing authentication, Base/Solana x402 payment semantics, database schema, relayer behavior, or protocol interfaces.

## Files To Change
- `web/app/api/x402/verify/route.ts`: safely normalize the parsed JSON body before Base and legacy proof extraction.
- `web/app/api/x402/settle/route.ts`: safely normalize the parsed JSON body before Base settlement or legacy proof verification.
- `web/__tests__/api/x402-routes.test.ts`: add authenticated invalid-body route regressions with payment helpers mocked.

## Implementation Steps
1. Parse each body with a catch-and-null fallback, then coalesce the result to `{}` before passing it to existing body helpers or reading `proof`.
2. Keep the established missing-proof response payload and HTTP `400` status; preserve the authentication-first behavior.
3. Add table-driven malformed JSON and literal-`null` tests for both routes. Assert that Base skill/payload lookup, legacy proof verification, and settlement/entitlement helpers do not run.

## Verification
- `npm test --workspace @agentvouch/web -- __tests__/api/x402-routes.test.ts --maxWorkers=1 --no-fileParallelism`
- `npm run format:check`
- `npm run lint:web`
- `npm run typecheck`
- `npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism`
- `npm exec --workspace @agentvouch/web -- next build --webpack`
- `git diff --check`

Acceptance criteria: both routes return their pre-existing `400` payload for malformed and literal-null JSON after successful authentication, with no payment/settlement helper call.

## Rollout
Ship as a focused route-boundary hardening PR. No configuration or migration is required.

## Rollback
Revert the single PR commit; no persisted state or protocol behavior needs restoration.

## Blockers
- None identified. Verified 2026-08-18: both handlers directly cast `await request.json()` and then dereference the assumed record, so malformed or literal-null bodies currently reach the outer `500` handler.

## Execution Notes
- 2026-08-18: added safe parse-and-coalesce handling to both x402 routes and four authenticated regression cases (malformed and literal-null input for each route). The focused test was red before the patch (`500`), then passed.
- 2026-08-18: formatting, lint, typecheck, all 908 web Vitest tests, webpack production build, and `git diff --check` passed. The build retained the existing viem Tempo dynamic-import warning and expected static-generation database fallbacks because local `DATABASE_URL` is absent.
