---
name: validate-github-discovery-input
overview: "Validate POST discovery payload fields at the API boundary so non-string queries cannot reach the GitHub discovery helper and produce a generic 500."
todos:
  - id: reproduce-invalid-query
    content: Add a regression for a non-string discovery query and confirm it currently reaches the generic error path.
    status: completed
  - id: validate-discovery-payload
    content: Normalize or reject invalid POST discovery payload query fields before invoking the GitHub discovery helper.
    status: completed
  - id: verify-discovery-route
    content: Run the focused route test plus format, lint, typecheck, full web tests, webpack build, and diff checks.
    status: completed
isProject: false
---

# Validate GitHub Discovery Request Input

## Goal
Prevent valid-but-type-invalid JSON sent to the authenticated `POST /api/github/skills/discover` boundary from reaching `discoverGithubSkills`, whose `options.query?.trim()` assumes a string and otherwise produces a generic 500.

## Scope
- In scope: POST payload normalization/validation in the GitHub skill discovery route and its focused Vitest coverage.
- Out of scope: discovery query syntax changes, GitHub API behavior, authentication policy, rate limits, or other API routes.

## Files To Change
- `web/app/api/github/skills/discover/route.ts`: validate runtime JSON field types before calling the discovery helper.
- `web/__tests__/api/github-skill-discovery-route.test.ts`: prove invalid input has an explicit client contract and does not trigger discovery.

## Implementation Steps
1. Add a failing test for an authorized POST carrying `{ "query": 7 }`, including assertions that discovery is not called.
2. Treat `q`/`query` values that are neither a string nor absent as invalid client input; preserve the existing default query for an omitted field and preserve existing numeric limit clamping behavior.
3. Return the established route-style JSON client error before external GitHub work.

## Verification
- `npm test --workspace @agentvouch/web -- __tests__/api/github-skill-discovery-route.test.ts --maxWorkers=1 --no-fileParallelism`
- `npm run format:check`
- `npm run lint:web`
- `npm run typecheck`
- `npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism`
- `npm exec --workspace @agentvouch/web -- next build --webpack`
- `git diff --check`

## Rollout
The handler remains behind its existing discovery-secret authorization policy. Deploy through the standard PR/Vercel path; no environment changes are required.

## Rollback
Revert the focused commit to restore the prior request parsing behavior. No schema, dependency, protocol, or data migration is involved.

## Blockers
- Verified 2026-08-29: no open PR changes this route or its test file.
- If the product requires accepting non-string query coercion, stop rather than silently changing the API contract.

## Execution Notes
- 2026-08-29: the RED regression returned `200` because the route forwarded `{ query: 7 }` unchanged to the mocked helper. The production helper calls `options.query?.trim()`, so this runtime type mismatch would otherwise escape the route boundary and become its generic `500` response.
- 2026-08-29: completed the focused test, format, lint, typecheck, complete web suite, webpack production build, and `git diff --check`. The build retained the repository's existing `ox`/`viem` dynamic-dependency warning and expected missing-`DATABASE_URL` static-generation fallback logs.
