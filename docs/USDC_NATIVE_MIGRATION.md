# USDC Native Migration Plan

## Summary

AgentVouch should move the on-chain trust protocol from SOL-denominated accounting to USDC-denominated accounting.

The current app already supports USDC/x402 for repo-backed skill purchases, but the Anchor program still uses lamports for listing prices, vouches, author bonds, voucher rewards, dispute bonds, and reputation score inputs. Because the currency invariant changes across every trust primitive, this migration should be a fresh program deployment rather than an in-place upgrade.

Versioning decision:

- Current SOL-denominated devnet release: `v0.1.0`.
- USDC-native devnet release: `v0.2.0`.
- First mainnet-ready release: `v1.0.0`.

Implementation decision:

- Build a new USDC-first program in this repo.
- Use a fresh program deploy keypair and new program ID for `v0.2.0`.
- Treat existing devnet accounts as disposable test data.
- Preserve useful app/API/x402 code, but do not preserve `v0.1.0` account layouts or SOL purchase semantics in the new program.
- Use native Circle USDC as the protocol settlement asset.

Governance decision:

- Devnet `v0.2.0` may use a controlled deployer key for iteration.
- Mainnet `v1.0.0` must not launch with a single hot-wallet upgrade authority.
- Mainnet upgrade authority, config authority, treasury authority, and settlement authority rotation must be controlled by a multisig or stronger governance setup before real user funds are accepted.
- Governance-sensitive changes include `usdc_mint`, `token_program`, `protocol_treasury_vault`, `x402_settlement_authority`, `x402_settlement_vault`, economic floors, slash percentages, and any future protocol fee.
- `v0.2.0` charges no protocol fee. When external voucher stake exists, purchases split `60%` author / `40%` voucher pool; when no voucher stake exists, `100%` goes to author proceeds. Account layouts should leave room for an explicitly configured future protocol fee without changing historical accounting.

Authority and treasury gate decision:

- BPF upgrade authority is separate from `ReputationConfig` roles and must be tracked in the deployment runbook.
- Devnet `v0.2.0` may use controlled keys for iteration, but the active upgrade authority, config authority, treasury authority, pause authority, and settlement authority pubkeys must be recorded for each deploy.
- Mainnet `v1.0.0` cannot accept real user funds while a single hot wallet controls upgrade, config, or treasury authority. Those roles require multisig or stronger governance.
- `config_authority` controls governance-sensitive config updates and role rotations.
- `treasury_authority` is reserved in `v0.2.0`; Milestone 3 should not add an arbitrary treasury-withdrawal instruction. Treasury inflows are dismissed dispute bonds and future governed fees.
- `pause_authority` can only toggle pause state and is rotatable by `config_authority` if separate.
- `settlement_authority` is reserved for the future x402 bridge, is rotatable and pausable by `config_authority`, and cannot withdraw arbitrary settlement or treasury vault balances.
- `paused = true` blocks new risk and new purchases: create/update paid listings, direct purchases, new vouches, vouch/listing links, author-bond deposits, and x402 settlement. It allows authority rotation, unpause, dispute open/resolve, voucher reward claims, author-bond withdrawals, vouch revokes, and close flows only when normal dispute/lock invariants already permit them.

Interop decision:

- Use CAIP-2 as the canonical chain identifier across docs, schema, events, and indexer outputs (`solana:<genesis>` today; `eip155:<chain-id>` and other CAIP-2 strings for future deployments).
- Align with ERC-8004 Trustless Agents and the Solana Agent Registry. AgentVouch is the slashing/economics layer on top of those identity and reputation registries, not a replacement for them.
- v0.2.0 does not require an ERC-8004 binding, but accounts and events leave room for `agent_registry`, `agent_id`, and `agent_uri`-style linkage so reputation deltas can be published back to ERC-8004 / Solana Agent Registry surfaces.
- Cross-chain redeployments inherit the same protocol semantics; only the chain context (CAIP-2), USDC mint, and token program change.

Non-goals for v0.2.0:

- AgentVouch does not introduce a new agent identity primitive. It links to ERC-8004 / Solana Agent Registry instead.
- AgentVouch does not implement cross-chain reputation aggregation in v0.2.0; it only emits chain-tagged, registry-mappable events that a future indexer or bridge can aggregate.

## Current State

### USDC Already Implemented

USDC support exists in the web/API layer:

- `skills.price_usdc_micros`
- `skills.currency_mint`
- `usdc_purchase_receipts`
- `usdc_purchase_entitlements`
- x402 direct USDC payment requirements
- facilitator verify/settle flow
- signed raw skill download after entitlement

Primary files:

- `web/app/api/skills/route.ts`
- `web/app/api/skills/[id]/raw/route.ts`
- `web/lib/x402.ts`
- `web/lib/usdcPurchases.ts`
- `web/lib/browserX402.ts`

### SOL Still In The Protocol

The `v0.1.0` Anchor program is SOL/lamports-only:

- `SkillListing.price_lamports`
- `SkillListing.total_revenue`
- `SkillListing.unclaimed_voucher_revenue`
- `Vouch.stake_amount`
- `Vouch.cumulative_revenue`
- `AgentProfile.total_staked_for`
- `AgentProfile.author_bond_lamports`
- `AuthorBond.amount`
- `ReputationConfig.min_stake`
- `ReputationConfig.dispute_bond`
- `ReputationConfig.min_author_bond_for_free_listing`
- `Purchase.price_paid`
- dispute snapshots and slashing amounts

The program currently depends on `anchor-lang` only. It does not use `anchor-spl`, SPL Token, ATAs, token vaults, or USDC mint validation.

## Target Model

The USDC-native `v0.2.0` program should use micro-USDC as the only protocol money unit.

Naming convention:

- Store protocol amounts as `u64`.
- Use `*_usdc_micros` for amounts that represent USDC.
- USDC has 6 decimals, so `1 USDC = 1_000_000`.
- Avoid `lamports` in protocol business logic except for rent and transaction fees.

Core principle:

> Users may eventually fund actions from SOL, ETH, or other assets, but protocol accounting settles in USDC.

Token program and mints:

- The program enforces classic SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`).
- Token-2022 token accounts and bridged USDC variants are rejected at the constraint level because the protocol only accepts the configured native Circle USDC mint under the classic SPL Token program.
- The expected USDC mint is stored on `ReputationConfig` so it is verifiable on-chain and configurable per cluster.
- Reference mints:
  - devnet: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
  - mainnet-beta: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Chain context is recorded as CAIP-2 (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` for devnet, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` for mainnet-beta).

USDC risk acknowledgement:

- Native Circle USDC is centralized collateral. Circle can blacklist/freeze accounts, mint/burn policy is issuer-controlled, and access depends on regulated infrastructure.
- `v0.2.0` accepts that risk because USDC gives the protocol a stable unit of account, simple listing prices, legible slashable backing, and a better fit for x402 and agentic commerce than volatile SOL or multi-asset collateral.
- The protocol should not describe USDC as decentralization-maximal collateral. It is the pragmatic settlement asset for this phase.
- Keep the asset choice explicit in config through `usdc_mint` and `token_program`, but enforce only native Circle USDC under the classic SPL Token program in `v0.2.0`.
- If a credible decentralized stable asset emerges with enough liquidity, chain support, x402 support, and operational simplicity, evaluate it in a future protocol version. Do not add price oracles or multi-collateral support in `v0.2.0`.

Identity and reputation interop:

- Treat AgentVouch as the economic accountability layer that sits on top of agent identity, not a competing identity standard.
- Align with ERC-8004 Trustless Agents (Identity, Reputation, Validation registries) and the Solana Agent Registry, which is interoperable with ERC-8004.
- The protocol owns vouches, author bonds, listings, purchases, voucher rewards, and disputes in USDC. Identity and base reputation feed in from registries; AgentVouch contributes the economic, slashable side of trust.
- Every protocol object (`AgentProfile`, `SkillListing`, `Vouch`, `AuthorBond`, `Purchase`, dispute accounts) and every event must carry enough fields to be mapped to its ERC-8004 equivalent (agent id, feedback id, validation id) and to a CAIP-2 chain context (`solana:<genesis>` today, `eip155:<chain-id>` later).
- Where an `AgentProfile` corresponds to a registered agent, store enough registry linkage (`agent_registry`, `agent_id`, and/or `agent_uri`) alongside the protocol pubkey so AgentVouch reputation can be read back through ERC-8004 and the Solana Agent Registry.
- Future deployments on EVM or stablecoin-native chains should reuse ERC-8004 identity/reputation surfaces directly rather than introducing a second identity primitive. AgentVouch contributes slashing and bond economics on whichever chain it is deployed.

Vault custody model:

The v0.2.0 program uses one explicit custody pattern per primitive:

- Protocol-owned USDC vaults use explicit token-account PDAs, not ATAs. Recipient accounts for user-facing payouts remain canonical ATAs.
- Author bond: per-author PDA-owned token vault.
- Vouch stake: per-vouch PDA-owned token vault, funded by the voucher who also pays rent and reclaims rent on `revoke_vouch`.
- Listing reward pool: per-listing PDA-owned token vault, separate from the listing PDA's data account.
- Dispute bond: per-dispute PDA-owned token vault until resolution.
- Protocol treasury: PDA-owned token vault that receives dismissed dispute bonds and future governed fees.
- x402 settlement: PDA-owned token vault reserved for a future bridge path; Milestone 3 does not enable protocol-listed x402 settlement.
- Author payout on purchase: direct transfer to the author's canonical USDC ATA for `(author, config.usdc_mint)`.
- Voucher revenue claim: transfers from the listing reward vault to the voucher's canonical USDC ATA.
- Slashed funds: preserve v0.1.0 economics in USDC. If a dispute is upheld, the challenger receives their dispute bond plus slashed author/voucher funds. If dismissed, the challenger bond goes to the protocol treasury vault.

ATA and rent rules:

- The program never auto-creates a user ATA. Clients must ensure buyer, author-withdraw, and voucher-claim ATAs exist before submitting; the web hook layer handles `createAssociatedTokenAccountIdempotentInstruction` where needed.
- `purchase_skill` no longer pays the author ATA directly. It pays the author share into the revision-scoped author proceeds vault; authors withdraw with `withdraw_author_proceeds`.
- SOL is required only for transaction fees and PDA/ATA rent. The party that creates a PDA-owned vault pays its rent (author for author-bond and listing-reward vaults, voucher for vouch-stake vaults, challenger for dispute-bond vaults, config initializer for treasury and settlement vaults). Rent is refunded to the original primitive rent payer on the matching close instruction. Slashing never confiscates SOL rent; it only moves USDC.

Vault lifecycle rules:

- Author bond vaults can close only after the author bond balance is zero and the author has no open disputes.
- Vouch stake vaults can close only through `revoke_vouch` or final settlement after the vouch is no longer active and no linked dispute can slash it.
- If a vouch is fully slashed, slashed USDC goes to the dispute payout path, but rent from closing the vouch PDA/token vault returns to the original rent payer.
- Listing reward vaults cannot close while `unclaimed_voucher_revenue_usdc_micros > 0` or while any voucher has claimable rewards. Listing removal should freeze new purchases but keep the reward vault claimable until all voucher claim rights are resolved.
- Listing reward vault residuals that are not assigned to a claimable voucher position, including rounding dust or accidental direct transfers, can be swept to the protocol treasury vault during a permissionless close/sweep path after all claimable rewards are resolved.
- Dispute bond vaults close on dispute resolution. If upheld, the challenger receives their dispute bond plus slashed USDC. If dismissed, the challenger bond goes to the protocol treasury vault. Rent returns to the challenger.
- `withdraw_author_bond` and `revoke_vouch` must fail while the target author has active disputes that can reach those funds.
- If an author loses their wallet, v0.2.0 does not provide admin recovery by default. Funds remain controlled by the original author authority unless a later governance-approved migration instruction is specified.

Purchase settlement principle:

- Protocol-visible paid purchases are permissionless. A fresh registered author can sell a paid listing with no external vouches and no author self-stake.
- When external vouch stake is active, direct app purchases call `purchase_skill` and split USDC inside the Anchor program with the configured `60%` author / `40%` voucher split.
- When no external vouch stake is active, including zero-backing and author-self-stake-only listings, the full payment goes to author proceeds; no voucher reward pool is created because there are no voucher positions that can claim it.
- With zero backing, an upheld dispute produces a reputation hit only. The protocol has no funds to slash, so no buyer funds are recoverable in that dispute path.
- x402 purchases for protocol-listed paid skills must not bypass voucher rewards. The intended v0.2.0 path is a POC-gated settlement bridge: x402 pays a protocol settlement vault, the backend verifies the settled transaction and memo, then a configured `settlement_authority` calls `settle_x402_purchase` to create the on-chain purchase and split funds.
- If the bridge POC fails, x402 remains disabled for new paid marketplace purchases. Existing historical repo-only x402 entitlements can still re-download content, but new paid repo skills must link an on-chain `SkillListing`.

x402 bridge POC pass/fail criteria:

- Gate decision before Milestone 3: `settle_x402_purchase` is excluded from the first Anchor USDC rewrite pass. Direct USDC `purchase_skill` is the only protocol-visible paid purchase path until the x402 bridge POC passes.
- Pass requires proof that `@x402/svm` and the selected facilitator can settle an exact USDC transfer into the intended protocol settlement vault pattern, including the PDA/off-curve owner case if that is the selected design.
- Pass requires deterministic memo binding to `protocol_version`, chain context, listing address, skill database id, buyer, and nonce without storing PII or free-form user text on-chain.
- Pass requires reliable buyer extraction (`settle.payer` or transaction authority) so the on-chain `Purchase` PDA is derived from the paying wallet, not the facilitator fee payer.
- Pass requires idempotency: the same payment reference or transaction signature cannot create more than one `X402SettlementReceipt`, `Purchase`, entitlement, or reward split.
- Pass requires a retry/refund path for the case where x402 settles but `settle_x402_purchase` fails after USDC lands in the settlement vault.
- Fail means paid skills require direct `purchase_skill`; `/api/x402/supported` must return capability metadata explaining that new repo-only x402 purchases are disabled and protocol-listed paid skills require direct on-chain purchase.
- Allowed x402-related flows after bridge failure are: free downloads without payment and existing historical entitlements that re-download with `X-AgentVouch-Auth`.

Settlement authority constraints:

- `settlement_authority` can only settle verified x402 payments from the settlement vault into the normal purchase/reward accounting path.
- It cannot set listing price, change author, change voucher split, mint USDC, bypass `Purchase` PDA uniqueness, or withdraw arbitrary settlement vault balances.
- It must be rotatable and pausable by config authority, with every settlement emitting a versioned event for audit.
- Production use requires monitoring for settlement failures, stuck settlement vault balances, duplicate attempts, and authority rotation events.

Economics and reputation gate decision:

- Milestone 3 locks the v0.2.0 devnet defaults at: `0.01 USDC` minimum paid listing price, `1 USDC` minimum vouch stake, `1 USDC` minimum author bond for free listings, `0.5 USDC` dispute bond, `60%` author share when voucher stake exists, `40%` voucher reward share when voucher stake exists, and `0%` protocol fee.
- Author bonds and voucher stake use the same USD-at-risk reputation curve because both represent slashable trust capital.
- Profile age stays in the on-chain score through the capped `longevity_component`, using `AgentProfile.registered_at`. Wallet/account age and external profile age are off-chain/indexed trust context in `v0.2.0`.
- Reputation uses integer math only:

```text
risk_usdc_micros = author_bond_usdc_micros + total_vouch_stake_usdc_micros
risk_component = min((risk_usdc_micros * stake_weight_per_usdc) / 1_000_000, risk_component_cap)
vouch_component = min(total_vouches_received * vouch_weight, vouch_component_cap)
longevity_component = min(age_days * longevity_bonus_per_day, longevity_component_cap)
raw_positive_score = risk_component + vouch_component + longevity_component
dispute_penalty = upheld_author_disputes * upheld_dispute_penalty
score = min(saturating_sub(raw_positive_score, dispute_penalty), reputation_score_cap)
```

- Default weights: `stake_weight_per_usdc = 10`, `risk_component_cap = 10_000_000` (saturates at `1,000,000 USDC` of slashable trust capital), `vouch_weight = 10`, `vouch_component_cap = 10_000` (saturates at `1,000` vouches), `longevity_bonus_per_day = 1`, `longevity_component_cap = 3_650` (saturates at ~10 years of profile age), `upheld_dispute_penalty = 1_000`, and `reputation_score_cap = 10_100_000`.
- Keep amount-based risk and count-based vouch social proof separate. Vouch stake contributes through `stake_weight_per_usdc`; `vouch_weight` is only the capped count-based component.
- Upheld disputes reduce reputation through slashed stake/bond lowering USD-at-risk and through the fixed upheld-dispute penalty. Open disputes freeze withdrawals but do not directly reduce score until resolved.

## Target Architecture

```text
Buyer / Voucher / Author
        |
        v
Wallet signs USDC transaction
        |
        v
Anchor v0.2.0 USDC program
        |
        +--> validates USDC mint and token accounts
        +--> moves USDC through PDA-owned vaults
        +--> records purchases, vouches, bonds, rewards, disputes
        +--> computes reputation from USDC-backed risk
        |
        v
Web/API indexes v0.2.0 accounts and x402 entitlements
```

## Program Identity And Keypairs

Use a fresh deploy keypair for the USDC-native `v0.2.0` migration.

Recommended naming:

```text
target/deploy/reputation_oracle-keypair.json       # legacy Anchor default for current v0.1.0 local program
target/deploy/reputation_oracle_v01-keypair.json   # archived v0.1.0 SOL devnet program key
target/deploy/agentvouch-keypair.json              # Anchor default for v0.2.0 USDC-native program
target/deploy/agentvouch_v02-keypair.json          # archived v0.2.0 keypair copy
```

Version rules:

- Use `v01` and `v02` suffixes for pre-mainnet devnet program keypairs.
- Reserve `v1` / `v1.0.0` language for the first mainnet-ready deployment.
- Do not deploy `v0.2.0` with the existing active `v0.1.0` program ID.

Current note:

- `target/deploy/reputation_oracle-keypair.json` maps to the active `v0.1.0` devnet program.
- `target/deploy/reputation_oracle_v01-keypair.json` is the archived `v0.1.0` keypair copy.
- `target/deploy/agentvouch-keypair.json` was generated for the fresh `v0.2.0` program identity.
- `target/deploy/agentvouch_v02-keypair.json` is the archived `v0.2.0` keypair copy.
- `v0.2.0` program pubkey: `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ`.

## Production Cutover Guardrail

Do not deploy the `v0.2.0` branch to production until the new program is deployed, initialized, indexed, and smoke-tested end to end.

Cutover rules:

- Keep production `agentvouch.xyz` stable on the current working flow while `v0.2.0` is still being built.
- Branch artifacts may reference the `v0.2.0` program ID during implementation, but production must not serve public metadata that advertises `v0.2.0` before deployed bytecode, config, API/indexer, and web flows match it.
- Cut over in this order: deploy program, initialize config, verify program/config authorities, sync IDL/client artifacts, enable API/indexer reads, enable feature-flagged v0.2.0 writes, run devnet smoke tests, update public metadata/docs/protocol constants together, then hard-cut primary writes to `v0.2.0`.
- Public metadata that agents, wallets, and reviewers can read must flip together at cutover: `web/public/skill.md`, `.well-known/agentvouch.json`, docs, generated IDL/client files, and `@agentvouch/protocol` constants.
- `web/public/skill.md` must be internally consistent at cutover: USDC-native copy, v0.2.0 program ID, current paid download contract, x402 capability status, and no stale SOL/lamport publish or purchase claims except explicit legacy notes.
- Phantom app acceptance should remain tied mostly to the domain, app ID, allowlisted URLs, and wallet UX. A program ID change is acceptable only after the new on-chain flow is live and verified.
- Do not expose new program ID-dependent wallet flows in production until Phantom connect, direct checkout, and embedded/send-only wallet fallback behavior are verified.
- Do not expose a half-cutover state where public docs or manifests point at `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ` before the program has been deployed and initialized on the intended cluster.
- During transition, APIs and trust surfaces may dual-read `v0.1.0` and `v0.2.0`, but new writes hard-cut to `v0.2.0` only after direct purchase indexing, entitlement repair/backfill, and smoke tests pass.
- Rollback path: keep `main` deploy-safe for the current v0.1 flow until Milestone 11 passes. If cutover smoke fails after a preview deploy, roll production metadata and write flags back to the current v0.1 flow; do not partially roll forward public manifests.
- `/api/x402/supported` remains fail-closed for protocol-listed paid skills until the x402 bridge POC passes; repo-only/off-chain x402 support must be labeled as not protocol-visible.
- Keep private deploy keypairs out of git. Commit only source, docs, generated IDL/client artifacts, and public constants.

Public cutover smoke checklist:

- Deployed program ID, `declare_id!`, `Anchor.toml`, `web/agentvouch.json`, generated client, protocol package constants, `.well-known/agentvouch.json`, and `skill.md` metadata all agree.
- Config is initialized with the expected USDC mint, token program, role authorities, treasury vault, settlement vault, floors, splits, pause state, and CAIP-2 chain context.
- API/indexer can read v0.2.0 config, profiles, listings, vouches, purchases, voucher claims, disputes, and authority events.
- Devnet smoke passes: register agent, deposit author bond, author-wide vouch, publish listing, direct USDC purchase, claim voucher revenue, open/resolve dispute, verify reputation delta, and download raw skill content with `X-AgentVouch-Auth`.
- Legacy v0.1 read surfaces remain readable during transition, while all new writes target v0.2.0 after hard cut.
- Production preview confirms Phantom wallet connection, direct purchase checkout, send-only/embedded wallet fallback copy, and no protocol-listed x402 advertisement unless bridge support is live.
- Public docs and `skill.md` have no stale SOL-denominated primary flow claims.

## Planned Implementation Process

Treat `v0.2.0` as a fresh protocol that uses the existing codebase as scaffolding, not as a backwards-compatible patch set. There is no real usage or user money on the current devnet deployment, so the implementation should prefer a clean USDC-native model over compatibility shims.

Recommended cadence:

- Use a dedicated branch or worktree and keep `main` deploy-safe for the current `v0.1.0` devnet app until the `v0.2.0` smoke test passes.
- Do one broad on-chain pass after the Pre-Milestone 3 gates close: rewrite accounts, fields, PDA seeds, token constraints, vault movement, and instruction signatures together so the IDL moves as one coherent protocol.
- Do not migrate one instruction at a time while preserving SOL account layouts. That creates temporary compatibility layers that should not survive into the fresh program.
- After the broad on-chain pass, iterate in tight compile/test loops: `anchor build`, IDL/client sync, unit tests, negative tests, and compute/account measurement.
- Once the program and IDL are stable, integrate outward in layers: generated client, web hooks, API/indexing, x402 bridge path, UI copy, CLI, docs, and pitch deck.
- Keep commits reviewable by milestone or subsystem, but do not require each commit to preserve a fully working hybrid SOL/USDC product. The branch only needs to become product-complete before devnet cutover.

Rule of thumb:

- Use broad rewrite passes for protocol shape and account layout decisions.
- Use incremental passes for verification, UI/API integration, docs, and bug fixes after the core shape compiles.
- If an implementation starts accumulating compatibility code for `v0.1.0`, stop and replace it with the simpler `v0.2.0` design unless it is explicitly needed for temporary read-only display.

Planning structure:

- Keep this document as the stable source-of-truth spec and roadmap. Do not turn it into a live task tracker.
- Use separate milestone plans when execution starts. Each milestone plan should contain implementation steps, working TODOs, verification commands, blockers, and notes.
- Update this document only when a decision changes protocol design, durable process, acceptance criteria, or a pre-Milestone gate.
- Close TODOs in the milestone plan as work progresses; do not mirror every execution TODO back into this document.

Example milestone plans:

- `Milestone 1 - Protocol Spec`
- `Milestone 2 - Fresh Program Identity`
- `Milestone 3 - Anchor USDC Rewrite`
- `Milestone 4 - Program Tests`

## Milestones

### Milestone 0: Freeze v0.1.0 Scope

Goal: stop treating the existing SOL program as the future protocol.

Tasks:

- Mark the current program as legacy in docs.
- Keep `v0.1.0` readable while `v0.2.0` is being built.
- Do not add new trust features to `v0.1.0`.
- Rewrite `AGENTS.md` learned workspace facts for the target USDC-native design before implementation starts, so agent guidance does not keep steering work back to legacy SOL-denominated patterns.
- Decide whether the UI should hide `v0.1.0` write actions immediately or only after `v0.2.0` is usable.

Acceptance criteria:

- `docs/ARCHITECTURE.md` or follow-up docs clearly state that `v0.1.0` is SOL-denominated and legacy.
- `AGENTS.md` reflects the target `v0.2.0` USDC-native protocol, fresh program ID plan, per-primitive vault model, CAIP-2 conventions, and x402 bridge gating.
- New work items target `v0.2.0` unless explicitly marked as `v0.1.0` maintenance.

Verification:

```bash
rg "legacy|USDC-native|SOL-denominated|v0.2.0" docs
rg "USDC-native|v0.2.0|per-primitive|CAIP-2|x402 bridge" AGENTS.md
```

### Milestone 1: v0.2.0 Protocol Spec

Goal: define the USDC-native account and instruction model before coding.

Tasks:

- Define all `v0.2.0` accounts and PDA seeds.
- Define USDC vault ownership for vouches, author bonds, listing reward pools, and dispute bonds.
- Define canonical USDC ATA validation for direct author payouts.
- Define x402 settlement vault ownership and the `settlement_authority` role for the bridge POC.
- Define exact reward split: `60%` author / `40%` voucher pool only when active external voucher stake exists; otherwise `100%` to author proceeds.
- Define free listing requirements using `min_author_bond_usdc_micros`.
- Define reputation formula using USDC-backed risk and non-money signals.
- Define dispute liability order:
  - free listings: author bond first
  - paid listings: author bond first, then linked vouchers if needed
- Preserve v0.1.0 dispute payout policy in USDC:
  - upheld: challenger receives their dispute bond plus slashed funds
  - dismissed: challenger bond goes to protocol treasury
- Define upgrade authority, config authority, settlement authority, treasury authority, pause/rotation flow, and mainnet multisig requirements.
- Define treasury withdrawal policy and confirm `v0.2.0` has zero protocol fee.
- Define voucher reward accounting model and revenue eligibility rules before coding.
- Define author wallet rotation policy. Default: listings are bound to the original author authority and canonical USDC ATA unless a future author-signed migration instruction is specified.
- Define how free listings behave if `author_bond_usdc_micros` drops below `min_author_bond_for_free_listing_usdc_micros` after slash or withdrawal. Default: freeze new paid/free installs that require trust until the bond is restored or the listing is explicitly marked inactive.
- Define dispute evidence semantics. Default: evidence URI and resolver/reviewer roles remain unchanged from v0.1.0 unless the spec explicitly changes them.
- Define ERC-8004 / Solana Agent Registry interop fields:
  - Optional `AgentProfile.agent_registry` plus `AgentProfile.agent_id` (or one opaque `registry_ref` if layout pressure matters) that links the on-chain profile to the registered agent in the Solana Agent Registry.
  - Optional `AgentProfile.agent_uri` when the implementation needs to resolve the external registration file directly.
  - Optional listing-level mirror of the same linkage for cross-chain reputation portability.
  - Event payloads include `protocol_version`, CAIP-2 chain context, program id, and registry linkage fields where present, so indexers can publish reputation deltas back to ERC-8004-aligned surfaces.
- Treat AgentVouch as a reputation-emitter into ERC-8004 / Solana Agent Registry, not an alternative identity layer. Avoid baking a competing identity primitive into v0.2.0 accounts.

Candidate account fields:

- `AgentProfile.total_staked_for_usdc_micros`
- `AgentProfile.author_bond_usdc_micros`
- `Vouch.stake_usdc_micros`
- `Vouch.cumulative_revenue_usdc_micros`
- `AuthorBond.amount_usdc_micros`
- `SkillListing.price_usdc_micros`
- `SkillListing.total_revenue_usdc_micros`
- `SkillListing.unclaimed_voucher_revenue_usdc_micros`
- `Purchase.price_paid_usdc_micros`
- `ReputationConfig.min_stake_usdc_micros`
- `ReputationConfig.dispute_bond_usdc_micros`
- `ReputationConfig.min_author_bond_for_free_listing_usdc_micros`
- `ReputationConfig.usdc_mint`
- `ReputationConfig.token_program`
- `ReputationConfig.protocol_treasury_vault`
- `ReputationConfig.x402_settlement_authority`
- `ReputationConfig.x402_settlement_vault`
- Optional `AgentProfile.agent_registry` for ERC-8004 / Solana Agent Registry linkage.
- Optional `AgentProfile.agent_id` for the registry-local agent identifier.
- Optional `AgentProfile.agent_uri` for the external registration file when needed.
- Optional `SkillListing.agent_registry` mirror for cross-chain reputation portability.
- Optional `SkillListing.agent_id` mirror for cross-chain reputation portability.

Locked floors and calibration:

- Minimum listing price: replace the v0.1.0 `0.001 SOL` rule with `0.01 USDC` (`10_000` micros).
- Minimum vouch stake: `1 USDC`; minimum author bond for free listings: `1 USDC`; dispute bond: `0.5 USDC`.
- Reputation formula: score against USD economic value, not lamport units. Use the locked Gate 2 formula, weights, caps, floor rounding, and `u128` intermediate math.
- Cooldowns, dispute holds, and revoke locks carry over from v0.1.0 unchanged; restate them in the spec so they are not dropped during the rewrite.

Locked voucher reward accounting:

- Use author-wide vouch rewards on `AgentProfile` with per-vouch entry indexes. Late vouches start at the current author reward index and cannot earn prior voucher-pool revenue.
- Use `SCALE = 1_000_000_000_000`, `reward_index_usdc_micros_x1e12`, `entry_author_reward_index_x1e12`, and checked `u128` intermediate math. Overflow fails the instruction; reward accounting must not saturate.
- Paid `purchase_skill` requires author-wide active vouch backing and a non-zero reward index delta.
- Purchase-time reward update:

```text
voucher_pool = price_usdc_micros * voucher_share_bps / 10_000
index_delta = voucher_pool * SCALE / active_reward_stake_usdc_micros
listing.reward_index_usdc_micros_x1e12 += index_delta
listing.unclaimed_voucher_revenue_usdc_micros += voucher_pool
```

- Position mutation accrues before changing stake, status, or entry index:

```text
accrued = reward_stake_usdc_micros * (listing.reward_index_usdc_micros_x1e12 - entry_reward_index_x1e12) / SCALE
pending_rewards_usdc_micros += accrued
entry_reward_index_x1e12 = listing.reward_index_usdc_micros_x1e12
```

- A voucher keeps already-accrued claim rights after unlink, revoke, or partial slash. Forfeiture is only forward-looking after the vouch is inactive or stake is reduced.
- Partial slashes accrue first, then reduce future reward weight in proportion to remaining active stake. Fully slashed positions keep already accrued pending rewards claimable unless a later explicit forfeiture rule is adopted.
- Claims accrue first, pay the actual claimable amount from the author reward vault to the voucher canonical ATA, decrement author-wide `unclaimed_voucher_revenue_usdc_micros` by the paid amount, and update aggregate vouch revenue counters.
- Listing removal freezes new purchases and links, but does not block reward claims.
- Listing closure no longer owns voucher reward funds; claimable rewards live at the author reward vault and remain claimable by voucher.

Compute and account ceiling gate decision:

- No Milestone 3 instruction may require an unbounded number of accounts. User-facing transactions must fit a `64` static-account planning ceiling without requiring Address Lookup Tables.
- Paid-listing purchase eligibility uses author-wide backing. Dispute liability keeps the author-bond-first path and can snapshot author-wide vouch exposure without requiring listing links.
- `MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING = 32` for `v0.2.0`.
- `MAX_DISPUTE_POSITIONS_PER_TX = 8` for any instruction that links, verifies, slashes, or settles dispute-linked voucher positions.
- Paid-listing upheld disputes use batched settlement when linked positions exceed the per-transaction limit: record ruling, settle author bond, process linked voucher positions in chunks, then finalize after all required positions are settled.
- Dismissed disputes use a fixed-account path. Direct purchases, voucher claims, link/unlink, revoke, author-bond deposit/withdraw, and listing create/remove/close remain fixed-account flows.
- Compute targets before devnet cutover: direct purchase below `250_000` CU, voucher claim below `200_000` CU, link/unlink/revoke below `250_000` CU each, open dispute and dismissed dispute resolution below `300_000` CU, dispute link batch of 8 positions below `500_000` CU, upheld voucher settlement batch of 8 positions below `1_200_000` CU, and future `settle_x402_purchase` below `350_000` CU when implemented.
- If measured compute exceeds these targets, reduce batch size before devnet cutover instead of relying on larger transactions.

Toolchain and generated artifact gate decision:

- Anchor CLI: `0.32.1`.
- Solana CLI: `3.1.4`.
- Rust/MSRV: `1.89.0` via `rust-toolchain.toml`.
- Node/npm for local verification: Node `24.1.0`, npm `11.12.1`.
- Add `anchor-spl = { version = "0.32.1" }` in Milestone 3 so SPL Token helpers match `anchor-lang = "0.32.1"`.
- Use npm as the canonical workspace package manager and align `Anchor.toml` to npm during Milestone 3 implementation.
- Regenerated artifacts are `target/idl/agentvouch.json`, `target/types/agentvouch.ts`, `target/deploy/agentvouch.so`, `web/agentvouch.json`, and `web/generated/agentvouch`.
- Generated artifacts must be regenerated, not patched by hand. If `NO_DNA=1 anchor build` does not leave `target/deploy/agentvouch.so` in the repo because `CARGO_TARGET_DIR` is set externally, run `env -u CARGO_TARGET_DIR cargo build-sbf --manifest-path programs/agentvouch/Cargo.toml`.
- Canonical generated artifact flow:

```bash
NO_DNA=1 anchor build
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
npm run build --workspace @agentvouch/web
```

Events and IDL break:

- Every `emit!` event signature changes (`*_lamports` -> `*_usdc_micros`). List the new event schema in the spec so indexers and downstream consumers can plan.
- Every v0.2.0 event should include `protocol_version` and enough keys for indexers to derive chain context, program id, listing, buyer/voucher/author, and affected vaults.
- Reputation-relevant events (vouch, revoke, slash, dispute resolved, author bond change, purchase, voucher claim) should be shaped so an ERC-8004-aligned bridge can map them to Reputation Registry feedback or Validation Registry results without parsing free-form text.

Acceptance criteria:

- A reviewed spec exists before implementation.
- Every `v0.1.0` lamport business field has an explicit `v0.2.0` replacement or is intentionally removed.
- Token account ownership and mint constraints are specified for every money-moving instruction.
- Protocol-listed paid purchase paths preserve the author/voucher split.
- Economic floors, reputation ranges, reward-index math, freeze rules, treasury policy, and authority rotation rules are decided before Milestone 3 starts.

Verification:

```bash
rg "lamports|price_lamports|author_bond_lamports|stake_amount" docs/USDC_NATIVE_MIGRATION.md
```

### Milestone 2: Fresh Program Identity

Goal: create and wire a new devnet program identity for `v0.2.0`.

Tasks:

- Generate `target/deploy/agentvouch-keypair.json` and mirror a versioned `target/deploy/agentvouch_v02-keypair.json` copy.
- Record the new pubkey in the migration notes.
- Update `declare_id!`.
- Update `Anchor.toml` devnet/localnet program IDs.
- Rename the crate/lib from `reputation-oracle` / `reputation_oracle` to `agentvouch`.
- Rename the Anchor program identity to `agentvouch`, including the crate/lib name and `programs/agentvouch/` folder.
- Move the checked-in web IDL/client paths to `web/agentvouch.json` and `web/generated/agentvouch`.

Acceptance criteria:

- `solana-keygen pubkey target/deploy/agentvouch-keypair.json` returns `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ`, distinct from the legacy `v0.1.0` program ID.
- `programs/agentvouch/src/lib.rs` and `Anchor.toml` agree on the `v0.2.0` program ID.

Verification:

```bash
solana-keygen pubkey target/deploy/agentvouch-keypair.json
rg "AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ" Anchor.toml programs/agentvouch/src/lib.rs
```

### Pre-Milestone 3 Gates

Goal: resolve design questions that would be expensive to rewrite after the Anchor USDC implementation starts.

Required gates:

- x402 bridge POC pass/fail decision, including PDA settlement vault compatibility, memo binding, payer extraction, idempotency, retry, and refund behavior.
- Governance and authority model for devnet and mainnet, including upgrade authority custody and config authority rotation.
- Treasury policy: `treasury_authority` is reserved, and no arbitrary treasury-withdrawal instruction ships in Milestone 3.
- Exact economic floors:
  - Minimum listing price: 0.01 USDC (`10_000` micros).
  - Minimum author bond for free listings and minimum vouch stake: 1 USDC.
  - Dispute bond: 0.5 USDC.
- Reputation score formula, score caps, rounding behavior, and USD-value calibration against the legacy v0.1.0 low-end trust scale (anchored to the `0.001 SOL` listing floor).
- Voucher reward index model, revoke/slash eligibility rules, and listing close behavior with unclaimed rewards.
- Compute/account ceilings: fixed-account flows stay bounded, paid-listing disputes use listing-scoped backing, `MAX_ACTIVE_REWARD_POSITIONS_PER_LISTING = 32`, and dispute link/slash batches process at most `MAX_DISPUTE_POSITIONS_PER_TX = 8`.
- Toolchain pin: Anchor `0.32.1`, Solana CLI `3.1.4`, Rust `1.89.0`, Node `24.1.0`, npm `11.12.1`, `anchor-spl = 0.32.1`, and `npm run generate:client`.

Acceptance criteria:

- No item above remains in the risk register as an unresolved implementation fork.
- Milestone 3 can proceed without adding placeholder shims or compatibility layers for undecided economics.

### Milestone 3: Anchor USDC Rewrite

Goal: replace SOL custody with SPL USDC custody.

Tasks:

- Add `anchor-spl`.
- Use SPL Token account constraints for USDC mint and token accounts.
- Add config-level USDC mint storage.
- Add PDA-owned token vaults where funds must remain under program control.
- Replace `system_program::transfer` business payments with checked token transfers.
- Keep SOL only for rent and transaction fees.
- Remove or rewrite `v0.1.0` migration instructions that only exist for old lamport account layouts.
- Add post-transfer balance or state checks anywhere instruction logic depends on vault deltas.
- Keep compute and account-count budgets visible in tests for high-account flows.
- After every `anchor build` (or `anchor clean && anchor build` when IDLs look stale), copy `target/idl/agentvouch.json` -> `web/agentvouch.json` and run `npm run generate:client`. The web client must remain Vercel-deploy-safe.

Instruction areas to rewrite:

- `initialize_config`
- `register_agent`
- `deposit_author_bond`
- `withdraw_author_bond`
- `vouch`
- `revoke_vouch`
- `create_skill_listing`
- `update_skill_listing`
- `purchase_skill`
- `settle_x402_purchase` after the bridge POC passes
- `claim_voucher_revenue`
- `open_author_dispute`
- `resolve_author_dispute`
- listing close/remove flows

Acceptance criteria:

- No protocol business amount is named `lamports`.
- All USDC transfers validate:
  - mint
  - source token account owner
  - destination token account owner
  - token account mint
  - PDA authority signer seeds
  - token program
- Program builds with the new ID.
- No instruction requires an unbounded number of accounts. Paid-listing dispute resolution uses listing-scoped backing and batched linked-position processing.

Verification:

```bash
NO_DNA=1 anchor build
cargo check --manifest-path programs/agentvouch/Cargo.toml
rg "price_lamports|author_bond_lamports|unclaimed_voucher_revenue|system_program::transfer" programs/agentvouch/src
```

### Milestone 4: Program Tests

Goal: prove the USDC accounting works before touching the app.

Testing strategy:

- Use LiteSVM for fast unit tests of token transfers, vault accounting, reputation math, and edge cases (wrong mint, missing ATA, insufficient balance, active-dispute freezes).
- Use Surfpool or devnet for integration tests that need RPC fidelity or live-cluster behavior. If a local validator is used, clone/import the required USDC mint and token accounts rather than assuming the real devnet mint exists locally.
- Measure compute units and account counts on worst-case dispute paths (highly-vouched author) before devnet cutover.

Tasks:

- Use LiteSVM or Mollusk for fast unit and negative tests on token-account constraints; reserve `anchor test` / Surfpool for end-to-end flows.
- Add tests for config initialization with USDC mint.
- Add tests for agent registration.
- Add tests for author bond deposit/withdraw.
- Add tests for vouch/revoke (including rent refund on revoke).
- Add tests for paid listing purchase, escrowed author proceeds, and reward pool accounting.
- Add tests that author proceeds are paid into the listing settlement vault and withdrawn separately.
- Add tests for voucher revenue claim.
- Add tests for dispute open/resolve and slashing (slash routed to challenger ATA).
- Add bridge POC tests before implementing `settle_x402_purchase`: x402 exact payment to protocol settlement vault, memo binding, payer extraction, duplicate payment ref rejection, and retry/refund behavior.
- Add negative tests for: wrong mint, wrong token program, missing recipient ATA, wrong ATA owner, insufficient stake, self-vouch, and reputation overflow.

Acceptance criteria:

- Tests cover every instruction that moves or accounts for USDC.
- Tests assert token balances and account state after each flow.
- Negative tests fail for the intended reason.

Verification:

```bash
NO_DNA=1 anchor test
```

### Milestone 5: IDL And Client Sync

Goal: refresh generated artifacts after the `v0.2.0` program compiles.

Tasks:

- Run `anchor build`.
- Sync the generated IDL to `web/agentvouch.json`.
- Regenerate the web client.
- Confirm generated program constants point to the `v0.2.0` program ID.
- Remove stale generated references to lamport-only fields.

Acceptance criteria:

- `web/agentvouch.json` has the `v0.2.0` address.
- `web/generated/agentvouch` has USDC field names.
- TypeScript compile errors identify all remaining app integration points.

Verification:

```bash
NO_DNA=1 anchor build
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
rg "ELmVnLSN|priceLamports|authorBondLamports|LAMPORTS_PER_SOL" web/generated web/agentvouch.json
```

### Milestone 6: Web Hook Integration

Goal: point the app's on-chain write flows at `v0.2.0` USDC instructions.

Tasks:

- Update `web/hooks/useReputationOracle.ts`.
- Replace SOL input conversions with micro-USDC conversions.
- Add USDC ATA discovery/creation requirements where needed.
- Add preflight checks for USDC balance and token accounts.
- Simulate transactions before asking the wallet to sign.
- Keep legacy read paths only if needed for temporary display.

Primary flows:

- register agent
- deposit author bond
- withdraw author bond
- vouch
- revoke vouch
- create/update listing
- purchase skill
- claim voucher revenue
- open/resolve dispute

Acceptance criteria:

- Hook API uses USDC units or clearly named micro-USDC amounts.
- No trust/staking write path calls a SOL-denominated `v0.1.0` instruction.
- Transaction summaries show token, amount, recipient/vault, fee payer, and cluster.

Verification:

```bash
rg "LAMPORTS_PER_SOL|formatSol|priceLamports|authorBondLamports" web/hooks web/lib
npm run build --workspace @agentvouch/web
```

### Milestone 7: UI Conversion

Goal: make the product read as USDC-native.

Tasks:

- Update dashboard staking and author bond inputs to USDC.
- Update author pages to show backing, self-stake, revenue, and disputes in USDC.
- Update skill cards and detail pages to treat USDC as primary.
- Remove or hide legacy SOL purchase CTAs.
- Keep primary nav and action sizing consistent with the current UI rules.

Primary files:

- `web/app/dashboard/page.tsx`
- `web/app/author/[pubkey]/page.tsx`
- `web/app/skills/page.tsx`
- `web/app/skills/[id]/page.tsx`
- `web/components/SkillPreviewCard.tsx`
- `web/components/TrustBadge.tsx`

Acceptance criteria:

- User-facing trust capital is displayed in USDC.
- SOL appears only for network fees, legacy notices, or explicit historical context.
- Paid skill purchase copy matches the `v0.2.0` protocol and x402 behavior.

Verification:

```bash
rg "SOL|lamports|formatSol|LAMPORTS_PER_SOL" web/app web/components web/hooks
npm run build --workspace @agentvouch/web
```

### Milestone 8: API, x402, And Entitlements Alignment

Goal: align the existing USDC/x402 commerce path with `v0.2.0` protocol semantics.

Tasks:

- Treat direct `purchase_skill` as the canonical protocol-visible paid purchase path.
- Require every protocol-listed paid purchase path to preserve voucher rewards when active external voucher stake exists; otherwise route the full payment to author proceeds.
- Run the x402 settlement bridge POC before making x402 primary for protocol-listed paid skills:
  - x402 exact payment credits a protocol settlement vault
  - `extra.memo` binds payment to skill, listing, chain context, and nonce
  - server verifies settled token delta, memo, payer, mint, and amount
  - backend calls `settle_x402_purchase` as `settlement_authority`
  - program creates an idempotent `X402SettlementReceipt` PDA and the normal `Purchase` PDA
  - program splits USDC from the settlement vault to author ATA and listing reward vault
- Browser USDC x402 uses split-signature sponsored flow; gate it to wallets that support `partialSign` (route Phantom embedded/send-only wallets to direct `signAndSendTransaction` or agent fallback). Document this for the settlement bridge POC.
- If the bridge POC fails, disable x402 for new paid marketplace purchases and require direct `purchase_skill`; keep historical repo-only/off-chain entitlements for signed re-downloads only.
- Keep `usdc_purchase_receipts` and `usdc_purchase_entitlements` for raw download access.
- Add active protocol metadata to `skills`:
  - `on_chain_protocol_version`
  - `on_chain_program_id`
- Add a unique index on `(chain_context, on_chain_program_id, on_chain_address)` where `on_chain_address IS NOT NULL`.
- v0.2.0 republish updates the existing `skills.id` row rather than creating a second skill row, so existing installs, versions, and entitlements remain attached to the same database skill.
- Keep entitlement identity as `(skill_db_id, buyer_pubkey)` so download access survives v0.1.0 to v0.2.0 republish.
- Add receipt audit fields such as `payment_flow` and nullable `protocol_version`; keep `payment_tx_signature` globally unique.
- Mark existing v0.1.0 receipts as legacy and stop writing legacy receipt shapes from new flows.
- Add a direct-purchase indexing path for raw download entitlement:
  - Browser purchase flow submits the confirmed `purchase_skill` signature to an API endpoint.
  - The API verifies the transaction, event, buyer, listing, price, mint, program id, and chain context before writing receipt/entitlement rows.
  - A background reconciler or webhook backfills missed direct purchases from v0.2.0 events so DB state does not rely solely on client reporting.
- Confirm `buildDownloadRawMessage` format is unchanged so existing CLI agents keep working; only the embedded `listing` value updates.
- Confirm `Purchase` PDA derivation seeds and signed-download semantics are stable across the program-id change, with CLI updates limited to the generated client/program id unless the spec intentionally changes seeds.
- Ensure signed download scope handles `v0.2.0` listing addresses.
- Update `/api/x402/supported` to advertise the v0.2.0 bridge only after the POC passes; otherwise document that protocol-listed paid skills require direct `purchase_skill`.
- Add observability for indexing lag, failed entitlement writes, stuck x402 settlement vault funds, direct-purchase verification failures, and config/authority rotation events.

Acceptance criteria:

- Protocol-listed paid purchases update the same reputation/reward accounting model.
- Raw skill downloads still work for agents using direct-purchase entitlements and historical x402 entitlements.
- No duplicate entitlement path creates inconsistent purchase state.
- Direct on-chain purchases grant download access after API verification, and background reconciliation can repair missed client callbacks.

Verification:

```bash
rg "legacy-sol|purchaseSkill|hasOnChainPurchase|x402-usdc" web/app/api web/lib web/app/skills
npm run build --workspace @agentvouch/web
```

### Milestone 9: Database Cutover

Goal: move `v0.2.0` onto a clean database branch or database while keeping the current database available as an archive and rollback point.

Decision:

- Prefer a fresh Neon branch or fresh database for the `v0.2.0` cutover over parallel `*_v2` tables in the current production database.
- Keep the idempotent in-place bootstrap code from Milestone 8 because it protects local, preview, and staged databases that already contain rows.
- Do not carry old devnet purchase, receipt, or entitlement state into the clean `v0.2.0` production cutover unless there is an explicit user-facing reason.
- Treat the old database as read-only archive/rollback after cutover.

Tasks:

- Create a fresh Neon branch or database for `v0.2.0`.
- Run the app bootstrap against the new database so the `skills`, `skill_versions`, `usdc_purchase_receipts`, and `usdc_purchase_entitlements` schema is created with Milestone 8 metadata fields.
- Use `docs/DATABASE_CUTOVER.md` as the cutover runbook and `npm run db:cutover --workspace @agentvouch/web` for inventory, bootstrap, export/import, and sanity checks.
- Decide which durable rows migrate:
  - repo-backed skills and versions that should remain listed
  - author identity/profile cache rows that are still useful
  - API keys only if they are intended to survive the protocol cutover
  - no legacy devnet purchases, legacy receipts, or stale entitlement rows by default
- Add a one-off migration/export script or runbook for selected rows rather than branching every API query by old/new table names.
- Verify migrated repo skills get correct `chain_context`, `on_chain_protocol_version`, `on_chain_program_id`, `price_usdc_micros`, `currency_mint`, and `on_chain_address` behavior.
- Point preview Vercel envs to the new database first.
- Smoke-test publish, listing link, direct purchase verification, raw download entitlement, `/api/skills`, `/api/skills/[id]`, `/api/skills/activity`, and `/api/x402/supported` against the new database.
- At cutover, point production `DATABASE_URL` to the new database and keep the old database credentials archived but inactive.
- Document rollback: restore production `DATABASE_URL` to the old database and roll back public metadata/write flags together if cutover smoke fails.

Acceptance criteria:

- The v0.2.0 app can boot and serve marketplace APIs from the new database without relying on old production rows.
- Selected durable skills and versions are present and correctly tagged with protocol metadata.
- Old devnet purchase/entitlement state does not grant access in the new database unless deliberately migrated.
- Production and preview database env vars are documented and point to the intended Neon branch/database.
- The old database is preserved as archive/rollback and not modified by the v0.2.0 cutover.

Verification:

```bash
npm run build --workspace @agentvouch/web
curl -s http://localhost:3000/api/skills | jq '.skills[:3]'
curl -s http://localhost:3000/api/x402/supported | jq
```

### Milestone 10: Docs, CLI, And Skill File

Goal: make public and agent-facing docs match the new protocol.

Tasks:

- Update `docs/ARCHITECTURE.md`.
- Update `docs/program-upgrades-and-redploys.md` or add a `v0.2.0` deploy runbook.
- Update `web/public/skill.md`.
- Update `web/app/docs/page.tsx`.
- Update `packages/agentvouch-cli` for USDC-native publish/list/install flows. CLI keeps read of v0.1.0 listings during the transition but writes only v0.2.0.
- Remove claims that new listings require a SOL minimum price.
- Document the first-time author cost shift: USDC author bond plus SOL for rent/fees/ATA creation, even though protocol accounting is USDC-native.
- Document that x402 bridge memos must contain only protocol references (version, listing, skill id, nonce) and no PII or free-form buyer text.
- Update `AGENTS.md` learned-facts to reflect USDC-native protocol, new program ID, vault model, and CAIP-2 conventions.
- Defer pitch deck co-versioning to Milestone 16, including `pitch/AgentVouch_walkthrough.pptx`, its paper sibling, account/instruction counts, vault-per-primitive diagrams, and USDC-native architecture slides.
- After every `anchor build`, copy `target/idl/agentvouch.json` to `web/agentvouch.json` and rerun `npm run generate:client` so the web client stays deploy-safe.

Acceptance criteria:

- Public docs describe USDC-native trust capital.
- CLI help and examples use USDC.
- Agent-facing install docs still use `https://agentvouch.xyz/skill.md`.

Verification:

```bash
rg "0.001 SOL|price_lamports|lamports|legacy SOL|ELmVnLSN" docs web/public packages/agentvouch-cli web/app/docs
npm run build --workspace @agentvouch/web
```

### Milestone 11: Devnet Deploy And Smoke Test

Goal: deploy `v0.2.0` to devnet and verify the full flow.

Tasks:

- Deploy `v0.2.0` to devnet with the fresh keypair.
- Initialize config with devnet USDC mint (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`).
- Enable the v0.2.0 app path behind a feature flag while v0.1.0 remains readable.
- Run a scripted batch re-registration for the internal devnet agents and republish their listings against `v0.2.0`.
- Register test agents.
- Create author bond.
- Create vouch.
- Publish listing.
- Purchase listing.
- Claim voucher revenue.
- Open and resolve a test dispute.
- Confirm reputation score changes (and that the recalibrated scale matches expectations).
- Confirm raw skill download still works for both freshly purchased v0.2.0 entitlements and any preserved legacy entitlements.
- Confirm `/api/skills` and trust pages can dual-read v0.1.0 legacy data and v0.2.0 primary data during the cutover.
- Hard-cut write actions to v0.2.0 only after direct purchase indexing, entitlement repair, and smoke tests pass.

Acceptance criteria:

- All core flows pass on devnet.
- Program ID, IDL, generated client, web env, and docs agree.
- No `v0.1.0` SOL write path is needed for the primary product flow.
- Feature flag, dual-read fallback, and hard-cut criteria are documented before app traffic moves to v0.2.0.

Verification:

```bash
NO_DNA=1 anchor build
NO_DNA=1 anchor test
npm run build --workspace @agentvouch/web
solana program show <v0.2.0-program-id> -u devnet
```

### Milestone 12: Production Hardening And Mainnet Readiness Prep

Goal: make the USDC-native `v0.2.0` production path stable and auditable before any larger settlement redesign or mainnet launch work.

Scope decision:

- Treat direct on-chain `purchase_skill` plus verified download entitlements as the canonical paid-skill path for this milestone.
- Remove or hard-gate stale `v0.1.0` SOL write assumptions from the web, API, CLI, scripts, tests, and docs.
- Standardize the public listing contract so repo-backed and chain-only skills expose USDC price, payment flow, listing address, source, entitlement mode, and legacy status consistently.
- Keep the escrow/refund redesign as a planned protocol track, not as an incidental hardening task. This milestone should specify it clearly enough that the next protocol milestone can implement it without changing the immediate production cutover.

Tasks:

- Audit and remove stale primary-flow SOL paths:
  - `price_lamports`, `priceLamports`, `LAMPORTS_PER_SOL`, and `formatSol` should survive only in rent/fee helpers, historical metadata, explicit legacy notices, or devnet funding utilities.
  - Any legacy SOL fallback for paid downloads must be disabled by default or clearly scoped to preserved historical entitlements.
- Normalize listing and access API responses:
  - `GET /api/skills`
  - `GET /api/skills/{id}`
  - `GET /api/index/skills`
  - `GET /api/skills/{id}/install`
  - `GET /api/skills/{id}/raw`
  - `GET /api/x402/supported`
- Make the marketplace and author/detail pages consume the normalized USDC listing contract instead of inferring paid/free state from legacy SOL fields.
- Update stale tests that still assert legacy SOL source strings, then add focused coverage for repo-backed paid USDC skills, chain-only USDC skills, free skills with author-bond requirements, and disabled legacy fallback behavior.
- Retire or rewrite operator scripts that still initialize or publish against the old lamport-denominated program path.
- Add a production hardening runbook covering:
  - Vercel production and preview env alignment
  - Neon branch/database mapping and rollback
  - Solana RPC/devnet variables
  - config authority, upgrade authority, settlement authority, and treasury authority
  - smoke checks for purchase, entitlement, raw download, vouch, author bond, dispute open/resolve, and voucher claim
- Add a mainnet-readiness policy draft for:
  - authority rotation or multisig
  - treasury withdrawal approval and accounting
  - monitoring for vault balances, events, indexing lag, failed x402 settlement, and unexpected treasury movement
  - incident response for bad config, stuck funds, failed indexer, compromised authority, and erroneous dispute resolution
- Prepare the Milestone 13 escrow/refund handoff by inventorying:
  - version-pinned `Purchase` records or companion purchase-version accounts
  - program-controlled author proceeds escrow instead of direct author wallet payout
  - explicit author withdraw instruction
  - separate voucher reward vault/accounting
  - paid-skill dispute state tied to a listing/version purchase cohort
  - refund pool and per-purchase claim tracking PDAs
  - upheld-dispute payout waterfall across reporter reward, purchaser refunds, and protocol reserve
  - x402/raw download compatibility during migration

Acceptance criteria:

- New USDC-native marketplace writes and paid downloads do not require a `v0.1.0` SOL write path.
- API responses expose one coherent listing/access shape for repo-backed and chain-only skills.
- Stale SOL UI/source tests are either removed or replaced with USDC-native assertions.
- Operator docs and scripts no longer point maintainers at obsolete lamport config or old program IDs for active flows.
- The escrow/refund redesign is documented as a separate protocol milestone with account, instruction, migration, and test implications.
- Mainnet launch blockers are explicit, owner-operable, and not hidden inside general risk text.

Verification:

```bash
rg "0\.001 SOL|legacy SOL|ELmVnLSN|Use SOL Fallback|Buy & Unlock" README.md docs web packages scripts
rg "price_lamports|priceLamports|LAMPORTS_PER_SOL|formatSol" web packages scripts docs
npm test --workspace @agentvouch/web
npm test --workspace @agentvouch/cli
npm run build --workspace @agentvouch/web
NO_DNA=1 anchor test
npm run smoke:flow-surface
# After explicit approval for live devnet writes:
npm run smoke:devnet-usdc -- --apply
```

### Milestone 13: Escrowed Proceeds And Purchaser Refund Redesign

Goal: replace direct author wallet payouts with program-controlled paid-skill settlement, then add claim-based purchaser restitution for upheld paid-skill disputes.

Scope decision:

- Treat this as a protocol milestone with account, instruction, IDL/client, web, x402, docs, and smoke-test impact.
- Keep the existing `Purchase`-based entitlement path working during migration.
- Scope purchaser refunds to the disputed paid skill/version purchase cohort, not to every skill by the same author.
- Use claim-based purchaser refunds. Do not push refunds to every purchaser inside dispute resolution.

Tasks:

- Specify version-pinned purchase identity:
  - capture immutable skill version/content identity at purchase time
  - decide whether to extend `Purchase` or add companion purchase-version accounts
  - preserve replay-safe entitlement checks for raw downloads
- Design escrow and accounting accounts:
  - author proceeds escrow PDA per listing or listing/version
  - voucher reward vault/accounting separate from author proceeds
  - purchaser refund pool PDA
  - per-purchase refund claim tracking PDA
  - reserve/sweep destination for expired unclaimed refunds
- Refactor purchase settlement:
  - send the author share into proceeds escrow instead of directly to the author wallet
  - keep the voucher share claimable by voucher stake weight
  - add an explicit author withdraw instruction
  - make buyer-visible USDC price and settlement split auditable in events
- Add paid-skill dispute/refund settlement:
  - link disputes to a listing/version purchase cohort
  - define upheld-dispute payout waterfall across challenger bond return, reporter reward, purchaser refund pool, and protocol reserve
  - cap purchaser refund claims at the purchase price paid
  - prevent duplicate refund claims and define claim-window expiry
- Update web and x402 flows:
  - keep `X-AgentVouch-Auth` raw downloads compatible with successful purchases
  - surface author proceeds escrow and withdraw status where authors manage listings
  - surface refund eligibility and claim status for buyers
  - document how x402 settlement maps into escrowed purchase records
- Regenerate and sync protocol artifacts after Anchor changes:
  - `target/idl/agentvouch.json`
  - `target/types/agentvouch.ts`
  - `web/agentvouch.json`
  - generated web client artifacts

Acceptance criteria:

- Paid purchases no longer depend on direct author wallet payout success.
- Author proceeds, voucher rewards, protocol treasury, and purchaser refund pools are separate and inspectable.
- Upheld paid-skill disputes create a bounded purchaser refund path without looping over buyers during resolution.
- Existing v0.2 purchase entitlements remain readable or have an explicit migration/legacy rule.
- Web and docs explain author withdrawal, refund eligibility, claim windows, and non-refundable legacy purchases.

Verification:

```bash
NO_DNA=1 anchor build
NO_DNA=1 anchor test
npm run generate:client
npm test --workspace @agentvouch/web
npm run build --workspace @agentvouch/web
npm run smoke:devnet-usdc
# After explicit approval for live devnet writes against the upgraded program:
npm run smoke:devnet-usdc -- --apply
```

### Milestone 14: Devnet Cutover Cleanup

Status: complete on 2026-05-11. Live evidence (deploy tx, config authority, canonical smoke fixture, stale-fixture hazards) lives in [`docs/DEVNET_STATE.md`](DEVNET_STATE.md); update that file rather than this milestone block when devnet state changes.

Goal: clean up the M13 devnet cutover so the repo, deployed program, generated artifacts, smoke fixtures, and operational docs all describe one current state.

Scope decision:

- Treat this as a post-upgrade hygiene milestone, not a new protocol design milestone.
- Preserve useful migration guardrails in scripts, but remove or archive stale pre-M13 assumptions that can make smoke tests reuse invalid devnet fixtures.
- Record enough deployment evidence that future operators can distinguish a code bug from stale devnet program/config state.

Tasks:

- Confirm deployed devnet state:
  - program binary hash matches the rebuilt `target/deploy/agentvouch.so`
  - devnet IDL contains the M13 instruction set
  - config account has been migrated to the M13 layout
  - `web/agentvouch.json` and generated client artifacts match the active local IDL
- Archive or reset stale smoke fixtures:
  - retire pre-M13 persisted skill IDs that lack `ListingSettlement`
  - keep the default smoke fixture pointed at a clean M13 listing
  - document when a fresh `--skill-id` should be used instead of reusing state
- Keep cutover scripts operator-safe:
  - `scripts/migrate-config.ts` should compile and fail clearly when the signer is not the config authority
  - `scripts/devnet-usdc-smoke.mjs` should detect pre-M13 config layout before decoding
  - existing-listing smoke paths should initialize missing M13 settlement accounts or explain why a fresh fixture is required
- Update runbooks and migration notes with:
  - devnet deploy transaction
  - config migration transaction
  - smoke skill ID and purchase transaction
  - current config authority and upgrade authority
  - known stale fixture hazards and recovery steps
- Review temporary code/docs added during cutover and remove anything that is only useful for a one-off local debugging session.

Acceptance criteria:

- A fresh checkout can run the documented build/client generation flow and see the same M13 instruction set in local artifacts.
- `npm run smoke:devnet-usdc -- --apply` passes against the default smoke state or fails with an actionable stale-fixture message.
- Operators can verify devnet program, IDL, config layout, and smoke fixture state without reverse-engineering previous chat logs.
- Docs no longer describe M13 escrow/refund as merely future work for the active devnet `v0.2.0` deployment.

Verification:

```bash
anchor idl fetch AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ --provider.cluster devnet
solana program dump AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ /tmp/agentvouch-devnet.so --url https://api.devnet.solana.com
shasum -a 256 target/deploy/agentvouch.so /tmp/agentvouch-devnet.so
npm run migrate:config
npm run generate:client
npm run build --workspace @agentvouch/web
# After explicit approval for live devnet writes:
npm run smoke:devnet-usdc -- --apply
```

### Milestone 15: SEO And LLM-Facing Docs

Goal: make the public web surface, agent-facing docs, and LLM-ingested documentation reflect the stabilized USDC-native protocol before updating pitch materials.

Scope decision:

- Treat `web/public/skill.md`, public docs pages, metadata, sitemaps, OpenGraph/Twitter text, and `.well-known` agent discovery files as production surfaces.
- Keep claims aligned to shipped behavior. Do not imply mainnet readiness, governance, or refund behavior beyond the deployed M13 semantics.
- Optimize for direct, factual phrasing around on-chain trust, USDC-backed vouches, author bonds, disputes, marketplace payments, and agent install flows.

Tasks:

- Audit and update SEO metadata across the web app:
  - homepage title/description
  - `/skills`
  - `/skills/[id]`
  - `/author/[pubkey]`
  - `/docs` and dedicated docs pages
  - OpenGraph and Twitter image/copy routes
  - sitemap and robots output
- Refresh LLM-facing and agent-facing docs:
  - `web/public/skill.md`
  - `web/public/.well-known/agentvouch.json` (canonical agent-discovery file; aliases such as `agent-card.json` / `agent-skills/index.json` / `api-catalog` were considered and deferred — adopting A2A-style filenames is future work, not a v0.2.0 requirement)
  - `web/public/llms.txt` and `web/public/llms-full.txt`
  - API examples for `/api/skills`, `/api/index/skills`, `/api/agents/{pubkey}/trust`, and paid raw download flows
- Update on-domain docs and measurement:
  - `web/app/docs/page.tsx`
  - `docs/SEO_MEASUREMENT.md`
  - any docs pages that still emphasize old SOL or pre-USDC x402 assumptions
- Add or update focused tests for SEO and LLM-facing output:
  - metadata strings do not reference the old program ID or stale SOL pricing
  - public agent files reference the canonical `agentvouch.xyz` install path
  - skill and author discovery JSON expose USDC-native fields and CAIP-2 chain context
- Verify generated/static public docs match the active program, current API contract, and CLI install/publish flows.

Acceptance criteria:

- Search snippets and metadata lead with AgentVouch as an on-chain trust and reputation layer for agents.
- LLM-ingested docs clearly describe USDC-native `v0.2.0`, canonical skill routes, paid download authorization, and current limitations.
- Public discovery files expose consistent program ID, chain context, payment flow, and USDC price fields.
- No SEO or LLM-facing page implies mainnet, governance behavior, or refund guarantees beyond the shipped M13 semantics.
- Deck updates remain deferred to Milestone 16.

Verification:

```bash
rg "ELmVnLSN|0\.001 SOL|legacy SOL|price_lamports|Buy & Unlock|Use SOL Fallback" web/public web/app docs/SEO_MEASUREMENT.md
npm test --workspace @agentvouch/web
npm run build --workspace @agentvouch/web
npm run smoke:flow-surface
```

### Milestone 16: Pitch Deck And Public Narrative Alignment

Goal: co-version the public deck and narrative materials with the stabilized USDC-native protocol, Milestone 13 settlement changes, and Milestone 15 SEO/LLM-facing docs.

Tasks:

- Update `pitch/AgentVouch_walkthrough.pptx` and `pitch/AgentVouch_walkthrough.paper.pptx`.
- Refresh account and instruction counts from `programs/agentvouch/`.
- Update diagrams for USDC vaults, escrowed proceeds, purchaser refund pools, voucher rewards, and dispute settlement.
- Keep claims aligned with shipped protocol behavior, marking any future work as `WIP`.
- Regenerate the paper deck from the canonical deck/theme tooling.

Acceptance criteria:

- The canonical deck matches the live program, IDL, docs, CLI, and web flows.
- Public claims do not imply mainnet, escrow, refunds, or governance behavior that has not shipped.
- Architecture slides reflect the current account and instruction model.

Verification:

```bash
rg "SOL|lamports|0\.001 SOL|ELmVnLSN|pitch deck.*Milestone 15|Milestone 15.*pitch deck" pitch README.md docs/ARCHITECTURE.md docs/VISION.md docs/SEO_MEASUREMENT.md
```

## Security Checklist

Every USDC-moving instruction must validate:

- expected USDC mint
- token account mint
- token account owner
- PDA vault address
- PDA authority seeds
- token program ID
- signer authority
- amount is greater than zero
- arithmetic overflow and underflow
- dispute and withdrawal locks
- x402 settlement authority, memo binding, payment-ref uniqueness, and settlement vault balance before any bridge settlement
- post-transfer vault/account state when instruction logic depends on token deltas
- no PII or free-form buyer content in emitted events or on-chain x402 memos

Every client transaction flow must surface:

- cluster
- token mint
- amount
- source account
- destination account or vault
- fee payer
- expected post-action state

Spam and abuse checks:

- Minimum stake, dispute bond, and listing author-bond floors should be high enough to make vouch spam, listing spam, and frivolous disputes uneconomic.
- Any rate limit in the web/API layer is a supplement only. The on-chain protocol must rely on economic costs and account constraints, not hidden centralized throttles.
- Compute and account-count ceilings should be measured for worst-case dispute and voucher-claim flows before devnet cutover.

## Branch And Worktree Convention

- Land the rewrite on a dedicated branch (`feat/usdc-native-v0.2.0`) or git worktree, not directly on `main`.
- Keep `main` deploy-safe for the existing `v0.1.0` devnet program until Milestone 11 passes.
- Squash-merge or rebase-merge into `main` only after devnet smoke tests are green and docs/CLI/skill.md are aligned.

## Open Questions And Risk Register

Track decisions that remain outside the locked Pre-Milestone 3 core rewrite gates:

- Exact x402 bridge POC outcome and whether x402 can be primary for protocol-listed paid skills in v0.2.0.
- Whether the x402 settlement vault can safely use a PDA owner with the current facilitator implementation.
- Whether `settle.payer` from the x402 facilitator is reliable enough to derive the on-chain `Purchase` PDA buyer.
- Retry and refund policy when x402 settles but `settle_x402_purchase` fails.
- Mainnet values for author proceeds lock, refund claim window, challenger reward bps, and challenger reward cap.
- Exact ERC-8004 / Solana Agent Registry binding shape: which fields the protocol stores on-chain (`agent_registry`, `agent_id`, `agent_uri`, or opaque `registry_ref`) and which it derives off-chain at the indexer layer.

## v1.0.0 Mainnet Readiness

The `v0.2.0` devnet migration is not mainnet-ready until these are complete:

- External or senior internal security review of all USDC-moving instructions, authority controls, and dispute/slashing paths.
- Mainnet upgrade authority controlled by multisig or stronger governance; no single hot wallet controls upgrades or config.
- Mainnet config runbook for native USDC mint, token program, treasury vault, settlement authority, economic floors, and slash percentage.
- Treasury policy documented, including withdrawal authority, approval threshold, accounting, and public reporting expectations.
- Incident response runbook for stuck settlement vault funds, bad config, compromised authority, failed indexer, and erroneous dispute resolution.
- Monitoring for program events, vault balances, indexing lag, x402 settlement failures, authority rotations, and unexpected treasury movement.
- Mainnet launch checklist that confirms `web/public/skill.md`, docs, CLI, generated client, IDL, pitch deck, and Vercel env all reference the same program/config.
- Decision on unclaimed refund reserve and sweep governance before mainnet.
- Decision on whether upgrade authority remains active, is time-locked, or is eventually frozen after sufficient production hardening.

## Non-Goals

The USDC-native `v0.2.0` program should not:

- support arbitrary collateral assets in the core program
- add a price-feed oracle
- preserve `v0.1.0` account layouts
- preserve `v0.1.0` purchase PDAs
- keep SOL-denominated reputation inputs
- support bridged USDC variants as protocol collateral

## Definition Of Done

The migration is complete when:

- `v0.2.0` is deployed to devnet with a fresh program ID.
- Every protocol money field is USDC-denominated; `rg "lamports|price_lamports|author_bond_lamports|stake_amount" programs/agentvouch/src` returns no business-logic hits (rent helpers excluded).
- `rg "LAMPORTS_PER_SOL|formatSol|priceLamports|authorBondLamports" web/app web/components web/hooks` returns no hits outside legacy notices.
- After `anchor build`, `web/agentvouch.json` and generated client artifacts are synced to the live `v0.2.0` IDL.
- Every USDC-moving instruction has at least one positive and one negative test (wrong mint, wrong token program, missing ATA, wrong owner).
- Vouching, author bonds, purchases, voucher rewards, disputes, and reputation all use USDC accounting.
- Web primary flows no longer require `v0.1.0` SOL instructions.
- Protocol-listed paid purchases preserve the `60%` author / `40%` voucher split only when active external voucher stake exists. If there are no active vouchers, the full payment goes to author proceeds. If the x402 bridge POC passes, x402 purchases do this through `settle_x402_purchase`; if it fails, x402 is disabled for protocol-listed paid skills until a later bridge or custom scheme ships.
- x402 paid downloads remain disabled for new paid marketplace purchases unless the bridge ships; historical x402 entitlements still re-download through signed auth.
- Direct on-chain purchases are indexed into download entitlements through verified API submission plus reconciliation.
- Active-dispute freeze invariants, vault close/refund rules, reward-index math, and listing-removal behavior are covered by tests.
- Governance, treasury, authority rotation, pause, and mainnet readiness policies are documented even if `v0.2.0` remains devnet-only.
- `web/public/skill.md`, `docs/ARCHITECTURE.md`, and `AGENTS.md` describe the live USDC-native protocol; SEO and LLM-facing docs are handled in Milestone 15, and pitch deck alignment is handled in Milestone 16.
- `NO_DNA=1 anchor build`, program tests, and `npm run build --workspace @agentvouch/web` pass.
