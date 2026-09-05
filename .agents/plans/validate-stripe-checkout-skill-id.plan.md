---
name: validate-stripe-checkout-skill-id
overview: "Reject malformed Stripe checkout skill identifiers at the API boundary before rate limiting, authentication, database initialization, or Stripe work."
todos:
  - id: confirm-checkout-id-contract
    content: Confirm the malformed skill-id failure and the repository UUID-boundary precedent
    status: completed
  - id: validate-checkout-skill-id
    content: Validate checkout skillId as a UUID before route side effects while preserving the existing missing-skillId contract
    status: completed
  - id: add-no-side-effect-regression
    content: Add a malformed-skillId regression proving no limiter, authentication, database, or Stripe session work occurs
    status: completed
  - id: verify-focused-change
    content: Run targeted and repository-required format, lint, typecheck, web-test, webpack-build, and whitespace checks
    status: completed
isProject: false
---

# Validate Stripe Checkout Skill ID

## Goal
Make `POST /api/stripe/checkout` reject a malformed `skillId` as a client error before it reaches the `skills.id::uuid` query, preventing a database cast failure from being reported as a server error.

## Scope
- In scope: UUID validation and regression coverage for the Stripe checkout request boundary.
- Out of scope: Stripe activation policy, live-pilot rules, checkout authentication, payment semantics, database schema, and any deployed Stripe configuration.

## Files To Change
- `web/app/api/stripe/checkout/route.ts`: import and apply the existing UUID validator immediately after the required `skillId` check.
- `web/__tests__/api/stripe-routes.test.ts`: add a malformed-ID regression that asserts the 400 response and no route-side effects.
- `.agents/plans/validate-stripe-checkout-skill-id.plan.md`: record implementation and verification state.

## Verified Gap (2026-08-26)
- `web/app/api/stripe/checkout/route.ts:92-95` only checks whether `skillId` is present; the first database query casts the unvalidated value using `${skillId}::uuid` at lines 201-213. PostgreSQL rejects non-UUID values, which the surrounding catch reports as a generic 500.
- The similar route `web/app/api/account/access-grants/[skillId]/route.ts:31` uses `isUuidLike()` at its route boundary.
- `web/__tests__/api/stripe-routes.test.ts:359-384` exercises missing IDs and disclosure failures but has no malformed-ID response or no-side-effect regression.
- Open PR #161 (inspected 2026-08-26) only normalizes a literal JSON `null` checkout body; it does not validate malformed nonempty skill IDs.

## Implementation Steps
1. Import `isUuidLike` from `@/lib/skillUrls` in the checkout route.
2. After preserving the current missing `skillId` 400 response, return `400 { error: "Invalid skillId" }` when the supplied ID is not UUID-shaped, before disclosure, rate-limit, session, wallet-auth, database, or Stripe work.
3. Add a targeted test with a non-UUID ID and valid disclosure/auth payload; assert `400`, the error, and zero calls to the rate limiter, wallet-auth verifier, DB initializer/query, and Stripe session creator.
4. Update todo status and this plan's dated execution note only after the stated verification commands pass.

## Verification
Run under Node 24 as required by `AGENTS.md`:
```bash
. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; }
npm test --workspace @agentvouch/web -- __tests__/api/stripe-routes.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria: malformed nonempty IDs return 400 rather than database-driven 500; no rate-limit, authentication, database, or Stripe-session dependency is invoked; existing checkout coverage and repository gates pass.

### Execution Note (2026-08-26)
- Added `isUuidLike()` validation immediately after the existing required-ID check. A malformed nonempty ID now returns `400 { error: "Invalid skillId" }` before disclosure validation, rate limiting, buyer-session lookup, wallet-signature verification, database initialization/querying, or Stripe-session creation.
- Updated the Stripe route test fixture from an invalid all-zero UUID to a valid v4 UUID because the new boundary validation correctly rejects the former. Added the no-side-effect malformed-ID regression.
- Verified under Node `v24.10.0`: targeted Stripe API suite (52 tests), format check, web lint, web typecheck, full web suite (128 files / 928 tests), and webpack production build passed. The build retained its existing `ox`/`viem` dynamic-dependency warning and expected local `DATABASE_URL` static-generation fallback logs. No live Stripe, card-payment, database, wallet, or deployment flow was run.

## Rollout
Ship as a focused request-boundary PR. No schema, environment, wallet, Stripe activation, or deployment change is required.

## Rollback
Revert the focused commit. The change affects only invalid client input before checkout side effects.

## Blockers
- None known as of 2026-08-26.
- No live Stripe checkout, card payment, database, wallet, or deployment flow will be run; verification is local route-level and build/test coverage only.
