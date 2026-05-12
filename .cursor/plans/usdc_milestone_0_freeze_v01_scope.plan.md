---
name: Milestone 0 - Freeze v0.1.0 Scope
overview: Mark the current SOL-denominated devnet protocol as legacy, align agent guidance with the USDC-native target, and keep new work pointed at v0.2.0.
todos:
  - id: mark-v01-legacy
    content: Confirm current docs describe v0.1.0 as SOL-denominated legacy scope
    status: completed
  - id: rewrite-agents-usdc-native
    content: Rewrite AGENTS.md learned workspace facts so future agents follow the v0.2.0 USDC-native target design
    status: completed
  - id: decide-v01-writes
    content: Decide whether v0.1.0 write actions remain visible until v0.2.0 is usable or are hidden immediately
    status: completed
  - id: verify-milestone-0
    content: Run Milestone 0 verification searches and lint checks
    status: completed
isProject: false
---

# Milestone 0 - Freeze v0.1.0 Scope

## Goal

Stop treating the existing SOL-denominated devnet program as the future protocol. Use it as readable scaffolding only while the `v0.2.0` USDC-native rewrite is specified and implemented.

## Non-Goals

- Do not edit Anchor program logic in Milestone 0.
- Do not generate the `v0.2.0` program keypair yet.
- Do not change web write flows yet.
- Do not solve the x402 settlement bridge POC here; carry it forward as a Milestone 1 / Pre-Milestone 3 blocker.

## Source Of Truth

- `docs/USDC_NATIVE_MIGRATION.md` remains the durable migration spec and roadmap.
- This plan is the working tracker for Milestone 0 execution only.
- Update the migration doc only if a durable design decision changes.

## Decisions

- `v0.1.0` remains readable during the rewrite for legacy devnet display and comparison.
- New trust and commerce write work targets `v0.2.0`.
- `AGENTS.md` should describe the USDC-native target design clearly enough that agents do not default back to legacy SOL-denominated patterns.
- Default UI posture: keep `v0.1.0` write actions available only as temporary legacy/devnet paths until `v0.2.0` is usable, but label or gate new product work as `v0.2.0`.

## Execution Checklist

### 1. Branch And Scope

- [x] Create `feat/usdc-native-v0.2.0` from current `main`.
- [x] Set the active Cursor branch to `feat/usdc-native-v0.2.0`.
- [x] Confirm the branch starts from a clean `main`.
- [x] Keep this branch focused on the USDC-native rewrite and related docs/plans.

### 2. Legacy Scope Freeze

- [x] Confirm `docs/USDC_NATIVE_MIGRATION.md` marks `v0.1.0` as legacy and keeps `v0.2.0` as the target for new work.
- [x] Keep `v0.1.0` readable during the rewrite for legacy devnet display and comparison.
- [x] Preserve the rule that new trust and commerce write work targets `v0.2.0`.
- [x] Avoid adding new trust features to `v0.1.0`.

### 3. AGENTS.md Alignment

- [x] Rewrite `AGENTS.md` learned workspace facts to cover the target `v0.2.0` design:
  - `v0.2.0` as the USDC-native devnet rewrite and `v1.0.0` as first mainnet-ready release.
  - Fresh program ID / deploy keypair plan.
  - Per-primitive USDC vault model.
  - CAIP-2 chain context conventions.
  - Protocol-listed paid purchases preserving the `60%` author / `40%` voucher split.
  - x402 bridge POC gating before x402 is enabled for protocol-listed paid skills.
  - Direct `purchase_skill` as the canonical protocol-visible paid purchase path until the bridge passes.
- [x] Keep legacy SOL-denominated guidance explicitly scoped to current `v0.1.0` devnet behavior.
- [x] Preserve unrelated durable workspace facts in `AGENTS.md`.

### 4. UI Write Posture

- [x] Default decision: keep existing `v0.1.0` write actions as temporary legacy/devnet paths until `v0.2.0` is usable.
- [x] Do not extend `v0.1.0` write actions with new trust or commerce features.
- [x] Revisit user-facing hide/label behavior in the web integration milestones.

### 5. Verification

- [x] Run verification searches from `docs/USDC_NATIVE_MIGRATION.md`.
- [x] Check lints for edited markdown files.
- [ ] Review final `git diff` before committing Milestone 0 changes.
- [ ] Commit Milestone 0 changes when ready.

## Acceptance Criteria

- `AGENTS.md` reflects the target USDC-native protocol and does not present SOL-denominated listing, staking, or purchase rules as the future design.
- New work is clearly directed toward `v0.2.0` unless explicitly marked as `v0.1.0` maintenance.
- Verification searches pass or show only intentional legacy references.
- Milestone 1 can begin without agent guidance pulling implementation back toward SOL-denominated account layouts, purchases, staking, or reputation.

## Completion Record

Completed:

- Branch `feat/usdc-native-v0.2.0` created and activated.
- `AGENTS.md` updated to scope the SOL marketplace as `v0.1.0` legacy/devnet scaffolding.
- `AGENTS.md` now names the `v0.2.0` USDC-native target and core design defaults.
- Verification searches and lint checks passed.

Remaining before closing Milestone 0:

- Review final diff.
- Commit Milestone 0 plan and `AGENTS.md` changes.

## Handoff To Milestone 1

Start Milestone 1 with a separate plan file. Do not start the broad Anchor rewrite until these design points are closed or explicitly moved into the Pre-Milestone 3 gates:

- x402 bridge POC shape: settlement vault owner, payer extraction, idempotency, retry/refund path.
- Exact account and PDA seed model for `AgentProfile`, `AuthorBond`, `Vouch`, `SkillListing`, `Purchase`, `X402SettlementReceipt`, dispute accounts, and vault token accounts.
- Final economic floors.
- Reputation formula, score caps, rounding, and overflow behavior.
- Voucher reward index math and revoke/slash eligibility.
- Authority model: config, treasury, settlement, pause, and mainnet multisig requirements.
- ERC-8004 / Solana Agent Registry binding shape.

## Verification

```bash
rg "legacy|USDC-native|SOL-denominated|v0.2.0" docs
rg "USDC-native|v0.2.0|per-primitive|CAIP-2|x402 bridge" AGENTS.md
```
