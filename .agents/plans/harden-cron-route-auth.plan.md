---
name: harden-cron-route-auth
overview: "Bring the two older Vercel-Cron endpoints in line with the operator-endpoint auth pattern: constant-time CRON_SECRET comparison and fail-closed auth on any deployed Vercel environment (production or preview), so preview deployments cannot run write-capable cron endpoints unauthenticated."
todos:
  - id: harden-cron-auth
    content: Replace the plain === Bearer comparison with constant-time timingSafeEqual and fail closed on VERCEL_ENV production or preview in both cron routes
    status: completed
  - id: update-cron-tests
    content: Update both cron test files so preview without a secret is rejected (401) and local development without a secret still runs
    status: completed
  - id: verify-cron-gates
    content: Run focused cron tests, formatting, lint, typecheck, and the full web vitest suite
    status: completed
  - id: publish-focused-pr
    content: Push the branch and open a focused PR with exact verification results
    status: in_progress
isProject: false
---

# Harden Vercel-Cron Endpoint Auth

## Goal
Make `/api/cron/refresh-snapshots` and `/api/cron/mirror-skills` authenticate the same way the newer operator endpoints (`/api/setup`, `/api/seed`, `/api/github/skills/discover`) already do: compare the `CRON_SECRET` Bearer token in constant time and fail closed whenever a secret is unset on any deployed Vercel environment. Both endpoints perform writes (mirror-skills creates listings and publishes versions; refresh-snapshots rewrites `platform_metrics_snapshot` and `author_trust_snapshots`), so an unauthenticated preview deployment is a real exposure, not a theoretical one.

## Scope
- In scope: `isAuthorized` in the two cron route files plus their two test files.
- Out of scope: extracting a shared `isAuthorized` helper (only four call sites exist; the repo keeps these helpers local and self-documenting per file), changing `vercel.json` cron schedules, adding new env vars, or touching money-moving settlement endpoints.

## Files To Change
- `web/app/api/cron/refresh-snapshots/route.ts`: import `timingSafeEqual`; add `timingSafeStringEqual`; compare the Bearer token in constant time; treat `VERCEL_ENV === "production" || VERCEL_ENV === "preview"` as deployed (fail closed); update the doc comment to match.
- `web/app/api/cron/mirror-skills/route.ts`: same four changes.
- `web/__tests__/api/cron-refresh-snapshots.test.ts`: the "preview without a secret" test must now expect 401; add a local-development (no `VERCEL_ENV`, no secret) success test; keep the production-fail-closed and valid-token tests.
- `web/__tests__/api/cron-mirror-skills.test.ts`: same test updates.

## Implementation Steps
1. In each route, replace `request.headers.get("authorization") === `Bearer ${secret}`` with a constant-time comparison (length-checked, then `timingSafeEqual`), mirroring `timingSafeStringEqual` in `web/app/api/setup/route.ts`.
2. In each route, change the deployed check from `VERCEL_ENV === "production"` to `VERCEL_ENV === "production" || VERCEL_ENV === "preview"` and adjust the log messages to the "deployed environment" wording used by `setup`/`discover`.
3. Update the file doc comments so they no longer claim the endpoints are permissive in non-production.
4. Update both test files: rename/retarget the "non-production" success cases to the local-development case (no `VERCEL_ENV` stub) and add an explicit "preview without a secret fails closed" case.

## Verification
- `npm test --workspace @agentvouch/web -- __tests__/api/cron-refresh-snapshots.test.ts __tests__/api/cron-mirror-skills.test.ts --maxWorkers=1 --no-fileParallelism`
- `npm run format:check`
- `npm run lint:web`
- `npm run typecheck`
- `npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism`
- `git diff --check`

## Rollout
Normal Vercel preview first. Previews with `CRON_SECRET` set are unaffected (Vercel Cron sends the Bearer token automatically). Previews without `CRON_SECRET` will start returning 401 to unauthenticated cron calls — that is the intended fail-closed behavior; set `CRON_SECRET` on any preview that needs cron.

## Rollback
Revert the focused commit. No schema, migration, or generated artifacts are involved.

## Blockers
- Stop if a live preview deployment legitimately invokes these endpoints without `CRON_SECRET` (none found; Vercel Cron always sends the secret when it is configured on the project).

## Dated Notes
- 2026-09-18: Verified both cron routes use plain `===` and fail closed only on `VERCEL_ENV === "production"`, while `setup`/`seed`/`github/skills/discover` (PR #174 and earlier) already use constant-time comparison and treat `preview` as deployed. Existing cron tests encode the old preview-permissive behavior and are updated in this plan.
- 2026-09-18 (closeout): Focused cron tests (15) and the full web suite (138 files / 1027 tests) pass; format:check, eslint, and `next typegen && tsc --noEmit` all pass. The explicit `next build --webpack` gate fails locally on the `/sitemap.xml` prerender because this box has no `DATABASE_URL`/`web/.env.local`; a clean `origin/main` worktree reproduces the identical failure, so it is a pre-existing environment limitation, not a regression from this change. Vercel remains the authoritative web build gate.
