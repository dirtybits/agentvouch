---
name: validate-paid-report-query-inputs
overview: "Reject malformed paid-report buyer and purchaseId query parameters before database initialization in the Base paid-report lookup route."
todos:
  - id: validate-query-inputs
    content: Move paid-report buyer and purchaseId validation ahead of database initialization while preserving the existing 400 response contract
    status: completed
  - id: add-regression-test
    content: Add a route-level regression proving malformed paid-report query input reaches neither initializeDatabase nor SQL
    status: completed
  - id: verify-paid-report-route
    content: Run the focused paid-purchase-reports test and whitespace validation
    status: completed
isProject: false
---

# Validate Paid-Report Query Inputs

## Goal
Reject malformed `buyer` and `purchaseId` query parameters at the `GET /api/skills/[id]/paid-reports` handler boundary, before database initialization and the skill UUID query, while preserving the route's existing client-error response.

## Scope
- In scope: `web/app/api/skills/[id]/paid-reports/route.ts` input ordering and its focused API tests.
- Out of scope: changing Base report semantics, database schema, on-chain reads, or other paid-report routes.

## Files To Change
- `web/app/api/skills/[id]/paid-reports/route.ts`: validate `buyer` and `purchaseId` before `initializeDatabase()` and `fetchSkill()`.
- `web/__tests__/api/paid-purchase-reports.test.ts`: cover malformed query input and assert no database initialization or SQL occurs.

## Implementation Steps
1. Preserve the existing UUID boundary guard for `id`.
2. Parse and validate the `buyer` and `purchaseId` query values immediately after that guard, inside the route's existing error-to-400 contract.
3. Only after all request identifiers validate, initialize the database and load the skill; reuse the validated values for the subsequent Base preflight/index calls.
4. Add a focused regression for malformed query input that checks the exact `400` error shape and confirms the database mocks were untouched.

## Verification
- `npm test --workspace @agentvouch/web -- __tests__/api/paid-purchase-reports.test.ts --maxWorkers=1 --no-fileParallelism`
- `git diff --check`

## Rollout
Ship as a focused request-boundary hardening PR. It changes no schema, chain state, or live configuration.

## Rollback
Revert the single PR commit if the API contract unexpectedly diverges; no migration or data cleanup is required.

## Blockers
- None identified. The existing route already returns `400` for invalid Base identifiers; this change only moves validation ahead of database work.

## Evidence
- Verified 2026-08-14: the route validates `id` at `route.ts:40-45`, but validates `buyer` and `purchaseId` only after `initializeDatabase()` and `fetchSkill()` at `route.ts:47-64`.
- Verified 2026-08-14: the adjacent test covers malformed route `id` but not malformed `buyer`/`purchaseId` query parameters (`web/__tests__/api/paid-purchase-reports.test.ts:145-159`).

## Completion Notes
- Completed 2026-08-14: extracted query parsing so `buyer` and `purchaseId` validate before `initializeDatabase()` and `fetchSkill()`, without moving database errors into the route's existing client-error handler.
- RED verified 2026-08-14: the new regression initially failed because `initializeDatabase` was called once for `buyer=not-an-address`.
- GREEN verified 2026-08-14: focused test, repository format/lint/typecheck, full web Vitest suite (125 files / 905 tests), `git diff --check`, and the webpack production build passed. The build retained its existing viem Tempo dynamic-import warning and expected missing-`DATABASE_URL` static-generation fallbacks; neither blocked completion.
