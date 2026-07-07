---
name: base-a1-voucher-slashing-port
overview: "Port the A1 voucher-slashing mechanism (live on Solana devnet since 2026-06-10) into the Base v1 candidate contract, EVM-simplified but invariant-preserving, so upheld paid-listing reports slash linked vouch stake — landing BEFORE the Phase 9c external security review so one review covers the complete mechanism. Approved 2026-07-06 (supersedes the base-port plan's disputes/slashing deferral for Base v1)."
todos:
  - id: design-lock-a1-evm
    content: "Write the EVM design mapping in this plan body to final form and get it human-acked: slash-set definition (listing-linked vouch positions), gas-bounded slash execution (single-tx loop with permissionless pagination fallback), ring-fenced slash bucket, listing dispute locks, dead-position semantics, accrual guard, snapshotted economics, and the buyer-first/capped-reporter routing decision. Do not start Solidity until the open decisions at the bottom are resolved."
    status: pending
  - id: implement-contract
    content: "Implement in contracts/base-poc/src/AgentVouchEvm.sol (+ AgentVouchTypes.sol): listing-linked vouch positions in the slash set, upheld-report slashing at slashPercentage into a ring-fenced refund-only bucket, dispute locks (link/unlink/revision/new-settlement freeze), VouchStatus.Slashed dead positions with residual reclaim after close, reward-accrual guard for non-live vouches, economics snapshot at resolution."
    status: pending
  - id: forge-tests
    content: "Forge suite mirroring the Solana A1 coverage: slash math + split, multi-position slash, mid-report link/unlink/revision dodge blocks, double-slash guard, residual reclaim, ring-fence (slashed funds never author-withdrawable, never in reporter-reward base), reward-vault solvency with slashed positions, zero-vouch and free-listing paths, pause interaction, reentrancy on USDC moves."
    status: pending
  - id: sync-artifacts
    content: "Sync Deploy.s.sol config, contracts/base-poc/ui/src/abi.ts, harness ABI fragments, and web/lib/adapters/agentVouchEvmAbi.ts + baseAuthorTrust.ts read surfaces (slashed-stake counters, report exposure) — keeping BaseAdapter server-safe."
    status: pending
  - id: web-trust-surfaces
    content: "Expose slashing honestly in web reads: Base skill/author trust shows stake-at-risk and slash history; no synthesized trust; chain-qualified joins preserved. UI actions (vouch/report) remain the Phase 9 report/vouch UI todo — this plan only guarantees the read surfaces reflect the new mechanism."
    status: pending
  - id: verify-and-record
    content: "Full gate: forge test --root contracts/base-poc, web format/lint/typecheck/vitest, next build --webpack; deploy a fresh Sepolia candidate, run a scripted backed-purchase -> upheld-report -> slash -> residual-reclaim smoke with recorded tx hashes and USDC deltas; update MAINNET_READINESS Base track, the phase-9/10 plans, and web/public/skill.md if product semantics change."
    status: pending
isProject: false
---

# Base A1 Voucher-Slashing Port

## Decision (2026-07-06)

The founder approved a **full mechanism port** of A1 voucher slashing from Solana to the Base v1
candidate. This supersedes, for Base v1, the base-port plan's "disputes/slashing deferred" scope
line and the Phase 9 "defer full voucher slashing parity unless explicitly re-approved" clause —
it is now re-approved. Rationale:

1. **Review economics.** The Phase 9c internal + external security review is the mainnet long
   pole. Every USDC-moving path added _after_ that review forces a re-review; landing slashing
   _before_ it means one review covers the complete mechanism.
2. **EVM shrinks A1.** Most Solana A1 complexity was chain-shaped: the ≤4-position paged
   `slash_dispute_vouches` crank, `SlashingVouchers` parking, and per-(dispute,vouch) link PDAs
   exist because of Solana tx account limits and rent. The _economics_ port cleanly; the
   _machinery_ gets simpler.
3. **The moat claim.** Base currently slashes at most `min(authorBond, reportBond)` from the
   author bond; vouching on Base is reward-only — the exact P0.1 condition the 2026-05-30 audit
   flagged on Solana. "Stake-backed reputation" requires enforced voucher downside at mainnet.

Sequencing: this plan is **Phase 9b-2** — after the PR #78/#79 report primitive (9b-1), before
the 9c review closeout. It must not block Phase 9 Part A live smokes (x402 relayer/funded-EOA
setup is human-gated and runs in parallel).

## Baseline (what exists in the v1 candidate today)

- `PROTOCOL_VERSION = "base-v1-candidate"`; `openReport`/`resolveReport` under `RESOLVER_ROLE`;
  reporter USDC bond; `forfeitReporterBond` dismissal anti-griefing lever; upheld slash bounded to
  `min(authorBond, reportBond)`; open/upheld/dismissed profile counters (PR #78).
- `vouch`/`revokeVouch`, author bonds, the 60/40 reward-index accrual, and
  `claimVoucherRevenue` carried from the POC — vouches currently face **no slash path**.
- Reports are **author-wide**; Solana disputes are **listing-scoped**. The port must reconcile
  this (see open decisions).

## Invariant mapping — Solana A1 → EVM (each encodes a shipped bug or review finding)

| #   | Solana A1/A2 invariant                                                                                                                                                                | EVM translation                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Slash set = the disputed listing's linked vouch positions, frozen at resolution                                                                                                       | Listing-scoped report (or listing-scoped exposure under an author-wide report); membership snapshot at `resolveReport(Upheld)`                                                                                                              |
| 2   | Paged permissionless `slash_dispute_vouches` crank (tx account limits)                                                                                                                | Single-tx bounded loop over positions; **keep a permissionless paginated crank fallback** for positions beyond a gas budget — do not assume unbounded iteration is safe                                                                     |
| 3   | Slashed funds ring-fenced (`slashed_deposit_usdc_micros`): refund-pool-only, excluded from author withdrawals AND the challenger/reporter-reward base                                 | Dedicated slash-bucket accounting per listing settlement; assert in tests it never enters `withdrawAuthorProceeds` or reporter-reward math (the Solana sketch that let authors reclaim slash via refund pools inflated the collusion prize) |
| 4   | Partial slash at `slash_percentage`; vouch → `Slashed` dead position (stops backing + earning); residual reclaimable via revoke after close                                           | Same status semantics in `AgentVouchTypes`; residual reclaim gated on no open reports against the author                                                                                                                                    |
| 5   | `link_vouch_to_listing` AND `unlink` blocked while dispute-locked (revoke lock alone freezes money, not membership)                                                                   | Lock link/unlink on the listing while a report exposing it is open                                                                                                                                                                          |
| 6   | `locked_by_dispute` mirror on the listing: revision bumps + new-settlement init blocked mid-dispute (rotation dodge: a fresh settlement is unlocked and lets the author keep selling) | Listing-level lock flag checked by `updateSkillListing` and settlement-revision paths                                                                                                                                                       |
| 7   | `accrue_author_rewards` guard for non-live vouches (else reward vault goes insolvent — index denominator drops pre-slash stake while residual keeps accruing)                         | Reward-index accrual must exclude `Slashed` positions; solvency property test                                                                                                                                                               |
| 8   | Double-slash guard (`AuthorDisputeVouchLink` PDA init-once)                                                                                                                           | Per-(report, vouch) slashed flag / mapping; idempotent crank                                                                                                                                                                                |
| 9   | A2: buyer-first before reporter reward; reward capped by bps/cap; funded only from eligible author proceeds, never slash buckets                                                      | Apply now — this is the P0.2 collusion lesson; do not launch 100%-to-reporter routing                                                                                                                                                       |
| 10  | A2: economics snapshotted at resolution (config can mutate mid-crank)                                                                                                                 | Snapshot `slashPercentage` + reward bps/cap into the report at `resolveReport`                                                                                                                                                              |
| 11  | A2: serialized author-bond exposure (reject new bond-exposing reports while one is open)                                                                                              | Already partially implied by profile counters; make it explicit                                                                                                                                                                             |
| 12  | A2: upheld paid reports without a verified purchase are reputation-only (no slash-to-refund pool that can strand locks)                                                               | Zero-refund branch clears locks at resolution                                                                                                                                                                                               |

EVM-specific additions the Solana plan never needed: **reentrancy** on every USDC transfer in the
slash/claim paths (OZ guards + checks-effects-interactions), and gas-bounded iteration (the crank
fallback in row 2).

## Files

- `contracts/base-poc/src/AgentVouchEvm.sol`, `src/libraries/AgentVouchTypes.sol`
- `contracts/base-poc/test/AgentVouchEvm.Slashing.t.sol` (new), extensions to Reports/X402 suites
- `contracts/base-poc/script/Deploy.s.sol`, `ui/src/abi.ts`, `harness/src/abi.ts`
- `web/lib/adapters/agentVouchEvmAbi.ts`, `web/lib/baseAuthorTrust.ts`, trust read surfaces
- `.agents/plans/base-port-chain-adapter.plan.md`, `base-port-chain-adapter-phase-9.plan.md`,
  `base-port-chain-adapter-phase-10.plan.md`, `docs/MAINNET_READINESS.md`, `web/public/skill.md`

## Verification

- `forge test --root contracts/base-poc` — new Slashing suite green plus all existing suites.
- Web gate: `npm run format:check`, lint, typecheck, vitest, `next build --webpack`.
- Fresh Base Sepolia candidate deploy + scripted live smoke: register → bond → vouch → link →
  paid purchase (backed, so the 60/40 split is finally observed live) → open report → resolve
  upheld → slash → verify ring-fence + dead position → residual reclaim after close. Record tx
  hashes and USDC deltas at explicit block numbers.

## Rollback

Contract-only until deployed: revert the PR. Once a new Sepolia candidate is deployed, the web
config points back at the previous contract address (rows are chain-qualified; no DB migration).
Nothing here touches the Phase 8a default-chain rollback seam.

## Open decisions (resolve in design-lock before Solidity)

1. **Report scope:** keep author-wide reports and derive listing-scoped slash exposure from the
   report's named listing, or add a listing-scoped report object mirroring Solana disputes?
   Leaning: add an explicit listing reference to the report; author-wide-only cannot define a
   slash set.
2. **Reporter routing:** confirm buyer-first + capped reporter reward (invariant 9) as the launch
   answer to the open "reporter-vs-treasury bounty routing" question from PR #78's reviews.
3. **Slash percentage source:** config `slashPercentage` (Solana parity) vs per-report resolver
   input bounded by config cap. Leaning: config value, snapshotted (invariant 10) — resolver
   discretion is a P0.2-shaped risk.
4. **Crank threshold:** the max positions slashed inline in `resolveReport` before requiring the
   paginated permissionless crank (gas measurement decides; pick the bound from forge gas
   reports, not intuition).
