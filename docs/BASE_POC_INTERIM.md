# Base Full-Logic POC — Phase 4.5 Interim Decision Memo

Date: 2026-06-22. Branch: `feat/base-poc-spike`. Scope: Phases 0–4 of
`.agents/plans/base-full-logic-poc.plan.md` (the rent-touching core + x402 lanes),
stopping before the disputes/slashing/refund port (Phases 5–7).

**This is a gate, not a verdict.** It scores the Decision Rubric on what Phases 0–4
can already answer and recommends whether to fund Phases 5–7.

## What was built (and adversarially verified)

An isolated Foundry contract (`contracts/base-poc/AgentVouchEvm.sol`, OZ v5.1) porting,
**by spec**, the AgentVouch protocol surface reachable without disputes: config/roles,
A3 pause, profiles, author bonds, vouches, listings + settlements, the direct purchase
flow with the author-wide reward index, proceeds + voucher claims, and **two x402 lanes**:

- **Lane B — `purchaseWithAuthorization`**: the contract consumes the buyer's EIP-3009
  authorization to pull USDC and records the purchase in one tx. No settlement authority.
  The authorization nonce is bound to `(buyer, listingId, revision, price)`, so a relayer
  cannot redirect a signed payment; the token consumes the nonce (replay-safe).
- **Lane C — `settleX402Purchase`**: a `SETTLEMENT_ROLE` attests an x402 payment already
  delivered to the contract, with `paymentRefHash` + `settlementTxHash` idempotency guards.

**65 Foundry tests**, all green. Three independent adversarial audits (parity / insolvency /
Solidity-security) confirmed the accounting faithful to Solana and surfaced findings now fixed
or documented (below). Gas measured, not guessed.

## Decision Rubric scorecard

| Dimension | Score | Evidence |
|---|---|---|
| Buyer gas-free UX | **Pass** | Lane B: buyer only signs off-chain (EIP-712); a relayer (≠ buyer) submits and pays gas. Tests prove the buyer holds no ETH. Lane A (smart-account/paymaster) is the second path. |
| Settlement trust | **Pass (Lane B) / Marginal (Lane C)** | Lane B needs no trusted settler (contract consumes the signature) — strictly better than the current Solana x402 bridge. Lane C is bridge-equivalent: it trusts `SETTLEMENT_ROLE` that funds arrived (see trust statement). Prefer Lane B. |
| Per-action cost | **Pass** | Measured median gas: purchase ~260–284k, settle ~63k, claim ~84k. At typical Base L2 gas this is ≈ $0.01–0.04 / purchase, within the $0.05 ceiling — though a paymaster/relayer markup eats into the margin, and low-value voucher claims need batching/threshold. |
| Operator custody burden | **Marginal** | Every lane adds a bounded signer/policy surface: Lane A a paymaster policy, Lane B a relayer (reimbursed, no fund custody), Lane C a trusted settlement signer. Comparable to Solana + Kora's relayer surface — not clearly better. |
| Accounting parity (Phases 0–4) | **Pass** | Adversarially verified faithful: split, reward-index accrual, claim, proceeds, dual-hash idempotency, cross-lane dup guard, pause set. Solvency holds under test (when funds are present). Divergences are documented and sub-cent (below). |
| Implementation cost | **(deferred)** | Phases 0–4 are ~700 lines + 65 tests. The full decision needs Phases 5–7 (disputes/slashing/refunds) — migration-grade work — plus audit and dual-chain ops. Not yet incurred by design. |

**Cost-ceiling threshold (committed here, per the rubric):** ≤ $0.05 / purchase at target
Base gas, exclusive of paymaster markup. Measured cost is within it.

## Key x402 findings (decision-relevant)

- **Lane B mempool-stranding edge (audit F-1).** Because the EIP-3009 authorization names the
  contract as `to`, anyone can submit it directly to the token, depositing the buyer's funds and
  consuming the nonce **without** creating a purchase receipt. The funds are then stranded (no
  receipt; the POC has no sweep). Pure griefing (the attacker gains nothing), but it is a real
  fund-safety/UX wrinkle of the contract-consumed pattern that a production design must answer
  (a reconciliation/recovery path — which tends to reintroduce some settlement-authority trust).
  Tested + documented in `test_laneB_frontRunStrandsFundsNoReceipt`.
- **Lane C trust statement.** The contract cannot verify the x402 USDC actually arrived (it reads
  no prior transfers and pulls nothing). Every Lane C integrity property collapses to "`SETTLEMENT_ROLE`
  is uncompromised and the facilitator delivered funds before attesting." The idempotency guards stop
  replay of one real payment within a revision; they do not stop a malicious authority minting phantom
  credits with fresh hashes (blast radius: one `price` per call). This matches the current Solana x402
  bridge's trust posture — it is not improved by moving to Base.

## Documented divergences from Solana (intentional, sub-cent)

- **Split rounding:** the POC routes the ≤1-micro split remainder to the author (`authorShare = price − voucherPool`) so every lane pulls/credits exactly the listing price with no stranded dust; Solana floors both shares independently and strands the micro.
- **Protocol fee:** both chains now fail loud on a non-zero `protocol_fee_bps` (PR #45 on Solana; the POC's `initializeConfig`) — consistent.
- **A3 pause set** mirrors the real per-instruction Solana guards (verified by grep, not prose).

## Recommendation

**Do not fund Phases 5–7 (the dispute/slashing/refund port) yet.** The spike proves Base can
host the protocol with faithful, gas-free-for-user, accounting-correct purchases — but it does
**not** show Base is *necessary*:

- Gas-free-for-user is achievable on **both** Base and Solana + Kora; it is not a Base-unique win.
- Per-action cost and custody burden are comparable to Solana + Kora, not decisively better.
- Lane B's trust-minimization is a genuine edge over the Solana x402 bridge, but it carries the
  F-1 stranding wrinkle; Lane C's trust posture is no better than today's bridge.

So the keep-vs-migrate decision turns on a **distribution bet** — is being natively where the
x402 / Coinbase agent-commerce ecosystem lives worth a full protocol re-implementation, a second
audit, and dual-chain operations? That is a strategic call for the founder, not something the
remaining parity work (Phases 5–7, the same business arithmetic in Solidity) would resolve.

**Suggested next step:** keep Solana canonical; ship the Solana + Kora friction path for the RC;
treat Base as a funded decision only if the x402-ecosystem distribution bet is made explicitly.
If it is, Phases 5–7 + the full `docs/BASE_POC_REPORT.md` follow.
