---
name: normalize-purchase-verify-body
overview: "Harden the direct-purchase verification API so malformed and literal-null JSON are rejected before database initialization or verification work."
todos:
  - id: confirm-request-contract
    content: Confirm the route's current failure and the adjacent paid-report verifier's established request-boundary contract
    status: completed
  - id: normalize-request-body
    content: Parse and normalize the purchase-verification request body before database initialization while preserving its existing 400 responses
    status: completed
  - id: add-no-side-effect-regressions
    content: Add malformed-JSON and literal-null regressions proving database and purchase-verification helpers do not run
    status: completed
  - id: verify-focused-change
    content: Run the targeted API test plus format, lint, typecheck, full web test, webpack build, and git whitespace checks
    status: completed
isProject: false
---

# Normalize Purchase-Verification Request Body

## Goal
Reject malformed JSON and valid JSON literal `null` at `POST /api/skills/[id]/purchase/verify` with the route's existing client-error contract, before database initialization, SQL, or purchase-verification helpers can run.

## Scope
- In scope: request-body parsing order and regression coverage for the direct-purchase verification route.
- Out of scope: purchase verification semantics, chain selection, database schema, direct-purchase helpers, and other API endpoints.

## Files To Change
- `web/app/api/skills/[id]/purchase/verify/route.ts`: normalize a successfully parsed `null` body to `{}` and delay `initializeDatabase()` until after body validation.
- `web/__tests__/api/skills-purchase-verify.test.ts`: cover literal-null and malformed JSON bodies, including no-side-effect assertions.

## Verified Gap (2026-08-16)
- The route initializes the database at line 70 before parsing the body, then casts `await request.json()` directly at lines 72–80. A literal JSON `null` reaches `body.signature` at line 82 and throws; malformed JSON returns 400 only after initialization.
- The adjacent `paid-reports/verify` route normalizes `((await request.json()) ?? {})` and validates required fields before `initializeDatabase()` (`web/app/api/skills/[id]/paid-reports/verify/route.ts:51-69`).
- The focused test file has a normal missing-signature case but no malformed/literal-null no-side-effect coverage (`web/__tests__/api/skills-purchase-verify.test.ts:169-175`).

## Implementation Steps
1. Keep the existing JSON parse `try`/`catch` and its `400 Request body must be valid JSON` response, but assign `((await request.json()) ?? {})` to the typed body.
2. Read request fields and reject a body with neither a payment reference nor the buyer/listing data needed for an existing Base purchase before calling `initializeDatabase()`. Preserve valid Base existing-purchase requests, which legitimately omit a payment reference but include buyer and listing data.
3. Call `initializeDatabase()` only after the input has passed the request-boundary checks, preserving the subsequent repository and chain-only lookup behavior.
4. Extend the route test helpers/mocks as needed and add table-driven or paired tests for malformed JSON and literal `null`; assert `400`, the expected error, and zero calls to database initialization, SQL, or either purchase-verification helper.

## Verification
Run under Node 24 as required by `AGENTS.md`:
```bash
. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; }
npm test --workspace @agentvouch/web -- __tests__/api/skills-purchase-verify.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria: both invalid-body forms return their existing 400-shaped errors without database or verification side effects; existing purchase-verification tests remain green; format, lint, typecheck, full web tests, webpack build, and whitespace checks pass.

### Execution Note (2026-08-16)
The focused route test passed under Node `v24.10.0`: 5 tests passed, including the new literal-null and malformed-JSON no-side-effect regressions. `npm run format:check`, `npm run lint:web`, and `npm run typecheck` passed. The full web suite passed (125 files, 906 tests), and `next build --webpack` completed successfully. The build retained pre-existing/non-blocking warnings: viem Tempo's dynamic-import critical-dependency warning and expected static-generation database fallbacks because local `DATABASE_URL` is absent. No live purchase verification was run.

## Rollout
Ship as a focused request-boundary hardening PR. No schema, environment, flag, wallet, or chain deployment changes are required.

## Rollback
Revert the single focused commit. The change is isolated to client-input handling and test coverage.

## Blockers
- None known as of 2026-08-16.
- No live purchase verification will be run: this change is verified at the route boundary only.
