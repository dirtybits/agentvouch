---
name: settings-api-keys-get-auth-header
overview: "Fix the Settings API-key list request so browser Fetch uses a signed header rather than an invalid GET request body, with route-level regression coverage (verified 2026-07-10)."
todos:
  - id: move-signed-auth-to-header
    content: "DONE 2026-07-10 — Updated the Settings key-list Fetch request and GET /api/keys handler to pass and validate the wallet-signed auth payload through a JSON request header; preserved existing API-key bearer authentication."
    status: completed
  - id: add-route-regression-test
    content: "DONE 2026-07-10 — Added GET route tests proving a valid signed header reaches verification and returns the owner key list, malformed header input returns 400, and the Settings source sends the signed list request in a header rather than a GET body."
    status: completed
  - id: verify-settings-key-list-fix
    content: "DONE 2026-07-10 — Focused API-key/Settings-source Vitest (4 tests), full web Vitest (94 files / 623 tests), formatting, lint, typecheck, and webpack build passed after restoring the lockfile-defined dependencies with npm ci."
    status: completed
isProject: false
---

# Fix Settings API-Key List Authentication

## Goal
Restore API-key listing in Settings by avoiding a GET request body, which the browser Fetch API rejects before it sends a request. The signed wallet payload will remain off URLs and be verified server-side.

## Scope
- In scope: the Settings API-key list request, `GET /api/keys` signed-auth parsing, and focused route regression coverage.
- Out of scope: API-key schema, key generation/revocation behavior, authentication protocol redesign, and Base/Solana protocol work.

## Files To Change
- `web/app/settings/page.tsx`: send the existing `list-keys` signed payload in `X-AgentVouch-Auth` on the GET request.
- `web/app/api/keys/route.ts`: parse and validate the signed header before the existing bearer API-key fallback.
- `web/__tests__/api/keys-route.test.ts`: cover successful signed-header authentication and key-list retrieval.
- `web/__tests__/app/settings-page-source.test.ts`: prevent reintroducing a GET body in the Settings key-list request.

## Implementation Steps
1. Keep the Settings signing message/action unchanged, but replace the illegal `GET` body with a JSON `X-AgentVouch-Auth` header.
2. Parse that header defensively in the route. A malformed header returns 400, an invalid signed payload returns the existing invalid-signature response, and a valid payload establishes the owner before the existing `Bearer sk_…` fallback.
3. Mock database/auth dependencies in a narrow route test and assert the handler returns the owner’s rows when the signed header verifies.

## Verification
- `npm test --workspace @agentvouch/web -- --run __tests__/api/keys-route.test.ts --maxWorkers=1 --no-fileParallelism`
- `npm run format:check`
- `npm run lint --workspace @agentvouch/web`
- `npm run typecheck --workspace @agentvouch/web`
- `npm exec --workspace @agentvouch/web -- next build --webpack`

Acceptance criteria: Settings no longer asks Fetch to construct a GET body, and the route reads the same signed payload from a header without weakening bearer API-key support.

## Completion (2026-07-10)
- Implemented and verified. `npm ci` restored the lockfile-defined `@vercel/speed-insights` package after the initial typecheck/build exposed a stale local dependency tree; no dependency manifest or lockfile changed.
- The webpack build passed with non-blocking dynamic-dependency and missing-local-`DATABASE_URL` runtime warnings only; it exited successfully.

## Rollout
Deploy through the normal PR/Vercel flow. The change affects only authenticated key-list reads; no database migration or flag is required.

## Rollback
Revert this focused commit to restore the prior route/client behavior. No persisted state changes.

## Blockers
Implementation has no blocker. PR creation is blocked in this headless environment because the required signed commit failed: `gpg: skipped "dirtybits <dirtybitsofficial@gmail.com>": No secret key` / `gpg: signing failed: No secret key`. The verified, staged branch is ready once the `dirtybits` signing key is available.
