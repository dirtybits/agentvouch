---
name: harden-connected-repo-route-boundaries
overview: "Reject malformed connected-repository IDs before database work and normalize sync's JSON body so invalid client input preserves its existing 4xx contract."
todos:
  - id: validate-nested-repo-id
    content: Add pre-database UUID validation to the nested disconnect and sync routes.
    status: completed
  - id: normalize-sync-body
    content: Normalize malformed and literal-null sync request bodies to the existing missing-auth contract.
    status: completed
  - id: add-route-regressions
    content: Add focused no-side-effect regressions for malformed IDs and null sync input.
    status: completed
  - id: verify-route-hardening
    content: Run the targeted test plus formatting, lint, typecheck, full web tests, webpack build, and diff checks.
    status: completed
isProject: false
---

# Harden Connected-Repository Nested Route Boundaries

## Goal
Make nested connected-repository routes reject invalid client input before authentication side effects, database initialization, PostgreSQL UUID casts, or a repository sync can run. Preserve existing route responses: an invalid repository ID is a `404 Connected repo not found for this wallet.` and missing `auth` is a `400 Missing required field: auth`.

## Scope
- In scope: `DELETE /api/agents/[pubkey]/repos/[id]` and `POST /api/agents/[pubkey]/repos/[id]/sync` input boundaries; their focused Vitest regression file.
- Out of scope: parent connect-route JSON parsing (already covered by open PR #150), data migrations, mirror synchronization behavior, and authentication semantics.

## Verified Gap (2026-08-19)
- `web/app/api/agents/[pubkey]/repos/[id]/route.ts` passes raw `id` to `deleteConnectedRepo` after initialization; `web/lib/mirror/connectedRepos.ts` casts that value with `::uuid`.
- `web/app/api/agents/[pubkey]/repos/[id]/sync/route.ts` likewise passes raw `id` to `getConnectedRepo`, which casts it with `::uuid`; it also calls `body.auth` after `request.json().catch(() => ({}))`, so valid JSON `null` throws into the outer `500` handler.
- A read-only probe reproduced the sync null-body `TypeError`; open PRs #144–#153 do not cover these nested handlers. PR #150 covers only the parent `/repos` route.

## Files To Change
- `web/app/api/agents/[pubkey]/repos/[id]/route.ts`: validate `id` at the route boundary before auth/database work.
- `web/app/api/agents/[pubkey]/repos/[id]/sync/route.ts`: validate `id` at the route boundary and coalesce parsed JSON to `{}` before reading `auth`.
- `web/__tests__/api/connected-repos-skip-review.test.ts`: extend mocks and route imports; prove invalid IDs return `404` without auth/database work and literal-null sync input returns the missing-auth `400` without database, lookup, deletion, or sync calls.

## Implementation Steps
1. Reuse `isUuidLike` from `@/lib/skillUrls`, matching the existing API UUID-boundary convention.
2. After resolving route params, return the existing connected-repo `404` response for a malformed `id`; do this before JSON parsing/auth verification and `initializeDatabase`.
3. In the sync handler, coalesce a successfully parsed literal `null` to `{}` while retaining the malformed-JSON fallback, so `verifyConnectAuth` receives `undefined` and returns its established missing-auth `400`.
4. Add direct route regressions for the malformed ID boundaries and sync literal-null input. Assert the exact response and no downstream calls.

> **Implementation note (2026-08-19):** The existing `REPO_ID` test fixture used UUID version 0 and therefore became invalid once the handlers adopted the shared `isUuidLike` boundary. It was updated to a valid version-4 UUID; no production identifier behavior diverged.

## Verification
Run with Node 24 activated by the repository-required nvm command:
```bash
npm test --workspace @agentvouch/web -- __tests__/api/connected-repos-skip-review.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```
Acceptance criteria: malformed IDs never reach authentication or database helpers; literal-null sync input returns the established `400` without downstream work; all listed commands exit successfully.

## Verification Results (2026-08-19)
- `npm test --workspace @agentvouch/web -- __tests__/api/connected-repos-skip-review.test.ts --maxWorkers=1 --no-fileParallelism`: passed (6 tests).
- `npm run format:check`, `npm run lint:web`, and `npm run typecheck`: passed.
- `npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism`: passed (125 files, 907 tests).
- `npm exec --workspace @agentvouch/web -- next build --webpack`: passed. It retained the pre-existing viem Tempo dynamic-import warning and local `DATABASE_URL` static-generation fallback messages; neither blocked the build.
- No live GitHub ownership verification or repository sync ran; the change rejects malformed input before those flows.

## Rollout
Deploy through the normal PR/Vercel workflow. The change is a request-boundary hardening with no schema or protocol rollout.

## Rollback
Revert the focused commit. No data migration, feature flag, or persistent state is involved.

## Blockers
- Stop if the existing handler contracts or test conventions show a different required status/body.
- Do not combine the parent connect-route null-body issue because it is already covered by open PR #150.
