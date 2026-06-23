# Base POC — Gas-Free UX Spike Report (v2)

Date: 2026-06-23. Branch: `feat/base-poc-spike-v2` (PR #51). Plan:
`.agents/plans/base-poc-spike-v2.plan.md`. Companion to the Phase 4.5 memo
(`docs/BASE_POC_INTERIM.md`).

## TL;DR

Gas-free UX for AgentVouch's core flows on Base is **real, cheap, and needs zero
contract changes.** The full journey — register, author bond, vouch, listing, purchase,
voucher revenue claim, author proceeds withdrawal — ran on **live Base Sepolia** with
every actor as a **Coinbase Smart Account** and a **Coinbase Developer Platform
paymaster** sponsoring all gas. Each user's ETH balance moved by **exactly 0**; the only
balances that changed were the intended USDC flows.

## What ran

- Contract: `AgentVouchEvm` at
  [`0x5D90BB39aCaF0DF7462F552D430dc1ff1f24913E`](https://sepolia.basescan.org/address/0x5D90BB39aCaF0DF7462F552D430dc1ff1f24913E)
  (Base Sepolia, Circle USDC `0x036C…CF7e`).
- 8 sponsored ERC-4337 UserOps across three smart accounts (author / voucher / buyer),
  via the CDP paymaster + bundler. Harness: `contracts/base-poc/harness`.

## Live gas (paid by the paymaster, not the user)

| Flow | Sponsored gas (ETH) |
|---|---|
| author.register | 0.000002747542 |
| voucher.register | 0.000002747626 |
| author.depositBond | 0.0000018116 |
| voucher.vouch | 0.000002714922 |
| author.createListing | 0.00000255234 |
| buyer.purchase | 0.000004753532 |
| voucher.claim | 0.000001997618 |
| author.withdraw | 0.000001531222 |
| **total (3-user journey)** | **0.000020856402** |

At ~$3k/ETH that is ~**$0.06 for the entire three-party journey** — well under a cent per
action. Base mainnet gas is in the same range, and CDP sponsors up to $10k/mo on mainnet,
so gas is negligible next to the USDC amounts moving through the protocol.

## Proof points

- **Zero user gas:** author / voucher / buyer ETH deltas were all `0`. They hold no ETH
  and never will; the paymaster pays.
- **Accounting intact under AA:** USDC deltas were buyer −10 (price), voucher −6 (−10
  stake +4 pool), author −4 (−10 bond +6 proceeds) — the exact 60/40 split.
- **No contract changes:** every function keys off `msg.sender`, so a smart account is
  simply the actor. The same contract that passes the local proof
  (`test/gasless/AgentVouchEvm.Gasless4337.t.sol`, 66/66) ran unmodified on Base Sepolia.

## Production notes / caveats

- **Who pays:** the paymaster (i.e. the protocol/treasury) bears gas. It's tiny, but it's
  an opex line and a sponsorship surface — scope the CDP policy with a contract+function
  **allowlist** (AgentVouch + USDC `approve`) and per-account rate limits, plus the global
  monthly cap, before mainnet. This run used an empty allowlist (sponsor-all), fine for
  testnet only.
- **Smart-account onboarding** is the real UX work: users need a Coinbase Smart Wallet (or
  equivalent). Counterfactual deploy means the account is created inside the first
  sponsored UserOp (initCode) — also gas-free — so onboarding can be one tap.
- **Purchase was already gasless** in-contract via the EIP-3009 `purchaseWithAuthorization`
  lane (buyer signs, relayer submits). 4337 generalizes gas-free to register/list/vouch
  too, under one account model.
- **Funding:** the demo funds each account with exactly the amount it spends; production
  needs the usual buffer + top-up UX.

## Verdict

The distribution bet — "no wallet friction on Base" — is technically de-risked for the
core flows. The remaining work to productionize is paymaster policy + smart-account
onboarding UX, not protocol changes. Disputes/slashing (Phases 5-7) remain out of scope
and orthogonal to this result. Solana stays canonical.
