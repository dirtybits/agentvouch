---
name: validate-author-route-pubkey
overview: "Reject malformed Solana author route parameters before trust, dispute, and identity lookups can perform RPC or database work."
todos:
  - id: confirm-route-boundary-gap
    content: Confirm the current GET route accepts any non-EVM path value and identify the established chain-address validation helper
    status: completed
  - id: validate-solana-author-param
    content: Validate non-EVM author route parameters before Solana trust, dispute, or identity lookups
    status: completed
  - id: add-no-side-effect-regression
    content: Add a focused GET regression proving malformed Solana author parameters return 400 without downstream lookups
    status: completed
  - id: verify-focused-change
    content: Run the targeted author route test plus format, lint, typecheck, full web tests, webpack build, and git whitespace checks
    status: completed
isProject: false
---

# Validate Author Route Public Keys

## Goal
Make `GET /api/author/[pubkey]` reject a malformed non-EVM path parameter with a client-error response before it can invoke Solana trust, dispute, or identity helpers.

## Scope
- In scope: the public author GET boundary and its adjacent route test.
- Out of scope: author-trust semantics, Base/EVM lookup behavior, database schema, RPC configuration, wallet auth, and chain deployment work.

## Files To Change
- `web/app/api/author/[pubkey]/route.ts`: validate the Solana-default branch with the shared chain-address helper before downstream work.
- `web/__tests__/api/author-route.test.ts`: cover the malformed-Solana-param `400` contract and no-side-effect invariant.

## Verified Gap (2026-09-03)
- The route treats any non-EVM-shaped `pubkey` as the Solana path and immediately calls `resolveAuthorTrust`, `listAuthorDisputesByAuthor`, and `resolveAgentIdentityByWallet` (`web/app/api/author/[pubkey]/route.ts:88-100`).
- The shared `isValidChainAddress` helper already validates Solana addresses without adapter or network work (`web/lib/chainAddress.ts:62-72`), but this route does not use it.
- The route test covers successful Solana-style reads and EVM validation but has no malformed-Solana-path regression (`web/__tests__/api/author-route.test.ts:117-143`).
- As of 2026-09-03, no open PR changes these files; open PRs #157–#168 cover distinct request-body, ID, numeric-input, docs, and UI seams.

## Implementation Steps
1. Import the shared chain-address validation helper and configured Solana chain context.
2. After the EVM branch, reject a non-Solana-valid `pubkey` with a stable `400` response before any trust, dispute, or identity helper runs.
3. Add one test using an invalid author path parameter. Assert the exact response and zero calls to the three downstream lookup mocks.

## Verification
Run under the repository-required Node 24 environment:
```bash
. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; }
npm test --workspace @agentvouch/web -- __tests__/api/author-route.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria: a malformed Solana-default route parameter returns `400`, runs no downstream trust/dispute/identity lookup, valid Solana and Base author requests retain their contracts, and the full local web gate passes.

### Execution Note (2026-09-03)
- The route now calls `isValidChainAddress` with the configured Solana context before Solana trust, dispute, or identity lookups. Base/EVM routing remains unchanged.
- The focused test passed: `web/__tests__/api/author-route.test.ts` (7 tests).
- `npm run format:check`, `npm run lint:web`, and `npm run typecheck` passed. The full web suite passed (128 files, 928 tests), followed by a successful `npm exec --workspace @agentvouch/web -- next build --webpack` and `git diff --check`.
- The webpack build retained existing `ox`/`viem` dynamic-dependency warnings and expected static-generation `DATABASE_URL` fallback logs because local database credentials are absent. No live Solana RPC, browser, wallet, database, or deployment flow was run.

## Rollout
Ship as a focused public request-boundary hardening PR. It adds no schema, environment, money-flow, or chain deployment changes.

## Rollback
Revert the focused commit to restore the prior public-route behavior. No stored data or deployment state requires rollback.

## Blockers
- No live Solana RPC or browser flow will be run; this is verified through route-level behavior and no-side-effect tests.
