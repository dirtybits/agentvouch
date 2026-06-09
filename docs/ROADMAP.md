# AgentVouch Roadmap

Forward plan from `v0.2.0` (USDC-native devnet) onward. This doc carries sequencing and strategy decisions; it complements, not duplicates:

- `docs/USDC_NATIVE_MIGRATION.md` — the M0–M15 migration milestones (historical record once complete)
- `docs/MAINNET_READINESS.md` — launch gates, audit findings, and Go/No-Go criteria
- `VISION.md` — identity model and trust-layer positioning

Update this doc when sequencing or strategy changes, not for task-level progress.

Last reviewed: 2026-06-09.

## Phase A: Mainnet Release Candidate Hardening

Blocks mainnet. Maps to the P0/P1 findings in `docs/MAINNET_READINESS.md`.

### A1. Voucher slashing (P0.1)

Implement the resolve-time slash loop per the 2026-06-09 design note in the readiness doc:

- Slash linked vouches at `slash_percentage` (partial; residual stays staked), set `VouchStatus::Slashed`, create `AuthorDisputeVouchLink` records, and recompute `voucher_slashed_usdc_micros`.
- Slashed funds deposit into the author proceeds vault and ride the existing `create_refund_pool` split — no new config or vault.
- Keep the `revoke_vouch` open-dispute lock (already in source).

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

### Category expansion: MCP servers / connectors

Planned as the **second listing type**, sequenced strictly after the trust loop is real (A1 + A2 shipped, one full upheld-dispute cycle survived on devnet). Rationale:

- Connectors execute code with credentials — higher blast radius than skill.md, so staked vouching, disputes, and slashing are worth more there.
- Willingness to pay is higher for working, vetted integrations than for prose.
- Vouch/dispute/refund mechanics map over cleanly; the schema already tolerates listing-type variation (`source`, `payment_flow`, listings without purchase PDAs).

Expanding categories before slashing and credible dispute governance exist would widen an unproven surface; the first incident would define the brand.

### Known risks (watch list, not blockers)

- Distribution: platform-native registries (Anthropic skills, MCP registries, GitHub) get default discovery — be the trust layer they query, not a competing storefront.
- Low willingness to pay for prose-only skills; thin paid-skill volume.
- Wallet/crypto friction for mainstream agent developers; x402 agent payments still early.
- Two-sided cold start.

### Sequencing summary

Skills beachhead → close P0s (A1–A4) → mainnet → MCP/connector listings → reputation-oracle API as the long-term product.
