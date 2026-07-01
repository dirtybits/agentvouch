---
name: a2-s2-authority-governance
overview: "Slice 2 for A2: add governed config setters, two-step authority handoff, role rotation, and reserve-aware treasury sweeping."
todos:
  - id: update-config
    content: Implement config-authority-gated update_config with explicit optional fields and invariant checks
    status: pending
  - id: config-handoff
    content: Implement nominate_config_authority and accept_config_authority for two-step config authority rotation
    status: pending
  - id: rotate-roles
    content: Implement role rotation for resolver, treasury, settlement, and pause authorities with AuthorityRotated events
    status: pending
  - id: treasury-sweep
    content: Implement treasury-authority-gated sweep_treasury with positive source binding and reserve exclusion
    status: pending
  - id: governance-tests
    content: Add Anchor tests for authority separation, invalid config updates, handoff failures, rotation, and treasury sweep constraints
    status: pending
  - id: verify-governance
    content: Run Anchor, generated-client, web/CLI, and root build checks required by authority/interface changes
    status: pending
isProject: false
---

# A2 S2 - Authority Governance

## Goal

Give A2 a safe control plane before dispute settlement changes move funds: config updates are explicit and bounded, config authority rotation is two-step, live roles can be rotated without redeploying, and treasury sweeps cannot withdraw reserved dispute funds.

Drafted from `.agents/plans/a2-dispute-governance-v1.plan.md` and source inspection on 2026-06-19.

## Dependencies

- Depends on S1 state fields:
  - `resolver_authority`
  - `resolution_timelock_seconds`
  - `pending_config_authority`
  - `reserved_treasury_usdc_micros` or a chosen reserve PDA
- Can be implemented before S3/S4, and should be tested independently before money movement changes.

## Scope

- In scope: `update_config`, `nominate_config_authority`, `accept_config_authority`, `rotate_authorities`, `sweep_treasury`, events, errors, tests, IDL/client refresh.
- Out of scope: dispute resolution proposal/execution, refund-pool creation, pause implementation from A3, Squads operational setup.

## Files To Change

- `programs/agentvouch/src/instructions/update_config.rs`
- `programs/agentvouch/src/instructions/nominate_config_authority.rs`
- `programs/agentvouch/src/instructions/accept_config_authority.rs`
- `programs/agentvouch/src/instructions/rotate_authorities.rs`
- `programs/agentvouch/src/instructions/sweep_treasury.rs`
- `programs/agentvouch/src/instructions/mod.rs`
- `programs/agentvouch/src/lib.rs`
- `programs/agentvouch/src/events.rs`
- `programs/agentvouch/src/state/config.rs`
- `tests/agentvouch-usdc-governance.ts` or equivalent
- `tests/helpers/agentvouchUsdc.ts`
- Generated client/IDL artifacts after build

## Implementation Steps

1. Add shared validation helpers if useful.
   - Reuse `ReputationConfig::validate_splits()`.
   - Keep validation close enough to `update_config` that tests can map each failure to one error.
   - Add explicit errors rather than reusing misleading ones.

2. Implement `update_config`.
   - Accounts: mutable `config`, `config_authority: Signer`.
   - Require `config_authority.key() == config.config_authority`.
   - Accept explicit optional fields for mutable economic/config values:
     - `min_vouch_stake_usdc_micros`
     - `dispute_bond_usdc_micros`
     - `min_author_bond_for_free_listing_usdc_micros`
     - `min_paid_listing_price_usdc_micros`
     - `author_share_bps`, `voucher_share_bps`, `protocol_fee_bps`
     - `slash_percentage`
     - `author_proceeds_lock_seconds`
     - `refund_claim_window_seconds`
     - `challenger_reward_bps`
     - `challenger_reward_cap_usdc_micros`
     - `resolution_timelock_seconds`
     - `chain_context`, only if the implementation intentionally supports it.
   - Enforce:
     - shares sum to `10_000`
     - bps fields `<= 10_000`
     - `slash_percentage <= 100`
     - lock/window/timelock values are nonnegative
     - `resolution_timelock_seconds >= MIN_RESOLUTION_TIMELOCK_SECONDS`
     - `chain_context.len() <= MAX_CHAIN_CONTEXT_LEN`
   - Emit `ReputationConfigUpdated` with changed fields or a compact before/after summary.

3. Implement two-step config authority handoff.
   - `nominate_config_authority`:
     - Gated by current `config.config_authority`.
     - Sets `pending_config_authority = Some(nominee)`.
     - Rejects default pubkeys.
     - Emits `AuthorityRotated` or a specific nomination event.
   - `accept_config_authority`:
     - Signed by pending nominee.
     - Requires `pending_config_authority == Some(signer)`.
     - Sets `config_authority = signer`, clears pending.
     - Emits `AuthorityRotated` with role `config_authority`.
   - Old config authority must fail after acceptance.

4. Implement `rotate_authorities`.
   - Gated by `config.config_authority`.
   - Rotate one or more of:
     - `resolver_authority`
     - `treasury_authority`
     - `settlement_authority`
     - `pause_authority`
   - Do not rotate legacy `authority` unless a live authorization path is found and documented.
   - Reject default pubkeys for live roles.
   - Emit `AuthorityRotated` per changed role.
   - Do not enforce separation of duties on-chain unless product explicitly wants that tradeoff. Enforce it in tests/runbooks as a production policy.

5. Implement `sweep_treasury`.
   - Accounts: mutable `config`, signer `treasury_authority`, `protocol_treasury_vault`, destination token account, `usdc_mint`, token program.
   - Require `treasury_authority.key() == config.treasury_authority`.
   - Positively bind source: `protocol_treasury_vault.key() == config.protocol_treasury_vault`.
   - Validate source and destination mint match `config.usdc_mint`.
   - Validate token program matches `config.token_program`.
   - Compute sweepable amount:
     - If using shared treasury vault: `vault.amount.saturating_sub(config.reserved_treasury_usdc_micros)`.
     - If using reserve PDA/vault: exclude that PDA/vault entirely.
   - Require `amount <= sweepable_amount`.
   - Transfer to a treasury-authority-owned or explicitly configured destination.
   - Emit `TreasurySwept`.

6. Register instructions.
   - Follow existing `instructions/mod.rs` and `lib.rs` module/wrapper style.
   - Keep names explicit. Do not overload old migration instructions.

## Invariants

- Resolver authority cannot mutate config.
- Config authority cannot accidentally be bricked by one-step self-rotation.
- Treasury authority cannot sweep refund vaults, settlement vaults, reward vaults, x402 vaults, author/vouch vaults, or reserved dispute funds.
- Mutable config cannot shorten an already proposed dispute. S3 must store `resolution_executable_at` at proposal time; S2 only provides the config value.
- Legacy `config.authority` remains non-authorizing.

## Tests

Add a dedicated governance suite if possible:

- `update_config` succeeds for valid changes and emits an event.
- Invalid share sums fail.
- bps above `10_000` fail.
- slash percentage above `100` fails.
- negative windows/locks/timelock fail.
- timelock below floor fails.
- resolver cannot call `update_config`.
- `nominate_config_authority` rejects wrong signer and default nominee.
- `accept_config_authority` rejects wrong nominee, succeeds for nominee, and old authority fails afterward.
- role rotation makes old resolver/treasury fail and new role succeed.
- `sweep_treasury` rejects wrong source vault even if signer is treasury authority.
- `sweep_treasury` rejects wrong mint/token program.
- `sweep_treasury` cannot sweep `reserved_treasury_usdc_micros`.

## Verification

Run from repo root:

```bash
NO_DNA=1 anchor build
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
NO_DNA=1 anchor test
npm run test --workspace @agentvouch/web
npm run test --workspace @agentvouch/cli
npm run build
git diff --check
```

## Rollout Notes

- Mainnet/RC runbooks must set config, resolver, treasury, settlement, and pause roles to multisig/governance controlled keys.
- Production separation of duties is a policy requirement: resolver, treasury, and config roles must not be the same ordinary hot wallet.
- Do not update `docs/DEVNET_STATE.md` until role rotation is actually performed on devnet.

## Blockers

- Stop if S1 did not add a reserve accounting model. A reserve-aware sweep without reserve state is just a treasury drain with better naming.
- Stop if any instruction still accepts `config.authority` as a live authority unless that is intentionally brought into the rotation policy.
