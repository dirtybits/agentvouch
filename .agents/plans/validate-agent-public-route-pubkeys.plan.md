---
name: validate-agent-public-route-pubkeys
overview: "Reject malformed Solana public agent route parameters before identity or trust lookups can perform RPC or database work."
todos:
  - id: confirm-route-boundary-gap
    content: Confirm the identity and trust GET routes accept malformed Solana wallet path parameters and identify the shared validation helper
    status: completed
  - id: validate-public-agent-params
    content: Validate the public identity and trust GET route pubkeys before downstream lookups
    status: completed
  - id: add-no-side-effect-regressions
    content: Add route regressions proving malformed pubkeys return 400 without trust, identity, or dispute work
    status: completed
  - id: verify-focused-change
    content: Run the focused tests plus format, lint, typecheck, full web tests, webpack build, and git whitespace checks
    status: completed
isProject: false
---

# Validate Public Agent Route Public Keys

## Goal
Make public Solana agent identity and trust reads reject malformed wallet path parameters with a stable client error before they invoke trust, identity, or dispute helpers.

## Scope
- In scope: `GET /api/agents/[pubkey]/identity`, `GET /api/agents/[pubkey]/trust`, their adjacent tests, and this execution record.
- Out of scope: authenticated identity mutation behavior, GitHub-linking behavior, author-route changes, Base/EVM routing, database schema, RPC configuration, wallet authentication, and chain deployment.

## Files To Change
- `web/app/api/agents/[pubkey]/identity/route.ts`: validate the public GET path parameter before profile status and identity resolution.
- `web/app/api/agents/[pubkey]/trust/route.ts`: validate the public GET path parameter before trust, identity, or dispute reads.
- `web/__tests__/api/agent-identity-route.test.ts`: use a valid Solana fixture and add the malformed-param/no-side-effect regression.
- `web/__tests__/api/agent-trust-route.test.ts`: use a valid Solana fixture and add the malformed-param/no-side-effect regression.
- `.agents/plans/validate-agent-public-route-pubkeys.plan.md`: retain scoped evidence and exact validation results.

## Verified Gap (2026-09-04)
- `GET /api/agents/[pubkey]/identity` passes `pubkey` directly to `verifyAuthorTrust` and `resolveAgentIdentityByWallet` (`web/app/api/agents/[pubkey]/identity/route.ts:21-25`). A direct local handler probe with `not-a-wallet` returned `200` with a synthetic fallback identity rather than rejecting the invalid public key.
- `GET /api/agents/[pubkey]/trust` immediately calls `resolveAuthorTrust`, `resolveAgentIdentityByWallet`, and `listAuthorDisputesByAuthor` with its unchecked path parameter (`web/app/api/agents/[pubkey]/trust/route.ts:19-24`).
- `isValidChainAddress` validates a Solana address locally and is the established API-boundary helper (`web/lib/chainAddress.ts:62-72`); the configured Solana context is available from `getConfiguredSolanaChainContext`.
- Open PRs #157–#169 were checked on 2026-09-04. #169 hardens the distinct `/api/author/[pubkey]` route; none changes these public `/api/agents/[pubkey]` GET handlers.

## Implementation Steps
1. Import `getConfiguredSolanaChainContext` and `isValidChainAddress` in each public GET route.
2. Reject a malformed `pubkey` with `400 { error: "Agent routes require a valid Solana address" }` before calling any downstream helper.
3. Update success fixtures to a valid Solana public key, then assert malformed parameters perform no downstream lookup work.

## Verification
Run under the repository-required Node 24 environment:
```bash
. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; }
npm test --workspace @agentvouch/web -- __tests__/api/agent-identity-route.test.ts __tests__/api/agent-trust-route.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria: malformed public-agent path parameters return the documented `400`, make no downstream calls, valid Solana reads retain their responses, and the full local web gate passes.

### Execution Note (2026-09-04)
- Both public GET handlers now validate against `getConfiguredSolanaChainContext()` via the shared `isValidChainAddress` helper before invoking trust, identity, or dispute work.
- The focused regression suite passed: `__tests__/api/agent-identity-route.test.ts` plus `__tests__/api/agent-trust-route.test.ts` (17 tests). The change was developed test-first: each new malformed-param regression failed with the old `200` response before the handlers were updated.
- `npm run format:check`, `npm run lint:web`, and `npm run typecheck` passed. The full web suite passed (128 files, 929 tests), followed by `npm exec --workspace @agentvouch/web -- next build --webpack` and `git diff --check`.
- The build retained the repository's existing `ox` dynamic-dependency warning and expected static-generation `DATABASE_URL` fallback logs because local database credentials are absent. No live Solana RPC, database, browser, wallet, or deployment flow was run.

## Rollout
Ship as a focused request-boundary-hardening PR. No environment, schema, money-flow, chain deployment, or authenticated mutation change is included.

## Rollback
Revert the focused commit. No stored data or deployment state needs rollback.

## Blockers
- No live Solana RPC, database, browser, wallet, or deployment flow is required for this handler-boundary change; behavior will be verified by route tests.
