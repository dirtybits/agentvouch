# AgentVouch Mainnet Readiness

`v0.2.0` is a USDC-native devnet release. It is not mainnet-ready until the items below are complete and reviewed.

## Current Assessment

AgentVouch is close to a mainnet release candidate, but should not be treated as mainnet-ready yet.

The core product shape is in place: the USDC-native protocol, marketplace publishing and purchase flows, author trust surfaces, voucher backing, dashboard revenue visibility, and agent-facing install path now fit together. The remaining work is mainly release hardening, not product discovery.

> **Update (2026-05-30): a direct code audit revised this assessment.** See [Code Audit Findings](#code-audit-findings-2026-05-30) below. At that point, the remaining work was **not** only release hardening: **voucher slashing — the core economic mechanism of a stake-backed reputation system — was missing**, and **dispute adjudication was a single key**. The slashing mechanism is now live on devnet per the 2026-06-10 update; the centralized trust root remains a launch blocker.

> **Update (2026-06-09): readiness re-read.** Active program references now converge on `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg` in `declare_id!`, `Anchor.toml`, `web/agentvouch.json`, generated clients, protocol package constants, `web/public/skill.md`, `docs/DEVNET_STATE.md`, operator runbooks, and local agent reference docs. The remaining non-readiness source occurrence of `AgnTDF...` is intentionally retained as `TRACK_B_PREVIOUS_DEVNET_PROGRAM_ID` in `web/scripts/db-cutover.ts` for historical cleanup. The `revoke_vouch` open-dispute lock is now present in source; voucher slashing itself, dispute governance, emergency pause, and refund reserve policy remain launch blockers.

> **Update (2026-06-10): A1 devnet upgrade complete.** Program `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg` was upgraded in slot `468574856` with deploy tx `2FYWJ3QfJLLTKr157tmkRFcQJs4fpRATiZWEs3MAQMZVwvbW8tcqUeGjGWVugKHasuu8qVJfEkBbRSGyyuU7Shrg`; the deployed binary matched local SHA-256 `641b9cd8536c8f9f7fabdc955553208fd76920ad045fa97517d38977560991b1`, and the on-chain IDL at `BK3kFBTsNRVVhWae4ucHKV2huiioEWD1RRWAKrM68RT4` semantically matched `target/idl/agentvouch.json` / `web/agentvouch.json`. Voucher slashing is now live on devnet and verified by `NO_DNA=1 anchor test` (31 passing), the direct devnet USDC smoke, x402 bridge POC, public flow-surface smoke, web tests/build, CLI tests/build, and lint/diff checks. Mainnet remains blocked by dispute governance, pause/emergency controls, authority policy/security review, and refund-reserve policy.

> **Update (2026-06-11): live dispute smoke complete.** `AGENTVOUCH_SMOKE_AUTHORITY_KEYPAIR=~/dev-keypair.json npm run smoke:devnet-usdc -- --apply --state-dir .agent-keys/a1-devnet-dispute-smoke --skill-id a1smoke-20260611` passed against devnet. The run linked a paid-listing vouch, purchased, opened a dispute, resolved it upheld with the config authority, cranked `slash_dispute_vouches`, created a `1_000_000` micro-USDC refund pool, and claimed the buyer refund. Result: `500_000` micro-USDC author bond slash, `500_000` micro-USDC voucher slash, vouch status `slashed`, active listing reward positions `0`, refund pool fully claimed, and the listing settlement dispute lock cleared.

> **Update (2026-06-19): A3 emergency pause merged, deployed, and smoke-tested on devnet.** Program `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg` was upgraded in slot `470607512` with deploy tx `5WDUWu15dU2L1FCFXd6MQeqG5SmppEjq8DMwFBdjhZCUSQ1AtD7haggRreXVeFYfZBbLSV6bMQ1GeJKmGp6gizHj`; local deploy artifact SHA-256 was `4def6997c51fb4ac2adf5963960845481913dfd28748990a7bb0be42cd63934d`. The on-chain IDL was upgraded at `BK3kFBTsNRVVhWae4ucHKV2huiioEWD1RRWAKrM68RT4` and fetched IDL contains `set_paused` / `PauseStateChanged`. The live pause smoke set `paused = true`, proved `create_skill_listing` fails with `Protocol is paused`, proved `claim_voucher_revenue` still works while paused, set `paused = false`, and proved a listing can be created after unpause. Mainnet remains blocked by dispute governance, authority custody/security review, and refund-reserve policy.

> **Update (2026-06-19): Kora planning added.** Kora/USDC fee abstraction is the preferred next path for removing user-held SOL from AgentVouch flows. It is not yet a shipped readiness claim. If enabled before mainnet, it becomes part of the release candidate scope: Kora signer custody, validation policy, rate limits, fee pricing, monitoring, rollback, and devnet smoke tests must be reviewed alongside the existing wallet-paid path. Plan: `.agents/plans/kora-usdc-fee-abstraction.plan.md`.

> **Update (2026-06-22): Base POC Phase 4.5 gate complete.** PR #44 implemented an isolated Base/EVM Foundry POC for Phases 0-4 under `contracts/base-poc` and recorded the interim decision memo in `docs/BASE_POC_INTERIM.md` with 65/65 tests. Finding: Base can preserve the purchase/accounting model and support gas-free-for-user USDC purchases, but it does not remove the need for relayer/paymaster/facilitator infrastructure and is not a clear RC shortcut over Solana + Kora. Lane B (`purchaseWithAuthorization`) is trust-minimized but has a production fund-stranding edge if an EIP-3009 authorization is submitted directly to USDC without recording a receipt; Lane C (`settleX402Purchase`) is bridge-equivalent and trusts a settlement authority. Base should remain decision evidence unless AgentVouch explicitly funds the x402/Coinbase distribution bet; it is not a mainnet-readiness blocker for the Solana RC.

> **Update (2026-06-24): x402 bridge RC follow-up added.** If the protocol-listed x402 bridge is part of the release-candidate path, enable it on devnet and run an end-to-end UI/API smoke before launch readiness: buyer auth message, x402 requirement, facilitator verify/settle, settlement vault credit, backend `settle_x402_purchase`, purchase PDA creation, entitlement recording, and raw download. The production runbook must include bridge env, settlement authority custody, facilitator config, monitoring, rollback, and reconciliation steps before the bridge is considered RC-ready.

The next milestone should be framed as **Mainnet Release Candidate**, not final mainnet launch. The release candidate is ready only when the protocol, wallet UX, production config, docs, and operating runbooks can survive repeated end-to-end devnet smoke tests without manual interpretation.

> **Update (2026-06-17): A2 plan review found additional design-lock blockers.** The A2 branch should not move into Anchor implementation until the plan explicitly locks: A2 as a devnet clean break, cancellable pending resolutions, buyer-first paid refunds, program-computed refund pools, zero-refund paid dispute behavior, serialized author-bond exposure, residual/expired fund ownership, reserve-aware treasury sweep rules, and dispute-economic snapshots. See [A2 Extra Review Findings](#a2-extra-review-findings-2026-06-17).

## Code Audit Findings (2026-05-30)

A direct review of `programs/agentvouch/src` and the test suites downgraded the assessment above. The escrow/accounting plumbing was solid (pinned PDA derivations re-checked in handlers, `transfer_checked` throughout, checked arithmetic, x402 replay guards via payment-ref + tx-sig PDAs, dispute locks that freeze paid-listing purchases/withdrawals). But the audit found one missing load-bearing mechanism and one centralized design choice, so part of the core product and trust model — not just release hardening — was still missing.

### P0 — blocking (product + trust correctness)

1. **Voucher slashing was missing in the 2026-05-30 audit; fixed on devnet 2026-06-10.** At audit time, the `AuthorBondThenVouchers` liability scope was recorded, but no instruction slashed voucher stake: `resolve_author_dispute.rs` only called `slash_author_bond_if_present`; `author_dispute.voucher_slashed_usdc_micros` was set to `0` at open and never recomputed; `VouchStatus::Slashed` (`state/vouch.rs`) was never assigned; `AuthorDisputeVouchLink` (`state/author_dispute_vouch_link.rs`) was defined but never created. Net at the time: **vouching was reward-only with zero downside** — the stake-backed-reputation thesis was not enforced on-chain. *Fix:* implement voucher slashing (debit voucher vaults, set `VouchStatus::Slashed`) and keep the active-dispute lock on `revoke_vouch`.

   > **Status (2026-06-10): deployed and smoke-tested on devnet.** Voucher slashing is live in the devnet program: upheld paid disputes park in `SlashingVouchers` and a permissionless `slash_dispute_vouches` instruction settles linked positions in pages of ≤ 4 (5 remaining accounts per position; a 4-position page measured 31 accounts, inside the tx limit). Slashed funds are ring-fenced in `ListingSettlement.slashed_deposit_usdc_micros` and exit only through `create_refund_pool`. The same program ID was upgraded in slot `468574856`; the deployed binary matched local SHA-256 `641b9cd8536c8f9f7fabdc955553208fd76920ad045fa97517d38977560991b1`, and the on-chain IDL matched local/web IDLs. Full Anchor suite green (31 tests incl. slashing tests for multi-page crank, dodge/rotation blocks, double-crank, stale-position skip-settle, residual reclaim, ring-fence, slashed-only pool, reward-vault solvency, remove/close locks, and refund-pool paths). Remaining before mainnet: external review/soak and operational governance around resolver, refund, authority custody, and pause controls.
   >
   > **Design locked (2026-06-09, supersedes the earlier sketch):** full plan in `.agents/plans/a1-voucher-slashing.plan.md`. Decisions: (1) slash set = the disputed listing's `ListingVouchPosition`s, settled in **pages** (≤ `MAX_DISPUTE_POSITIONS_PER_TX` per tx) via a new permissionless `slash_dispute_vouches` instruction, with `resolve(Upheld)` parking the dispute in a new `SlashingVouchers` status and `open_author_disputes` decremented only on the final page — a single atomic resolve-time loop does not fit Solana tx account limits at 32 positions. (2) Slashed funds are **ring-fenced** in a new `ListingSettlement.slashed_deposit_usdc_micros`: refund-pool-only, excluded from author withdrawals and from the challenger-reward base (the earlier "deposit into withdrawable proceeds" sketch let the author reclaim voucher slash via a small refund pool, and inflated the collusion prize). (3) Partial slash at `slash_percentage`, but the vouch goes to `VouchStatus::Slashed` (dead position — stops backing and earning); the residual is reclaimable through `revoke_vouch` once the author has no open disputes. (4) `link_vouch_to_listing` **and** `unlink_vouch_from_listing` are blocked while the listing is dispute-locked — without the unlink lock, vouchers can exit the slash set mid-dispute (the revoke lock alone only freezes the money, not membership). The `AuthorDisputeVouchLink` PDA init per `(dispute, vouch)` is the double-slash guard.
   >
   > **Review amendments (2026-06-09, plan review against source):** the freeze is enforced via a new `SkillListing.locked_by_dispute` mirror — checking the *current settlement's* lock alone is bypassable, because `update_skill_listing` can bump the revision mid-dispute and `initialize_listing_settlement` then mints a fresh **unlocked** settlement (this rotation also let authors keep selling mid-dispute, escaping the refund lock; the same guard closes both). Revision bumps and new-settlement init are blocked while the listing is dispute-locked. Additionally: `accrue_author_rewards` gets a non-live status guard so Slashed vouches stop accruing author-wide rewards on residual stake (otherwise the reward vault goes insolvent — the index denominator drops the full pre-slash stake while per-vouch accrual would continue on the residual). Full details: R1–R5 in the plan file.

2. **Dispute adjudication is a single key.** `resolve_author_dispute` and `create_refund_pool` are gated only on `config.config_authority` (`require_keys_eq!(config.config_authority, authority.key())`). One ordinary pubkey unilaterally decides Upheld/Dismissed and sizes refunds — no multisig, timelock, quorum, or appeal; on-chain evidence is a URI string. Slashed author bond is paid **100% to the challenger** (`resolve_author_dispute.rs`), not to harmed buyers, so a compromised or colluding resolver + challenger can drain any author's bond. *Fix:* multisig + timelock on the resolver authority at minimum; route slashed funds to harmed buyers (or explicitly justify otherwise); longer term, the optimistic-oracle / LLM-jury adjudication design.

3. **No pause / emergency stop in the 2026-05-30 audit; fixed on devnet 2026-06-19.** At audit time, `config.paused` was written only at init (`= false`); no instruction set it true, so every `require!(!paused)` guard was dead code and `pause_authority` was never read. A3 adds `set_paused(paused: bool)` gated by `config.pause_authority`, emits `PauseStateChanged`, and keeps buyer/voucher claim flows open while paused. It was merged, deployed, IDL-upgraded, and live-smoked on devnet on 2026-06-19. Remaining before mainnet: put pause authority under approved custody, record the production signer policy, and repeat the smoke on the mainnet release-candidate deployment.

4. **No refund reserve; refunds frequently unfundable.** Refund pools are funded from the author's own undisbursed proceeds for one revision, first-come-first-served until empty. Free-listing disputes produce no pool at all, and proceeds withdrawn before a dispute opened leave nothing. The slashed bond does not backstop buyers (it goes to the challenger).

### P1 — required before launch

5. **No config setters / authority rotation instructions.** Economic params (`slash_percentage`, bond floors, reward shares/caps) and authorities change only via redeploy or the M13 migration. `treasury_authority` has no withdrawal path — dismissed-dispute bonds accrue in the treasury vault with no in-program sweep.
6. **External security review** of every USDC-moving instruction (per [Security Review](#security-review)) — not yet done; this is a Go gate.
7. **Test gaps:** Anchor now covers voucher slashing, listing lock/remove/close paths, stale-position skip-settle, and refund-pool accounting, and a live devnet authority-keyed upheld-dispute → slash → refund smoke passed on 2026-06-11. Remaining gaps: repeated soak from clean state and deeper API ↔ on-chain integration (the web/API layer is still mostly mocked; purchase entitlement checks are stronger, but refund/dispute bookkeeping needs live-path coverage).

Primary files for hardening: `instructions/resolve_author_dispute.rs`, `instructions/create_refund_pool.rs`, `instructions/revoke_vouch.rs`, `state/config.rs`.

## A2 Extra Review Findings (2026-06-17)

The draft A2 plan fixes the broad P0.2 direction - split resolver/config authority, add a timelocked propose/execute path, and route slashed value toward harmed buyers. Focused pre-implementation reviews found the following design-lock items that must be documented and tested before coding the A2 on-chain changes.

1. **Use an A2 devnet clean break, not stacked same-program migrations.** A2 changes `ReputationConfig`, `AuthorDispute`, and `ListingSettlement` account layouts. The existing M13 migration gates on a moving `ReputationConfig::LEN`, so extending it without a separate migration design can misclassify already-M13 config accounts. For A2 devnet implementation and smoke, prefer a fresh program ID plus DB cleanup over broad realloc/backfill.

2. **Paid disputes must be buyer-first before challenger reward.** A2 should not reserve challenger reward before funding the buyer refund pool. In underfunded paid disputes, all available eligible capacity should go to buyer refund first and challenger reward should be zero. Challenger reward can be computed only after buyer exposure is satisfied, capped by snapshotted bps/cap, and funded only from remaining eligible author proceeds, not slash buckets.

3. **Paid upheld disputes without an attached verified purchase need a zero-refund path.** Current disputes can be opened without a `purchase`; if A2 sets refund exposure to zero but relies on `create_refund_pool` to clear locks, paid no-purchase disputes can strand listing/settlement locks. A2 v1 should treat paid no-purchase upheld disputes as reputation-only: no voucher slashing, no refund pool, no challenger reward, and locks clear at resolution. Broader affected-buyer settlement belongs in A4 or an indexer-backed scope.

4. **Residual paid slash funds and expired refund-pool funds need an owner.** Slash buckets are refund-pool-only and capped by buyer exposure. Any residual slash above buyer exposure, plus unclaimed refund-pool balances after the claim window, must route to protocol treasury/reserve with eventing. They must not remain stranded and must never become author-withdrawable by default.

5. **Dispute economics must be snapshotted at proposal.** Config setters can mutate slash percentage and challenger reward bps/cap while a dispute is proposed or while voucher slash pages are still running. A2 should snapshot settlement economics on `propose_author_dispute_resolution`; execute, `slash_dispute_vouches`, and refund creation should use those snapshots while recomputing from live token bucket balances.

6. **Timelock needs an on-chain remedy, not only observation time.** A delay is useful only if a multisig/guardian can stop a bad pending proposal before execution. A2 should include `cancel_author_dispute_resolution`, gated by `config_authority`, which returns a pending dispute to `Open` without moving funds or clearing locks.

7. **Financial and reputation-only paid dispute branches must be mutually exclusive.** A paid dispute should enter financial settlement only when it has both `AuthorBondThenVouchers` liability scope and an attached verified purchase. Paid no-purchase disputes must remain reputation-only even when the listing has active vouches; otherwise A1 `SlashingVouchers` parking and the zero-refund path conflict.

8. **Refund pool size must be program-computed.** Permissionless refund-pool creation is useful for liveness, but a caller must not be able to create an undersized pool and clear locks. The program should compute `min(buyer exposure, available capacity)` from on-chain state and snapshots; caller input cannot lower the buyer-first amount.

9. **Author-bond exposure should be serialized in A2 v1.** The author bond is one profile-level collateral pot. Until the protocol has aggregate exposure accounting or per-dispute reserves, A2 should reject new author-bond-exposing disputes while `author_profile.open_author_disputes > 0`.

10. **Expired refunds need an owned close path.** `claim_purchase_refund` fails after the claim window, so any unclaimed refund vault balance needs a `close_refund_pool`-style instruction that routes the balance to reserve/treasury accounting with eventing.

11. **Reserve and treasury sweep policy must prevent instant dispute extraction.** Residual dispute slash and expired refund funds should be treated as reserve accounting. `sweep_treasury` should positively bind the protocol treasury source, exclude or reserve dispute-derived funds until A4 policy allows sweeping, and production resolver/treasury/config authorities must be separate multisig/governance roles.

These findings are now reflected in `.agents/plans/a2-dispute-governance-v1.plan.md`. Mainnet remains no-go until the implemented program and tests prove these invariants.

## Re-Read Findings (2026-06-09)

- **Program identity:** active source and public/runtime artifacts point at `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg`: `programs/agentvouch/src/lib.rs`, `Anchor.toml`, `web/agentvouch.json`, `web/generated/agentvouch/`, `packages/agentvouch-protocol/src/index.{ts,js,d.ts}`, `scripts/devnet-usdc-smoke.mjs`, `docs/DEVNET_STATE.md`, `docs/DEPLOY.md`, `docs/PRODUCTION_RUNBOOK.md`, `web/public/skill.md`, `.cursor/skills/agentvouch/`, and public docs.
- **Historical ID:** `web/scripts/db-cutover.ts` retains `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ` only as `TRACK_B_PREVIOUS_DEVNET_PROGRAM_ID` for old-state cleanup. Do not treat it as active deployment config.
- **Purchase gate:** direct purchase verification is stronger than earlier notes imply. The API verifies the confirmed transaction, program id, chain context, listing PDA, derived `Purchase` PDA, buyer, listing revision, price, and USDC mint before recording an entitlement.
- **x402 bridge:** protocol-listed x402 remains fail-closed behind `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED`; `/api/x402/supported` does not advertise the bridge unless the flag is enabled. The bridge binds buyer/listing/skill/amount/nonce into a payment-ref hash and checks the backend settlement authority against on-chain config.
- **Verification run:** `npm run test --workspace @agentvouch/web`, `npm run test --workspace @agentvouch/cli`, `NO_DNA=1 anchor build`, `npm run build --workspace @agentvouch/web`, and `npm run build --workspace @agentvouch/cli` passed on 2026-06-09. On 2026-06-10, `NO_DNA=1 anchor test` passed with 31 tests after rerunning outside the sandboxed port-binding failure; no port-8899 process was killed. The same day also passed web tests (332), CLI tests (50), web/CLI builds, web lint, `git diff --check`, direct devnet USDC smoke, strict x402 bridge POC, and public flow-surface smoke. On 2026-06-11, the direct devnet USDC smoke was extended and passed the live authority-keyed dispute/slash/refund branch. On 2026-06-19, the A3 pause smoke passed against the deployed program: pause blocked a new listing, voucher revenue claim stayed open, unpause restored listing creation, and final state confirmed `paused = false`.

## Release Candidate Gates

- Protocol safety review covers purchase, vouch, voucher reward, author bond, dispute, refund, close, claim, and withdraw paths.
- Devnet soak has repeated the full happy path with fresh wallets: register, publish, vouch, purchase, claim voucher revenue, withdraw author proceeds, report, resolve, and refund.
- Emergency pause has been exercised on devnet: pause, prove at least one risk-creating flow fails, prove buyer refund or voucher claim still works, unpause, and prove normal operation resumes.
- Wallet UX is clear for locked wallets, simulation warnings, insufficient SOL, ATA creation, network mismatch, and rejected signatures.
- If Kora sponsorship is enabled: wallet UX clearly distinguishes sponsored and fallback paths, quotes any USDC fee, proves users can complete the targeted flow without SOL, and never implies unsupported flows are SOL-free.
- If Kora sponsorship is enabled for external demo or release-candidate use: Phantom warning noise from partial Kora signing is resolved or explicitly accepted in release notes. Preferred fix: have Kora attach the sponsor signature during prepare, send Phantom a sponsor-pre-signed transaction, skip duplicate Kora signing on submit, and refresh blockhashes when wallet signing itself expires.
- Kora scope must be explicit in release notes and UI copy. The 2026-06-24 spike covers `register_agent` and `purchase_skill` only; `create_skill_listing`, `initialize_listing_settlement`, `deposit_author_bond`, `vouch`, `link_vouch_to_listing`, `open_author_dispute`, and `claim_purchase_refund` still need separate `rent_payer: Signer` interfaces plus sponsored API routes before those paths can be called no-SOL/user-gas-free.
- If the x402 bridge is enabled: `/api/x402/supported` advertises the protocol-listed bridge only after a live devnet smoke proves settlement into the protocol vault, `settle_x402_purchase`, purchase PDA creation, entitlement recording, and paid raw download all work from a fresh buyer.
- Base/EVM POC work is not part of the Solana RC gate unless a separate Base launch plan is explicitly adopted. Do not block the Solana RC on Base UI smoke or Phases 5-7.
- Mainnet configuration is frozen: program ID, USDC mint, economic floors, config authority, treasury authority, resolver authority, Vercel env, and Neon branch.
- If Kora sponsorship is enabled: Kora endpoint, auth mode, fee token, signer backend, payer account, validation allowlists, spend caps, and emergency disable env are frozen and recorded in the production runbook.
- If the x402 bridge is enabled: facilitator endpoint, accepted network/mint, settlement vault, settlement authority, payment-ref/memo policy, idempotency/reconciliation procedure, monitoring, and emergency disable env are frozen and recorded in the production runbook.
- Public docs match shipped behavior: `web/public/skill.md`, `/docs`, CLI help, paid download instructions, and publish/update flows.
- Production operations are documented: monitoring, authority handling, rollback, incident response, and user support for paid access failures.

## Required Decisions

- Final mainnet values for `author_proceeds_lock_seconds`, `refund_claim_window_seconds`, `challenger_reward_bps`, and `challenger_reward_cap_usdc_micros`.
- Whether upgrade authority remains active, moves behind a timelock, or is frozen after hardening.
- Which multisig or governance mechanism controls upgrade, config, treasury, and settlement authorities.
- Which monitoring and incident channels are authoritative.

## Authority Policy

Mainnet must not depend on a single hot wallet for:

- program upgrades
- config changes
- treasury movement
- x402 settlement authority
- dispute resolver authority
- pause or emergency controls

Before mainnet:

1. Put critical authorities behind multisig or stronger governance.
2. Document signer set, threshold, rotation procedure, and emergency removal procedure.
3. Record authority pubkeys in the production runbook.
4. Test authority rotation on devnet.

## Treasury Policy

Document:

- treasury vault addresses
- withdrawal authority
- approval threshold
- accounting cadence
- public reporting expectations
- reserve and sweep rules for unclaimed refund funds

Treasury movement should be explainable from on-chain events and operator notes.

## Monitoring

Monitor at least:

- program upgrade authority changes
- config authority changes
- `ReputationConfig` changes
- protocol treasury vault balance
- x402 settlement vault balance
- listing reward vault balances
- purchase, vouch, author bond, dispute, and claim events
- indexing lag between Solana and API responses
- failed purchase verification or raw download authorization
- unexpected treasury or settlement movement
- if enabled, Kora payer SOL balance, Kora USDC fee receipts, Kora validation rejects, abnormal fee-payer outflow, sponsorship error rates, and fallback-rate spikes

## Incident Response

Have playbooks for:

- bad config
- stuck settlement vault funds
- compromised authority
- failed indexer or stale API data
- erroneous dispute resolution
- bad IDL/client deploy
- Neon branch mismatch
- Solana RPC outage or cluster mismatch
- Kora/paymaster outage, payer depletion, validation misconfiguration, or suspicious sponsored-transaction outflow

Each playbook should include:

- detection signal
- severity
- owner
- immediate stop action
- rollback path
- public/user communication threshold
- postmortem requirements

## Security Review

Before mainnet, complete an external or senior internal review of:

- every USDC-moving instruction
- token account owner and mint constraints
- PDA vault ownership and authority seeds
- arithmetic overflow and underflow behavior
- active-dispute freezes and slashing paths
- voucher reward math
- x402 settlement memo binding and payment-ref uniqueness
- x402/Base POC lesson applied to any production x402 path: signed-payment flows need a recovery/reconciliation answer for funds delivered without a receipt, and settlement-attestation flows need bounded signer custody, idempotency, monitoring, and rollback.
- Kora sponsored transaction shape validation, payer outflow controls, fee quote integrity, signer custody, and fallback behavior if the feature is enabled
- authority rotation and rollback paths

Review at least these user-facing protocol flows end to end:

- buyer pays for a listed skill and receives raw access
- author withdraws escrowed proceeds
- voucher claims author-wide reward revenue
- free-skill report uses author bond exposure
- paid-skill report uses author bond first, then linked vouchers where applicable
- upheld report creates a purchaser refund pool
- purchaser claims a refund during the claim window
- stale or closed listing behavior does not strand funds without a documented path

## Launch Checklist

- `NO_DNA=1 anchor build` passes.
- Full Anchor test suite passes.
- Web and CLI tests pass.
- `npm run build --workspace @agentvouch/web` passes.
- IDL and generated clients are synced.
- `web/public/skill.md`, docs, CLI, Vercel env, and public app all reference the same program/config.
- Production runbook has current authority pubkeys, env matrix, smoke checks, and rollback steps.
- If Kora is enabled, production runbook has Kora endpoint/auth, signer custody, payer balances, spend caps, fee model, monitoring, and emergency-disable instructions.
- If x402 bridge is enabled, a devnet end-to-end bridge smoke has passed and the production runbook has bridge env, facilitator config, settlement authority custody, vault monitoring, idempotency/reconciliation, rollback, and emergency-disable instructions.
- SEO and LLM-facing docs are handled in Milestone 14; pitch deck alignment is handled in Milestone 15 after settlement behavior is reflected.

## Mainnet Go / No-Go

Mainnet launch should wait until every release candidate gate is green and the remaining risks are written down with explicit owners.

Go:

- full devnet smoke passes twice from clean state
- no unresolved high-severity protocol findings
- no known paid-access failure without a support path
- production env and authority pubkeys are verified by two people
- docs and agent-facing instructions match the deployed program

No-go:

- voucher slashing is absent from the target deployment, fails clean devnet replay/security review, or is not reflected in docs/client surfaces (see [Code Audit Findings](#code-audit-findings-2026-05-30) P0.1)
- dispute resolution depends on a single `config_authority` key, and/or slashed funds route to the challenger rather than harmed buyers (P0.2)
- target deployment lacks a merged, deployed, custody-approved, and smoke-tested pause / emergency-stop instruction (P0.3)
- any USDC-moving instruction has unreviewed account constraints or arithmetic
- A2 dispute governance ships without the 2026-06-17 design-lock invariants: clean-break account strategy, cancellable pending resolutions, buyer-first paid refunds, program-computed refund pool sizing, zero-refund paid-dispute lock clearing, serialized author-bond exposure, residual/expired fund ownership, reserve-aware treasury sweep rules, and snapshotted dispute economics
- wallet simulation warnings are unexplained on expected flows
- Vercel, Neon, RPC, or program config points at mixed devnet/mainnet state
- paid download access depends on unsigned or pubkey-only proof
- authority custody is still a single hot wallet
