# AgentVouch Roadmap

Forward plan from `v0.2.0` (USDC-native devnet) onward. This doc carries sequencing and strategy decisions; it complements, not duplicates:

- `docs/USDC_NATIVE_MIGRATION.md` — the M0–M15 migration milestones (historical record once complete)
- `docs/MAINNET_READINESS.md` — launch gates, audit findings, and Go/No-Go criteria
- `VISION.md` — identity model and trust-layer positioning

Update this doc when sequencing or strategy changes, not for task-level progress.

Last reviewed: 2026-06-19.

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
- **LLM-jury / optimistic-oracle adjudication** enters as *evidence input* to contested cases, not as the authority, until it has a track record.
- Carried protocol ideas (from `TODO.md`, revalidate before building): reputation decay, on-chain evidence hashing (IPFS pointers + content hash instead of bare URI strings).

## Phase D: Product Strategy

### Positioning: reputation oracle first, storefront second

The durable asset is verified, staked, accountable trust data — vouches, backing, dispute history, slash records — queryable by other registries and agent frameworks (per `VISION.md`). The marketplace is the proving ground that generates this data; it does not need to win as a destination against platform-native registries.

### Skill value thesis

Generic how-to content depreciates with every model release. Durable skill value for frontier models: org/domain-specific procedure not in training data, freshness (post-cutoff API/tool changes), executable capability with credentials, and provenance/safety. Marketplace surfaces and curation should optimize for those, not for volume of generic content.

### Wallet and transaction friction: Kora before chain migration

Kora is the preferred next Solana-native path for removing user-held SOL from normal AgentVouch flows. The plan lives in `.agents/plans/kora-usdc-fee-abstraction.plan.md`.

Strategic read:

- Do not migrate to Base just to get gasless USDC UX. Solana already supports fee payer separation and batched token reimbursement; Kora packages this into a configurable paymaster/relayer.
- Preserve Solana program state as the trust source: purchases, vouches, bonds, disputes, slashing, refunds, and rewards should remain protocol-visible.
- Ship in layers: fee-only sponsorship first, then explicit `rent_payer` program interfaces for full no-SOL first-time flows.
- Keep x402 as the agent-facing payment envelope where it fits; use Kora to make direct Solana protocol instructions less wallet-hostile.
- Treat Kora as a launch accelerator, not a launch blocker, unless it is enabled in the release candidate path. Once enabled, it inherits mainnet readiness gates for signer custody, spend caps, monitoring, and rollback.

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
2. Land Kora-sponsored purchase or x402 bridge readiness for paid protocol-listed skills.
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
