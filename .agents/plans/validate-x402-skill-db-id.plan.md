---
name: validate-x402-skill-db-id
overview: "Reject malformed Base x402 skill UUIDs at the shared request boundary so verify and settle return a client error before PostgreSQL UUID casts or payment work."
todos:
  - id: validate-shared-skill-id
    content: Validate Base x402 skill ID aliases with the existing UUID boundary helper before routes can load a listing — completed 2026-09-01
    status: completed
  - id: add-route-regressions
    content: Cover malformed Base x402 skill IDs for verify and settle and prove no database/payment helper executes — targeted test passed 2026-09-01
    status: completed
  - id: verify-focused-change
    content: Run targeted x402 tests plus formatting, lint, typecheck, full web tests, webpack build, and diff checks — completed 2026-09-01
    status: completed
isProject: false
---

# Validate Base x402 Skill Database IDs

## Goal
Return a client-error response for malformed `skillDbId`/`skill_id`/`skillId` values used by the Base x402 verify and settle flows, instead of allowing an invalid value to reach PostgreSQL's `::uuid` cast and the routes' generic `500` handler.

## Scope
- In scope: shared Base x402 body parsing, x402 verify/settle regression coverage, and this execution record.
- Out of scope: legacy Solana proof behavior, Base payment-payload semantics, database schema changes, live payment flows, and broader x402 refactoring.

## Files To Change
- `web/lib/baseX402Api.ts`: distinguish malformed Base x402 skill ID aliases from absent IDs with the existing UUID boundary helper.
- `web/app/api/x402/verify/route.ts`: reject malformed Base x402 skill IDs before selecting legacy or Base payment work.
- `web/app/api/x402/settle/route.ts`: apply the same exclusive malformed-ID rejection before settlement logic.
- `web/__tests__/api/x402-routes.test.ts`: retain the real shared parser while mocking payment/database dependencies; add no-side-effect malformed-ID cases for both routes.
- `.agents/plans/validate-x402-skill-db-id.plan.md`: keep implementation and verification state current.

## Verified Gap (2026-09-01)
- `getBaseX402SkillIdFromBody` accepted any non-empty string, and both routes passed that string to `loadBaseX402Skill`.
- `loadBaseX402Skill` uses `WHERE id = ${skillDbId}::uuid`; an invalid value can therefore throw before an x402 client-error response is selected.
- The existing merged invalid-body hardening in PR #153 covers malformed JSON and literal `null`, not malformed UUID-shaped Base skill IDs. Open PRs #157–166 do not modify these x402 routes or helper.

## Implementation Steps
1. Apply `isUuidLike` at the shared Base x402 skill-ID extraction boundary after trimming an accepted alias.
2. Change the x402 route test mock to preserve the actual parser while substituting only I/O/payment helpers.
3. Add table-driven malformed-ID assertions for `POST /api/x402/verify` and `POST /api/x402/settle`, using a valid object payment payload to select the Base branch. Assert `400` and no listing load, payment verification, entitlement, settlement, or relay helper call.

## Verification
- `npm test --workspace @agentvouch/web -- __tests__/api/x402-routes.test.ts --maxWorkers=1 --no-fileParallelism`
- `npm run format:check`
- `npm run lint:web`
- `npm run typecheck`
- `npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism`
- `npm exec --workspace @agentvouch/web -- next build --webpack`
- `git diff --check`

## Execution Notes (2026-09-01)
- Implemented shared raw-ID extraction plus UUID validation so malformed nonempty aliases are distinguishable from absent IDs. Both Base x402 routes now return `400 { error: "Invalid skillDbId" }` before legacy-proof selection, listing lookup, payment verification, entitlement lookup, or settlement work.
- The regression keeps the real shared parser and covers both routes with an invalid ID and object Base payload; all listed payment/database mocks remain uncalled.
- Verification passed: targeted x402 routes (6 tests), Prettier, web ESLint, web typecheck, full web Vitest suite (128 files / 929 tests), webpack production build, and `git diff --check`. The build retained the repository's existing `ox`/`viem` dynamic-import warning and expected static-generation `DATABASE_URL` fallbacks; no live database or payment flow ran.

## Rollout
Merge as a normal API hardening PR. The change narrows only malformed Base x402 input before any database or payment helper work; no feature flag, deployment, or migration is required.

## Rollback
Revert the focused commit to restore the prior parser behavior. No persistent data or external payment state is changed by rejected requests.

## Blockers
None identified. A live Base x402 transaction is intentionally out of scope because this change rejects malformed request data before payment verification or settlement.
