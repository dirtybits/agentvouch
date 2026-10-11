---
name: reject-index-host-ssrf
overview: "Prevent public discovery-index handlers from treating an untrusted request Host as an internal fetch target or canonical public URL."
todos:
  - id: reproduce-host-derived-origin
    content: Confirm the three index handlers pass request.nextUrl.origin into the self-fetch helper and identify the canonical-origin precedent
    status: completed
  - id: pin-index-origin
    content: Replace request-derived index origins with the configured canonical SITE_URL in the skills, authors, and trusted-authors handlers
    status: completed
  - id: add-host-header-regressions
    content: Add route-level regressions proving hostile request origins do not reach fetchAllIndexedSkills or generated public URLs
    status: completed
  - id: verify-index-origin-fix
    content: Run targeted web tests plus format, lint, typecheck, full web tests, diff checks, and the webpack build gate where environment permits — webpack compiled and typechecked, but sitemap prerender remains blocked by missing DATABASE_URL
    status: completed
isProject: false
---

# Reject Host-Derived Index Fetches

## Goal
Ensure the public discovery index endpoints fetch the skills list and emit public skill URLs from the configured AgentVouch public origin, rather than the incoming request origin. This closes a server-side request forgery and response-poisoning boundary caused by treating a caller-controlled Host header as trusted.

## Scope
- In scope: `GET /api/index/skills`, `GET /api/index/authors`, and `GET /api/index/trusted-authors`; their shared call into `fetchAllIndexedSkills`; regression coverage for hostile request origins.
- Out of scope: changing the pagination helper, reverse-proxy configuration, OAuth callback origins, key-audience origin handling, or any chain/database/wallet behavior.

## Files To Change
- `web/app/api/index/skills/route.ts`: use `SITE_URL` as the internal index origin and public URL prefix.
- `web/app/api/index/authors/route.ts`: use `SITE_URL` as the internal index origin.
- `web/app/api/index/trusted-authors/route.ts`: use `SITE_URL` as the internal index origin.
- `web/__tests__/api/index-routes.test.ts`: route-level hostile-origin regression coverage.

## Verified Gap (2026-10-02)
Each index handler assigned `request.nextUrl.origin` to `baseUrl` and passed it to `fetchAllIndexedSkills`. The helper interpolates the value into `fetch(`${baseUrl}/api/skills?...`)` (`web/lib/indexFeeds.ts:91-102`). In Next route handlers the request URL origin is built from the incoming Host, so an attacker-controlled host could steer this server-side request and, for `/api/index/skills`, become the emitted `public_url` prefix.

`web/lib/site.ts` already defines the canonical public origin as `SITE_URL`, taking a trimmed `NEXT_PUBLIC_APP_URL` only and otherwise defaulting to `https://agentvouch.xyz` (verified 2026-10-02). No open PR covered this route family as of the same date.

## Implementation Note (2026-10-02)
The three handlers now take no request argument because no request-derived value is safe or needed for this response. Each passes `SITE_URL` to `fetchAllIndexedSkills`; `/api/index/skills` also uses that same value when constructing `public_url`. Route-level tests invoke the handlers with an `attacker.invalid` request origin and prove the helper still receives `https://agentvouch.xyz`.

## Implementation Steps
1. Import `SITE_URL` in each of the three index handlers and replace the request-derived `baseUrl` assignment.
2. Keep all existing endpoint response shapes, pagination, cache behavior, and error handling intact.
3. Mock `fetchAllIndexedSkills` in one route-level test file. Call each handler with `https://attacker.invalid/...` and assert its only helper argument is the canonical origin. For the skills endpoint also assert its emitted `public_url` uses the canonical origin.

## Verification
- `npm test --workspace @agentvouch/web -- __tests__/api/index-routes.test.ts --maxWorkers=1 --no-fileParallelism`
- `npm run format:check`
- `npm run lint:web`
- `npm run typecheck`
- `npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism`
- `git diff --check origin/main...HEAD`
- `npm exec --workspace @agentvouch/web -- next build --webpack`; if prerender blocks solely because `web/.env.local`/`DATABASE_URL` is absent, report the exact stage and preserve the successful compile/typecheck evidence without claiming a full build.

## Rollout
Merge as one focused web/API PR. No migration, feature flag, deployment setting, cache invalidation, or live-chain action is required.

## Rollback
Revert the focused commit. This restores request-derived index origins and therefore reintroduces the Host-header-controlled fetch/public-URL behavior; no persisted state needs restoration.

## Blockers
- Do not substitute a request header allowlist or introduce proxy configuration without an explicit deployment decision.
- If the environment requires preview deployments to self-fetch their own preview origin, stop and revise the plan because that conflicts with the canonical-origin security invariant.
