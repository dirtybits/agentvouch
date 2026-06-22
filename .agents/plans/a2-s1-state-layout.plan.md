---
name: a2-s1-state-layout
overview: "Slice 1 for A2: add the account layout, constants, initializer defaults, and events required by dispute governance before touching money movement."
todos:
  - id: config-layout
    content: Add resolver/timelock/config-handoff/reserve fields and constants to ReputationConfig, update LEN, and keep legacy authority non-authorizing
    status: pending
  - id: dispute-layout
    content: Append ResolutionProposed and pending-resolution/economic-snapshot fields to AuthorDispute without moving author/filter offsets
    status: pending
  - id: settlement-layout
    content: Add a separate paid author-bond slash refund bucket to ListingSettlement and update LEN
    status: pending
  - id: init-and-helpers
    content: Update initialize_config, scripts, and Anchor test helpers for resolver authority and resolution timelock defaults
    status: pending
  - id: events
    content: Add A2 governance, authority, treasury, and refund-close events with indexer-friendly fields
    status: pending
  - id: verify-state
    content: Run Anchor build plus IDL/client generation checks that prove layout and initializer changes compile
    status: pending
isProject: false
---

# A2 S1 - State Layout And Events

## Goal

Land the A2 account/interface shape first so later agents can implement authority governance, proposed resolutions, refund accounting, and clients without repeatedly changing account sizes. This slice should compile and regenerate the IDL, but it should not implement the new settlement behavior yet.

Drafted from `.agents/plans/a2-dispute-governance-v1.plan.md` and source inspection on 2026-06-19.

## Dependencies

- Depends on the current A1 devnet source only.
- Must happen before S2, S3, S4, and S5.
- A2 remains a devnet clean break. Do not extend `migrate_config_m13` for these layout changes.

## Scope

- In scope: state structs, constants, `LEN` values, event structs, config initialization arguments/defaults, test helper defaults, generated IDL/client refresh.
- Out of scope: `update_config`, authority rotation, propose/cancel/execute behavior, refund-pool computation, treasury sweeping, UI changes, deployment.

## Files To Change

- `programs/agentvouch/src/state/config.rs`
- `programs/agentvouch/src/state/author_dispute.rs`
- `programs/agentvouch/src/state/settlement.rs`
- `programs/agentvouch/src/events.rs`
- `programs/agentvouch/src/instructions/initialize_config.rs`
- `tests/helpers/agentvouchUsdc.ts`
- `scripts/init-config.ts`
- `scripts/init-agentvouch-config.ts`
- `scripts/devnet-usdc-smoke.mjs`
- Generated after build: `target/idl/agentvouch.json`, `target/types/agentvouch.ts`, `web/agentvouch.json`, `web/generated/agentvouch/`, `packages/agentvouch-protocol/src/index.{ts,js,d.ts}`

## Implementation Steps

1. Update `ReputationConfig`.
   - Add `resolver_authority: Pubkey`.
   - Add `resolution_timelock_seconds: i64`.
   - Add `pending_config_authority: Option<Pubkey>` for the S2 two-step config handoff.
   - Add `reserved_treasury_usdc_micros: u64` if A2 reserve funds share `protocol_treasury_vault`. This is the S2/S4 guard that prevents dispute-derived reserve funds from being swept as ordinary treasury funds.
   - Add constants:
     - `DEFAULT_RESOLUTION_TIMELOCK_SECONDS: i64 = 259_200`
     - `MIN_RESOLUTION_TIMELOCK_SECONDS: i64` with a nonzero floor selected by the implementation, documented in tests. Local tests may initialize a shorter nonzero value, but config setters must enforce the floor for production-like configs.
   - Update `ReputationConfig::LEN`.
   - Keep `authority` as legacy/inert metadata. Do not add new authorization checks against `authority`.

2. Update `AuthorDispute`.
   - Append `AuthorDisputeStatus::ResolutionProposed` to preserve existing enum encodings.
   - Append pending-resolution fields after the current fields, so existing memcmp assumptions such as author offset do not move:
     - `proposed_ruling: Option<AuthorDisputeRuling>`
     - `computed_refund_pool_preview_usdc_micros: u64`
     - `computed_challenger_reward_preview_usdc_micros: u64`
     - `slash_percentage_snapshot: u8`
     - `challenger_reward_bps_snapshot: u16`
     - `challenger_reward_cap_usdc_micros_snapshot: u64`
     - `resolution_proposed_at: Option<i64>`
     - `resolution_executable_at: Option<i64>`
     - `resolution_proposer: Option<Pubkey>`
   - Update `AuthorDispute::LEN`.
   - Do not rename `ruling` or `resolved_at`; S3 will decide when those final fields are set.

3. Update `ListingSettlement`.
   - Add `bond_slashed_deposit_usdc_micros: u64` next to `slashed_deposit_usdc_micros`.
   - Keep the two buckets distinct:
     - `slashed_deposit_usdc_micros` is voucher-slash money.
     - `bond_slashed_deposit_usdc_micros` is paid-listing author-bond slash money.
   - Update `ListingSettlement::LEN`.
   - Do not mix author-bond slash into the voucher bucket.

4. Update `initialize_config`.
   - Add `resolver_authority` and `resolution_timelock_seconds` inputs, or default resolver to `config_authority` only if the caller omits it through a local helper wrapper.
   - Initialize `pending_config_authority = None`.
   - Initialize `reserved_treasury_usdc_micros = 0`.
   - Enforce a nonnegative timelock during init, and prefer enforcing the production floor unless tests need a local-only helper.
   - Preserve existing split, slash, mint, and chain-context validation.

5. Update scripts and tests helpers.
   - In `tests/helpers/agentvouchUsdc.ts`, add `resolverAuthority` to `TestContext` if separate from `configAdmin`.
   - Update helper calls around `initializeConfig`.
   - Update config init scripts and smoke scripts so devnet initialization does not silently assign the wrong resolver authority.

6. Add events in `events.rs`.
   - `AuthorDisputeResolutionProposed`
   - `AuthorDisputeResolutionCancelled`
   - `AuthorDisputeResolutionExecuted`
   - `ReputationConfigUpdated`
   - `AuthorityRotated`
   - `TreasurySwept`
   - `RefundPoolClosed`
   - Include enough fields for monitors: config/dispute/listing accounts, actor signer, role name where applicable, ruling, executable timestamp, refund amount, reward amount, slash bucket totals, treasury/reserve amounts, and timestamp.

7. Register no new instructions in this slice except whatever `initialize_config` signature already exposes through `lib.rs`.

## Invariants

- Existing `AuthorDispute` fields used by filters are not moved unless every downstream filter is updated in the same commit.
- A2 adds new authority fields, but `authority` remains non-authorizing.
- A2 reserve funds have an explicit accounting field or a separate reserve PDA before any sweep instruction ships.
- Account `LEN` constants match Borsh/Anchor serialization sizes.

## Tests

- Add or update initializer tests in `tests/agentvouch-usdc.ts` or a new governance test file:
  - resolver authority initializes to the expected pubkey.
  - timelock initializes to the expected value.
  - pending config authority starts `None`.
  - reserved treasury amount starts `0`.
  - invalid timelock or invalid economic values fail.
- Update any existing test fixture that deserializes `ReputationConfig`, `AuthorDispute`, or `ListingSettlement`.

## Verification

Run from repo root:

```bash
NO_DNA=1 anchor build
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
NO_DNA=1 anchor test
npm run build
git diff --check
```

If full `anchor test` is too slow during iteration, the final slice handoff still requires it before marking `verify-state` completed.

## Rollout Notes

- This slice changes account layouts. Treat it as devnet clean-break work.
- Do not update `docs/DEVNET_STATE.md` or `web/public/skill.md` until the new program is actually deployed and smoked.
- If an implementer attempts same-program migration, stop and write a separate migration plan first.

## Blockers

- If `reserved_treasury_usdc_micros` cannot safely live on `ReputationConfig`, choose and document a dedicated reserve PDA before S2/S4.
- If Anchor account-size changes fail for generated clients, fix generation before moving to instruction slices.
