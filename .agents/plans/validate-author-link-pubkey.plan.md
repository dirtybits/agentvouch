---
name: validate-author-link-pubkey
overview: "Reject malformed Solana public keys at the parent author identity-link POST boundary before body parsing, signature verification, or trust/registry work."
todos:
  - id: confirm-parent-route-gap
    content: Confirm the parent author identity-link POST lacks the sibling Solana path-param guard — completed 2026-09-14
    status: completed
  - id: validate-author-link-param
    content: Add the shared Solana address guard and route regression while preserving valid identity-link behavior — focused test passed 2026-09-14
    status: completed
  - id: verify-author-link-guard
    content: Run the focused route test, required web checks, git whitespace check, and PR CI verification
    status: in_progress
isProject: false
---

# Validate Parent Author Identity-Link Public Key

## Goal
Make `POST /api/author/[pubkey]` reject a malformed Solana path parameter with its established `400` contract before it parses a body, verifies a wallet signature, or calls trust/registry identity helpers.

## Scope
- In scope: parent author identity-link POST boundary, its route-level regression coverage, and this execution plan.
- Out of scope: author-trust semantics, Solana registry discovery behavior, EVM author routes, database schema, chain deployment, and wallet-auth protocol changes.

## Files To Change
- `web/app/api/author/[pubkey]/route.ts`: validate the POST `pubkey` using the existing configured-Solana `isValidChainAddress` convention before request-body parsing.
- `web/__tests__/api/author-route.test.ts`: use a valid Solana fixture in POST happy-path tests and add a no-side-effect malformed-path regression.
- `.agents/plans/validate-author-link-pubkey.plan.md`: record execution state and evidence.

## Verified Gap (2026-09-14)
- The parent identity-link POST obtains `pubkey` then immediately parses request JSON at `web/app/api/author/[pubkey]/route.ts:153-159`, and can subsequently run `verifyWalletSignature`, `verifyAuthorTrust`, and registry discovery/link helpers.
- The same file's GET route already rejects invalid Solana addresses through `isValidChainAddress({ chainContext: getConfiguredSolanaChainContext(), value: pubkey })` before downstream work (`:90-100`).
- The nested `POST /api/author/[pubkey]/discover-registry` received the same boundary hardening in open PR #185; its PR description identifies parent author identity linking as a related sibling but the parent POST has no corresponding guard.
- Existing parent-POST tests use `Author111`, an invalid Solana address, so fixtures must become a real valid address to preserve coverage below the new boundary.

## Implementation Steps
1. Add the same configured-Solana `isValidChainAddress` guard at the start of the parent POST, returning the established `400` error before `request.json()`.
2. Replace parent-POST valid-path fixtures with the deployed valid AgentVouch Solana public key already used by the adjacent GET test.
3. Add a regression that passes an invalid route param and a spy JSON body; assert the exact `400` response and zero calls to body parsing, signature verification, trust checks, discovery, and identity linking.
4. Update todo statuses and this plan's execution note immediately after verification.

## Verification
Run with the repository-required Node 24 environment:
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

### Execution Status (2026-09-14)
- Focused route test passed (8 tests); `npm run format:check`, `npm run lint:web`, `npm run typecheck`, and the full web Vitest suite passed (135 files, 985 tests).
- `npm exec --workspace @agentvouch/web -- next build --webpack` compiled successfully but failed while prerendering `/sitemap.xml` because this sole worktree has no `web/.env.local` or other local env source and `DATABASE_URL` is required. This is an environment blocker, not a successful build; CI/Vercel must provide the final build evidence.
- `git diff --check` passed after formatting the focused test.

Acceptance criteria: malformed parent author route params return the established `400` before body/auth/trust/registry work; valid identity-link behavior still reaches its existing mocked helpers; required checks are recorded with their actual outcomes.

## Rollout
Ship as a focused request-boundary PR. It changes neither stored data nor chain/money behavior.

## Rollback
Revert the focused commit. No migration, deployment, or stored-state cleanup is required.

## Blockers
- A live Solana RPC/browser/wallet flow is outside this route-level hardening change. State any unavailable local environment checks precisely rather than treating them as passes.
