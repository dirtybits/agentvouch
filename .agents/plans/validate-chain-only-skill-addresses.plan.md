---
name: validate-chain-only-skill-addresses
overview: "Reject malformed chain-only Solana listing addresses at the raw-download, install, and purchase-verification route boundaries before RPC, parsing, auth, or database work."
todos:
  - id: validate-chain-only-addresses
    content: Add the existing Solana address guard to the three remaining chain-only skill route boundaries
    status: completed
  - id: add-chain-only-address-regressions
    content: Add focused regressions proving malformed chain-only IDs return 404 without downstream work
    status: completed
  - id: verify-focused-pr
    content: Run focused and full web quality gates, inspect the diff, commit signed changes, open a PR, and monitor checks
    status: completed
isProject: false
---

# Validate Chain-Only Skill Listing Addresses

## Goal
Make the raw-download, install, and purchase-verification chain-only routes consistently reject malformed Solana listing addresses before they can trigger an RPC/cache lookup, parse a request, verify a signature, or initialize the database.

## Scope
- In scope: `chain-<Solana listing address>` validation in the raw, install, and purchase-verify handlers and their adjacent Vitest route suites.
- Out of scope: repository UUID validation, entitlement semantics, Base routes, on-chain program interfaces, database schema, and raw-download SSRF behavior.

## Verified Gap (2026-09-21)
- `web/app/api/skills/[id]/route.ts:208-213` already rejects an invalid chain-only suffix using `isAddress()` before database/RPC work; its regression is `web/__tests__/api/skills-route.test.ts:540-551`.
- `web/app/api/skills/[id]/raw/route.ts:80-82`, `install/route.ts:26-33`, and `purchase/verify/route.ts:70-78` accept any `chain-` suffix. Raw performs `fetchOnChainSkillListing`; install parses and verifies the request before its lookup; purchase verify parses then initializes the database before its lookup.
- No open pull requests existed when checked on 2026-09-21. Recent PR #200 added the detail-route sibling guard but did not modify these three handlers.

## Files To Change
- `web/app/api/skills/[id]/raw/route.ts`: reject malformed chain-only listing IDs before calling `fetchOnChainSkillListing`.
- `web/app/api/skills/[id]/install/route.ts`: reject malformed chain-only listing IDs before `request.json()` and wallet-signature verification.
- `web/app/api/skills/[id]/purchase/verify/route.ts`: reject malformed chain-only listing IDs before `request.json()` and database initialization.
- `web/__tests__/api/skills-raw.test.ts`, `skills-install.test.ts`, and `skills-purchase-verify.test.ts`: assert the existing `404 { error: "Skill not found" }` contract and absence of the relevant downstream mocks.

## Implementation Steps
1. Reuse `isAddress` from `@solana/kit`, matching the existing detail route; do not introduce a new address validator.
2. In each handler, preserve the valid chain-only path and existing malformed repository-ID handling while returning the detail route's existing `404` payload for a malformed `chain-` suffix.
3. Add one regression per route that passes `chain-not-a-solana-address` and proves no request body parse, signature verification, database initialization, SQL, or on-chain listing lookup occurs before rejection, as applicable.
4. Add a dated verification note if implementation diverges from the test-proven public contract.

## Verification
```bash
. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; }
npm test --workspace @agentvouch/web -- __tests__/api/skills-raw.test.ts __tests__/api/skills-install.test.ts __tests__/api/skills-purchase-verify.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria: malformed chain-only IDs return `404` before all route-specific downstream effects; valid chain-only behavior remains covered by existing tests; all commands exit successfully.

## Rollout
Ship as a normal request-boundary hardening PR. It changes no flag, schema, chain deployment, or payment behavior.

## Verification Results (2026-09-21)
- Focused route suite passed after the implementation and formatting pass: 3 files / 67 tests.
- Full web Vitest suite passed before the formatting-only pass: 141 files / 1,185 tests.
- `npm run lint:web` and `npm run typecheck` passed under Node v24.10.0.
- `npm run format:check` and `git diff --check` passed after formatting the two touched install files.
- `npm exec --workspace @agentvouch/web -- next build --webpack` compiled and typechecked successfully, then failed while prerendering `/sitemap.xml` because this worktree has no `web/.env.local` and therefore no `DATABASE_URL`. This is an environment blocker unrelated to the route change; no database URL was added or changed.
- PR #203 checks passed on the initial code commit: GitHub Actions `test` (2m03s), GitHub Actions `contracts` (1m40s), and Vercel deployment. The PR was `CLEAN` when checked on 2026-09-21.
- No live chain, payment, database, or browser smoke was run; the regressions prove early rejection before their mocked downstream effects.

## Rollback
Revert the focused commit. The affected malformed path has no persistent effects.

## Blockers
- Stop if the relevant routes already intentionally support a non-Solana chain-only identifier; current route names, `fetchOnChainSkillListing`, and the existing detail-route contract establish Solana-only handling.
- Do not extend this change to Base or repository-ID routes.
