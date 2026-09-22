---
name: registry-metadata-public-fetch
overview: "Route registry-controlled metadata fetches through the pinned public-address transport to close an SSRF boundary."
todos:
  - id: route-registry-metadata-through-public-transport
    content: Replace the direct registry metadata fetch with bounded, manually handled public-URL hops
    status: completed
  - id: cover-registry-metadata-fetch-boundary
    content: Add focused regression coverage proving the registry flow uses the protected transport for redirects and contains rejected metadata fetches
    status: completed
  - id: verify-and-publish-security-fix
    content: Run focused and web quality gates, then commit, push, open the focused PR, and inspect CI
    status: in_progress
isProject: false
---

# Protect Registry Metadata Fetches

## Goal

Close the SSRF boundary in `solanaAgentRegistry`: an indexer-provided `agentURI`
currently reaches a direct server-side `fetch`, which may follow redirects and
resolve private or rebinding DNS destinations. Reuse the existing pinned
public-address transport already verified for chain-only skill downloads.

## Scope

- In scope: registry metadata (`agentURI`) registration reads and their focused
  unit tests.
- Out of scope: indexer endpoint configuration, registry protocol behavior,
  chain/mainnet configuration, database changes, and a broad outbound-fetch
  refactor.

## Files To Change

- `web/lib/solanaAgentRegistry.ts`: replace `fetch(httpUrl)` with a five-hop
  manual redirect loop using `fetchPublicUrl`; retain best-effort empty
  registrations on failed/unusable metadata.
- `web/__tests__/lib/solanaAgentRegistry.test.ts`: mock the protected transport
  at the registry boundary and cover its initial URL, a redirect hop, and a
  rejected metadata read without falling back to global fetch.
- `.agents/plans/registry-metadata-public-fetch.plan.md`: maintain execution
  state and dated verification notes.

## Implementation Steps

1. Import `fetchPublicUrl` from `web/lib/publicUrlFetch.server.ts` and add a
   bounded redirect loop consistent with the existing five-redirect policy in
   `web/app/api/skills/[id]/raw/route.ts` (verified 2026-09-22).
2. Resolve relative `Location` headers against the just-fetched target. Treat a
   missing location, more than five redirects, non-OK response, invalid JSON,
   or protected-transport rejection as an empty registrations result. Do not
   use a direct/global fetch for metadata after this change.
3. Add boundary tests that prove all metadata hops call the protected transport;
   its own behavioral suite already proves DNS validation, address pinning, and
   no direct global fetch for rejected destinations.

## Verification

- `npm test --workspace @agentvouch/web -- __tests__/lib/solanaAgentRegistry.test.ts __tests__/lib/publicUrlFetch.test.ts --maxWorkers=1 --no-fileParallelism`
- `npm run format:check`
- `npm run lint:web`
- `npm run typecheck`
- `npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism`
- `npm exec --workspace @agentvouch/web -- next build --webpack`
- `git diff --check`

Acceptance: registry metadata never calls global `fetch`; every HTTP(S) metadata
hop goes through `fetchPublicUrl`, whose public DNS validation and pinned socket
transport are covered by its behavioral tests.

### Execution note (2026-09-22)

Implemented the bounded five-redirect loop in
`web/lib/solanaAgentRegistry.ts` and added route-boundary regressions for the
protected initial URL, each redirect hop, and a rejected private-target fetch.
The focused suite passed 124 tests; the full web suite passed 1,184 tests across
141 files. Formatting, lint, typecheck, and `git diff --check` passed. The
webpack build compiled and typechecked successfully, then failed only while
prerendering `/sitemap.xml` because this checkout has no `DATABASE_URL` /
`web/.env.local`; no credentials or environment configuration were changed to
bypass that existing local prerequisite. The production Vercel build remains the
remote build gate.

## Rollout

A small security PR only. No production deployment, live registry call, or
chain action is part of this work. GitHub CI and Vercel provide the final remote
checks.

## Rollback

Revert this PR only if protected transport compatibility unexpectedly prevents
legitimate public registry metadata reads. This restores the prior direct-fetch
risk and must be treated as a temporary mitigation pending a compatible fix.

## Blockers

Stop if the protected transport cannot preserve the registry's required
metadata behavior without changing its public API or adding dependencies.

## Verified Gap (2026-09-22)

`web/lib/solanaAgentRegistry.ts:204-218` converts an indexer-supplied
`agentURI` to HTTP(S) and calls direct `fetch(httpUrl)`. Unlike the chain-only
skill downloader, this neither pins DNS nor handles redirects manually; default
fetch redirect following can therefore reach a private destination. Open PRs
#202-#205 and recent commits `5299a8a` / `59ad7f1` do not modify this file or
cover this registry-metadata path (verified 2026-09-22).
