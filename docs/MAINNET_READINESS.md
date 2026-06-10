# AgentVouch Mainnet Readiness

`v0.2.0` is a USDC-native devnet release. It is not mainnet-ready until the items below are complete and reviewed.

## Current Assessment

AgentVouch is close to a mainnet release candidate, but should not be treated as mainnet-ready yet.

The core product shape is in place: the USDC-native protocol, marketplace publishing and purchase flows, author trust surfaces, voucher backing, dashboard revenue visibility, and agent-facing install path now fit together. The remaining work is mainly release hardening, not product discovery.

> **Update (2026-05-30): a direct code audit revised this assessment.** See [Code Audit Findings](#code-audit-findings-2026-05-30) below. The remaining work is **not** only release hardening: **voucher slashing — the core economic mechanism of a stake-backed reputation system — is not implemented**, and **dispute adjudication is a single key**. Until those are addressed, a mainnet deploy would put real USDC behind a half-built mechanism with a centralized, perverse-incentive trust root.

> **Update (2026-06-09): readiness re-read.** Active program references now converge on `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg` in `declare_id!`, `Anchor.toml`, `web/agentvouch.json`, generated clients, protocol package constants, `web/public/skill.md`, `docs/DEVNET_STATE.md`, operator runbooks, and local agent reference docs. The remaining non-readiness source occurrence of `AgnTDF...` is intentionally retained as `TRACK_B_PREVIOUS_DEVNET_PROGRAM_ID` in `web/scripts/db-cutover.ts` for historical cleanup. The `revoke_vouch` open-dispute lock is now present in source; voucher slashing itself, dispute governance, emergency pause, and refund reserve policy remain launch blockers.

The next milestone should be framed as **Mainnet Release Candidate**, not final mainnet launch. The release candidate is ready only when the protocol, wallet UX, production config, docs, and operating runbooks can survive repeated end-to-end devnet smoke tests without manual interpretation.

## Code Audit Findings (2026-05-30)

A direct review of `programs/agentvouch/src` and the test suites downgraded the assessment above. The escrow/accounting plumbing is solid (pinned PDA derivations re-checked in handlers, `transfer_checked` throughout, checked arithmetic, x402 replay guards via payment-ref + tx-sig PDAs, dispute locks that freeze paid-listing purchases/withdrawals). But two load-bearing design choices are **not implemented or are centralized**, so part of the core product and trust model — not just release hardening — is still missing.

### P0 — blocking (product + trust correctness)

1. **Voucher slashing is not implemented.** The `AuthorBondThenVouchers` liability scope is recorded, but no instruction ever slashes voucher stake: `resolve_author_dispute.rs` only calls `slash_author_bond_if_present`; `author_dispute.voucher_slashed_usdc_micros` is set to `0` at open and never recomputed; `VouchStatus::Slashed` (`state/vouch.rs`) is never assigned; `AuthorDisputeVouchLink` (`state/author_dispute_vouch_link.rs`) is defined but never created. Net: **vouching is reward-only with zero downside** — the stake-backed-reputation thesis is not enforced on-chain. *Fix:* implement voucher slashing (debit voucher vaults, set `VouchStatus::Slashed`) and keep the active-dispute lock on `revoke_vouch`.

   > **Status (2026-06-09): partially mitigated, still blocking.** The `revoke_vouch` active-dispute lock is present in source, so vouchers cannot exit while the backed author has an open dispute. The `resolve` slash-loop is still designed but not built. Slashing is a verified/bonded-tier feature, but mainnet with paid vouch-backed listings should wait until it is implemented and tested.
   >
   > **Design locked (2026-06-09, supersedes the earlier sketch):** full plan in `.agents/plans/a1-voucher-slashing.plan.md`. Decisions: (1) slash set = the disputed listing's `ListingVouchPosition`s, settled in **pages** (≤ `MAX_DISPUTE_POSITIONS_PER_TX` per tx) via a new permissionless `slash_dispute_vouches` instruction, with `resolve(Upheld)` parking the dispute in a new `SlashingVouchers` status and `open_author_disputes` decremented only on the final page — a single atomic resolve-time loop does not fit Solana tx account limits at 32 positions. (2) Slashed funds are **ring-fenced** in a new `ListingSettlement.slashed_deposit_usdc_micros`: refund-pool-only, excluded from author withdrawals and from the challenger-reward base (the earlier "deposit into withdrawable proceeds" sketch let the author reclaim voucher slash via a small refund pool, and inflated the collusion prize). (3) Partial slash at `slash_percentage`, but the vouch goes to `VouchStatus::Slashed` (dead position — stops backing and earning); the residual is reclaimable through `revoke_vouch` once the author has no open disputes. (4) `link_vouch_to_listing` **and** `unlink_vouch_from_listing` are blocked while the listing settlement is `locked_by_dispute` — without the unlink lock, vouchers can exit the slash set mid-dispute (the revoke lock alone only freezes the money, not membership). The `AuthorDisputeVouchLink` PDA init per `(dispute, vouch)` is the double-slash guard.

2. **Dispute adjudication is a single key.** `resolve_author_dispute` and `create_refund_pool` are gated only on `config.config_authority` (`require_keys_eq!(config.config_authority, authority.key())`). One ordinary pubkey unilaterally decides Upheld/Dismissed and sizes refunds — no multisig, timelock, quorum, or appeal; on-chain evidence is a URI string. Slashed author bond is paid **100% to the challenger** (`resolve_author_dispute.rs`), not to harmed buyers, so a compromised or colluding resolver + challenger can drain any author's bond. *Fix:* multisig + timelock on the resolver authority at minimum; route slashed funds to harmed buyers (or explicitly justify otherwise); longer term, the optimistic-oracle / LLM-jury adjudication design.

3. **No pause / emergency stop.** `config.paused` is written only at init (`= false`); no instruction sets it true, so every `require!(!paused)` guard is dead code and `pause_authority` is never read. There is no kill switch.

4. **No refund reserve; refunds frequently unfundable.** Refund pools are funded from the author's own undisbursed proceeds for one revision, first-come-first-served until empty. Free-listing disputes produce no pool at all, and proceeds withdrawn before a dispute opened leave nothing. The slashed bond does not backstop buyers (it goes to the challenger).

### P1 — required before launch

5. **No config setters / authority rotation instructions.** Economic params (`slash_percentage`, bond floors, reward shares/caps) and authorities change only via redeploy or the M13 migration. `treasury_authority` has no withdrawal path — dismissed-dispute bonds accrue in the treasury vault with no in-program sweep.
6. **External security review** of every USDC-moving instruction (per [Security Review](#security-review)) — not yet done; this is a Go gate.
7. **Test gaps:** voucher-slashing path (N/A until implemented); listing update/remove/close/settlement-init (implemented, untested); one nose-to-tail upheld → slash → refund test; and API ↔ on-chain integration (the web/API layer is ~100% mocked — no test proves the API's entitlement/refund bookkeeping matches on-chain truth).

Primary files for hardening: `instructions/resolve_author_dispute.rs`, `instructions/create_refund_pool.rs`, `instructions/revoke_vouch.rs`, `state/config.rs`.

## Re-Read Findings (2026-06-09)

- **Program identity:** active source and public/runtime artifacts point at `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg`: `programs/agentvouch/src/lib.rs`, `Anchor.toml`, `web/agentvouch.json`, `web/generated/agentvouch/`, `packages/agentvouch-protocol/src/index.{ts,js,d.ts}`, `scripts/devnet-usdc-smoke.mjs`, `docs/DEVNET_STATE.md`, `docs/DEPLOY.md`, `docs/PRODUCTION_RUNBOOK.md`, `web/public/skill.md`, `.cursor/skills/agentvouch/`, and public docs.
- **Historical ID:** `web/scripts/db-cutover.ts` retains `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ` only as `TRACK_B_PREVIOUS_DEVNET_PROGRAM_ID` for old-state cleanup. Do not treat it as active deployment config.
- **Purchase gate:** direct purchase verification is stronger than earlier notes imply. The API verifies the confirmed transaction, program id, chain context, listing PDA, derived `Purchase` PDA, buyer, listing revision, price, and USDC mint before recording an entitlement.
- **x402 bridge:** protocol-listed x402 remains fail-closed behind `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED`; `/api/x402/supported` does not advertise the bridge unless the flag is enabled. The bridge binds buyer/listing/skill/amount/nonce into a payment-ref hash and checks the backend settlement authority against on-chain config.
- **Verification run:** `npm run test --workspace @agentvouch/web`, `npm run test --workspace @agentvouch/cli`, `NO_DNA=1 anchor build`, `npm run build --workspace @agentvouch/web`, and `npm run build --workspace @agentvouch/cli` passed on 2026-06-09. `NO_DNA=1 anchor test` built the program but failed before the TypeScript suite because Anchor reported local RPC port `8899` in use; direct localhost RPC checks did not find a responding validator afterward, so the full Anchor suite still needs a clean local-validator rerun.

## Release Candidate Gates

- Protocol safety review covers purchase, vouch, voucher reward, author bond, dispute, refund, close, claim, and withdraw paths.
- Devnet soak has repeated the full happy path with fresh wallets: register, publish, vouch, purchase, claim voucher revenue, withdraw author proceeds, report, resolve, and refund.
- Wallet UX is clear for locked wallets, simulation warnings, insufficient SOL, ATA creation, network mismatch, and rejected signatures.
- Mainnet configuration is frozen: program ID, USDC mint, economic floors, config authority, treasury authority, resolver authority, Vercel env, and Neon branch.
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
- pause or emergency controls, when implemented

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

- voucher slashing is not implemented (the core economic mechanism is missing — see [Code Audit Findings](#code-audit-findings-2026-05-30) P0.1)
- dispute resolution depends on a single `config_authority` key, and/or slashed funds route to the challenger rather than harmed buyers (P0.2)
- no pause / emergency-stop instruction exists (P0.3)
- any USDC-moving instruction has unreviewed account constraints or arithmetic
- wallet simulation warnings are unexplained on expected flows
- Vercel, Neon, RPC, or program config points at mixed devnet/mainnet state
- paid download access depends on unsigned or pubkey-only proof
- authority custody is still a single hot wallet
