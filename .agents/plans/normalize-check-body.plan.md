---
name: normalize-check-body
overview: "Harden POST /api/check so a JSON literal null is rejected as a client error before database initialization or scan work."
todos:
  - id: confirm-request-contract
    content: Confirm the null-body failure and the route's existing invalid-body contract
    status: completed
  - id: normalize-request-body
    content: Reject a literal-null JSON check body before database initialization
    status: completed
  - id: add-no-side-effect-regression
    content: Add a literal-null regression proving database and scan helpers do not run
    status: completed
  - id: verify-focused-change
    content: Run targeted and repository-required checks for the focused route hardening
    status: completed
isProject: false
---

# Normalize `/api/check` Request Body

## Goal

Make `POST /api/check` reject a valid JSON literal `null` with a client-error response before database initialization, trust resolution, or scan-budget work occurs.

## Scope

- In scope: literal-null validation in the bounded JSON parser and one focused route regression.
- Out of scope: scan policy, rate limits, trust semantics, database schema, client behavior, and other API routes.

## Files To Change

- `web/app/api/check/route.ts`: reject a parsed JSON literal `null` before returning it as `CheckRequestBody`.
- `web/__tests__/api/check-route.test.ts`: cover a literal-null body and assert no database or scan side effects.

## Verified Gap (2026-08-22)

- `readBoundedJsonBody` casts the result of `JSON.parse` to `CheckRequestBody` without checking its runtime shape (`web/app/api/check/route.ts:101-138`). JSON literal `null` therefore reaches `POST` and `body.tree_hash` at line 421 after `initializeDatabase()` has already run at line 419.
- Accessing `tree_hash` on `null` throws a `TypeError`, which the outer handler maps to a `500` (`web/app/api/check/route.ts:499-508`), rather than treating the client body as invalid.
- The route's existing `CheckRequestError` maps request-body failures to client errors before database initialization; the oversized-body regression already verifies that boundary (`web/__tests__/api/check-route.test.ts:175-187`).
- GitHub search on 2026-08-22 found no open or historical focused PR for this route-body issue; the only current API body PR is #157 for `PATCH /api/skills/[id]`.

## Implementation Steps

1. In `readBoundedJsonBody`, preserve the existing bounded stream read and malformed-JSON handling, then reject only a parsed literal `null` with `CheckRequestError("JSON body must be an object", 400)`. Other JSON values retain their pre-existing behavior.
2. Add a route test posting raw `null`; assert `400`, the object-body error, and zero calls to `initializeDatabase`, SQL, trust resolution, scan-cache lookup, heuristic scan, or model scan helpers.
3. Keep valid object request behavior unchanged.

## Verification

Run under Node 24, per `AGENTS.md`:

```bash
. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; }
npm test --workspace @agentvouch/web -- __tests__/api/check-route.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria: a literal-null request returns `400` without database, trust, or scan side effects; all existing check-route behavior stays green; formatting, lint, typecheck, full tests, the webpack build, and whitespace checks pass.

### Execution Note (2026-08-22)

`readBoundedJsonBody` now treats only a parsed literal `null` as an invalid non-object body and raises the route's existing `CheckRequestError` before `initializeDatabase()`. This keeps the pre-existing behavior for other JSON values unchanged. The targeted route suite passed under Node `v24.10.0` (10 tests), with the new regression asserting no database, SQL, trust, cache, heuristic, or model-scan calls. `npm run format:check`, `npm run lint:web`, `npm run typecheck`, and `git diff --check` passed. The full web suite passed (128 files, 928 tests), and `next build --webpack` passed. The build emitted the repository's existing `ox`/`viem` dynamic-dependency warning and expected local static-generation `DATABASE_URL` fallback logs. No live AI scan or database flow was run.

## Rollout

Ship as a focused request-boundary hardening PR. It does not alter schemas, flags, chain behavior, or deployed contracts.

## Rollback

Revert the single focused commit. The behavior change is limited to invalid JSON-body handling.

## Blockers

- None known as of 2026-08-22.
- No live AI scan or database flow will run; validation is route-level only.
