---
name: normalize-connected-repo-body
overview: "Return the existing missing-auth client error for malformed or literal-null connect-repo request bodies before database or sync work begins."
todos:
  - id: harden-request-body
    content: Normalize malformed and literal-null JSON to an empty body before connect-repo authentication.
    status: completed
  - id: add-regression
    content: Add a route regression that proves a literal-null body returns 400 without database, ownership, creation, or sync work.
    status: completed
  - id: verify-change
    content: Run the targeted route test, formatting, relevant web lint/typecheck, full web tests/build, and diff checks.
    status: completed
isProject: false
---

# Normalize Connected-Repo Request Bodies

## Goal
Make `POST /api/agents/[pubkey]/repos` treat malformed and literal-`null` JSON as an empty request body, so the established missing-auth `400` contract applies before any database, GitHub ownership, or repository-sync work.

## Scope
- In scope: request-body normalization in the connect-repo route and a no-side-effect literal-null regression.
- Out of scope: changing connected-repo authentication semantics, repository-coordinate validation, database schema, or sync behavior.

## Files To Change
- `web/app/api/agents/[pubkey]/repos/route.ts`: safely parse and normalize the request body before `verifyConnectAuth`.
- `web/__tests__/api/connected-repos-skip-review.test.ts`: cover literal JSON `null` and assert no protected downstream calls run.

## Verified Gap (2026-08-15)
`route.ts` directly casts `await request.json()` and then reads `body.auth`. A syntactically valid JSON body of `null` throws before `verifyConnectAuth`, reaches the outer handler, and returns `500`. `verifyConnectAuth` documents the established missing-auth response as `400`, and the sibling sync route already safely catches malformed JSON before auth validation.

## Implementation Steps
1. Normalize parser failures and literal `null` to `{}` at the route boundary.
2. Add a route-level literal-null regression that expects `{ error: "Missing required field: auth" }`, status `400`, and no database, ownership, creation, or sync calls.
3. Run focused and repository-appropriate static checks.

## Verification
- `npm test --workspace @agentvouch/web -- __tests__/api/connected-repos-skip-review.test.ts --maxWorkers=1 --no-fileParallelism`
- `npm run format:check`
- `npm run lint:web`
- `npm run typecheck`
- `git diff --check`

## Rollout
Merge as a request-boundary-only web change. No deployment configuration or live transaction is required.

## Rollback
Revert the single focused commit; no schema, data, or external state changes are involved.

## Blockers
None identified. This plan does not exercise a live GitHub ownership verification or sync; the regression verifies that invalid input cannot reach those helpers.

## Execution Notes
- **2026-08-15:** Implemented the safe parse in the connect-repo route and added the literal-null no-side-effect regression. Targeted test, format, lint, typecheck, full web Vitest suite (125 files / 905 tests), webpack production build, and `git diff --check` passed. The build emitted the pre-existing viem Tempo dynamic-import warning and expected local `DATABASE_URL` static-generation fallbacks; no live GitHub or sync flow was run.
