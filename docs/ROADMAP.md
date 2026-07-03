# AgentVouch Roadmap

Forward plan from `v0.2.0` (USDC-native devnet) onward. This doc carries sequencing and strategy decisions; it complements, not duplicates:

- `docs/USDC_NATIVE_MIGRATION.md` — the M0–M15 migration milestones (historical record once complete)
- `docs/MAINNET_READINESS.md` — launch gates, audit findings, and Go/No-Go criteria
- `VISION.md` — identity model and trust-layer positioning

Update this doc when sequencing or strategy changes, not for task-level progress.

Last reviewed: 2026-06-24.

## Phase A: Mainnet Release Candidate Hardening

Blocks mainnet. Maps to the P0/P1 findings in `docs/MAINNET_READINESS.md`.

### A1. Voucher slashing (P0.1)

Design locked 2026-06-09 — implementation plan in `.agents/plans/a1-voucher-slashing.plan.md`, design rationale in the readiness doc's P0.1 note. In brief:

- Slash the disputed listing's linked vouch positions at `slash_percentage` in **pages** (new permissionless `slash_dispute_vouches` instruction; `resolve(Upheld)` parks the dispute in `SlashingVouchers` until the last page) — atomic resolve-time slashing doesn't fit tx limits at 32 positions.
- Slashed funds are **ring-fenced** in `ListingSettlement.slashed_deposit_usdc_micros`: refund-pool-only, excluded from author withdrawals and the challenger-reward base.
- Slashed vouches become dead positions (`VouchStatus::Slashed`, no backing, no rewards); residual stake reclaimable via `revoke_vouch` after the dispute closes.
- Freeze slash-set membership via a `SkillListing.locked_by_dispute` mirror: `link_vouch_to_listing`, `unlink_vouch_from_listing`, revision bumps, and new-settlement init all blocked while dispute-locked (a settlement-only check is bypassable by rotating to a fresh settlement — the same rotation also let authors keep selling mid-dispute).
- Guard `accrue_author_rewards` against non-live vouches so slashed residual stake stops earning (reward-vault solvency).

### A2. Dispute governance v1 (P0.2)

Goal: convert "one hot key decides instantly and pays the challenger" into "a known signer set proposes, and the world has time to react." In order of leverage:

1. **Reroute slashed funds.** Refund pool for harmed buyers first; challenger gets a capped reward via the existing `challenger_reward_bps` / `challenger_reward_cap_usdc_micros` config params. This removes the resolver+challenger collusion incentive and is the cheapest, most important change.
2. **Split `resolver_authority` from `config_authority`** as a separate config field. Resolving disputes and changing economic params are different powers.
3. **Add config setter and authority rotation instructions** (also covers P1.5). Without them, even pointing an authority at a multisig requires redeploy. Include a governed treasury sweep path for `treasury_authority`.
4. **Two-phase resolution:** `propose_resolution` records the ruling and refund sizing, then a 48–72h timelock before `execute_resolution` moves funds. The window is where an author contests and a compromised resolver gets caught.
5. **Squads multisig on the resolver authority.** 2-of-3 to start, documented honestly (signer set, threshold, rotation, emergency removal — see Authority Policy in the readiness doc). A small real signer set beats pretend decentralization.
6. **Bound resolver discretion:** derive the refund pool ceiling from a formula (e.g. min of escrowed proceeds and affected-revision purchase volume) instead of a free authority-chosen number.

### A3. Emergency pause (P0.3)

Add a `set_paused` instruction gated on `pause_authority` (currently written at init and never read). The `require!(!paused)` guards already exist in ~10 handlers and become live once this ships.

Status 2026-06-19: merged, same-ID upgraded on devnet, on-chain IDL upgraded, and pause/unpause smoke passed. Policy: paused blocks new exposure and author-side collateral exits; buyer refund claims and voucher revenue claims remain open. Remaining before mainnet: custody pause authority behind the approved signer policy and repeat the smoke on the release-candidate deployment.

### A4. Refund reserve policy (P0.4)

Decide and document how refunds are backstopped when author proceeds are insufficient (free-listing disputes, proceeds withdrawn pre-dispute). A2's slashed-funds rerouting covers part of this; the residual policy must be written down even if the answer is "bounded, first-come-first-served, documented."

### A5. Tests and review (P1)

- Anchor tests for `update_skill_listing`, `remove_skill_listing`, `close_skill_listing`, `initialize_listing_settlement` (implemented, currently untested).
- Voucher-slashing path tests once A1 lands, extending the existing upheld → bond-slash → refund-claim coverage in `tests/agentvouch-usdc-marketplace.ts` and `tests/agentvouch-usdc-disputes.ts`.
- At least one API ↔ on-chain integration test proving entitlement/refund bookkeeping matches on-chain truth (web suite is currently fully mocked).
- External security review of every USDC-moving instruction (Go gate; scope in the readiness doc's Security Review section).
- Scanner eval harness (`evals/skill-scan/`): track unsafe-recall of the publish-time AI scan (`web/lib/ai/scan.ts`) against the labeled adversarial dataset; add every production miss as a new case (holdout first) and re-run before any rubric or model change. The adversarial set compounds into the evidence behind scanner claims and a reference set for disputes.

## Phase B: Mainnet Launch

Run the Go/No-Go in `docs/MAINNET_READINESS.md`. Nothing here overrides it.

## Phase C: Post-Mainnet Protocol Direction

- **Optimistic dispute resolution.** A challenger's proposed ruling stands after a contest window unless the author (or a voucher — they have stake at risk and are natural watchdogs) escalates; the multisig only adjudicates contested cases. The A2 two-phase resolution is the stepping stone.
- **LLM-jury / optimistic-oracle adjudication** enters as _evidence input_ to contested cases, not as the authority, until it has a track record.
- Carried protocol ideas (from `TODO.md`, revalidate before building): reputation decay, on-chain evidence hashing (IPFS pointers + content hash instead of bare URI strings).

## Phase D: Product Strategy

### Positioning: reputation oracle first, storefront second

The durable asset is verified, staked, accountable trust data — vouches, backing, dispute history, slash records — queryable by other registries and agent frameworks (per `VISION.md`). The marketplace is the proving ground that generates this data; it does not need to win as a destination against platform-native registries.

### Skill value thesis

Generic how-to content depreciates with every model release. Durable skill value for frontier models: org/domain-specific procedure not in training data, freshness (post-cutoff API/tool changes), executable capability with credentials, and provenance/safety. Marketplace surfaces and curation should optimize for those, not for volume of generic content.

### Wallet and transaction friction: Kora before chain migration

Kora is the preferred next Solana-native path for removing user-held SOL from normal AgentVouch flows. The plan lives in `.agents/plans/kora-usdc-fee-abstraction.plan.md`.

> **Update 2026-06-25:** the x402/Coinbase distribution bet has since been chosen (see "Base full-logic POC" below). Base is now the **frontrunner to become the canonical chain** (not yet written in stone), so Kora is the Solana-native fallback for fee friction rather than the primary pre-migration path. The "do not migrate to Base" reads below are the pre-decision analysis (2026-06-22) that the decision overrode; the technical cautions in them still hold.

Strategic read:

- Do not migrate to Base just to get gasless USDC UX. Solana already supports fee payer separation and batched token reimbursement; Kora packages this into a configurable paymaster/relayer.
- The Base POC Phase 4.5 memo reinforced this: Base can host gas-free-for-user USDC purchases, but the same UX outcome is achievable on Solana with Kora while preserving the current canonical program state.
- Preserve Solana program state as the trust source: purchases, vouches, bonds, disputes, slashing, refunds, and rewards should remain protocol-visible.
- Ship in layers: fee-only sponsorship first, then explicit `rent_payer` program interfaces for full no-SOL first-time flows.
- Keep x402 as the agent-facing payment envelope where it fits; use Kora to make direct Solana protocol instructions less wallet-hostile.
- Treat Kora as a launch accelerator, not a launch blocker, unless it is enabled in the release candidate path. Once enabled, it inherits mainnet readiness gates for signer custody, spend caps, monitoring, and rollback.

Current Kora spike boundary, as of 2026-06-24:

- Covered by the sponsored/Kora UI path: `register_agent` and `purchase_skill`. Both have a separate `rent_payer: Signer`, so the user signs for identity or USDC movement while the sponsor can pay SOL fees and account rent.
- Not yet covered: publishing/listing management paths such as `create_skill_listing` and `initialize_listing_settlement` still use the author as the Anchor payer for listing, settlement, and proceeds-vault rent. Paid publish/link-listing can still require author SOL.
- Not yet covered: backing/trust paths such as `deposit_author_bond`, `vouch`, and `link_vouch_to_listing` still use the author/voucher as the Anchor payer for bond, vouch, vault, and listing-position rent.
- Not yet covered: dispute/refund paths such as `open_author_dispute` and `claim_purchase_refund` still use the challenger/buyer as the Anchor payer for dispute bond vaults and refund-claim accounts.
- Admin/operator paths (`initialize_config`, migrations, `settle_x402_purchase`, refund-pool creation, cranks) may remain operator-paid unless the product explicitly needs those to be user gas-free.
- Before claiming broad "no SOL needed" UX, add `rent_payer: Signer` to the relevant user-facing instructions, update Anchor tests, regenerate IDL/client, sync web callers, and add matching sponsored transaction prepare/submit endpoints. Until then, copy should say Kora covers targeted register and purchase flows only.
- Kora sponsor signing now happens during `prepare` for the purchase and registration paths, so Phantom receives a sponsor-pre-signed transaction before the user signs. Server submit re-validates, simulates, and broadcasts the fully signed transaction; it no longer asks Kora to attach the sponsor signature after wallet signing. If Phantom warning noise returns, first verify that the prepared transaction includes the sponsor signature and then add a wallet-signing blockhash refresh path.

Current x402 bridge follow-up for the RC path:

- Enable the protocol-listed x402 bridge on devnet (`AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED`) and run an end-to-end UI/API smoke against a real paid listing.
- Prove the full bridge path: buyer auth message, x402 requirement generation, facilitator verify/settle, settlement vault credit, backend `settle_x402_purchase`, purchase PDA creation, entitlement recording, and raw download.
- Record the required env, settlement authority custody, facilitator config, monitoring, rollback, and any failure/reconciliation steps in the production runbook before treating x402 bridge as release-candidate-ready.

### Payment rail sequencing — 2026-07-01

Three commerce lanes, in priority order (details in `docs/BASE_X402_PAYMENT_RAIL_SPEC.md`, `docs/STRIPE_FEASIBILITY.md`, `docs/STRIPE_MPP_POLICY.md`):

1. **Protocol-visible commerce** (preferred): direct Solana USDC `purchase_skill`, Base USDC purchases, and protocol-listed x402. Only these fund voucher rewards, author proceeds escrow, and dispute/refund state. With Base as the canonical-chain frontrunner, Base Lane B (EIP-3009 in-contract) is the preferred agent rail.
2. **Card-funded early sales**: Stripe MPP mints a wallet-bound off-chain entitlement (`stripe-mpp-offchain`) so humans can buy now. Never counted as protocol settlement; excluded from purchase metrics, voucher yield, and refund state. Excluded on Base protocol listings until chain-qualified card entitlements exist.
3. **Future smart-account UX**: Base smart-account/paymaster work carries the wallet-abstraction bet; it does not make Stripe a settlement ledger.

Before Stripe Tier 2, choose the graduation model (card on-ramp to protocol settlement vs. parallel MPP marketplace vs. limited early-sales rail) — see the decision list in `docs/STRIPE_FEASIBILITY.md`.

### Base full-logic POC

Base remains the strongest expansion candidate for a USDC/x402-native AgentVouch lane, but it should be tested as a **port by spec**, not a migration by transpilation. The plan lives in `.agents/plans/base-full-logic-poc.plan.md`.

Status 2026-06-22: PR #44 reached the Phase 4.5 interim gate. Phases 0-4 are implemented in isolated Foundry code under `contracts/base-poc` with 65/65 tests, including direct purchases, author proceeds, voucher rewards, and two x402 lanes. The interim memo is `docs/BASE_POC_INTERIM.md`.

**Decision update 2026-06-25: the x402/Coinbase distribution bet has been chosen.** Base is now the **frontrunner to become the canonical chain — not yet written in stone** (the reversible commit point is the Phase 8 default-chain flip in the port plan). Execution is a `ChainAdapter` seam-swap port under the existing `web/` app, not a rewrite: `.agents/plans/base-port-chain-adapter.plan.md`. Progress: Phase 1 (seam), Phase 2a + 2b-design (SolanaAdapter behind the seam; reads/writes split into `ChainAdapter`/`ChainWallet`), and Phase 3a (BaseAdapter reads, live-verified against the deployed Sepolia contract) are done; Phase 3b (first Base render in `/skills`), Phase 4 (wallet), and Phase 5 (writes + agent x402) remain. Decided 2026-06-25: **Phase 4** uses Coinbase Smart Wallet **passkey** for the MVP, with **wagmi/MetaMask injected as a roadmapped follow-on** (MetaMask's distribution warrants it; reconsider if it balloons the wallet work); **Phase 5** uses **on-chain identity** via `AgentVouchEvm.registerAgent`/`getProfile`. Solana stays implemented and dormant behind the seam, not deleted. The x402 rev-split comparison that informed the bet is `docs/X402_REVSPLIT_BASE_VS_SOLANA.md`.

Gate read:

- Base can preserve the purchase/accounting model and make the buyer experience gas-free-for-user.
- That UX is not a Base-only win; Solana + Kora can target the same "USDC only, no SOL setup" product outcome with less migration surface.
- Lane B (`purchaseWithAuthorization`) is the better trust-minimized x402 lane, but EIP-3009 authorizations can be submitted directly to USDC, stranding funds in the contract with no receipt unless production adds recovery/reconciliation.
- Lane C (`settleX402Purchase`) is bridge-equivalent: it trusts a settlement authority that funds arrived.
- ~~Do not fund Phases 5-7, Base UI smoke, or a full Base migration report unless AgentVouch explicitly chooses the x402/Coinbase distribution bet. Otherwise, keep Solana canonical and move the RC friction work to Kora.~~ **Superseded 2026-06-25:** this gate is now met — the bet is chosen and the Base lane proceeds via the `ChainAdapter` port (see the decision update above). Kora stays the Solana-native fallback for RC friction if the Base bet is later unwound.

Strategic read:

- PR #44's purchase/x402 evidence was the basis for choosing the bet (2026-06-25); the work now proceeds beyond a POC branch into the `web/` app behind the `ChainAdapter` seam.
- Solana stays the implemented fallback, dormant behind the seam (not deleted); the reversible commit point is the Phase 8 default-chain flip, so **frontrunner — not yet written in stone** is the accurate status until then.
- Make the gasless claim precise: users should not need ETH, but a relayer/paymaster/facilitator/keeper still pays native Base gas and is reimbursed in USDC under bounded protocol rules.
- Preserve the current accounting invariants if the Base track resumes: protocol-visible purchase receipts, 60/40 author/voucher economics when backed, no-vouch purchases routing fully to authors, dispute locks, slashed-fund ring-fencing, and one-claim/one-settlement idempotency.
- Compare concrete evidence, not vibes: smart-account/paymaster UX, x402 settlement trust assumptions, gas costs, implementation size, test coverage, and operator custody burden.
- Do not update public docs or marketplace defaults to present Base as live until there is a separate launch plan, deployed contract, audited authority/paymaster policy, and browser/API smoke.

### Category expansion: MCP servers / connectors

Planned as the **second listing type**, sequenced strictly after the trust loop is real (A1 + A2 shipped, one full upheld-dispute cycle survived on devnet). Rationale:

- Connectors execute code with credentials — higher blast radius than skill.md, so staked vouching, disputes, and slashing are worth more there.
- Willingness to pay is higher for working, vetted integrations than for prose.
- Vouch/dispute/refund mechanics map over cleanly; the schema already tolerates listing-type variation (`source`, `payment_flow`, listings without purchase PDAs).

Expanding categories before slashing and credible dispute governance exist would widen an unproven surface; the first incident would define the brand.

### AgentVouch MCP client/server

MCP should become an adoption surface for agents, not a second protocol. The earlier MCP caution still applies: do not duplicate purchase, auth, signing, or trust logic in a standalone server. Reuse the HTTP API, CLI/protocol package, generated Solana client, x402 bridge, and Kora-sponsored transaction path.

V1 should be split deliberately:

- **Local MCP client first:** read-only tools for `list_skills`, `inspect_skill`, `get_author_trust`, `list_authors`, and free-skill install. Paid install can orchestrate the existing purchase/download flow, but should require explicit spend policy: max USDC amount, allowed domain, allowed network/mint, and a local signer or wallet integration. Avoid remote custody of user keys.
- **Hosted MCP server second:** discovery and trust tools over public APIs, suitable for agents that want AgentVouch context inside Claude/Cursor/etc. Hosted tools should not sign or pay. If paid install is exposed, it should return an x402 requirement or a typed transaction intent, not hold private keys.
- **x402-compatible buyer path:** track Coinbase/CDP x402 MCP client patterns as an interoperability target. They are useful buyer-side plumbing, but they only settle x402 payments; protocol-listed AgentVouch purchases still need `purchase_skill` or the feature-flagged `settle_x402_purchase` bridge.
- **Kora-compatible transaction path:** once Kora sponsorship is live, the MCP client can call the same typed sponsored transaction APIs as the web app. This is the clean route to "agent pays in USDC, signs once, no SOL setup" without inventing MCP-only payment semantics.

Sequencing:

1. Stabilize public OpenAPI/agent-facing API contracts and keep `web/public/skill.md` current.
2. Land Kora-sponsored purchase and/or x402 bridge readiness for paid protocol-listed skills, including a live devnet bridge smoke if the x402 path is enabled.
3. Build local read-only/free-install MCP wrapper over existing modules.
4. Add paid-install orchestration with explicit spend caps and no remote key custody.
5. Only after the above, consider a hosted read-only AgentVouch MCP endpoint for discovery/trust.

This belongs near the MCP/connector expansion strategy: AgentVouch should both list/vet MCP servers as marketplace objects and provide MCP tools that let agents query AgentVouch trust before installing or paying.

### Known risks (watch list, not blockers)

- Distribution: platform-native registries (Anthropic skills, MCP registries, GitHub) get default discovery — be the trust layer they query, not a competing storefront.
- Low willingness to pay for prose-only skills; thin paid-skill volume.
- Wallet/crypto friction for mainstream agent developers; Kora and x402 reduce the UX gap but add signer, relayer, policy, and monitoring surfaces.
- Two-sided cold start.

### Sequencing summary

Skills beachhead → close P0s (A1–A4) → optional Kora/x402 friction hardening for the RC path → mainnet → MCP client/server adoption surface → MCP/connector listings → reputation-oracle API as the long-term product.
