---
name: defer-api-key-db-init
overview: "Defer GET /api/keys database initialization until a validated authentication path needs SQL, preventing unauthenticated requests from invoking the runtime schema initializer."
todos:
  - id: add-auth-rejection-tests
    content: Add GET /api/keys regressions proving malformed or invalid authentication returns before database initialization.
    status: completed
  - id: defer-database-initialization
    content: Move initializeDatabase calls into only the signed-auth and bearer-key branches immediately before their first SQL operation.
    status: completed
  - id: verify-api-key-route
    content: Run targeted API-key tests plus formatting, lint, typecheck, full web Vitest, webpack build, and diff checks.
    status: completed
isProject: false
---

# Defer unauthenticated API-key database initialization

## Goal
Ensure `GET /api/keys` rejects malformed, invalid, or absent credentials before it invokes `initializeDatabase()`. Valid signed-header and bearer API-key requests must keep their existing nonce and listing behavior.

## Scope
- In scope: the API-key list route and its route tests.
- Out of scope: schema changes, API-key authentication semantics, rate-limit policy, and any API-key create/revoke behavior.

## Files To Change
- `web/app/api/keys/route.ts`: initialize the database only in authenticated branches that are about to consume a nonce or query API-key ownership.
- `web/__tests__/api/keys-route.test.ts`: prove rejected GET authentication cases leave `initializeDatabase` and SQL untouched.

## Verified Gap
- **Verified 2026-08-27:** `GET /api/keys` calls `initializeDatabase()` at `web/app/api/keys/route.ts:206`, before parsing `X-AgentVouch-Auth`, validating a wallet signature/scope, checking a bearer key, or returning its existing `401`/`400` errors.
- **Verified 2026-08-27:** `POST` and `DELETE` in the same route defer initialization until after their request/auth validation (`route.ts:156` and `route.ts:327`), providing the local precedent.

## Implementation Steps
1. Add focused tests for malformed header, invalid signed authentication, and absent credentials that assert no database initialization or SQL work occurs.
2. Remove the eager GET initializer. Add it immediately before `consumeApiKeyAuthNonce` in the valid signed-auth path and immediately before the bearer-key lookup in the bearer path.
3. Preserve response status/payloads and the signed nonce replay invariant.

## Verification
Run with Node 24 selected using the repository `nvm` command:

```bash
npm test --workspace @agentvouch/web -- __tests__/api/keys-route.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria: rejected GET credentials do not call `initializeDatabase` or `sql`; valid signed-header and bearer-key tests remain green; all repository checks above pass.

## Rollout
Merge through the normal PR/Vercel pipeline. The change is request-ordering only and does not require configuration, migration, or deployment action outside the normal web release.

## Rollback
Revert the focused commit if a production authentication path unexpectedly depends on eager initialization. No data migration or state rollback is required.

## Blockers
None materialized.

## Completion Note
- **Verified 2026-08-27:** targeted `__tests__/api/keys-route.test.ts` passed (24 tests); format check, web lint, web typecheck, full web Vitest (128 files / 928 tests), webpack production build, and `git diff --check` passed.
- The webpack build retained its existing `ox`/`viem` dynamic-dependency warning and logged the expected static-generation fallback messages because local `DATABASE_URL` is absent; compilation and build exit status were successful.
- No live API-key, wallet, database, or deployment flow was run.