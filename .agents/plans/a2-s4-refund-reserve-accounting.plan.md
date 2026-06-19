---
name: a2-s4-refund-reserve-accounting
overview: "Slice 4 for A2: make refund pools program-computed, buyer-first, reserve-aware, and closable after expiry."
todos:
  - id: computed-refund-pool
    content: Rewrite create_refund_pool so pool amount is computed from buyer exposure and available capacity, not caller-selected
    status: pending
  - id: buyer-first-reward
    content: Apply buyer-first allocation before capped challenger reward and exclude slash buckets from reward base
    status: pending
  - id: slash-bucket-drain
    content: Drain bond and voucher slash buckets as refund-only money before eligible author proceeds and prevent author withdrawal
    status: pending
  - id: residual-reserve
    content: Route paid slash residuals above buyer exposure to protocol reserve/treasury accounting with sweep protection
    status: pending
  - id: close-refund-pool
    content: Add close_refund_pool for expired unclaimed balances, routing residuals to reserve/treasury and emitting RefundPoolClosed
    status: pending
  - id: refund-tests
    content: Add Anchor tests for underfunding prevention, buyer-first math, slash buckets, residual reserve, expiry close, and lock clearing
    status: pending
  - id: verify-refunds
    content: Run Anchor, generated-client, web/CLI, and root build checks required by refund instruction changes
    status: pending
isProject: false
---

# A2 S4 - Refund And Reserve Accounting

## Goal

Close the H3/M3 class of failures: a permissionless caller can crank refund-pool creation, but cannot choose a tiny pool, clear locks, or strand buyer/refund funds. Paid dispute money is buyer-first, slash buckets are never author-withdrawable, and expired refund balances have an owner.

Drafted from `.agents/plans/a2-dispute-governance-v1.plan.md` and source inspection on 2026-06-19.

## Dependencies

- Depends on S1 settlement/config reserve fields.
- Depends on S3 governed resolution setting final status and slash buckets.
- Coordinates with S2 `sweep_treasury` so reserved funds are not swept as ordinary treasury.

## Scope

- In scope: `create_refund_pool`, `close_refund_pool`, refund/reserve accounting, claim compatibility, lock clearing, tests, IDL/client refresh.
- Out of scope: broad affected-buyer reserve policy beyond the single attached purchase, A4 reserve backstop, web UI beyond generated client impact.

## Files To Change

- `programs/agentvouch/src/instructions/create_refund_pool.rs`
- `programs/agentvouch/src/instructions/close_refund_pool.rs`
- `programs/agentvouch/src/instructions/claim_purchase_refund.rs`
- `programs/agentvouch/src/instructions/withdraw_author_proceeds.rs`
- `programs/agentvouch/src/instructions/mod.rs`
- `programs/agentvouch/src/lib.rs`
- `programs/agentvouch/src/state/settlement.rs`
- `programs/agentvouch/src/state/config.rs`
- `programs/agentvouch/src/events.rs`
- `tests/agentvouch-usdc-disputes.ts`
- `tests/agentvouch-usdc-slashing.ts`
- `tests/helpers/agentvouchUsdc.ts`
- Generated client/IDL artifacts after build

## Implementation Steps

1. Rewrite refund amount selection.
   - Keep `create_refund_pool` permissionless after dispute reaches the correct terminal state.
   - Remove caller-selected `requested_refund_pool_usdc_micros` as the amount source.
   - If an argument remains for client compatibility, treat it as a minimum-output or exact-expected guard that cannot lower the computed amount.
   - Compute:
     - `max_purchase_refund_exposure = author_dispute.skill_price_usdc_micros_snapshot` when `purchase.is_some()`, else `0`.
     - `available_refund_capacity = withdrawable_author_proceeds_usdc_micros + slashed_deposit_usdc_micros + bond_slashed_deposit_usdc_micros`.
     - `buyer_first_refund_pool = min(max_purchase_refund_exposure, available_refund_capacity)`.
   - Require pool amount is nonzero unless the S3 branch explicitly marks a zero-capacity paid dispute as terminal and lock-clearable.

2. Apply buyer-first challenger reward math.
   - Compute the refund pool before challenger reward.
   - If available capacity is less than or equal to buyer exposure, challenger reward is zero.
   - Reward base is only remaining eligible withdrawable author proceeds after buyer-first allocation.
   - Exclude both slash buckets:
     - `slashed_deposit_usdc_micros`
     - `bond_slashed_deposit_usdc_micros`
   - Use `author_dispute.challenger_reward_bps_snapshot` and `author_dispute.challenger_reward_cap_usdc_micros_snapshot`, not live config.
   - Use floor division in micro-USDC.

3. Move tokens and decrement buckets in an auditable order.
   - Drain refund-only buckets before author proceeds:
     - First `bond_slashed_deposit_usdc_micros`.
     - Then voucher `slashed_deposit_usdc_micros`.
     - Then withdrawable author proceeds.
   - Decrement every source bucket by exactly the amount consumed.
   - Increment `refunded_author_proceeds_usdc_micros` only for proceeds-funded refunds if the existing accounting expects that semantic.
   - Never make a slash bucket author-withdrawable.
   - Transfer challenger reward only after buyer refund funding is determined.

4. Route residual slash funds.
   - Any paid slash bucket amount above buyer exposure routes to protocol reserve/treasury accounting.
   - If using shared treasury vault, transfer residual to `protocol_treasury_vault` and increment `config.reserved_treasury_usdc_micros`.
   - If using a reserve PDA/vault, transfer residual there instead and make S2 sweep rules aware of it.
   - Emit enough event data to reconcile residual source bucket and reserve amount.

5. Clear locks only after accounting is complete.
   - Keep `ListingSettlement.locked_by_dispute` and `SkillListing.locked_by_dispute` until the refund pool has been created or a proven zero-capacity/no-purchase branch has finalized.
   - Do not clear locks when an undersized caller argument fails.
   - Do not clear locks if token transfers fail.

6. Add `close_refund_pool`.
   - Permissionless after `refund_pool.claim_deadline` has passed.
   - Reject close before deadline.
   - Transfer remaining refund vault balance to protocol reserve/treasury accounting.
   - Decrement/zero `remaining_pool_usdc_micros` and record closure if the account is retained, or close the account if safe and supported by account constraints.
   - Never route expired refund funds to the author by default.
   - Emit `RefundPoolClosed`.

7. Keep `claim_purchase_refund` compatibility.
   - Existing one-claim-per-purchase PDA remains the double-claim guard.
   - Claim amount remains bounded by purchase price, pool cap, and remaining pool.
   - Claim after deadline still fails.
   - Closing after deadline is the owned path for unclaimed balances.

8. Confirm `withdraw_author_proceeds`.
   - It must read only `withdrawable_author_proceeds_usdc_micros`.
   - It must reject locked settlements.
   - It must never touch either slash bucket.

## Invariants

- Permissionless refund cranks cannot underfund a buyer pool.
- Buyer-first allocation happens before challenger reward.
- Challenger reward excludes all slash buckets.
- Slash buckets cannot become author-withdrawable.
- Residual dispute-derived funds are reserved until A4 policy says otherwise.
- Expired refund funds are not stranded and are not author-reclaimed.
- Lock clearing is a consequence of successful accounting, not caller input.

## Tests

Add or extend refund/slashing tests:

- Caller passes `1` micro-USDC or an undersized amount and cannot create a tiny pool or clear locks.
- Overlarge caller amount fails or is ignored according to the implemented guard.
- Underfunded paid dispute sends all available capacity to buyer refund and pays zero challenger reward.
- Fully funded paid dispute funds buyer first, then pays capped challenger reward from remaining eligible proceeds.
- Voucher slash bucket and author-bond slash bucket are separate and both excluded from reward base.
- Slash buckets drain before eligible author proceeds.
- Residual slash above buyer exposure routes to reserve/treasury and increments reserved accounting.
- Author cannot withdraw slash buckets or reserved residuals.
- Claim before deadline succeeds.
- Claim after deadline fails.
- Close before deadline fails.
- Close after deadline transfers unclaimed balance to reserve/treasury, emits `RefundPoolClosed`, and cannot be repeated for value.
- Paid no-purchase dispute cannot create a refund pool.
- `create_refund_pool` still fails while dispute is `SlashingVouchers`.

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

- Do not update `web/public/skill.md` until the program-computed amount behavior is deployed.
- S5 must update smoke scripts that currently pass explicit refund amounts.
- A4 owns broader reserve/backstop policy. S4 only ensures A2 funds have an owner and cannot be swept accidentally.

## Blockers

- Stop if S2 treasury sweep does not reserve/exclude dispute-derived funds.
- Stop if S3 still allows purchase-attached paid disputes to resolve and clear locks without refund accounting.
- Stop if account constraints cannot positively distinguish protocol treasury from settlement/refund/reward vaults.
