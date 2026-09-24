---
name: reject-unsafe-connected-repo-branches
overview: "Restrict connected-repository branch names to safe Git ref paths so branch input cannot normalize raw GitHub verification URLs outside the declared owner/repository."
todos:
  - id: restrict-branch-paths
    content: Reject absolute, empty-segment, dot-segment, and double-dot connected-repository branch paths while retaining normal slash-delimited Git branch names
    status: completed
  - id: add-branch-validation-tests
    content: Add focused behavioral tests for accepted branch names and traversal-like rejected values
    status: completed
  - id: verify-branch-hardening
    content: Run targeted mirror tests, formatting, lint, typecheck, full web Vitest, webpack build, and whitespace checks
    status: completed
isProject: false
---

# Reject Unsafe Connected-Repository Branch Paths

## Goal

Prevent a wallet connecting a repository from using branch text that URL-normalizes the verification-file request outside the stated `githubOwner/githubRepo` path. Preserve support for ordinary branch names including slash-delimited release branches.

## Scope

- In scope: connected-repository branch syntax validation and direct behavioral regression tests.
- Out of scope: GitHub API transport changes, ownership-proof semantics, connected-repository schema, sync behavior, and changes to existing stored branches.

## Verified Gap (2026-09-24)

- `web/lib/mirror/connectedRepos.ts:79` accepts every 1–120-character combination of letters, digits, `.`, `_`, `-`, and `/`.
- `web/lib/mirror/connectedRepos.ts:115` interpolates the accepted branch into a `raw.githubusercontent.com` verification URL. A URL probe verified that `../../victim/repo/main` normalizes from an `attacker/owned` URL to `https://raw.githubusercontent.com/victim/repo/main/.well-known/agentvouch.json`.
- This makes the ownership proof no longer bind the retrieved verification file to the declared repository. Current `web/__tests__/lib/mirror-connectedRepos.test.ts` has no behavioral coverage for `validateRepoCoords`; `web/__tests__/api/connected-repos-skip-review.test.ts` mocks it.
- Open PRs #203, #206, #207, and #208 address other API/fetch boundaries and do not cover connected-repository branch validation (verified 2026-09-24).

## Files To Change

- `web/lib/mirror/connectedRepos.ts`: replace the permissive branch regex with validation that permits normal relative Git branch segments but rejects unsafe path forms before the raw URL is constructed.
- `web/__tests__/lib/mirror-connectedRepos.test.ts`: import `validateRepoCoords` and add table-driven accepted and rejected branch tests, including dot-segment traversal forms.

## Implementation Steps

1. Add regression cases demonstrating that `main`, `release/v1.0`, and `feature/fix-123` remain valid, while `../victim/repo/main`, `main/../x`, `/absolute`, `main//x`, `main/.`, and dot-only segments are rejected.
2. Implement the smallest validation rule that requires a non-empty relative slash-separated branch path, rejects `.` / `..` segments, and preserves the existing character and length allowlist.
3. Run the focused test to prove the new boundary, then run the repository-required static and web checks.

## Verification

```bash
. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; }
npm test --workspace @agentvouch/web -- __tests__/lib/mirror-connectedRepos.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria: unsafe branch values return the existing `Invalid branch` validation error before ownership verification; ordinary slash-delimited branch names still validate; all listed checks pass or any environment-only build blocker is recorded.

## Rollout

Merge as a focused server-side input-boundary hardening change. It requires no migration, environment change, deploy procedure, GitHub action, wallet action, or chain action.

## Rollback

Revert the focused commit. No persisted data or external state needs restoration. Existing rows are unaffected; if a legacy stored branch is unsafe, its normal sync behavior was already unreliable and this PR does not mutate it.

## Blockers

- Do not broaden the branch syntax beyond the documented safe relative path requirement.
- Stop if existing tests or callers demonstrate a required valid Git ref form that cannot be represented without unsafe URL path semantics; no such caller was found as of 2026-09-24.

## Execution Notes

- **2026-09-24:** Added direct `validateRepoCoords` regressions. The tests failed before the implementation: all seven unsafe branch values were accepted. The boundary now rejects empty, `.` and `..` path segments while retaining the existing character and length allowlist.
- **2026-09-24:** Focused test passed (23 tests); `npm run format:check`, `npm run lint:web`, `npm run typecheck`, `npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism` (141 files / 1,192 tests), and `git diff --check` passed under Node v24.10.0.
- **2026-09-24:** `next build --webpack` compiled successfully and completed TypeScript, then failed only while prerendering `/sitemap.xml` because this checkout has no `web/.env.local` / `DATABASE_URL`. No environment configuration was changed. The build also retained the pre-existing viem Tempo dynamic-import warning. No live GitHub ownership verification, repository sync, database action, wallet action, or chain action was run.
