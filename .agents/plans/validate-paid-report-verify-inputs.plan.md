---
name: validate-paid-report-verify-inputs
overview: "Reject malformed Base paid-report verification transaction and purchase identifiers before database bootstrap on the public idempotent endpoint."
todos:
  - id: validate-identifiers
    content: "Validate txHash and purchaseId format at the route boundary before initializeDatabase"
    status: completed
  - id: add-regression
    content: "Add a regression test proving malformed present identifiers do not initialize or query the database"
    status: completed
  - id: verify-route
    content: "Run the focused paid-purchase report test file and repository formatting/type checks"
    status: completed
  - id: publish-pr
    content: "Commit the focused change, push it, open a pull request, and inspect CI status"
    status: completed
isProject: false
---

# Validate Paid-Report Verification Inputs

## Goal
Reject syntactically malformed `txHash` and `purchaseId` values in `POST /api/skills/[id]/paid-reports/verify` before database initialization, preserving the endpoint's existing client-error contract and avoiding needless database/bootstrap work from public invalid requests.

## Scope
- In scope: boundary validation in `web/app/api/skills/[id]/paid-reports/verify/route.ts` and its focused Vitest coverage in `web/__tests__/api/paid-purchase-reports.test.ts`.
- Out of scope: changes to Base protocol verification, database schema/initializers, contract code, or report semantics.

## Files To Change
- `web/app/api/skills/[id]/paid-reports/verify/route.ts`: validate present `txHash` as 32-byte hex and `purchaseId` as Base bytes32 before `initializeDatabase()`.
- `web/__tests__/api/paid-purchase-reports.test.ts`: cover malformed-but-present identifiers and assert no bootstrap or SQL call occurs.
- `.agents/plans/validate-paid-report-verify-inputs.plan.md`: keep status and dated closeout evidence current.

## Implementation Steps
1. Reuse the same 32-byte hex constraints enforced downstream by `verifyAndIndexBasePaidPurchaseReport` and `requireBaseBytes32`; do not loosen accepted input or change success-path verification.
2. Return the existing route-level 400 response shape for malformed identifiers before `initializeDatabase()`.
3. Add a focused regression that submits otherwise-present invalid strings and proves the verifier, database initializer, and SQL mock are untouched.

## Execution Notes
- **2026-09-19:** Added route-level 32-byte-hex validation after required-field parsing and before database initialization. The red regression failed on current main with HTTP 200; after the change, the focused test file passes all 8 tests.

## Verification
- `npm test --workspace @agentvouch/web -- __tests__/api/paid-purchase-reports.test.ts --maxWorkers=1 --no-fileParallelism`
- `npm run format:check`
- `npm run lint:web`
- `npm run typecheck --workspace @agentvouch/web`
- `git diff --check`

**2026-09-19 verification:** focused paid-report tests passed (9 tests); full web suite passed (138 files, 1,027 tests); Prettier, web ESLint, TypeScript, and `git diff --check` passed. `next build --webpack` compiled and completed TypeScript, but static prerendering failed at `/sitemap.xml` because this checkout has no `DATABASE_URL` in `web/.env.local`; no build artifact was accepted as a pass. PR #197 was opened and its required checks passed: `contracts` (1m26s), `test` (1m46s), and Vercel deployment.

## Rollout
Normal PR/Vercel rollout. Valid requests continue into the existing exact on-chain verifier; malformed public requests fail earlier with HTTP 400.

## Rollback
Revert the focused commit. No migration, deployment, or persisted data change is involved.

## Blockers
- None identified. Verified 2026-09-19: the route currently calls `initializeDatabase()` after only string-presence checks (`route.ts:60-69`), while downstream verification rejects invalid `txHash` and `purchaseId` formats (`web/lib/basePaidPurchaseReportVerification.ts:117-124,423-433`).
