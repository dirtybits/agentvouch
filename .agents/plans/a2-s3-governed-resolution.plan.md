---
name: a2-s3-governed-resolution
overview: "Slice 3 for A2: replace one-shot dispute resolution with resolver proposal, config-authority cancellation, timelocked permissionless execution, and snapshot-based slashing setup."
todos:
  - id: proposal
    content: Add propose_author_dispute_resolution that validates resolver authority, records ruling/previews/snapshots/executable_at, and moves no funds
    status: pending
  - id: cancellation
    content: Add cancel_author_dispute_resolution that lets config authority clear pending proposals without moving funds or clearing locks
    status: pending
  - id: execution
    content: Add execute_author_dispute_resolution that enforces timelock, moves dispute/author bond funds, and preserves A1 slashing state
    status: pending
  - id: author-bond-serialization
    content: Update open_author_dispute to reject overlapping author-bond-exposing disputes while open_author_disputes is nonzero
    status: pending
  - id: slash-snapshot
    content: Update slash_dispute_vouches to use dispute slash_percentage_snapshot instead of live config
    status: pending
  - id: resolution-tests
    content: Add governed-flow tests for authority split, timelock, cancellation, free/paid/no-purchase branches, and A1 regressions
    status: pending
  - id: verify-resolution
    content: Run Anchor, generated-client, web/CLI, and root build checks required by new instruction interfaces
    status: pending
isProject: false
---

# A2 S3 - Governed Dispute Resolution

## Goal

Replace the current instant `resolve_author_dispute` path with a cancellable two-phase flow: resolver proposes, config authority can cancel during the timelock, and anyone can execute after maturity if the proposal still stands.

Drafted from `.agents/plans/a2-dispute-governance-v1.plan.md` and source inspection on 2026-06-19.

## Dependencies

- Depends on S1 state/events.
- Depends on S2 for `resolver_authority`, config handoff, and treasury role policy, but S3 can be code-reviewed in parallel if the state shape is stable.
- S4 must follow to finish refund-pool economics for purchase-attached paid disputes.

## Scope

- In scope: `propose_author_dispute_resolution`, `cancel_author_dispute_resolution`, `execute_author_dispute_resolution`, legacy `resolve_author_dispute` disposition, `open_author_dispute` author-bond serialization, `slash_dispute_vouches` snapshot use, tests.
- Out of scope: program-computed refund pool creation and close-expired-refund mechanics, except for state transitions that hand off cleanly to S4.

## Files To Change

- `programs/agentvouch/src/instructions/propose_author_dispute_resolution.rs`
- `programs/agentvouch/src/instructions/cancel_author_dispute_resolution.rs`
- `programs/agentvouch/src/instructions/execute_author_dispute_resolution.rs`
- `programs/agentvouch/src/instructions/resolve_author_dispute.rs`
- `programs/agentvouch/src/instructions/open_author_dispute.rs`
- `programs/agentvouch/src/instructions/slash_dispute_vouches.rs`
- `programs/agentvouch/src/instructions/mod.rs`
- `programs/agentvouch/src/lib.rs`
- `programs/agentvouch/src/events.rs`
- `programs/agentvouch/src/state/author_dispute.rs`
- `programs/agentvouch/src/state/settlement.rs`
- `tests/agentvouch-usdc-disputes.ts`
- `tests/agentvouch-usdc-slashing.ts`
- `tests/helpers/agentvouchUsdc.ts`
- Generated client/IDL artifacts after build

## Implementation Steps

1. Factor shared validation from `resolve_author_dispute`.
   - Preserve PDA and account relationship checks from the current resolver path.
   - Keep token mint, token owner, vault authority, treasury vault, dispute bond vault, author bond vault, listing, and settlement validations.
   - Avoid copying token movement into `propose`.

2. Implement `propose_author_dispute_resolution`.
   - Accounts should include `author_dispute`, `author_profile`, `skill_listing`, optional/remaining `listing_settlement` for paid disputes, `config`, and `resolver_authority: Signer`.
   - Require `resolver_authority.key() == config.resolver_authority`.
   - Require `author_dispute.status == Open`.
   - Record:
     - `status = ResolutionProposed`
     - `proposed_ruling`
     - computed refund preview
     - computed challenger reward preview
     - `slash_percentage_snapshot`
     - `challenger_reward_bps_snapshot`
     - `challenger_reward_cap_usdc_micros_snapshot`
     - `resolution_proposed_at`
     - `resolution_executable_at = now + config.resolution_timelock_seconds`
     - `resolution_proposer`
   - For Dismissed, refund/reward previews are zero.
   - For paid no-purchase disputes, refund/reward previews are zero.
   - Move no tokens.
   - Do not mutate reputation counters.
   - Do not clear listing or settlement locks.
   - Emit `AuthorDisputeResolutionProposed`.

3. Implement `cancel_author_dispute_resolution`.
   - Accounts: pending `author_dispute`, `config`, `config_authority: Signer`, plus listing/settlement accounts only if needed for validation.
   - Require `config_authority.key() == config.config_authority`.
   - Require `status == ResolutionProposed`.
   - Clear proposed ruling, preview amounts, economic snapshots, proposal timestamps, and proposer.
   - Set `status = Open`.
   - Do not move funds.
   - Do not mutate `open_author_disputes`.
   - Do not clear `SkillListing.locked_by_dispute` or `ListingSettlement.locked_by_dispute`.
   - Emit `AuthorDisputeResolutionCancelled`.

4. Implement `execute_author_dispute_resolution`.
   - Executor can be permissionless after maturity.
   - Require:
     - `status == ResolutionProposed`
     - `Clock::get()?.unix_timestamp >= resolution_executable_at`
     - proposal fields are present
   - Dismissed branch:
     - Transfer challenger dispute bond to `config.protocol_treasury_vault`.
     - Clear listing/settlement locks.
     - Decrement `author_profile.open_author_disputes`.
     - Increment dismissed counters and recompute reputation.
     - Set final `ruling`, `resolved_at`, and `status = Resolved`.
   - Upheld free `AuthorBondOnly` branch:
     - Return challenger dispute-bond principal.
     - Slash author bond if present.
     - Pay capped challenger reward from the author-bond slash.
     - Route residual slash to protocol reserve/treasury accounting.
     - Do not create refund pool and do not slash vouchers.
     - Clear locks and resolve.
   - Upheld paid financial branch:
     - Financial only when `liability_scope == AuthorBondThenVouchers` and `purchase.is_some()`.
     - Return challenger dispute-bond principal.
     - Slash author bond if present.
     - Transfer paid author-bond slash into the disputed listing's author proceeds vault.
     - Increment `listing_settlement.bond_slashed_deposit_usdc_micros`.
     - If linked vouches exist, enter `SlashingVouchers` and keep locks.
     - If no linked vouches, keep locks until S4 `create_refund_pool` consumes the refund path or finalizes a zero-capacity terminal case.
   - Upheld paid no-purchase branch:
     - Reputation-only in A2 v1.
     - No voucher slashing, no refund pool, no challenger reward.
     - Clear locks and resolve.
   - Emit `AuthorDisputeResolutionExecuted`.

5. Disable or replace legacy `resolve_author_dispute`.
   - Preferred: keep the instruction as a compatibility wrapper that fails with `UseGovernedResolutionFlow`.
   - Do not leave an instant config-authority bypass.
   - Update tests and generated clients accordingly.

6. Serialize author-bond exposure in `open_author_dispute`.
   - Reject new author disputes when `author_profile.open_author_disputes > 0`.
   - This applies because the author bond is profile-level shared collateral.
   - Do not rely on listing locks, because free disputes have no paid listing settlement lock.

7. Update `slash_dispute_vouches`.
   - Use `author_dispute.slash_percentage_snapshot` instead of `config.slash_percentage`.
   - Keep A1 paging, link-PDA double-slash guard, stale-position handling, and lock semantics.
   - Final slashing should leave locks in place when a refund pool is required.

## Invariants

- Proposal moves no funds.
- Timelock stores `resolution_executable_at` at proposal time; later config changes cannot shorten it.
- A bad pending proposal has an on-chain cancel remedy before execution.
- Canceled proposals cannot execute.
- Permissionless execution is only a liveness mechanism after the timelock.
- Paid no-purchase disputes cannot collide with voucher-slashing or refund-pool branches.
- A1 `SlashingVouchers` semantics remain intact for purchase-attached paid disputes with linked positions.

## Tests

Add or update tests in `tests/agentvouch-usdc-disputes.ts` and `tests/agentvouch-usdc-slashing.ts`:

- Resolver can propose; config authority cannot propose unless also resolver.
- Resolver cannot cancel; config authority can cancel.
- Proposal records snapshots and moves no USDC.
- Execute before `resolution_executable_at` fails.
- Cancel returns dispute to `Open`; later execute fails.
- Re-propose after cancel and execute after timelock succeeds.
- Config timelock/slash/reward changes after proposal do not alter pending proposal execution.
- Dismissed branch sends dispute bond to treasury and clears locks.
- Free upheld branch returns principal, pays capped reward from author bond slash, reserves residual, creates no refund pool.
- Paid purchase-attached branch with active vouches enters `SlashingVouchers`.
- Paid purchase-attached branch with no active vouches keeps locks for S4 refund creation.
- Paid no-purchase branch resolves reputation-only even with active vouches.
- Second concurrent author dispute fails while `open_author_disputes > 0`.
- `slash_dispute_vouches` uses snapshot slash percentage.
- Legacy `resolve_author_dispute` no longer bypasses the governed flow.

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

- This slice changes operator workflow. Dashboard, smoke, and docs should not be considered current until S5 updates surfaces.
- Timelock tests should use a short nonzero local value. Do not set production defaults to zero just to make tests easy.
- If local validator clock control is unavailable, use the shortest allowed local timelock and make the wait explicit in tests.

## Blockers

- Stop if S1 proposal fields are not present or not appended safely.
- Stop if S2 has not made `resolver_authority` explicit.
- Stop if any account path still lets `config_authority` perform one-shot final resolution.
