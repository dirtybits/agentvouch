---
name: validate-nested-connected-repo-pubkeys
overview: "Reject malformed Solana wallet path parameters before request parsing, authentication, database work, or repository mutation in nested connected-repository routes."
todos:
  - id: add-nested-pubkey-guards
    content: Add established Solana address boundary guards to nested disconnect and sync handlers.
    status: completed
  - id: add-pubkey-regressions
    content: Add focused no-side-effect tests for malformed nested wallet path parameters.
    status: completed
  - id: verify-nested-hardening
    content: Run the focused test, formatting, lint, typecheck, full web tests, webpack build, and diff check — completed; webpack prerender was blocked only by the absent local DATABASE_URL.
    status: completed
isProject: false
---

# Validate Nested Connected-Repository Pubkeys

## Goal
Make the nested connected-repository mutation routes reject malformed Solana `pubkey` path parameters with the route family's existing `400` response before parsing a body, verifying a wallet signature, initializing the database, or performing a disconnect/sync action.

## Scope
- In scope: `DELETE /api/agents/[pubkey]/repos/[id]`, `POST /api/agents/[pubkey]/repos/[id]/sync`, and their focused Vitest regressions.
- Out of scope: repository-ID validation, body normalization, sync semantics, schema changes, and the parent `/repos` route, which already has the same pubkey guard in PR #178.

## Verified Gap (2026-09-11)
- `web/app/api/agents/[pubkey]/repos/route.ts` validates the parent `POST` `pubkey` before `request.json()` and `verifyConnectAuth`.
- Its nested `DELETE` and sync `POST` siblings resolve the same unvalidated `pubkey`, then call `verifyConnectAuth` after body parsing. They only validate `id` before that work.
- Open PR #178 covers the parent connect handler only; open PRs #177 and #182 harden other agent route siblings. No open PR covers these two nested handlers.

## Files To Change
- `web/app/api/agents/[pubkey]/repos/[id]/route.ts`: validate the resolved wallet path parameter before ID handling or request parsing.
- `web/app/api/agents/[pubkey]/repos/[id]/sync/route.ts`: apply the same early guard.
- `web/__tests__/api/connected-repos-skip-review.test.ts`: assert malformed wallet paths return the established `400` and invoke no parsing/auth/database/repository helpers.

## Implementation Steps
1. Import and use `isValidChainAddress` with `getConfiguredSolanaChainContext`, matching the parent connected-repo route.
2. After resolving params in each nested handler, return `{ error: "Agent routes require a valid Solana address" }` with status `400` when invalid, before `isUuidLike`, body parsing, auth verification, or database work.
3. Add direct mocked-request regressions for sync and disconnect. Assert the exact response and no downstream calls.

## Implementation Notes
- **2026-09-11:** The first focused test run showed the shared `PUBKEY` fixture was intentionally malformed before nested handlers had the route-boundary guard. Replaced it with the active valid Solana program ID so all happy-path nested tests continue to exercise authentication and sync logic. This mirrors the valid-fixture correction in open PR #178; the one-line overlap is intentional and produces the same tree when that parent-route hardening merges.

## Verification
With Node 24 active via the repository nvm command, run:
```bash
npm test --workspace @agentvouch/web -- __tests__/api/connected-repos-skip-review.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check origin/main...HEAD
```

Acceptance criteria: malformed nested wallet paths return the established `400`; no body parsing, signature verification, database initialization, repository fetch/delete, or sync runs; all feasible checks pass.

## Verification Results (2026-09-11)
- Targeted `connected-repos-skip-review` Vitest run: passed (11 tests), including both new no-side-effect malformed-wallet regressions.
- `npm run format:check`, `npm run lint:web`, and `npm run typecheck`: passed.
- Full web Vitest suite: passed (135 files, 986 tests).
- `npm exec --workspace @agentvouch/web -- next build --webpack`: compilation and TypeScript phases passed; static prerendering then failed at `/sitemap.xml` because this cron checkout lacks gitignored `web/.env.local` `DATABASE_URL`. The output also retained the pre-existing `ox` critical-dependency warning. This route-only change does not have a local full-build result; Vercel remains the deployment build gate.
- `git diff --check`: passed after the final plan update.

## Rollout
Ship through the standard focused PR and Vercel workflow. This is a request-boundary hardening change with no schema, protocol, feature-flag, or persistent-state rollout.

## Rollback
Revert the focused commit. No migration or state repair is required.

## Blockers
- Stop if a nested handler's public error contract differs from the parent route's established invalid-pubkey response.
- Do not expand this PR to other `[pubkey]` route families; they require separate evidence and review.
