# AgentVouch Beta Launch Checklist

**The deliberately minimal bar to ship something people use.** This is **not** the
mainnet bar — that lives in [`MAINNET_READINESS.md`](./MAINNET_READINESS.md). They are
different gates, and conflating them is what stalled shipping. Clear *this* list, launch
a beta, and let real usage tell you which mainnet item to build first.

## Goal

Ship a usable, **gas-free** AgentVouch beta and learn the three things that matter: do
developers publish, do buyers buy, and will anyone vouch with **real money** — operated
manually, with bounded financial risk.

## Operating posture (the decisions that replace the mainnet machinery)

These are choices, not gaps. State them publicly and they stop being "blockers."

- **Disputes: manual.** You are the resolver. Handle them case-by-case off-chain (evidence
  over DM/email), settle with the existing `config_authority` key. A single resolver key is
  a *mainnet* P0, not a beta one — at beta scale it is just you.
- **Slashing: manual / rare.** A1 slashing exists on devnet but you do not rely on it.
  Handle a bad actor by hand, or refund out of pocket. The skin-in-the-game comes from the
  **locked stake**, not from automated punishment.
- **Caps: low.** Cap listing prices and vouch stakes small, so the blast radius of "manual
  and trusting" is tiny.
- **Authorities: single keys are fine for beta.** No multisig required to launch.
- **One emergency lever: A3 pause** (already shipped). If something is wrong, pause.

## The one open decision

**Launch surface:** devnet soft-launch (zero financial risk, real users can still try) **or**
a tightly capped mainnet (small real $, you as operator). Recommendation: start on devnet or
a hard-capped mainnet. Pick one before launch and write it down here.

## Ship checklist (the green light)

A short, finishable list — not a research program:

- [ ] **Gas-free buy works end to end** — land #48, then smoke it: a buyer holding USDC and
  **no SOL** completes a purchase and receives the skill.
- [ ] **Core happy path on the chosen surface:** register → publish a listing → vouch (real
  locked USDC) → buy (gas-free) → download.
- [ ] **Staked vouching is live** (USDC locked on vouch). This is the load-bearing mechanism;
  keep it. Automated slashing is **not** required.
- [ ] **Price / stake caps set low.**
- [ ] **A3 pause reachable** by the operator.
- [ ] **Honest public note:** "Beta. Disputes are handled manually by the team. Amounts are
  capped. Not yet audited for mainnet." Set expectations; do not overclaim.
- [ ] **Docs match shipped behavior** (`web/public/skill.md`, `/docs`, CLI help) — do not
  describe slashing or disputes as automated.

## Explicitly deferred (revisit only when volume forces it)

Not abandoned — switched off until you need them. Nothing built so far is wasted.

- A2 decentralized dispute governance (timelock, propose/execute, buyer-first refunds).
- Automated voucher slashing as a *relied-upon* mechanism.
- Multisig / governance on authorities; reserve-backed refund pools; treasury sweep policy.
- External security audit (required before meaningful mainnet $, not before a capped beta).
- Base / x402 migration — decision evidence only; see `docs/BASE_POC_INTERIM.md` (on the
  `feat/base-poc-spike` branch). Verdict: keep Solana canonical unless the distribution bet is funded.

## Done looks like

A real developer publishes gas-free, a real buyer buys gas-free, and you can resolve any
dispute by hand. That is the beta. Ship it, watch what sticks or breaks, and let *that* —
not a blocker list — decide what to harden next.
