---
name: base-port-chain-adapter-phase-8b
overview: "BLOCKED gate plan: cut the AgentVouch default over to Base mainnet (eip155:8453) only after the Phase 9 v1 trust/security gates and mainnet contract/RPC/USDC/paymaster prerequisites all exist."
todos:
  - id: confirm-8b-prerequisites
    content: Confirm every prerequisite in the gate checklist (Phase 9 v1 contract + security review, mainnet deploy, RPC/USDC/paymaster env, custody policy, runbook) with recorded evidence before any code change.
    status: pending
  - id: enable-mainnet-adapter
    content: Extend getAdapter()/chain config to accept eip155:8453 with mainnet contract/RPC/USDC/paymaster values, removing the Phase 8a mainnet rejection with explicit tests.
    status: pending
  - id: flip-mainnet-default
    content: Flip getDefaultChainContext() default from Base Sepolia to Base mainnet behind the same env rollback seam, keeping Solana and Sepolia selectable as configured.
    status: pending
  - id: verify-phase8b
    content: Run the full local gate suite plus a mainnet smoke (register/list/buy/raw download with real funds policy approved by the human) and record evidence before rollout.
    status: pending
isProject: false
---

# Phase 8b - Base Mainnet Cutover [BLOCKED]

## Status

**BLOCKED.** Do not start this plan until every item in the gate checklist below has recorded
evidence. Any code that enables `eip155:8453` before then is a stop-the-line bug (see the Phase 8a
plan). This file exists so 8a and 8b cannot be conflated: 8a is the reversible Base **Sepolia**
default; 8b is the mainnet cutover, a separate decision with its own prerequisites.

## Goal

Flip the AgentVouch default chain from Base Sepolia (`eip155:84532`) to Base mainnet
(`eip155:8453`) once — and only once — the trust, security, and infrastructure gates pass.
Solana stays selectable; the Phase 8a env rollback seam keeps working as the emergency switch.

## Context

- Umbrella plan: `.agents/plans/base-port-chain-adapter.plan.md` (Phase 8 section, PR #58 review
  2026-06-29 defined the two-gate split).
- Phase 8a (`.agents/plans/base-port-chain-adapter-phase-8a.plan.md`) makes Base Sepolia the
  default behind a Solana rollback env and explicitly rejects `eip155:8453`.
- Phase 9 (`.agents/plans/base-port-chain-adapter-phase-9.plan.md`) owns the Base Sepolia E2E
  proof and the minimal Base v1 trust layer, ownership policy, and security review that gate this
  plan.
- The current Base contract is the `base-poc-v0` spike (`contracts/base-poc/src/AgentVouchEvm.sol`).
  It must not ship to mainnet as is.

## Gate Checklist (all required before starting)

Record evidence (PR links, tx hashes, doc versions) next to each item when checked:

- [ ] Phase 9 Part A complete: Base Sepolia default proven E2E (human passkey + agent x402 + raw
      download + Solana regression).
- [ ] Phase 9 Part B complete: Base v1 trust/payment contract implemented (vouch/revoke, author
      bond, founder-resolved reports/disputes, version getter) with forge + web tests green.
- [ ] Internal security review and one external security pass on the v1 contract, or an explicit
      human-recorded acceptance.
- [ ] Ownership/custody policy documented and applied: multisig (or documented alternative) holds
      DEFAULT_ADMIN_ROLE / CONFIG_ROLE / RESOLVER_ROLE / TREASURY_ROLE / SETTLEMENT_ROLE /
      PAUSE_ROLE.
- [ ] Mainnet `AgentVouchEvm` v1 deployed, address recorded in a Base deployment state doc.
- [ ] Mainnet RPC env (server + client names) provisioned and archive-capable where reads need it.
- [ ] Base mainnet native USDC address configured and verified.
- [ ] CDP mainnet paymaster/bundler exists with a funded gas policy and recorded spend limits.
- [ ] `getAdapter()` accepts `eip155:8453` behind tests (currently it deliberately rejects it).
- [ ] Mainnet deploy/cutover runbook drafted and `docs/MAINNET_READINESS.md` updated.

## Scope (once unblocked)

- Chain config: accept `eip155:8453` in `getAdapter()`/`web/lib/adapters/*` with mainnet
  contract/RPC/USDC/paymaster values; remove the Phase 8a mainnet rejection and replace the
  "mainnet-blocked" tests with "mainnet-enabled" equivalents.
- Default flip: `getDefaultChainContext()` defaults to `eip155:8453`; Sepolia and Solana remain
  reachable via the existing env seam. The Phase 8a rollback env (set both server and client
  values, then redeploy) stays the emergency switch.
- Trust surfaces: mainnet Base authors flow through the Phase 9 trust reads/snapshots; no
  synthesized trust.
- Docs: update `docs/MAINNET_READINESS.md`, deployment state doc, and `web/public/skill.md` for
  mainnet semantics.

Out of scope:

- Removing Solana or Sepolia support.
- Multi-EVM beyond Base.
- Any trust/contract feature work — that belongs to Phase 9; this plan only cuts over.

## Verification

- Full local gate suite (format, lint, typecheck, vitest, webpack build).
- Mainnet smoke with human-approved funds policy: register/list/buy/raw download plus x402
  settlement evidence (tx hashes, USDC deltas, entitlement rows).
- Rollback rehearsal: prove the env rollback (set env + redeploy) restores the prior default in a
  preview before production rollout.

## Rollback

- Set the Phase 8a rollback envs to the previous default (Sepolia or Solana) and redeploy —
  `NEXT_PUBLIC_*` values are build-time inlined, so an env change alone is not a runtime switch.
- If the mainnet contract itself is the problem, `setPaused(true)` under PAUSE_ROLE per the v1
  ownership policy, then follow the incident runbook.
