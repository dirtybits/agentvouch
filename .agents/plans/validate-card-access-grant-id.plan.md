---
name: validate-card-access-grant-id
overview: "Avoid PostgreSQL UUID-cast failures and unnecessary access-grant reads by validating the card-access route's skill identifier before its database helper runs."
todos:
  - id: add-regression
    content: Add a focused route regression proving a malformed skill ID returns the established authenticated no-access response without calling the grant helper.
    status: completed
  - id: validate-skill-id
    content: Validate the dynamic skill ID immediately before the authenticated access-grant lookup while preserving disabled and unauthenticated responses.
    status: completed
  - id: verify-route-change
    content: Run the focused Vitest regression plus formatting, lint, typecheck, full web tests, webpack build, and diff checks.
    status: completed
isProject: false
---

# Validate Card Access-Grant Route Identifier

## Goal
Make the authenticated card-access status route reject an invalid repository skill identifier locally, rather than invoking a helper that casts the client-controlled value to PostgreSQL `uuid` and then swallowing the database error as `hasAccess: false`.

## Scope
- In scope: `GET /api/account/access-grants/[skillId]` and a focused Vitest route regression.
- Out of scope: access-grant schema/query semantics, session behavior, Stripe payment flows, and changing the endpoint's response schema or status codes.

## Verified Gap (2026-08-20)
- `web/app/api/account/access-grants/[skillId]/route.ts` passes `skillId` directly to `hasActiveMarketplaceAccessGrant` after a valid buyer session.
- `web/lib/buyerAccessGrants.ts:58` casts that dynamic value with `${skillDbId}::uuid`; invalid client input therefore issues a failing query before the route catches it and returns `hasAccess: false`.
- Open PRs #144–#155 were reviewed on 2026-08-20; none changes this route or its access-grant helper.

## Files To Change
- `web/app/api/account/access-grants/[skillId]/route.ts`: validate a session-authenticated `skillId` before calling the access-grant helper; retain the current disabled and unauthenticated early responses.
- `web/__tests__/api/buyer-access-grants-route.test.ts`: add a direct route test that asserts the same authenticated no-access response and no access-grant lookup for a malformed ID.
- `.agents/plans/validate-card-access-grant-id.plan.md`: maintain implementation state and verification evidence.

## Implementation Steps
1. Add a focused failing test using the existing route's three dependencies (`buyerAuthConfig`, `buyerSession`, and `buyerAccessGrants`). Configure the feature enabled and a valid session, call the route with a non-UUID ID, and assert `200`, `{ enabled: true, authenticated: true, hasAccess: false }`, and no grant-helper invocation.
2. Reuse `isUuidLike` from `@/lib/skillUrls` immediately after resolving `skillId` and before `hasActiveMarketplaceAccessGrant`.
3. Preserve feature-disabled (`503`) and unauthenticated (`200`, `authenticated: false`) contracts by leaving their early returns before the new validation.

## Verification
Activate Node 24 using the repository-required nvm command, then run:
```bash
npm test --workspace @agentvouch/web -- __tests__/api/buyer-access-grants-route.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria: a malformed ID reaches no grant helper/database query while the established response shape remains unchanged; all commands exit successfully.

## Verification Results (2026-08-20)
- Focused regression: passed (`1` test).
- `npm run format:check`, `npm run lint:web`, and `npm run typecheck`: passed.
- Full web suite: passed (`126` files, `905` tests).
- `npm exec --workspace @agentvouch/web -- next build --webpack`: passed. It retained the existing viem Tempo dynamic-import warning and expected static-generation `DATABASE_URL` fallbacks in this local environment.
- `git diff --check`: passed.
- No live Stripe, buyer session, database, or card-access flow was run; this change rejects malformed input before the access-grant helper query.

## Rollout
Ship through the normal PR/Vercel workflow. This is a request-boundary optimization and hardening change with no migration or feature flag change.

## Rollback
Revert the focused commit. No persistent state, migration, or protocol change is involved.

## Blockers
- Stop if existing route tests or callers require an invalid identifier to produce a response other than authenticated no-access.
- Do not modify access-grant SQL or session/auth behavior in this PR.
