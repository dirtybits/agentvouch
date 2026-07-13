---
name: api-key-signature-nonce-object-binding
overview: "Harden wallet-authorized API-key list/create/revoke requests against same-action replay and unsigned object substitution with canonical API-key messages and an additive atomic nonce ledger."
todos:
  - id: define-api-key-auth-envelope
    content: "Define the web-only API-key auth payload, canonical action/method/path/audience/object message, nonce validation, key-name normalization, and exact scope assertion without changing shared protocol or CLI signing."
    status: completed
  - id: add-atomic-replay-ledger
    content: "Add an additive api_key_auth_nonces table and consume each wallet nonce atomically before API-key reads or mutations, with safe duplicate and expiry behavior."
    status: completed
  - id: update-settings-and-routes
    content: "Make Settings sign a fresh nonce plus normalized key name or exact key id, enforce the envelope in all three /api/keys wallet-auth handlers, and preserve bearer-key GET behavior."
    status: completed
  - id: add-replay-regressions
    content: "Cover exact canonical messages, malformed/missing nonce, detached fields, name/key-id substitution, same and concurrent replay, consume failure, expired signatures, and unchanged bearer GET."
    status: completed
  - id: verify-api-key-hardening
    content: "Run focused and full web format/lint/typecheck/Vitest/webpack gates, record neighboring auth gaps as out-of-scope follow-ups, and prepare the focused PR."
    status: completed
isProject: false
---

# API-Key Wallet Signature Nonce And Object Binding

## Goal

Make every wallet-authorized `/api/keys` request usable at most once and bind mutations to the exact
API-key object named by the request. PR #101 already binds the action; this plan closes same-action
replay and body-substitution gaps without changing API-key bearer authentication or shared CLI signing.

## Verified Gap — 2026-07-13

- `verifyWalletSignature` validates Ed25519 ownership and a five-minute timestamp window but stores no
  replay state.
- `create-key` signs only action and timestamp; a captured signature can create multiple fresh
  credentials up to the active-key cap, and the unsigned key name can be replaced.
- `revoke-key` does not sign `key_id`; a captured signature can revoke another active key owned by the
  same wallet.
- `list-keys` is lower impact but remains replayable for key metadata.
- No CLI or protocol-package caller uses `/api/keys`. Shared `buildSignMessage` and
  `@agentvouch/protocol` compatibility are out of scope.

## Scope

### In scope

- Web-only API-key auth payload and canonical message helper.
- Fresh UUIDv4 client nonce for list/create/revoke.
- Exact action, HTTP method, path, deployment origin, timestamp, nonce, and normalized name or key UUID binding.
- Additive, race-tolerant nonce table and atomic consume-before-side-effect behavior.
- Settings client, `/api/keys` route, and focused/full web regression coverage.

### Out of scope

- Identity, GitHub, connected-repository, publisher, download, or other wallet-auth routes.
- EVM/EIP-712 authentication, API-key permission redesign, key rotation, CLI changes, or contract work.
- Legacy acceptance for old Settings bundles. Old unsigned-object messages fail closed after deploy;
  users refresh and sign the current message.

## Canonical Envelope

Add `ApiKeyAuthPayload extends AuthPayload` with a required UUID nonce. Build exact messages with this
field order:

    AgentVouch API Key
    Action: list-keys | create-key | revoke-key
    Method: GET | POST | DELETE
    Path: /api/keys
    Audience: <window.location.origin>
    Name: <JSON string>       # create only
    Key id: <UUID>            # revoke only
    Nonce: <UUID>
    Timestamp: <unix_ms>

Normalize create names once: a string is trimmed, empty becomes `default`, and length must be at most
64 characters before signing or SQL. JSON-string encoding keeps embedded newlines from becoming
ambiguous message fields. Reject non-string names rather than allowing a server error.

Reconstruct the expected message from the canonical request fields and the route request origin, then
compare exact normalized text. Reject non-string messages and non-integer timestamps before scope
normalization. Do not parse arbitrary message fields into authority and do not add a legacy fallback.

## Replay Ledger

Add `api_key_auth_nonces` through the existing additive runtime initializer:

- `owner_pubkey VARCHAR(44)`;
- `nonce UUID`;
- `action VARCHAR(32)`;
- `consumed_at TIMESTAMPTZ DEFAULT NOW()`;
- `expires_at TIMESTAMPTZ`;
- primary key `(owner_pubkey, nonce)` and an expiry index.

Consume with one `INSERT ... ON CONFLICT DO NOTHING RETURNING` after signature and exact scope
verification but before any key query, creation, listing, lookup, or revocation. A duplicate returns a
conflict response and performs no operation. The owner-scoped primary key prevents one wallet from
pre-consuming another wallet’s random nonce.

A downstream failure may burn the nonce; that is safe fail-closed behavior and the client signs a fresh
one to retry. Keep consumed rows through at least the signature-valid window. Opportunistic expiry
cleanup runs in the same statement, deletes at most 100 rows older than an additional five-minute safety
buffer, and cannot create a SELECT-then-INSERT race or delete a still-replayable nonce. Prerequisite
queries remain after consumption deliberately: a signed request is one-time even if the requested
operation later fails.

## Files To Change

- `web/lib/authPayload.ts` or a focused `web/lib/apiKeyAuth.ts`: canonical envelope, normalization,
  payload type, nonce validation, and exact assertion.
- `web/lib/db.ts`: additive nonce table and expiry index.
- `web/app/api/keys/route.ts`: canonical field validation and atomic nonce consume for wallet auth.
- `web/app/settings/page.tsx`: fresh nonce plus normalized name or exact key ID in each signed request.
- `web/__tests__/lib/auth.test.ts` or focused helper tests.
- `web/__tests__/api/keys-route.test.ts`: route, substitution, replay, and bearer regressions.
- `web/__tests__/app/settings-page-source.test.ts`: current canonical client wiring.

## Verification

    export PATH="$HOME/.nvm/versions/node/v24.1.0/bin:$PATH"
    npm test --workspace @agentvouch/web -- --run __tests__/lib/auth.test.ts __tests__/api/keys-route.test.ts __tests__/app/settings-page-source.test.ts --maxWorkers=1 --no-fileParallelism
    npm run format:check
    npm run lint --workspace @agentvouch/web
    npm run typecheck --workspace @agentvouch/web
    npm test --workspace @agentvouch/web
    npm exec --workspace @agentvouch/web -- next build --webpack
    git diff --check

Acceptance requires:

- exact successful list/create/revoke wallet messages and deployment-audience binding;
- missing, malformed, reused, or expired nonce rejection;
- cross-action, cross-origin, changed timestamp, changed name, changed key ID, and changed method/path rejection;
- two concurrent requests with one signed nonce perform at most one operation;
- nonce-consume failure prevents every downstream side effect;
- normalized/default/newline-containing names have one unambiguous signed representation;
- bearer API-key GET remains unchanged;
- shared protocol/CLI message builders and tests remain unchanged.

## Rollout And Rollback

Ship route and Settings client together. Cached old Settings JavaScript fails closed until refresh.
No backfill or destructive migration is required.

Rollback the focused commit if necessary. The additive nonce table may remain unused; do not drop it in
the request path. Restoring the old route also restores its replay risk, so rollback requires an explicit
security acceptance.

## Follow-Ups

Identity, GitHub, connected-repository, publisher, and download signatures have separate scope/replay
properties. Audit them in separate plans/PRs; do not silently widen this fix.

## Internal Review — 2026-07-13

The focused security review found no Critical or High issue. It identified unbounded expired-row
retention, cross-deployment replay, and malformed-message handling. The final implementation adds
bounded expiry cleanup with a retention buffer, binds the signed deployment audience, validates runtime
message/timestamp shapes, and adds regressions for each. Per-instance rate limiting and the neighboring
wallet-auth route audit remain separate follow-ups.

## Completion — 2026-07-13

Local implementation is complete and independently deployable from the paid-report activation plan.
Focused coverage passed with 34 tests; the complete web gate passed formatting, lint, typecheck, 98 test
files / 654 tests, and the production webpack build. The runtime schema change is additive and requires no
backfill. No contract, chain deployment, activation, public-network write, or environment change was made.
