---
name: base-gate-label-clarity
overview: "Give each Base deployment gate and AgentVouch protocol requirement a topic-specific label, using clear and consistent technical English."
todos:
  - id: inventory-labels
    content: Inventory reader-facing Base Gate A-D and protocol requirement A1-A5 labels and define the canonical names
    status: completed
  - id: update-docs
    content: Update the activation plan, deployment runbook, state record, readiness table, and related plan headings with topic-specific labels
    status: completed
  - id: verify-terminology
    content: Verify that bare gate labels are removed from reader-facing prose and run the documentation formatting checks
    status: completed
isProject: false
---

# Clarify Base Gate Labels

## Goal

Make every Base gate label identify its chain scope, sequence, and topic. Readers must not confuse
the Base Sepolia deployment stages with the cross-chain AgentVouch protocol requirements.

## Scope

- In scope: reader-facing headings, tables, cross-references, and decision-record text in Base plans
  and operations documents.
- In scope: a short terminology note that defines both naming systems.
- Out of scope: file names, command names, JSON field names, contract identifiers, environment
  variables, historical transaction evidence, and gate status changes.

## Canonical Labels

- `Base Sepolia Deployment Gate A — Candidate Verification`
- `Base Sepolia Deployment Gate B — Paused Deployment`
- `Base Sepolia Deployment Gate B1 — Deploy Without Initialization`
- `Base Sepolia Deployment Gate B2 — Verify, Pause, Configure, and Transfer Roles`
- `Base Sepolia Deployment Gate C — Isolated Lifecycle Test`
- `Base Sepolia Deployment Gate D — Preview and Shared Testnet Activation`
- `AgentVouch Protocol Requirement A1 — Voucher Slashing`
- `AgentVouch Protocol Requirement A2 — Governed Dispute Resolution`
- `AgentVouch Protocol Requirement A3 — Emergency Pause`
- `AgentVouch Protocol Requirement A4 — Refund and Restitution Reserve`
- `AgentVouch Protocol Requirement A5 — Test and Security Review`

## Files To Change

- `.agents/plans/base-paid-report-activation-sepolia.plan.md`: rename deployment-stage headings and
  cross-references.
- `.agents/plans/a1-voucher-slashing.plan.md`, `.agents/plans/a2-*.plan.md`, and
  `.agents/plans/a3-emergency-pause.plan.md`: identify A1-A3 as protocol requirements in headings.
- `docs/BASE_DEPLOY.md`: use the canonical deployment gate names in procedures.
- `docs/BASE_SEPOLIA_A1_STATE.md`: use the canonical deployment gate names in decision records.
- `docs/ROADMAP.md`, `docs/MAINNET_READINESS.md`, `docs/DEVNET_STATE.md`, and
  `docs/CHAIN_CAPABILITY_MAP.md`: name A1-A5 as protocol requirements and explain the two naming
  systems.

## Writing Rules

- Use one topic per label and paragraph.
- Use short sentences and active voice where practical.
- Use the same term for the same concept.
- Keep historical statuses and technical meaning unchanged.
- Do not claim full ASD-STE100 conformance; use its clarity principles as guidance.

## Verification

- Search the changed documents for unexplained bare `Gate A`, `Gate B`, `Gate C`, `Gate D`, and
  reader-facing `A1` through `A5` labels.
- Run `npm run format:check`.
- Review the rendered Markdown structure and confirm that links and anchors remain understandable.

## Rollback

Revert this documentation-only commit. No runtime, database, contract, wallet, or deployment state
changes are part of this work.

## Blockers

- None. This change does not authorize any deployment stage or change any gate status.

## Design Note — 2026-08-01

The initial inventory called A1-A5 “Base mainnet requirements.” The repository uses these identifiers
across Solana and Base. The canonical name is therefore “AgentVouch Protocol Requirement A1-A5.” The
Base readiness table reports the Base implementation status for each cross-chain requirement.

Base Sepolia Deployment Gate B is a roll-up stage. It is complete only when Gate B1 and Gate B2 are
both complete. Gate B1 and Gate B2 keep separate approvals because each permits a separate
public-network transaction phase.

## Verification Note — 2026-08-01

- Repository format check passed.
- Chain capability-map verification passed with 25 Solana instructions, 22 Base state-changing
  functions, and 26 mapped rows.
- Targeted Markdown formatting passed for the new plan and the primary roadmap, readiness, state,
  deployment, and activation documents.
- A repository search found no headings or table rows that start with a bare deployment gate or
  protocol requirement identifier.
- Runtime tests and the production build were skipped because this change edits documentation only.

## Review Note — 2026-08-01

Automated review found that the state table listed Gate B1 and Gate B2 but omitted the Gate B roll-up.
The table and activation plan now define Gate B as the paused-deployment roll-up. Gate B completes
only after both separately approved sub-gates and the readback evidence complete.
