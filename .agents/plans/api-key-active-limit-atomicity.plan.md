---
name: api-key-active-limit-atomicity
overview: "Make the five-active-API-key quota atomic across concurrent, separately signed create-key requests without changing API-key authentication or existing key data."
todos:
  - id: define-atomic-key-create
    content: "Add an additive database helper that serializes a wallet's API-key creation, checks its active-key count, and inserts the new key in one transaction."
    status: pending
  - id: route-uses-atomic-create
    content: "Replace the create-key route's separate count and insert queries with the atomic helper and preserve the existing 400 quota response."
    status: pending
  - id: add-concurrency-regression
    content: "Add focused route and schema-source regressions proving a full quota cannot insert and that key creation no longer depends on a split read-then-write check."
    status: pending
  - id: verify-api-key-limit
    content: "Run focused API-key tests plus format, lint, typecheck, full web Vitest, webpack build, and git diff checks."
    status: pending
isProject: false
---

# Make The API-Key Active Limit Atomic

## Goal

Ensure the existing five-active-API-key limit is enforced when a wallet submits multiple valid, distinct `create-key` requests concurrently. The implementation must retain the current canonical nonce/object binding and preserve existing active keys.

## Verified Gap — 2026-07-14

- `web/app/api/keys/route.ts` checks `SELECT id FROM api_keys ... revoked_at IS NULL` and, only after that query returns, issues a separate `INSERT` (lines 137–158 as inspected on 2026-07-14).
- No database constraint or transactional serialization currently bounds active keys per `owner_pubkey`; two requests that both observe fewer than five rows can each insert a key.
- The current one-time nonce ledger prevents replay of *one* wallet signature, but a wallet can sign multiple fresh nonces. It intentionally does not serialize independent, valid creation requests.

## Scope

### In scope

- Atomic enforcement of the existing `>= 5` active-key quota for `POST /api/keys`.
- Additive PostgreSQL helper DDL using the repository's runtime-initializer retry pattern.
- Focused API route and schema-source regression coverage.

### Out of scope

- Changes to the five-key product limit, API-key permissions, bearer authentication, nonce semantics, API-key rotation, or deletion/revocation behavior.
- Any destructive migration, new dependency, chain/protocol change, or external database operation.
- Broad authentication-route auditing; the API-key nonce/object hardening remains in `.agents/plans/api-key-signature-nonce-object-binding.plan.md`.

## Files To Change

- `web/lib/db.ts`: add an additive `create_api_key_with_active_limit` PL/pgSQL helper to core schema DDL. It must take owner, hash, prefix, and normalized name; acquire a transaction-scoped advisory lock keyed by the owner; count only `revoked_at IS NULL` rows *after* acquiring the lock; insert and return the public key metadata only when the count is below five.
- `web/app/api/keys/route.ts`: call the helper once after nonce consumption. Return the existing quota error when the helper returns no row; do not reintroduce a standalone preflight count.
- `web/__tests__/api/keys-route.test.ts`: cover the helper's returned-row and no-row route handling and assert the old split count query is absent.
- `web/__tests__/lib/db-source.test.ts`: assert the additive helper and its per-owner transaction-scoped serialization are present in bootstrap DDL.
- `.agents/plans/api-key-active-limit-atomicity.plan.md`: maintain execution status and dated divergence notes.

## Implementation Steps

1. Add `create_api_key_with_active_limit` through `runCoreSchemaDdl()` as `CREATE OR REPLACE FUNCTION` with a `RETURNS TABLE` shape matching the route's current insert response (`id`, `key_prefix`, `name`, `permissions`, `created_at`). Follow the existing initializer's retry-safe function convention.
2. In the PL/pgSQL body, acquire `pg_advisory_xact_lock` for the owner-specific key before executing the active-row count. This must happen in an earlier PL/pgSQL statement than the count so a waiting request takes a fresh read-committed snapshot after the prior create commits.
3. If the count is five or more, return no rows. Otherwise insert the supplied values, return only non-secret metadata, and leave raw-key generation/hashing in the route.
4. Replace the route's `SELECT id` plus separate `INSERT` with one helper call. A zero-row result returns the exact existing 400 message: `Maximum 5 active API keys allowed. Revoke an existing key first.`
5. Extend test mocks for helper success and quota exhaustion. Add source-level assertions that prevent restoring the split active-key lookup. Do not claim true parallel database execution from a mocked route test; the function's lock/count/insert composition is the concurrency invariant.

## Verification

```bash
export PATH="$HOME/.nvm/versions/node/v24.1.0/bin:$PATH"
npm test --workspace @agentvouch/web -- --run __tests__/api/keys-route.test.ts __tests__/lib/db-source.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm test --workspace @agentvouch/web
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria:

- a create succeeds below five active keys and returns the same public response shape;
- a quota-exhausted create returns the existing 400 error and does not create a raw key response;
- route code has no independent `SELECT id FROM api_keys` preflight before insertion;
- the database helper serializes by owner, counts only non-revoked rows, and inserts within the same helper invocation;
- nonce consumption remains before the helper, so replay behavior stays fail-closed;
- no migration, data backfill, chain action, or environment change is introduced.

## Rollout

Deploy the helper and route together in the ordinary Vercel/PR flow. The runtime initializer applies only additive helper DDL. Existing key rows need no backfill.

## Rollback

Revert the route commit if needed. The unused additive function may remain; do not drop it at request time. Reverting restores the known concurrent quota-bypass risk, so document that security trade-off explicitly.

## Blockers

- Stop if the deployed Neon/Postgres role cannot create the helper function or if a transaction-scoped advisory lock cannot be exercised by the serverless driver.
- Stop if an implementation requires a non-additive constraint, a quota-policy change, or a new dependency; those require explicit approval under `AGENTS.md`.
