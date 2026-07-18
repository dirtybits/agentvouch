# AgentVouch Chain Capability Map

**Last verified:** 2026-07-17

This is the canonical cross-chain instruction and capability map. Read it before changing chain-tagged protocol code, contract ABIs, adapters, deployment claims, or readiness status. Run `npm run verify:chain-map` after changing any mapped source surface.

## Verified snapshots

- **Solana devnet:** all 25 instructions below are live at `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg`. Source and `web/agentvouch.json` were checked against each other on 2026-07-09.
- **Base `main` source:** checked at `ce219b86` after the clean-break A1 merge in PR #102. The static verifier compares this table to the current checkout, so the table must move with later source changes.
- **Base Sepolia deployment:** `AgentVouchEvm` at `0x5992dD52Ee2015f558D0A690777C55e27b05B7d1`, reporting `PROTOCOL_VERSION=base-v1-candidate`. Runtime was 19,348 bytes when rechecked on 2026-07-09.
- **Base mainnet:** `eip155:8453` remains blocked by `docs/MAINNET_READINESS.md`. A source mapping is not a mainnet-readiness or deployment claim.

Status meanings:

- `LIVE_DEVNET`: present in the active Solana devnet program.
- `MERGED_SOURCE`: present in the current Base `main` contract source.
- `LIVE_SEPOLIA_PRE_A1`: selector is present in the current pre-A1 Base Sepolia candidate.
- `NOT_DEPLOYED`: merged source exists, but the selector is absent from that deployment.
- `NOT_APPLICABLE`: deliberately folded into another EVM operation or specific to Solana accounts/rent.

## Off-chain card-access seam

Stripe card checkout is not a chain capability and therefore does not appear as
a row in the instruction map below. In the walletless preview, an authenticated
opaque buyer account may receive a `marketplace_access_grants` row for a Solana
or Base Sepolia skill. That grant authorizes only the off-chain marketplace
download. It creates no Solana purchase PDA, Base purchase id, x402 settlement,
protocol receipt, author proceeds, voucher rewards, or dispute state. Optional
linked wallets are proven separately and do not become the grant key. Base
mainnet remains blocked.

## Current surface

<!-- BEGIN SURFACE MAP -->
| Verb | What it does | Solana instruction | Solana devnet | Base `main` mapping | Base source | Base Sepolia | Key difference |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Configure | Initializes authorities, USDC custody, economics, chain context, and pause state. | `initialize_config` | `LIVE_DEVNET` | `initializeConfig` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Base uses role-controlled contract storage instead of config and vault PDAs. |
| Admin | Migrates a legacy config account to the M13 layout. | `migrate_config_m13` | `LIVE_DEVNET` | — | `NOT_APPLICABLE` | `NOT_APPLICABLE` | Historical Solana devnet migration; Base v1 is a fresh deployment. |
| Admin | Migrates a legacy listing and creates its revision-0 settlement. | `migrate_skill_listing_m13` | `LIVE_DEVNET` | — | `NOT_APPLICABLE` | `NOT_APPLICABLE` | Historical Solana devnet migration; Base v1 is a fresh deployment. |
| Pause | Pauses or resumes risk-creating protocol actions. | `set_paused` | `LIVE_DEVNET` | `setPaused` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Solana uses a configured pause authority; Base uses `PAUSE_ROLE`. |
| Register | Creates or refreshes an agent's on-chain identity. | `register_agent` | `LIVE_DEVNET` | `registerAgent` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Both expose the profile through their chain-native account/storage model. |
| Self-stake | Deposits an author's USDC bond. | `deposit_author_bond` | `LIVE_DEVNET` | `depositAuthorBond` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Base accounts internally inside one custody contract. |
| Self-stake | Withdraws an eligible author bond. | `withdraw_author_bond` | `LIVE_DEVNET` | `withdrawAuthorBond` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Both enforce exposure locks; Base currently has only its pre-A1 report lock. |
| Vouch | Creates, reactivates, or increases a USDC-backed endorsement. | `vouch` | `LIVE_DEVNET` | `vouch` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Solana can allocate the author vouch to listings; Base vouches are author-wide. |
| Vouch | Revokes an eligible endorsement and reclaims its remaining stake. | `revoke_vouch` | `LIVE_DEVNET` | `revokeVouch` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Base has no listing-position unwind because vouches are author-wide. |
| Report | Opens a bonded issue against an author/listing. | `open_author_dispute` | `LIVE_DEVNET` | `openPaidPurchaseReport` | `MERGED_SOURCE` | `NOT_DEPLOYED` | Merged Base A1 accepts only an eligible buyer-owned Direct or Authorization receipt; the live Sepolia deployment still exposes the superseded author-wide report. |
| Resolve | Reviews and rules on a dispute before settlement. | `resolve_author_dispute` | `LIVE_DEVNET` | `reviewPaidPurchaseReport`, `resolvePaidPurchaseReport` | `MERGED_SOURCE` | `NOT_DEPLOYED` | Base splits trusted review from the terminal ruling and snapshots author-wide exposure for an upheld paid-purchase report. |
| Slash | Permissionlessly settles eligible voucher slashing in bounded pages. | `slash_dispute_vouches` | `LIVE_DEVNET` | `slashPaidPurchaseReportVouches` | `MERGED_SOURCE` | `NOT_DEPLOYED` | Solana processes listing-linked positions; Base processes author-wide vouches against the snapshotted active stake. |
| Sell | Creates a listing and its initial revision settlement. | `create_skill_listing` | `LIVE_DEVNET` | `createSkillListing` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Base initializes settlement storage internally rather than creating a separate account. |
| Sell | Updates listing metadata or price and rotates revision when required. | `update_skill_listing` | `LIVE_DEVNET` | `updateSkillListing` | `MERGED_SOURCE` | `NOT_DEPLOYED` | Merged after the current Base Sepolia candidate; revision changes are blocked during report exposure. |
| Sell | Soft-removes a listing. | `remove_skill_listing` | `LIVE_DEVNET` | `removeSkillListing` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Same lifecycle outcome. |
| Sell | Closes a removed listing account and reclaims rent. | `close_skill_listing` | `LIVE_DEVNET` | `removeSkillListing` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | EVM storage has no rent-reclaim close, so removal is the terminal public action. |
| Settle | Creates the settlement account for the current listing revision. | `initialize_listing_settlement` | `LIVE_DEVNET` | — | `NOT_APPLICABLE` | `NOT_APPLICABLE` | Base performs the equivalent internal initialization during create/update. |
| Buy | Purchases a paid skill directly in USDC. | `purchase_skill` | `LIVE_DEVNET` | `purchaseSkill` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Both use the locked 60/40 economics when backing exists; Solana rewards listing-linked positions while Base rewards author-wide vouches. |
| Buy (agent) | Records a role-attested x402 settlement with replay guards. | `settle_x402_purchase` | `LIVE_DEVNET` | `settleX402Purchase` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Both trust a scoped settlement authority after off-chain payment. |
| Earn | Claims accrued voucher revenue. | `claim_voucher_revenue` | `LIVE_DEVNET` | `claimVoucherRevenue` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Solana positions can be listing-scoped; Base accrual is author-wide. |
| Earn | Withdraws author proceeds for a listing revision. | `withdraw_author_proceeds` | `LIVE_DEVNET` | `withdrawAuthorProceeds` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Both preserve revision-scoped author proceeds. |
| Refund | Creates and closes bounded restitution liabilities for an upheld paid dispute. | `create_refund_pool` | `LIVE_DEVNET` | `resolvePaidPurchaseReport`, `slashPaidPurchaseReportVouches`, `closePaidPurchaseReportCredit`, `claimRestitutionReserve` | `MERGED_SOURCE` | `NOT_DEPLOYED` | Base funds credit during uphold/final voucher processing, closes expired credit separately, and exposes pull-only excess to the configured restitution recipient. |
| Refund | Lets the eligible buyer claim the funded purchase credit once. | `claim_purchase_refund` | `LIVE_DEVNET` | `claimPaidPurchaseReportCredit` | `MERGED_SOURCE` | `NOT_DEPLOYED` | Base A1 funds only the initiating buyer, capped at purchase price plus return of the report bond. |
| Vouch allocation | Links an author vouch to a listing reward/slash position. | `link_vouch_to_listing` | `LIVE_DEVNET` | — | `NOT_APPLICABLE` | `NOT_APPLICABLE` | Deliberately Solana-only; Base vouching is author-wide. |
| Vouch allocation | Exits a listing reward/slash position when unlocked. | `unlink_vouch_from_listing` | `LIVE_DEVNET` | — | `NOT_APPLICABLE` | `NOT_APPLICABLE` | Deliberately Solana-only; Base vouching is author-wide. |
| Buy (agent) | Atomically consumes a buyer's EIP-3009 authorization and records the purchase. | — | `NOT_APPLICABLE` | `purchaseWithAuthorization` | `MERGED_SOURCE` | `LIVE_SEPOLIA_PRE_A1` | Base-only Lane B; there is no Solana analog. |
<!-- END SURFACE MAP -->

## Merged A1 deployment gap

PR #102 merged the seven-function `base-v1-a1` paid-report surface and removed `openReport` / `resolveReport` from Base `main`. The facade runtime is 23,487 bytes and the linked-library runtime is 5,939 bytes; 116 Forge tests, the full local Anvil lifecycle, linked-library verification, and an internal executable-diff review passed.

This is a source claim only. The live Base Sepolia address remains the pre-A1 `base-v1-candidate` and does not route the paid-report selectors. Paid-report wallet/UI writes, fresh linked deployment, live smoke, custody/operations inputs, and external review or explicit human acceptance remain gated by `.agents/plans/base-paid-report-activation-sepolia.plan.md`.

## Verification

Static drift check, required after source or map changes:

```bash
npm run verify:chain-map
```

The checker compares:

1. the 25 public Anchor instructions in `programs/agentvouch/src/lib.rs`;
2. the 25 instructions in `web/agentvouch.json`;
3. this table's Solana mappings; and
4. every state-changing `public` or `external` function defined by `contracts/base-poc/src/AgentVouchEvm.sol` against this table's Base mappings.

The mapped Base set must exactly equal the current contract source. Deployment status remains a separate
manual/live verification claim; `MERGED_SOURCE` never implies `LIVE_SEPOLIA_PRE_A1` or mainnet readiness.

It deliberately does not make network requests. For a claim about what is deployed, recheck the recorded address and selector surface against Base Sepolia, for example:

```bash
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_AGENTVOUCH=0x5992dD52Ee2015f558D0A690777C55e27b05B7d1
cast call "$BASE_AGENTVOUCH" "PROTOCOL_VERSION()(string)" --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast selectors "$(cast code "$BASE_AGENTVOUCH" --rpc-url "$BASE_SEPOLIA_RPC_URL")"
```

Selector presence proves only that a function is routed by that bytecode; behavioral deployment claims still require the relevant live smoke and evidence in the phase plan.
