---
name: dependency-security-remediation
overview: "Reduce actionable production dependency advisories with minimal compatible version updates, beginning with the directly declared Next.js and viem packages."
todos:
  - id: classify-audit-findings
    content: Reproduce the production audit, map each direct advisory to its workspace and runtime reachability, and select only compatible updates
    status: pending
  - id: update-safe-direct-dependencies
    content: Update the approved direct production dependencies and regenerate only the required root npm lockfile entries
    status: pending
  - id: verify-security-and-build
    content: Re-run the production audit and the affected web quality gates, confirming both advisory reduction and application buildability
    status: pending
  - id: review-rollout-and-rollback
    content: Review the focused dependency diff, record residual advisories, and prepare a reversible deployment rollout
    status: pending
isProject: false
---

# Dependency Security Remediation

## Goal
Reduce the current actionable npm audit exposure through the smallest compatible dependency updates, without changing product behavior, chain semantics, or the build toolchain.

## Scope
- In scope: direct dependency advisories reported by `npm audit --omit=dev`, especially web runtime dependencies with a non-major remediation.
- In scope: dependency declarations, root `package-lock.json`, and the validation evidence required for a dependency-only PR.
- Out of scope: dependency additions, broad `npm audit fix` rewrites, Vercel CLI major-version migration, Anchor/toolchain replacement, production deployment, and source-code refactors.

## Files To Change
- `web/package.json`: pin approved web runtime dependency versions after compatibility review.
- `package.json`: update a root declaration only if its audited package is a production runtime dependency and has a compatible non-major fix.
- `package-lock.json`: regenerate exclusively through npm for the selected dependency updates.
- `.agents/plans/dependency-security-remediation.plan.md`: maintain execution status, audit counts, selected versions, and residual-risk notes.

## Verified Gap (2026-09-07)
- `npm audit --omit=dev --json` reported 58 advisories: 2 critical, 41 high, 13 moderate, and 2 low.
- Direct affected declarations reported by that audit are `next` (`web/package.json`, currently `16.1.6`), `viem` (`web/package.json`, currently `^2.52.2`), `vercel` (`package.json`, currently `^50.25.6`), and `@coral-xyz/anchor` (`package.json`, currently `^0.32.1`).
- npm reports a non-major `next` fix at `16.3.4`; it reports a fix is available for `viem`; `vercel` requires a major upgrade to `59.11.7`; and no automatic fix is available for `@coral-xyz/anchor`.
- Open PRs #173 and #174 modify unrelated skill-route and operator-endpoint files. No open PR was found for this dependency remediation.

## Implementation Steps
1. Run `npm ls next viem vercel @coral-xyz/anchor` and rerun `npm audit --omit=dev --json`, saving a concise before-count and the direct-advisory chains in the plan notes.
2. Confirm whether the vulnerable `next` and `viem` versions are reachable by the deployed web application. Do not update `vercel` until a separate major-version compatibility decision is approved; do not force an Anchor update without an upstream-compatible release.
3. Update only the approved direct web dependencies. Use npm to regenerate the root lockfile; do not use `npm audit fix --force`, add overrides without tracing consumers, or introduce a second lockfile.
4. Inspect `git diff -- package.json web/package.json package-lock.json` for unrelated lockfile churn. Revert unrelated metadata/platform changes before committing.
5. Record exact before/after audit counts and the unresolved dependency paths in this plan. If a proposed update changes a framework/API contract or requires source changes, stop and split it into a new implementation plan.

## Verification
Run with the repository-required Node 24 environment:
```bash
. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; }
npm ls next viem vercel @coral-xyz/anchor
npm audit --omit=dev --json
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria:
- The selected direct advisory or advisories no longer appear in the production audit.
- The lockfile contains only intentional dependency resolution changes.
- Formatting, lint, typecheck, web tests, and the explicit webpack production build pass.
- The PR states the residual Vercel/Anchor and transitive dependency risk precisely rather than claiming a clean audit.

## Rollout
Deploy the focused dependency-only PR through the normal Vercel preview first. Confirm the preview build and smoke the homepage, `/skills`, a skill detail route, and a signed-in buyer flow when credentials are available. Promote only after the preview is healthy; no chain, database, or money-flow action is part of this rollout.

## Rollback
Revert the dependency-only commit and redeploy the previously healthy Vercel build. The update must not include migrations, generated protocol artifacts, or persisted-data changes, so rollback is limited to package declarations and `package-lock.json`.

## Blockers
- A remediation requiring a new dependency, a major framework/CLI upgrade, source compatibility edits, or a build-toolchain change requires explicit human approval under `AGENTS.md`.
- Do not claim runtime remediation from dev-only or unused CLI dependency changes until deployed-path reachability is demonstrated.
- `@coral-xyz/anchor` currently has no npm-provided automatic fix; track upstream remediation separately rather than forcing a substitute package.
