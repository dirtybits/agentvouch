---
name: a2-s5-clients-smoke-readiness
overview: "Slice 5 for A2: regenerate clients, update web/CLI/operator surfaces, smoke the clean-break devnet program, and sync readiness docs."
todos:
  - id: generated-clients
    content: Rebuild Anchor IDL, sync web/agentvouch.json, regenerate curated web client and protocol package exports
    status: pending
  - id: web-hooks
    content: Update web dispute hooks and author-dispute status helpers for propose/cancel/execute and ResolutionProposed
    status: pending
  - id: operator-ui
    content: Update dashboard dispute controls for pending proposals, cancellation, execution, and timelock states
    status: pending
  - id: cli-and-smoke
    content: Update CLI compatibility and devnet smoke script for resolver/config/treasury roles and program-computed refunds
    status: pending
  - id: docs-runbooks
    content: Update ROADMAP, MAINNET_READINESS, PRODUCTION_RUNBOOK, DEVNET_STATE, and web/public/skill.md only when behavior/deploy evidence is real
    status: pending
  - id: final-verification
    content: Run full Anchor, generated-client, web, CLI, root build, devnet smoke, deployed binary/IDL checks, and final diff/security review
    status: pending
isProject: false
---

# A2 S5 - Clients, Smoke, And Readiness

## Goal

Make the implemented A2 program usable and auditable outside Anchor tests: generated clients line up with the IDL, web/operator surfaces use the governed flow, CLI and smoke scripts understand new roles and program-computed refunds, and readiness docs match deployed devnet evidence.

Drafted from `.agents/plans/a2-dispute-governance-v1.plan.md` and source inspection on 2026-06-19.

## Dependencies

- Depends on S1 through S4 implementation.
- Should be the final implementation slice before external/security review.
- May be split into web/CLI/docs sub-branches if the code changes are large, but the final verification must run against one integrated branch.

## Scope

- In scope: generated artifacts, curated client exports, web hooks/UI, CLI compatibility, smoke scripts, runbooks, readiness docs, devnet clean-break evidence.
- Out of scope: changing A2 protocol behavior, mainnet deployment, A3 pause, A4 refund reserve policy.

## Files To Change

- `web/scripts/generate-client.ts`
- `web/agentvouch.json`
- `web/generated/agentvouch/`
- `packages/agentvouch-protocol/src/index.ts`
- `packages/agentvouch-protocol/src/index.js`
- `packages/agentvouch-protocol/src/index.d.ts`
- `web/hooks/useReputationOracle.ts`
- `web/lib/authorDisputes.ts`
- `web/app/dashboard/page.tsx`
- `packages/agentvouch-cli/src/lib/solana.ts`
- `scripts/devnet-usdc-smoke.mjs`
- `docs/ROADMAP.md`
- `docs/MAINNET_READINESS.md`
- `docs/PRODUCTION_RUNBOOK.md`
- `docs/DEVNET_STATE.md`
- `web/public/skill.md`
- `.well-known/agentvouch.json` if program ID or public metadata changes there

## Implementation Steps

1. Regenerate Anchor and curated clients.
   - Run `NO_DNA=1 anchor build`.
   - Copy `target/idl/agentvouch.json` to `web/agentvouch.json`.
   - Run `npm run generate:client`.
   - Update `web/scripts/generate-client.ts` curated exports:
     - Add `proposeAuthorDisputeResolution`.
     - Add `cancelAuthorDisputeResolution`.
     - Add `executeAuthorDisputeResolution`.
     - Add `updateConfig`.
     - Add `nominateConfigAuthority`.
     - Add `acceptConfigAuthority`.
     - Add `rotateAuthorities`.
     - Add `sweepTreasury`.
     - Add `closeRefundPool`.
     - Remove `resolveAuthorDispute` from public exports if S3 makes it a hard-failing legacy wrapper.
   - Confirm generated `programs/agentvouch.ts` remains excluded if that is still the local curated-client pattern.

2. Update web data/status helpers.
   - In `web/lib/authorDisputes.ts`, add `ResolutionProposed` labels and active-status behavior.
   - Preserve memcmp offsets or update them intentionally if S1 moved layout fields.
   - In `web/hooks/useReputationOracle.ts`, replace one-shot resolution calls with explicit propose/cancel/execute callbacks.
   - Replace any resolver authorization that reads legacy `config.authority`; propose should check `resolverAuthority`, cancel should check `configAuthority`, execute can be permissionless after maturity.
   - Fix any hardcoded `status === 0 ? "Open" : "Resolved"` logic.
   - Expose proposal timestamps, executable timestamp, snapshots, refund preview, and reward preview where operator surfaces need them.

3. Update dashboard/operator UI.
   - Replace Upheld/Dismiss immediate buttons with propose actions for the resolver.
   - Show pending proposal state when `ResolutionProposed`.
   - Show cancel action for config authority.
   - Show execute action when the timelock has matured, available to any connected wallet if the UX supports permissionless execution.
   - Avoid implying execution is possible before `resolution_executable_at`.
   - Keep copy concise and operational; this is an admin/operator surface, not a marketing page.

4. Update CLI compatibility.
   - Rebuild type imports from `web/agentvouch.json` and `target/types/agentvouch`.
   - If the CLI exposes no dispute commands, verify it still builds and that program/config types compile.
   - If operator commands are added, keep them devnet-only and explicit about resolver/config/treasury roles.

5. Update smoke script.
   - Replace one-shot resolve with:
     - propose
     - optionally cancel and re-propose in the A2 smoke path
     - wait/advance according to local timelock
     - execute
     - slash pages when applicable
     - create program-computed refund pool
     - claim refund
     - close expired refund pool in a dedicated expiry smoke if practical
   - Add separate envs or CLI flags for resolver authority, config authority, treasury authority, and smoke payer.
   - Remove required explicit refund amount unless it is only an expected/minimum guard.
   - Log proposal/executable timestamps, slash snapshots, `bond_slashed_deposit_usdc_micros`, reserve amounts, and tx signatures.

6. Update docs only when true.
   - `docs/ROADMAP.md`: mark A2 implementation status and any sequencing changes.
   - `docs/MAINNET_READINESS.md`: move A2 from plan/design to implemented/devnet-live only after evidence exists.
   - `docs/PRODUCTION_RUNBOOK.md`: add authority policy, proposal/cancel/execute runbook, treasury sweep policy, monitoring events, and incident response for bad pending resolutions.
   - `docs/DEVNET_STATE.md`: update only after clean-break deploy/init/smoke with program ID, ProgramData, deploy tx/slot, config pubkeys, binary hash, IDL account, and smoke txs.
   - `web/public/skill.md`: update only after live program behavior matches new instruction names and refund semantics.

7. Perform devnet clean-break verification when code is ready.
   - Follow the repo clean-break guidance: new program ID, DB cleanup, IDL/client sync, config initialization, fresh smoke state.
   - Do not claim devnet-live until the smoke passes from clean state.

## Invariants

- Public clients and web code must not call stale one-shot resolution.
- `ResolutionProposed` must be treated as active, not resolved.
- UI and docs must not claim buyer refunds beyond the single attached purchase until A4/indexer scope exists.
- `web/public/skill.md` must describe the deployed program, not an unshipped branch.
- Devnet evidence must include binary/IDL matching proof, not only a successful local build.

## Tests And Verification

Local final checks:

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

Devnet clean-break checks after deployment:

```bash
AGENTVOUCH_SMOKE_AUTHORITY_KEYPAIR=~/dev-keypair.json npm run smoke:devnet-usdc -- --apply --state-dir ".agent-keys/a2-devnet-dispute-smoke-$(date +%s)" --skill-id "a2smoke-$(date +%s)"
solana program dump -u devnet <PROGRAM_ID> /tmp/agentvouch_devnet.so
shasum -a 256 target/deploy/agentvouch.so
LOCAL_LEN=$(wc -c < target/deploy/agentvouch.so)
head -c $LOCAL_LEN /tmp/agentvouch_devnet.so | shasum -a 256
```

Also verify the on-chain IDL semantically matches `target/idl/agentvouch.json` and `web/agentvouch.json`.

## Rollout Notes

- Keep mainnet marked no-go after A2 until A3 pause/emergency controls, A4 reserve policy, authority custody, and external/senior review are complete.
- If devnet deployment uses a fresh program ID, update every program ID surface in one branch and verify no stale public artifacts remain.
- If any smoke path requires manual waiting for the timelock, record exact wall-clock timestamps and tx signatures.

## Blockers

- Stop if S1-S4 did not run client generation after IDL changes.
- Stop if dashboard code still imports `getResolveAuthorDisputeInstruction` as the active path.
- Stop if docs would imply mainnet readiness before A3/A4 and authority custody are complete.
