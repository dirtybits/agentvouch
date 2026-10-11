---
name: guard-free-skill-detail-fetch
overview: "Route free chain-only skill detail content through the existing DNS-pinned public URL transport rather than direct server-side fetch."
todos:
  - id: extract-guarded-skill-uri-fetch
    content: Extract the existing validated redirect-aware skill_uri text fetch into a shared server-only helper and use it in raw downloads
    status: completed
  - id: protect-free-detail-content
    content: Use the shared helper for free chain-only detail previews instead of direct fetch
    status: completed
  - id: verify-detail-fetch-boundary
    content: Add a route-level regression proving the detail handler uses the protected transport and run focused checks
    status: completed
isProject: false
---

# Guard free chain-only skill detail fetches

## Goal

Ensure a permissionless Solana listing's `skill_uri` cannot make the detail route connect to a private address or a DNS-rebound destination while rendering a free skill preview.

## Scope

- In scope: shared server-only retrieval of author-controlled chain `skill_uri` text; the free chain-only branch of `web/app/api/skills/[id]/route.ts`; focused route tests.
- Out of scope: registry metadata (covered by open PR #206), raw-download behavior beyond retaining its existing semantics, EVM/chain-protocol changes, database changes, and deployment configuration.

## Verified gap (2026-09-23)

- `web/app/api/skills/[id]/route.ts:269-277` treats any free chain listing's author-controlled `listing.data.skillUri` as content and calls direct `fetch(listing.data.skillUri)`.
- `web/app/api/skills/[id]/raw/route.ts:51-77` already protects the same permissionless field with `resolveSafeFetchUrl`, redirect validation, and `fetchPublicUrl`.
- `web/lib/publicUrlFetch.server.ts:156-227` pins every approved HTTP(S) request to a public DNS answer; this prevents hostname-to-private-address and DNS-rebinding bypasses.
- The existing `skill-uri-dns-protection.plan.md` explicitly scoped the raw-download path and listed other outbound paths as out of scope; this is a distinct detail-preview boundary, not a modification of that plan.

## Files To Change

- `web/lib/skillUriFetch.server.ts`: add the reusable redirect-bounded, safe URL, DNS-pinned text-fetch helper based on the existing raw-route behavior.
- `web/app/api/skills/[id]/raw/route.ts`: call the shared helper without changing download access-control semantics.
- `web/app/api/skills/[id]/route.ts`: call the shared helper before embedding free chain-only preview content.
- `web/__tests__/api/skills-route.test.ts`: add a focused regression proving a free chain detail preview reaches the protected transport rather than global fetch.

## Implementation Steps

1. Move the raw route's `fetchSkillUriContent` logic into a server-only library helper. Preserve the five-redirect maximum, every-hop `resolveSafeFetchUrl` validation, manual redirect handling, response-body cancellation, status handling, and text return type.
2. Replace both route-local outbound paths with the helper. Preserve best-effort detail behavior: rejected/unavailable content remains `null`, not a route failure.
3. Extend the detail-route test setup to mock the protected transport and assert a free on-chain listing reads preview content through that mock. Assert global `fetch` is never used by the route boundary.

## Verification

- `npm test --workspace @agentvouch/web -- __tests__/api/skills-route.test.ts __tests__/api/skills-raw.test.ts __tests__/lib/publicUrlFetch.test.ts --maxWorkers=1 --no-fileParallelism`
- `npm run format:check`
- `npm run lint:web`
- `npm run typecheck`
- `git diff --check`

Acceptance: a free chain detail request retains preview behavior for a successful public URL, but route source and regression prove it cannot use direct global fetch; raw download regressions retain their existing guarded path.

### Execution record (2026-09-23)

- Added `web/lib/skillUriFetch.server.ts` and moved the raw-route redirect loop into it without changing its five-hop limit, safe URL validation, DNS-pinned transport, response cancellation, or status semantics.
- The free detail preview now calls that helper and retains its existing best-effort `null` fallback if retrieval is rejected or unavailable.
- Focused tests passed: 191 tests across `skills-route`, `skills-raw`, and `publicUrlFetch`.
- Format, web lint, and typecheck passed; the full web suite passed 1,183 tests across 141 files; `git diff --check` passed.
- `next build --webpack` compiled and completed TypeScript, then failed prerendering `/sitemap.xml` because this checkout has no `web/.env.local` / `DATABASE_URL`. No credentials or environment configuration were changed; Vercel remains the deployment build gate.

## Rollout

Publish one focused web security PR. No production deployment, live-chain action, or browser smoke is required for this server-side boundary patch.

## Rollback

Revert only this PR's commit. This would restore the known direct-fetch exposure for free chain detail previews while leaving raw-download protections intact.

## Blockers

Stop if sharing the helper changes raw-download status, redirect, or content behavior; preserve raw behavior and keep the detail fallback best-effort. The local environment may lack `web/.env.local`, so a production webpack prerender failure due to absent `DATABASE_URL` is not evidence of a code failure.
