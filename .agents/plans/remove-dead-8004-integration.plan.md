---
name: remove-dead-8004-integration
overview: "Remove the unreferenced EIP-8004 purchase-feedback module without changing any live request path."
todos:
  - id: confirm-unreferenced-integration
    content: Verify the EIP-8004 module, exports, environment keys, and dependency have no callers in source, tests, or scripts
    status: completed
  - id: remove-dead-module
    content: Delete the unreferenced web/lib/reputation8004.ts module; retain the direct dependency because npm lockfile regeneration caused unrelated churn
    status: completed
  - id: verify-dead-code-removal
    content: Run focused search, format, lint, typecheck, focused/full web tests, webpack build, and diff checks — format/lint/typecheck/full tests passed; local webpack build remains blocked by missing DATABASE_URL
    status: in_progress
  - id: publish-cleanup-pr
    content: Create a signed focused pull request and monitor its required checks
    status: in_progress
isProject: false
---

# Remove Dead EIP-8004 Integration

## Goal
Remove an EIP-8004 purchase-feedback integration that is unreachable in the current application. This reduces dead source and obsolete environment-key surface without changing any live request path.

## Scope
- In scope: the unreferenced `web/lib/reputation8004.ts` module and this plan.
- Out of scope: implementing EIP-8004 feedback, changing purchase settlement, changing AgentVouch protocol behavior, or changing dependency/lockfile state.

## Files To Change
- `web/lib/reputation8004.ts`: delete the fully unreferenced integration module.
- `.agents/plans/remove-dead-8004-integration.plan.md`: keep execution record and verification status current.

## Implementation Steps
1. Confirm source, tests, scripts, and package manifests have no import or call of `reputation8004`, `writeUsdcPurchaseFeedback`, or its `EIGHT004_*` environment keys (verified 2026-09-15).
2. Delete the module after preserving the existing dependency/lockfile because current npm lockfile regeneration introduces unrelated churn.
3. Verify TypeScript and the web build do not retain an import edge.

## Verification
- `npm exec --workspace @agentvouch/web -- tsx -e` import/search is unnecessary; use repository searches to confirm no source or test references remain.
- `npm run format:check`
- `npm run lint:web`
- `npm run typecheck`
- `npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism`
- `npm exec --workspace @agentvouch/web -- next build --webpack`
- `git diff --check`

## Rollout
Merge as a no-runtime-path cleanup. No migration, deployment toggle, chain transaction, or configuration action is required.

## Rollback
Revert the focused commit to restore the unused module if a consumer outside this repository is identified. The module had no internal import path or production caller as verified on 2026-09-15.

## Blockers
- Stop if an application import, test contract, script, or deployment configuration consumes the module or `EIGHT004_*` keys.
- Do not change the direct `8004-solana` dependency in this focused cleanup: the available npm lockfile flows rewrote thousands of unrelated lockfile lines.

## Dated Notes
- 2026-09-15: Repository-wide source/test/script search found only definitions in `web/lib/reputation8004.ts`; `npm ls 8004-solana --all --omit=dev` showed it only as a direct dependency of `@agentvouch/web`. No open PR exists, and no current or recent branch was found that targets this module.
- 2026-09-15: Tried standard and lockfile-only npm removal with npm 11.6.1. Both rewrote thousands of unrelated lockfile lines, violating this plan's narrow-scope requirement. Restored `web/package.json` and `package-lock.json`; the PR removes only the unreachable source module.
- 2026-09-15: `npm run format:check`, `npm run lint:web`, `npm run typecheck`, and full serialized web Vitest passed (138 files, 1,023 tests). `next build --webpack` compiled and typechecked, but exited during sitemap prerender because this checkout has no `DATABASE_URL` in `web/.env.local`; no alternate database credential is available to validate that environment-bound static path.
