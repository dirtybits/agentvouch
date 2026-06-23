---
name: Milestone 3 Rewrite
overview: Execute the USDC-native Anchor rewrite as a controlled protocol break, keeping on-chain account/interface changes ahead of web/UI work and verifying each phase before expanding scope.
todos:
  - id: baseline
    content: Run and record baseline build/check/search results before editing
    status: completed
  - id: account-model
    content: Rewrite account structs, config roles, constants, and USDC field names
    status: completed
  - id: instruction-interfaces
    content: Update instruction account constraints, args, PDA vaults, recipient ATAs, and events
    status: completed
  - id: token-logic
    content: Implement SPL token movement and accounting clusters in dependency order
    status: completed
  - id: program-tests
    content: Add positive, negative, compute, and account-count tests for USDC primitives
    status: completed
  - id: idl-client-sync
    content: Sync IDL, regenerate web client, then fix web/API/CLI integration fallout
    status: completed
isProject: false
---

# Milestone 3 USDC Rewrite Plan

## Process

Use the existing spec docs as source of truth, not as the execution checklist: [`docs/USDC_NATIVE_MIGRATION.md`](/Users/andysustic/Repos/agent-reputation-oracle/docs/USDC_NATIVE_MIGRATION.md) and [`.cursor/plans/usdc_milestone_1_protocol_spec.plan.md`](/Users/andysustic/Repos/agent-reputation-oracle/.cursor/plans/usdc_milestone_1_protocol_spec.plan.md).

Create Milestone 3 as a compile-first sequence. Do not touch web/UI until the Anchor account model, instruction signatures, events, and IDL compile coherently.

## Phase 0: Baseline

- Confirm the branch is clean and already on `feat/usdc-native-v0.2.0`.
- Run baseline checks: `NO_DNA=1 anchor build`, `cargo check --manifest-path programs/agentvouch/Cargo.toml`, and targeted searches for existing lamport business fields.
- Capture known baseline failures before editing so new failures are attributable.

## Phase 1: Account Model And Config

Start here.

- Add `anchor-spl = "0.32.1"` in [`programs/agentvouch/Cargo.toml`](/Users/andysustic/Repos/agent-reputation-oracle/programs/agentvouch/Cargo.toml).
- Update [`programs/agentvouch/src/state/config.rs`](/Users/andysustic/Repos/agent-reputation-oracle/programs/agentvouch/src/state/config.rs) for USDC mint, token program, role authorities, treasury/settlement vaults, economic constants, reputation constants, pause state, and bumps.
- Update account structs in [`programs/agentvouch/src/state/`](/Users/andysustic/Repos/agent-reputation-oracle/programs/agentvouch/src/state/) from lamports/SOL fields to `*_usdc_micros` and reward-index fields.
- Add new bounded accounts/constants: `ListingVouchPosition`, `MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING`, and `MAX_DISPUTE_POSITIONS_PER_TX`.
- Remove or quarantine v0.1 migration-only account paths that cannot survive the fresh layout.

Gate: `cargo check` should fail only on instruction code that still expects old fields, not on account definitions or imports.

## Phase 2: Instruction Interfaces

- Rewrite account constraints and instruction args before writing full business logic.
- Add explicit token-account PDA vaults and canonical recipient ATA constraints.
- Update events in [`programs/agentvouch/src/events.rs`](/Users/andysustic/Repos/agent-reputation-oracle/programs/agentvouch/src/events.rs) to emit `*_usdc_micros`, protocol version, program/listing/user keys, and vault references.
- Keep `settle_x402_purchase` out of core implementation unless the bridge POC is intentionally in scope.

Gate: `NO_DNA=1 anchor build` should produce a coherent `agentvouch` IDL, even if not all tests pass yet.

## Phase 3: Token Movement And Accounting

Implement instruction clusters in dependency order:

1. `initialize_config`, `register_agent`, role/pause helpers.
2. Author bond deposit/withdraw with USDC vaults.
3. Vouch/revoke with stake vaults and reputation recalculation.
4. Listing create/update/remove/close plus reward vault lifecycle.
5. Direct `purchase_skill` with author ATA payout and voucher reward index update.
6. Voucher revenue claim.
7. Dispute open/resolve with dispute bond vaults and batched linked-position settlement.

Gate: every USDC-moving instruction validates mint, token program, token owner, PDA seeds, amount > 0, and post-transfer state where needed.

## Phase 4: Program Tests

- Add focused tests for each money-moving primitive before web integration.
- Cover positive and negative cases: wrong mint, wrong token program, missing ATA, wrong owner, insufficient USDC, active dispute locks, overflow, and account-count bounds.
- Measure compute and account counts for purchase, claim, open dispute, dismissed dispute, max link batch, and max slash batch.

Gate: `NO_DNA=1 anchor test` or the selected fast local test path passes for program behavior.

## Phase 5: IDL And Client Sync

Only after the on-chain IDL is stable enough to integrate:

```bash
NO_DNA=1 anchor build
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
npm run build --workspace @agentvouch/web
```

Then fix generated-client fallout in hooks, API, CLI, and scripts. Prioritize generated type errors over manual string searches.

## Review Strategy

Keep commits/PRs reviewable by phase, not by single instruction if that creates broken transitional shims. The first reviewable checkpoint should be account model + config + compiling instruction interface, followed by token movement clusters and tests.