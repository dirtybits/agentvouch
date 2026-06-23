# Kora-on-Solana vs. Base/EVM — the x402 decision

Date: 2026-06-23. Status: **decision instrument, not a verdict.**
Companion to `docs/BASE_POC_INTERIM.md` (the Phase 4.5 gate) and
`.agents/plans/kora-usdc-fee-abstraction.plan.md`.

This doc exists to make one call explicit: **does AgentVouch keep Solana canonical
and remove user friction with Kora, or move the canonical protocol to Base/EVM?**
PR #53 (gas-free UI + live x402 agent purchase on Base Sepolia) is the artifact that
prompted it. The earlier interim memo framed this as a "distribution bet"; this doc
puts the two paths side by side so the bet can be priced.

## TL;DR

Both paths deliver the headline UX — **users hold only USDC, never the gas token.**
That is no longer the differentiator. The decision turns on three things the UX demo
does *not* settle:

1. **The agent-native rail.** Base has a contract-consumed EIP-3009 path (Lane B) that
   is *trust-minimized* — no settler is trusted with funds. Solana's x402 today is a
   bridge that trusts a settlement authority. This is Base's one genuine protocol-level
   edge, and it is the heart of the "agent commerce" thesis.
2. **What is actually built.** The Base contract is **Phases 0–4 only**. The trust
   enforcement half of AgentVouch — **disputes, voucher slashing, refunds** — does not
   exist in Solidity yet, is unaudited, and is exactly the part that makes staked
   vouching mean anything.
3. **The cost of being canonical.** Canonical = migrating live Solana reputation/vouch/
   bond state, a second audit, and either dual-chain ops or sunsetting the Solana program.

My recommendation is at the bottom. It is *not* "don't move" — it's "move deliberately,
with the trust-half ported and audited first, or don't call it canonical yet."

## The two paths

### Path A — Kora on Solana (keep canonical, remove friction)

Kora is a Solana paymaster/relayer: it pays the SOL fee (and, with explicit `rent_payer`
interfaces, the rent) and collects a USDC fee. The protocol program is unchanged in its
trust model; only the *payer* is split from the *actor*.

- **Keeps** the audited, live Solana program canonical. Disputes/slashing/refunds already
  exist and are battle-tested.
- **Removes** the "you need SOL" friction that `purchase_skill` preflight still surfaces.
- **Cost:** integrate Kora + add `rent_payer` to the `init`/`init_if_needed` paths (the
  plan's Layer 2). Bounded, no migration, no second audit.
- **x402 posture:** unchanged — x402 stays the HTTP payment envelope; `purchase_skill` /
  `settle_x402_purchase` remain the on-chain anchors, and the settlement bridge stays
  trusted. No trust-minimized agent pull.

### Path B — Base/EVM (move canonical)

Re-implement the protocol on Base. The Phases 0–4 contract is live on Base Sepolia
(`0x5D90…913E`) and PR #53 proves the gas-free UX + Lane B agent purchase end to end.

- **Gains** the trust-minimized EIP-3009 Lane B, no rent (every Solana flow that bills
  rent today is a plain sponsored write here), and native presence in the Coinbase /
  x402 agent-commerce ecosystem.
- **Cost:** port Phases 5–7 (disputes, slashing, refunds) — migration-grade work — plus a
  second audit, a live-USDC mainnet deploy, state migration of existing Solana reputation,
  and dual-chain ops (or a Solana sunset).

## Head to head

| Dimension | Kora on Solana | Base / EVM | Edge |
|---|---|---|---|
| User holds only USDC (no gas token) | Yes (fee-only sponsor + `rent_payer`) | Yes (paymaster-sponsored UserOps) | **Tie** |
| Rent / account-creation cost | Real; needs explicit `rent_payer` engineering | **None** (EVM has no rent) | **Base** |
| Agent-native payment trust | Bridge — trusts a settlement authority | **Lane B trust-minimized** (contract consumes the signature) | **Base** |
| Per-purchase cost | Solana fees + Kora margin (sub-cent base) | ~260–284k gas ≈ $0.01–0.04 + paymaster markup | Tie / slight Solana |
| Disputes / slashing / refunds | **Live, audited** | **Not built**, unaudited (Phases 5–7) | **Solana** |
| Operator custody surface | Kora relayer (USDC fee, no fund custody) | Paymaster policy + relayer; Lane C settler if used | Tie |
| Ecosystem / distribution | Solana agent tooling | **Coinbase / x402 / EIP-3009 native** | **Base** (the bet) |
| Time-to-canonical | Weeks (no migration) | Port + audit + migration + dual-chain | **Solana** |
| State migration risk | None (stays put) | Must migrate live reputation/vouch/bond | **Solana** |

## The Lane B footgun, named once more

Base's headline advantage (Lane B) carries a documented wrinkle, **F-1**: the EIP-3009
authorization names the contract as `to`, so anyone can replay it straight to USDC,
depositing the buyer's funds with **no purchase receipt** — stranded. It is pure griefing
(attacker gains nothing), but a production design must answer it, and the fixes
(`receiveWithAuthorization`, or a reconciliation/sweep) tend to reintroduce *some*
settlement-authority trust — eroding part of the very edge that justified the move. This
is tracked in `test_laneB_frontRunStrandsFundsNoReceipt` and re-surfaced in PR #53. Not a
blocker; a line item to cost into Path B.

## What "much simpler USDC-native flow" is really worth

The simpler experience is real and I don't want to undersell it — no rent accounting, no
`rent_payer` plumbing, one ERC-20 `approve`+`purchase` batched in a single sponsored
UserOp, and a passkey (Face/Touch ID) onboarding with no extension. That is a materially
cleaner story than Solana's rent + fee + reimbursement dance, and for an *agent* buyer the
EIP-3009 off-chain signature (no tx, no smart account, no gas) is the cleanest rail either
chain offers.

The honest caveat: that simplicity is demonstrated on the **purchase** path, which is the
easy half. The half that earns AgentVouch the word "trust" — staking with real
consequences, adjudication, refunds — is unbuilt on Base and unaudited. The UX win is not
in dispute; it just doesn't price the migration on its own.

## Recommendation

**Base is a defensible canonical choice — conditional on funding the bet, not drifting
into it.** If the founder is making the x402/agent-commerce distribution bet explicitly
(and the lean here is clearly that), the right sequence is:

1. **Commit the bet in writing** — "AgentVouch is an agent-commerce protocol; native x402
   presence is worth a re-implementation + second audit." Everything below follows from
   this; without it, ship Kora and keep Solana canonical.
2. **Port Phases 5–7** (disputes, slashing, refunds) to the EVM contract and reach test
   parity with the Solana program. Until this exists, "canonical on Base" means shipping a
   protocol that can't punish a bad vouch — don't call it canonical before then.
3. **Resolve F-1** for production (`receiveWithAuthorization` or a documented
   reconciliation path) and lock the paymaster policy (the CDP bundler URL is browser-
   exposed; a hosted UI makes it a drainable sponsorship endpoint — allowlist + rate-limit).
4. **Second audit** of the full EVM surface, then a live-USDC mainnet deploy.
5. **State migration plan** for existing Solana reputation/vouch/bond, and an explicit
   decision on dual-chain operation vs. Solana sunset.

**Interim, regardless of the canonical call:** ship the **Kora fee-only spike** on the RC
path. It is cheap, removes the live friction now, and is *not wasted* if Base wins — it
keeps Solana usable through the migration window rather than betting the current product on
a chain whose trust-half isn't built yet.

In one line: **the UX question is answered (Base is simpler); the protocol and migration
questions are not — fund steps 1–5 to make Base canonical, and run Kora in parallel so
shipping isn't blocked on that port.**
