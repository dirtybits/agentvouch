---
name: reject-invalid-raw-skill-id
overview: "Reject malformed repository UUIDs before database initialization in the shared raw-download access resolver, preserving chain-only handling and archive endpoints."
todos:
  - id: validate-repo-skill-id
    content: Add a shared UUID boundary guard for repo-backed raw, zip, and archive downloads before PostgreSQL UUID casts
    status: completed
  - id: update-raw-access-tests
    content: Replace raw-route placeholder IDs with valid UUID fixtures and add a malformed-ID no-database regression
    status: completed
  - id: verify-raw-access
    content: Run focused raw-download tests, formatting, diff checks, and the applicable web quality gates
    status: completed
  - id: publish-focused-pr
    content: Create a signed focused PR with exact verification results
    status: in_progress
isProject: false
---

# Reject Invalid Raw Skill IDs

## Goal
Return the existing `404 Skill not found` response for malformed repo-backed IDs before `initializeDatabase()` and `::uuid` casts in the shared download-access resolver. This protects `raw`, `zip`, and `archive` download routes while retaining their intentional `chain-*` behavior.

## Scope
- In scope: shared repo-ID validation in `web/lib/skillRawAccess.ts` and the direct raw-route regression coverage in `web/__tests__/api/skills-raw.test.ts`.
- Out of scope: validating chain-only Solana listing addresses, changing entitlement/payment semantics, database schema work, or broad route refactors.

## Files To Change
- `web/lib/skillRawAccess.ts`: import and apply `isUuidLike` after preserving the `chain-` early return and before database initialization.
- `web/__tests__/api/skills-raw.test.ts`: use well-formed UUID fixtures for non-chain requests and prove malformed IDs reach neither database initialization nor SQL.
- `.agents/plans/reject-invalid-raw-skill-id.plan.md`: record implementation and verification status.

## Implementation Steps
1. Keep the current `chain-` access rejection unchanged in `resolveSkillAccess`.
2. Reject a non-UUID repo ID with `404 Skill not found` before `initializeDatabase()` and any SQL `::uuid` cast.
3. Update route-test fixtures so existing behavior tests remain about entitlement and x402 behavior rather than invalid ID handling.
4. Add one regression asserting the malformed request returns `404` and calls neither database initialization nor SQL.

## Verification
- `npm test --workspace @agentvouch/web -- __tests__/api/skills-raw.test.ts --maxWorkers=1 --no-fileParallelism`
- `npm run format:check`
- `npm run lint:web`
- `npm run typecheck`
- `npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism`
- `npm exec --workspace @agentvouch/web -- next build --webpack`
- `git diff --check`

## Rollout
Merge as a request-boundary hardening change. No feature flag, migration, or live-chain action is required.

## Rollback
Revert the focused commit if a legitimate non-UUID repo skill identifier is discovered. Current repository queries cast the route ID to PostgreSQL UUID, so such IDs are not compatible with the existing backend contract.

## Blockers
- Stop if a supported repo-backed route ID is not UUID-shaped; no such route contract was found during inspection on 2026-08-11.

## Dated Notes
- 2026-08-11: Verified `resolveSkillAccess` reaches `WHERE s.id = ${id}::uuid` after `initializeDatabase()` for every non-`chain-` ID. `raw`, `zip`, and `archive` all use this resolver. Open PRs #143–#146 harden sibling endpoints but none modifies this resolver.
- 2026-08-12: Implemented shared repo-ID validation after the preserved `chain-` early return. Updated raw-route fixtures to use valid UUIDs and added a regression proving malformed IDs do not initialize the database or construct SQL. Verified focused/full Vitest, format, lint, typecheck, webpack build, and `git diff --check`; webpack retained its existing viem Tempo dynamic-import warning and expected static-generation fallback messages because local `DATABASE_URL` is absent.
