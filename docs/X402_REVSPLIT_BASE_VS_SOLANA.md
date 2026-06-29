# x402 Rev-Split — Base vs Solana

Date: 2026-06-24. Branch: `feat/base-port-chain-adapter`. Plan:
`.agents/plans/base-port-chain-adapter.plan.md`. Companions: `docs/BASE_POC_GASFREE_REPORT.md`,
`docs/BASE_POC_INTERIM.md`.

Findings from the Base-port investigation: is the 60/40 author/voucher rev-split proven on the
**x402 agent-payment path** for Base, and is it fundamentally different from the Solana x402-bridge
path we built but have not enabled?

## TL;DR

Two findings:

1. **The 60/40 split is contract-proven on the Base x402 path.** It is shared settlement math
   (`_recordPurchase`), and the x402 lanes assert the exact split in unit tests that **pass green**
   (run locally 2026-06-24). For the port, Phase 5 is _wiring_, not mechanism.
2. **Base x402 is fundamentally different from — and materially more seamless than — the Solana
   x402-bridge**, and the entire difference is **USDC's EIP-3009**. On Base, payment authorization
   and the 60/40 split are fused into **one atomic transaction** with **no backend key and no
   custodial vault**. On Solana, SPL USDC has no EIP-3009 equivalent, so the bridge is **two-step +
   custodial**: the payment lands in an intermediate vault, then a trusted backend settlement
   authority runs a separate instruction to do the split.

Net: on Base the rev-split rides for free on native USDC; you delete the bridge entirely.

## What's proven (Base)

The split is not x402-specific code — it is shared settlement math in `_recordPurchase`
(`contracts/base-poc/src/AgentVouchEvm.sol:406`):

```
voucherPool = price * voucherShareBps / 10_000
authorShare = price - voucherPool        // exact remainder, no dust
```

Every purchase entry point routes through it: human `purchaseSkill`, x402 Lane B
(`purchaseWithAuthorization`), and x402 Lane C (`settleX402Purchase`). Config defaults are
`authorShareBps = 6000` / `voucherShareBps = 4000` / `protocolFeeBps = 0`
(`contracts/base-poc/script/Deploy.s.sol:47`); the constructor reverts unless the shares sum to
`10_000`. The voucher 40% is a stake-weighted **pool** (reward-index accrual to
`unclaimedVoucherRevenueUsdcMicros`), claimed with `claimVoucherRevenue` — mirrors the Solana
reward model, so this is parity.

Tests (`contracts/base-poc/test/AgentVouchEvm.X402.t.sol`), run locally 2026-06-24:

```
[PASS] test_laneB_backedSplit6040            asserts 6_000_000 author / 4_000_000 voucher micros
[PASS] test_laneB_noBackingFullToAuthor      unbacked listing = 100% author
[PASS] test_laneC_backedSplitAndClaim        settlement-path split + voucher claim end-to-end
[PASS] test_laneB_receiveAuthCannotBeFrontRunOrStranded   the F-1 front-run fix
4 passed; 0 failed
```

Note: CI now includes a `contracts` job that vendors Foundry dependencies and runs `forge test -vv`.
Local worktrees may still lack `contracts/base-poc/lib`; run the setup/vendor step locally or rely
on the CI contracts job when those dependencies are absent.

## The mechanism difference

|                      | **Base (Lane B)**                                             | **Solana (x402-bridge)**                                         |
| -------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Payment primitive    | USDC **EIP-3009** `receiveWithAuthorization`                  | SPL transfer to a single `payTo` (no EIP-3009 analog)            |
| Buyer action         | Signs **one** EIP-712 authorization off-chain                 | Pays via x402 into a custodial vault                             |
| Settlement           | Contract pulls USDC **and** splits 60/40 in **one atomic tx** | Backend authority runs a **separate** `settle_*` tx to split     |
| Intermediate custody | **None**                                                      | `x402_settlement_vault` (PDA ATA) holds funds between steps      |
| Trusted hot key      | **None** (Lane B)                                             | **Required** — `settlementAuthority` signs + fee-pays settlement |
| Transactions         | 1                                                             | 2                                                                |

### Base — payment + split fused (atomic)

`purchaseWithAuthorization` (`contracts/base-poc/src/AgentVouchEvm.sol:340`) does, in a single call:

1. `_recordPurchase(...)` — the 60/40 split, then
2. `IERC20ReceiveWithAuthorization(usdc).receiveWithAuthorization(buyer, address(this), price, ...)`
   — pulls the exact USDC against the buyer's signature.

EIP-3009's `receiveWithAuthorization` is **caller-bound to the payee** (requires `msg.sender == to`),
so only the AgentVouch contract can redeem the buyer's signature — this is the F-1-safe property. The
buyer signs one EIP-712 message; a relayer submits; the contract pulls and splits atomically. No
backend key, no custodial vault, no second transaction.

### Solana — two-step + custodial (a bridge)

`web/lib/x402ProtocolBridge.ts` is a genuine bridge because SPL USDC has no EIP-3009 equivalent and
x402's "exact" scheme is just a transfer to one `payTo`:

1. The agent's x402 USDC payment lands in an intermediate **custodial `x402_settlement_vault`** (a
   PDA-owned ATA — set as the `payTo` in the payment requirement).
2. A trusted **backend `settlementAuthority` hot key**
   (`AGENTVOUCH_X402_SETTLEMENT_AUTHORITY_SECRET_KEY`) then submits a separate `settle_x402_purchase`
   instruction (`web/lib/x402ProtocolBridge.ts:411`) that moves the vaulted funds and applies the
   60/40 split, plus receipt + signature-guard PDAs for idempotency.

Two transactions, an intermediate custody hop, a hot key with a `config.settlementAuthority` role,
and more validation surface.

## Honest caveats

- **Unit-tested, not live-demonstrated.** The split tests pass against MockUSDC, but the live Base
  Sepolia x402 demo (`contracts/base-poc/harness/src/agent-x402-demo.ts`) does **not** set up a
  voucher, so the on-chain demo only exercised the _unbacked_ (100%-author) path. The actual 60/40
  has not been observed on a live network — only in Foundry. For live proof, run a _backed_ x402
  purchase on Sepolia and watch for 6/4.
- **Atomic split is not impossible on Solana.** The _regular_ (non-x402) purchase already does it —
  the buyer signs the full `purchase_skill` tx and the program splits via CPI in one tx. The
  two-step is the cost of conforming to x402's EVM-shaped "transfer-to-payTo" protocol on SPL, not a
  Solana limitation per se.
- **The Solana bridge is well-built, not janky** — idempotency guards, receipt PDAs,
  simulate-before-send, and author/price/mint/pause validation. It is _more machinery_, not bad
  machinery.
- **Both chains have a backend-settled lane.** Base also has Lane C (`settleX402Purchase` under
  `SETTLEMENT_ROLE`). The asymmetry is that Base _additionally_ offers Lane B (atomic, keyless),
  which Solana x402 has no analog for.
- **`protocolFeeBps` is hardwired 0** ("reserved"); strictly author + voucher = 100% today, same as
  Solana. A protocol cut would need that path enabled.
- **Sepolia, not mainnet.** Same config redeploys to mainnet (a separate flagged gate).

## Implications for the port

Phase 5 (`base-adapter-write`) is **wiring an already-proven mechanism**, not building/proving the
split. On the agent-payment axis specifically, Base Lane B removes two real liabilities the Solana
bridge carries:

- a **hot settlement key** that must stay live, funded, and secured, and
- a **custodial-float failure mode** (funds stranded in the vault if settlement never runs).

So wire **Base Lane B** for the agent path. This is captured as a note in the Phase 5 block of the
plan.

## Verdict

The x402 rev-split is fundamentally different across the two chains, and Base is the more seamless of
the two — not by a little, and not merely at parity. The difference is entirely USDC's EIP-3009,
which collapses authorization + payment + split into one trust-minimized atomic transaction. This is
one of the stronger arguments _for_ the Base port: on agent x402 it is not just a re-platforming, it
is a real reduction in trust and operational surface. The Solana x402-bridge remains correct and
retained (dormant), exactly as the port decision intends.
