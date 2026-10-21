---
name: reject-private-connected-repos
overview: "Require linked-login connected repositories to be publicly visible before marking them active, preserving the unauthenticated raw-content sync contract."
todos:
  - id: prove-public-visibility
    content: Add a public GitHub repository visibility check to the linked-login ownership path before a connected repository can be created
    status: completed
  - id: cover-visibility-boundary
    content: Add focused behavioral regressions for public, private, unavailable, and GitHub lookup failure outcomes
    status: completed
  - id: verify-visibility-hardening
    content: Run focused mirror tests, formatting, lint, typecheck, full web Vitest, webpack build, and whitespace checks — build attempted; blocked only by absent DATABASE_URL during sitemap prerender
    status: completed
isProject: false
---

# Reject Private Connected Repositories

## Goal

Keep connected-repository registration aligned with its public-source contract: a wallet whose linked GitHub login matches the requested owner may connect only repositories that GitHub exposes publicly, so an unavailable or private repository is not saved as active and immediately handed to the unauthenticated raw-content sync path.

## Scope

- In scope: the linked-login branch of `verifyRepoOwnership` and direct unit coverage for the GitHub public-visibility boundary.
- Out of scope: GitHub OAuth, database schema, existing repository rows, community mirrors, sync transport, and changes to ownership proof semantics for the existing public verify-file path.

## Verified Gap (2026-10-12)

- `web/lib/mirror/connectedRepos.ts:147-150` treats a linked GitHub login matching `githubOwner` as sufficient ownership proof without checking that `githubRepo` exists or is public.
- The same module documents at line 12 that connected repositories must be public because `raw.githubusercontent.com` fetches their content without credentials; `web/lib/mirror/github.ts:157-162` confirms raw content is fetched unauthenticated.
- Consequently, a linked owner can receive an active connection response for a private or nonexistent repository, after which initial sync cannot retrieve its raw content. The server GitHub token used by tree/ref helpers must not be treated as permission to mirror private content.
- Current `web/__tests__/lib/mirror-connectedRepos.test.ts` covers coordinate validation and SQL conflict behavior but has no `verifyRepoOwnership` coverage. Open PRs #235 and #236 address coordinate type validation and SSRF blocklist coverage, respectively, not repository visibility (verified 2026-10-12).

## Files To Change

- `web/lib/mirror/connectedRepos.ts`: use an unauthenticated GitHub repository metadata lookup on the linked-login path and only accept an explicit public result; return a clear ownership failure otherwise.
- `web/__tests__/lib/mirror-connectedRepos.test.ts`: mock fetch and add public/private/unavailable/error behavior tests around `verifyRepoOwnership`.

## Implementation Steps

1. Add a small helper that reads `https://api.github.com/repos/{owner}/{repo}` without the server mirror token and returns true only when a successful response explicitly reports `private: false`.
2. Make the linked-login ownership branch wait for that check. Preserve the existing linked-login success result for public repositories and return an actionable refusal for private, missing, or lookup-failed repositories.
3. Add targeted regressions proving that the visibility check uses the declared owner/repo URL without credentials, accepts public metadata, and refuses private, non-OK, malformed, or failed lookups without falling through to the verify-file path.
4. Run the focused test first, then the repository static and web gates.

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

Acceptance criteria: linked-login registration succeeds only after unauthenticated GitHub metadata says `private: false`; private, unavailable, malformed, and failed responses return an ownership refusal before a connected-repository row or sync is reached; existing verify-file behavior remains unchanged.

## Rollout

Merge as a focused server-side validation change. It requires no migration, environment change, GitHub action, wallet action, or chain action. New invalid registrations are refused; existing rows are untouched.

## Rollback

Revert the focused commit. No persisted state is changed by the visibility lookup and no existing connection is altered.

## Blockers

- Do not send `GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_PAT`, or a user OAuth token to the visibility lookup; authenticated success would incorrectly make private repositories appear eligible.
- Do not add a dependency or a database migration. If GitHub’s public metadata response cannot reliably expose the `private` field, defer rather than infer visibility.

## Execution Notes

- **2026-10-12:** Added the focused regressions first. Before the implementation, the linked-login path returned `{ verified: true, method: "linked-login" }` for private, unavailable, malformed, and failed GitHub metadata responses and never made the visibility request (5 focused-test failures).
- **2026-10-12:** The implemented lookup sends only GitHub’s public media type and `agentvouch-connect` user agent—never the mirror service token—and accepts only a successful response with `private: false`. Focused test now passes (31 tests).
- **2026-10-12:** Under the cron shell’s available Node v22.23.1, `npm run format:check`, `npm run lint:web`, `npm run typecheck`, `git diff --check`, and the full web suite passed (152 files, 1,316 tests). `next build --webpack` compiled successfully and completed TypeScript, then failed only while prerendering `/sitemap.xml` because `web/.env.local` has no `DATABASE_URL`; no environment configuration was changed. The known `ox`/`viem` dynamic-import warning remained.
