---
name: a3-emergency-pause
overview: "Implement roadmap A3 / readiness P0.3: make the existing paused flag and pause_authority operational with a small set_paused instruction, tests, generated clients, and runbook updates."
todos:
  - id: design-lock
    content: Lock the A3-lite pause policy: paused blocks new risk and purchases, while safe exits stay allowed unless a handler can worsen protocol exposure
    status: completed
  - id: set-paused-instruction
    content: Add set_paused gated by config.pause_authority, emit PauseStateChanged, and register the instruction in mod.rs/lib.rs
    status: completed
  - id: pause-guard-audit
    content: Audit every instruction for paused behavior and add/remove guards so the implemented policy matches the test matrix
    status: completed
  - id: tests
    content: Add Anchor coverage for pause authority, idempotent pause/unpause, blocked risky flows, allowed safe exits, and x402 bridge pause behavior
    status: completed
  - id: clients-and-scripts
    content: Rebuild IDL, sync web/agentvouch.json, regenerate clients, and update helper/client exports for set_paused
    status: completed
  - id: docs-and-runbook
    content: Update source/readiness/runbook docs for A3; defer DEVNET_STATE.md and web/public/skill.md until deployed behavior changes
    status: completed
  - id: verification
    content: Run local build/test/diff checks; devnet pause smoke remains pending before treating A3 as launch-alpha ready
    status: in_progress
isProject: false
---

# A3 - Emergency Pause

## Goal

Turn AgentVouch's existing `ReputationConfig.paused` flag into a real emergency brake before a capped mainnet alpha. A `pause_authority` signer can pause or unpause the protocol, risky new activity stops while paused, and safe exit/claim paths remain available when they do not increase exposure.

Design target as of 2026-06-18:

1. **A3-lite, not full governance.** Ship a narrow `set_paused(paused: bool)` instruction. Authority rotation and richer governance remain A2 or later governance work.
2. **Pause blocks new risk.** Creating new protocol exposure should fail while paused.
3. **Pause should avoid trapping buyer/user claims.** Buyer refund claims and voucher revenue claims stay open.
4. **Pause preserves author-side recovery collateral.** Author proceeds and author-bond withdrawals stay blocked while paused because they can drain funds needed during incident response.
5. **Pause authority is explicit.** Only `config.pause_authority` can toggle the flag.
6. **The current guards become real.** Existing `require!(!config.paused, ...)` checks stop being dead code once `set_paused` exists.

## Scope

- In scope: Anchor program instruction, events, pause guard audit, tests, generated clients, helper/smoke updates, readiness/runbook docs.
- In scope: x402 bridge behavior because `web/lib/x402ProtocolBridge.ts` already fails closed when `config.paused` is true.
- Out of scope: A2 dispute governance, A4 reserve policy, multisig setup, authority rotation, treasury sweep, mainnet deployment itself.

## Source Context

Verified 2026-06-18 against this worktree on `feat/a3-emergency-pause`:

- `ReputationConfig` already has `pause_authority: Pubkey` and `paused: bool` in `programs/agentvouch/src/state/config.rs`.
- `initialize_config` already accepts `pause_authority` and sets `config.paused = false`.
- `docs/MAINNET_READINESS.md` P0.3 says no instruction sets `paused`, making pause guards dead code.
- `docs/ROADMAP.md` already defines A3 as `set_paused` gated on `pause_authority`.
- `docs/USDC_NATIVE_MIGRATION.md` states the intended policy: paused blocks new risk and purchases, while authority rotation, unpause, disputes, claims, withdrawals, revokes, and close flows may remain allowed when normal invariants permit them.
- Existing paused guards are present in:
  - `create_skill_listing.rs`
  - `update_skill_listing.rs`
  - `initialize_listing_settlement.rs`
  - `deposit_author_bond.rs`
  - `vouch.rs`
  - `link_vouch_to_listing.rs`
  - `purchase_skill.rs`
  - `settle_x402_purchase.rs`
  - `open_author_dispute.rs`
  - `withdraw_author_proceeds.rs`
  - `claim_purchase_refund.rs`
- Instructions without paused checks include:
  - `register_agent.rs`
  - `withdraw_author_bond.rs`
  - `revoke_vouch.rs`
  - `claim_voucher_revenue.rs`
  - `resolve_author_dispute.rs`
  - `slash_dispute_vouches.rs`
  - `create_refund_pool.rs`
  - `unlink_vouch_from_listing.rs`
  - `remove_skill_listing.rs`
  - `close_skill_listing.rs`
  - migration instructions

## Pause Policy

Blocked while paused:

- `create_skill_listing`
- `update_skill_listing`
- `initialize_listing_settlement`
- `deposit_author_bond`
- `vouch`
- `link_vouch_to_listing`
- `purchase_skill`
- `settle_x402_purchase`
- `open_author_dispute`
- `withdraw_author_proceeds`
- `withdraw_author_bond`

Allowed while paused:

- `set_paused(false)` to unpause.
- `register_agent`, because it does not move USDC or create direct financial exposure.
- `revoke_vouch`, if normal dispute/open-lock invariants permit it.
- `claim_voucher_revenue`.
- `claim_purchase_refund`.
- `resolve_author_dispute`, `slash_dispute_vouches`, and `create_refund_pool` for A1/A2 cleanup and refunds, unless implementation finds a concrete incident case where they worsen exposure.
- `unlink_vouch_from_listing`, `remove_skill_listing`, and `close_skill_listing` when their existing dispute/ownership/status checks permit them, because these reduce or retire exposure.
- migration instructions only in controlled devnet/upgrade flows, not as normal user actions.

Decision locked 2026-06-19: `claim_purchase_refund` should be allowed while paused because it pays buyers from an already-created refund pool. `withdraw_author_proceeds` should remain blocked, and `withdraw_author_bond` should gain a pause guard, because both can drain recovery collateral before operators understand an incident.

## Files To Change

- `programs/agentvouch/src/instructions/set_paused.rs`: new instruction.
- `programs/agentvouch/src/instructions/mod.rs`: register module and export context.
- `programs/agentvouch/src/lib.rs`: add `set_paused(ctx, paused)`.
- `programs/agentvouch/src/events.rs`: add `PauseStateChanged`.
- `programs/agentvouch/src/instructions/*.rs`: audit paused guards against the policy above.
- `tests/agentvouch-usdc.ts` or `tests/agentvouch-usdc-governance.ts`: config/pause authority tests.
- `tests/agentvouch-usdc-marketplace.ts`, `tests/agentvouch-usdc-disputes.ts`, and `tests/agentvouch-usdc-slashing.ts`: paused behavior coverage where existing fixtures make sense.
- `tests/helpers/agentvouchUsdc.ts`: helper for `setPaused`.
- `web/scripts/generate-client.ts`: curated export for `setPaused`, if needed.
- `scripts/devnet-usdc-smoke.mjs`: optional pause/unpause smoke step.
- `web/lib/x402ProtocolBridge.ts`: verify no code change needed beyond tests/docs; it already fails closed when `config.paused`.
- `docs/MAINNET_READINESS.md`
- `docs/PRODUCTION_RUNBOOK.md`
- `docs/ROADMAP.md`, only if sequencing/status changes.
- `docs/DEVNET_STATE.md`, only after devnet deployment/smoke.
- `web/public/skill.md`, only after live deployed behavior changes.

## Implementation Steps

1. **Lock the pause policy in tests first.**
   - Buyer refund claims stay allowed.
   - Voucher revenue claims stay allowed.
   - Author proceeds and author-bond withdrawals stay blocked until unpaused.
   - Document the reason: paused mode preserves recovery collateral during incident response.

2. **Add `set_paused`.**
   - Accounts:
     - mutable `config` PDA, seeds `[b"config"]`
     - `pause_authority: Signer`
   - Require `pause_authority.key() == config.pause_authority`.
   - Set `config.paused = paused`.
   - Allow idempotent calls (`true -> true`, `false -> false`) unless there is a specific reason to reject them.
   - Emit `PauseStateChanged { config, pause_authority, paused, timestamp }`.

3. **Register the instruction.**
   - Add `pub mod set_paused;` and `pub use set_paused::*;` in `instructions/mod.rs`.
   - Add `pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()>` in `lib.rs`.

4. **Audit pause guards.**
   - Keep guards on new-risk paths listed as blocked.
   - Add missing guards only for risky paths that lack them.
   - Remove or intentionally keep guards on exit paths according to the design decision.
   - Keep x402 bridge fail-closed behavior aligned with on-chain `settle_x402_purchase`.

5. **Add tests.**
   - Test unauthorized pause fails.
   - Test `pause_authority` can pause and unpause.
   - Test idempotent pause/unpause.
   - Test at least one representative blocked flow from each risk family:
     - listing creation/update
     - author bond deposit
     - vouch/link
     - direct purchase
     - x402 settlement if test scaffolding exists
     - open dispute
   - Test safe exits according to the locked policy:
     - author proceeds withdrawal or explicitly documented blocked behavior
     - author bond withdrawal
     - vouch revoke
     - voucher revenue claim
     - purchase refund claim
     - listing remove/close where normal conditions permit
   - Test `web/lib/x402ProtocolBridge.ts` fail-closed behavior if the web suite already has bridge tests.

6. **Regenerate IDL and clients.**
   - Run Anchor build.
   - Sync `target/idl/agentvouch.json` to `web/agentvouch.json`.
   - Run `npm run generate:client`.
   - Update curated exports if `setPaused` is not exported.

7. **Update docs/runbook.**
   - `docs/MAINNET_READINESS.md`: mark P0.3 as implemented only after tests pass; before deploy, say source implemented/pending devnet smoke.
   - `docs/PRODUCTION_RUNBOOK.md`: add pause authority, when to pause, exact command/script, what remains allowed, unpause procedure, and post-incident review.
   - `docs/DEVNET_STATE.md`: update only after devnet deployment/smoke evidence exists.
   - `web/public/skill.md`: update only after live program behavior and public agent-facing instructions reflect `set_paused`.

## Test Matrix

1. `set_paused(true)` by non-pause authority fails.
2. `set_paused(true)` by `pause_authority` succeeds and emits `PauseStateChanged`.
3. `set_paused(false)` by `pause_authority` succeeds and emits `PauseStateChanged`.
4. Repeating pause or unpause is deterministic and does not corrupt config.
5. Paused blocks create/update listing.
6. Paused blocks initialize listing settlement.
7. Paused blocks author-bond deposit.
8. Paused blocks vouch creation.
9. Paused blocks link-to-listing.
10. Paused blocks direct purchase.
11. Paused blocks x402 settlement or the bridge fails before transaction construction.
12. Paused blocks opening a new author dispute.
13. Paused blocks author proceeds withdrawal.
14. Paused blocks author-bond withdrawal.
15. Paused still allows vouch revoke when no open dispute exists.
16. Paused still allows voucher revenue claim.
17. Paused still allows purchase refund claim.
18. Paused still allows listing remove/close when normal no-lock/status checks pass.
19. Unpaused restores the blocked flows.

## Verification

Run from repo root after implementation:

```bash
NO_DNA=1 anchor build
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
NO_DNA=1 anchor test
npm run test --workspace @agentvouch/web
npm run test --workspace @agentvouch/cli
npm run build --workspace @agentvouch/web
npm run build --workspace @agentvouch/cli
npm run build
git diff --check
```

Devnet smoke before treating A3 as launch-alpha ready:

```bash
AGENTVOUCH_SMOKE_AUTHORITY_KEYPAIR=~/dev-keypair.json npm run smoke:devnet-usdc -- --apply --state-dir .agent-keys/a3-pause-smoke --skill-id a3pause-<date>
```

The smoke should include at minimum: set paused true, prove a purchase or vouch flow fails, set paused false, prove the same flow succeeds.

## Rollout

1. Implement and verify locally.
2. Open PR from `feat/a3-emergency-pause` into `main`.
3. Review as a small launch-safety PR independent of A2.
4. Deploy to devnet after merge or from the reviewed branch.
5. Record deploy slot, tx, binary hash, IDL evidence, pause authority, and smoke txs in `docs/DEVNET_STATE.md`.
6. Only then update mainnet-alpha readiness language.

## Rollback

- Pre-mainnet: redeploy the prior devnet program and restore matching IDL/client artifacts if the pause change breaks flows.
- If accidentally paused on devnet/mainnet alpha, unpause with the configured `pause_authority`.
- If `pause_authority` is compromised, use upgrade/config governance runbook procedures; A3-lite does not add authority rotation.

## Blockers / Open Questions

- `withdraw_author_proceeds` and `withdraw_author_bond` are deliberately blocked while paused to preserve recovery collateral. If a later incident response policy wants author-side exits during pause, update the runbook and tests first.
- Operator setup: production `pause_authority` should not be an ordinary hot wallet for a mainnet alpha.
- A3 does not solve A2 dispute governance or A4 reserve automation. It only adds the brake pedal needed to launch a tightly capped alpha more safely.
