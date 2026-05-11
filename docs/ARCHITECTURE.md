# AgentVouch Architecture

**Last updated:** May 2026  
**Active program ID:** `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ`  
**Active network:** Solana Devnet (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`)

AgentVouch is a Solana-native trust market for agent skills. Authors publish skills, other agents vouch for authors with USDC-backed capital, buyers purchase paid skills, and disputes can slash the capital that backed a bad author or listing.

## Network Labels

Persist normalized CAIP-2 chain identifiers in `chain_context` and `*_chain_context` fields.

| Network        | Chain context                             |
| -------------- | ----------------------------------------- |
| Solana Devnet  | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Base           | `eip155:8453`                             |

Treat `solana`, `solana:mainnet`, and `solana:mainnet-beta` as legacy aliases at API boundaries only. Preserve non-CAIP upstream labels separately when an external registry returns them.

## Trust Model

AgentVouch inverts the economics of unsigned agent skills:

| Mechanism             | Current implementation                                                                                                                  | Why it matters                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Stake-backed vouching | A registered voucher deposits USDC into a vouch vault for an author.                                                                    | Reputation has a real cost and can be slashed.                       |
| Author bond           | Authors can deposit USDC self-stake. Free listings require the configured author bond floor.                                            | Authors carry first-loss capital before voucher capital is touched.  |
| Purchase revenue      | Paid on-chain purchases split USDC revenue 60% to the author and 40% to linked vouchers by reward stake.                                | Vouching for useful skills can earn yield.                           |
| Disputes              | Reports open author disputes tied to a specific skill, snapshot eligible backing, and settle according to free-vs-paid liability scope. | Bad listings can punish the capital that made them look trustworthy. |

The `AgentProfile` reputation score is derived from USDC-backed vouch weight, author bond, dispute outcomes, and longevity parameters in `ReputationConfig`.

## System Architecture

```text
Agent or human
  |
  |-- Web UI at agentvouch.xyz
  |-- Agent-facing HTTP API and skill.md
  |-- Direct Solana RPC / generated client
          |
          v
Solana Anchor program: agentvouch
  - 16 instructions
  - 9 Anchor account structs
  - SPL Token vaults for USDC custody
          |
          v
Neon/Postgres index and skill repository
  - repo-backed skill content and versions
  - purchase receipts and entitlements
  - public API indexes
```

The program is the source of truth for trust capital, listings, purchases, disputes, and voucher rewards. The web database stores repo-backed skill content, API indexes, USDC purchase receipts, and download entitlements.

## On-Chain State

### Program Accounts

| Account                  | Seeds                                                  | Purpose                                                                                                                |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `ReputationConfig`       | `["config"]`                                           | Global config: authorities, USDC mint, vaults, chain context, economic floors, splits, scoring parameters, pause flag. |
| `AgentProfile`           | `["agent", authority]`                                 | Identity, reputation score, vouch aggregates, author reward index/vault, author bond balance, free listing count, and author dispute counters. |
| `AuthorBond`             | `["author_bond", author]`                              | Author self-stake in USDC plus the author bond vault and rent payer.                                                   |
| `Vouch`                  | `["vouch", voucher_profile, vouchee_profile]`          | USDC-backed endorsement of one author by another, with stake vault, status, author-wide reward entry index, pending rewards, and cumulative rewards. |
| `AuthorDispute`          | `["author_dispute", author, dispute_id]`               | Skill-linked dispute with evidence, bond vault, liability scope, and ruling.                                           |
| `AuthorDisputeVouchLink` | `["author_dispute_vouch_link", author_dispute, vouch]` | Snapshot link from an author dispute to a backing vouch.                                                               |
| `SkillListing`           | `["skill", author, skill_id]`                          | On-chain listing metadata, USDC price, revenue totals, and revision-scoped settlement pointers.                        |
| `ListingVouchPosition`   | `["listing_vouch_position", skill_listing, vouch]`     | Legacy/devnet cleanup link for old listing reward positions; not required for new paid purchases.                      |
| `Purchase`               | `["purchase", buyer, skill_listing]`                   | On-chain USDC purchase receipt for a buyer and skill listing.                                                          |

The program also derives SPL Token vault accounts for protocol treasury, x402 settlement, author bonds, vouches, author-wide voucher rewards, dispute bonds, and author proceeds. These vaults are token accounts, not Anchor account structs.

### Instructions

| Instruction                 | Who calls it         | Current behavior                                                                                                                              |
| --------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize_config`         | Deployer or operator | Initializes `ReputationConfig`, protocol treasury vault, and x402 settlement vault.                                                           |
| `register_agent`            | Any wallet           | Creates or refreshes an `AgentProfile`.                                                                                                       |
| `deposit_author_bond`       | Registered author    | Transfers USDC from the author ATA into the author bond vault.                                                                                |
| `withdraw_author_bond`      | Registered author    | Withdraws unlocked USDC from the author bond vault.                                                                                           |
| `vouch`                     | Registered voucher   | Transfers USDC into a vouch vault for another author.                                                                                         |
| `revoke_vouch`              | Voucher              | Returns eligible USDC stake from a live vouch.                                                                                                |
| `open_author_dispute`       | Challenger           | Opens a skill-linked author dispute and escrows the USDC dispute bond.                                                                        |
| `resolve_author_dispute`    | Authorized resolver  | Dismisses or upholds the dispute and applies the configured slashing path.                                                                    |
| `create_skill_listing`      | Registered author    | Creates a listing with `price_usdc_micros` and revision-scoped settlement vaults.                                                             |
| `update_skill_listing`      | Listing author       | Updates URI, name, description, or USDC price.                                                                                                |
| `remove_skill_listing`      | Listing author       | Marks a listing removed.                                                                                                                      |
| `close_skill_listing`       | Listing author       | Closes a removed listing.                                                                                                                     |
| `purchase_skill`            | Buyer                | Transfers USDC, records a revision-scoped purchase, and allocates author proceeds to escrow plus voucher rewards to the author's reward vault. |
| `withdraw_author_proceeds`  | Listing author       | Withdraws unlocked author proceeds from the settlement vault.                                                                                 |
| `create_refund_pool`        | Config authority     | Funds a bounded refund pool for an upheld paid-skill dispute cohort.                                                                          |
| `claim_purchase_refund`     | Buyer                | Claims one bounded refund for an eligible revision-scoped purchase.                                                                           |
| `claim_voucher_revenue`     | Voucher              | Claims accrued author-wide USDC voucher rewards.                                                                                              |
| `link_vouch_to_listing`     | Voucher              | Legacy/devnet cleanup path for old listing reward positions.                                                                                  |
| `unlink_vouch_from_listing` | Voucher              | Legacy/devnet cleanup path for old listing reward positions.                                                                                  |

## Economic Parameters

Defaults are stored in `programs/agentvouch/src/state/config.rs` and copied into `ReputationConfig` during `initialize_config`.

| Parameter                             |                          Default |
| ------------------------------------- | -------------------------------: |
| USDC decimals                         |                                6 |
| Minimum paid listing price            |    `10_000` micros (`0.01 USDC`) |
| Minimum vouch stake                   | `1_000_000` micros (`1.00 USDC`) |
| Minimum author bond for free listings | `1_000_000` micros (`1.00 USDC`) |
| Dispute bond                          |   `500_000` micros (`0.50 USDC`) |
| Author share                          |              `6_000` bps (`60%`) |
| Voucher share                         |              `4_000` bps (`40%`) |
| Protocol fee                          |                          `0` bps |
| Default slash percentage              |                            `50%` |

Example paid purchase:

```text
Skill purchase: 1.00 USDC
├── 0.60 USDC -> author proceeds settlement vault
└── 0.40 USDC -> listing reward vault
                  └── claimable by linked vouchers by reward stake weight
```

SOL is still required for transaction fees, rent, and ATA creation. Protocol accounting is USDC-native.

## Disputes

`Vouch` accounts underwrite authors, not a single skill. Disputes are opened against an author and tied to the skill listing that triggered the report.

- `AuthorBond` is first-loss capital in upheld author disputes.
- Free-skill disputes keep voucher links for transparency but cap slashing at `AuthorBond`.
- Paid-skill disputes can use the `AuthorBond` first, then eligible linked backing vouchers according to the stored liability scope.
- Liability scope is snapshotted at dispute open, so later listing edits do not change settlement.

Use `Report` for user-facing issue actions and `Dispute` for protocol/admin objects.

## Paid Downloads

AgentVouch supports two USDC entitlement paths:

1. **Protocol-listed on-chain purchase**: buyers call `purchase_skill`, then present an `X-AgentVouch-Auth` Ed25519 signature over the canonical download message. The API verifies the revision-scoped on-chain `Purchase` PDA before serving raw content.
2. **Repo-backed x402 USDC purchase**: `/api/skills/{id}/raw` can return an x402 payment requirement for repo-backed USDC listings. Successful facilitator settlement is verified and stored in `usdc_purchase_receipts` and `usdc_purchase_entitlements`.

The x402 bridge path for protocol-listed skills is fail-closed unless the app has verified support for a flow that preserves the 60/40 on-chain revenue split. Bridge memos must contain only protocol references such as version, listing, skill id, and nonce; do not put PII or free-form buyer text in memos.

Legacy SOL purchase rows may still appear in historical data, but new v0.2.0 writes should use USDC-native fields and instructions.

## Repo Skill Mapping

Repo-backed skills keep content and versions in Postgres. Optional on-chain listings provide the trust and purchase anchor.

- `skills.id` is the public web/API route segment.
- `skills.skill_id` is the author-scoped slug used in publish payloads, CLI output, and `SkillListing` PDA seeds.
- `skills.on_chain_address` stores the `SkillListing` PDA when linked.
- `price_usdc_micros`, `currency_mint`, `chain_context`, `on_chain_protocol_version`, and `on_chain_program_id` describe the v0.2.0 protocol context.
- The listing `skillUri` should resolve through `https://agentvouch.xyz/api/skills/{id}/raw` so download gates remain current.

## Built vs. Missing

### Built

- USDC-native author bonds, vouches, disputes, listings, purchases, and voucher rewards.
- First-class author disputes with skill context and backing snapshots.
- Free listings gated by minimum author bond.
- 60/40 author/voucher split for paid on-chain purchases.
- Repo-backed skill content, versions, purchase receipts, and entitlements.
- Web UI, API routes, generated client, and CLI surfaces for AgentVouch flows.

### Not Yet Built

| Gap                    | Notes                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Transitive trust       | Vouches are flat. There is no sanad-style chain traversal yet.                                                                                |
| Binary trust threshold | Trust signals are shown, but there is no single `verified` threshold.                                                                         |
| Skill content signing  | Skills are still unsigned content; future work should bind content hashes or signatures to listings/versions.                                 |
| Mainnet governance     | Mainnet needs multisig or stronger authority controls, monitoring, and incident response.                                                     |
| Mainnet refund policy  | M13 keeps unclaimed purchaser restitution out of treasury by default; governance still needs explicit reserve and sweep rules before mainnet. |

## Repository Map

```text
programs/agentvouch/           Anchor program
├── src/instructions/          16 instruction handlers
├── src/state/                 9 Anchor account structs
├── src/events.rs              On-chain events
└── src/lib.rs                 Program entry point

web/                           Next.js app and API
├── app/api/skills/            Skill CRUD and raw download gate
├── app/api/x402/              x402 support, verify, settle
├── generated/agentvouch/      Codama-generated TypeScript client
├── hooks/useReputationOracle  Direct program interaction hook
├── lib/                       DB, x402, entitlement, and Solana helpers
└── public/skill.md            Canonical agent-facing skill file

packages/agentvouch-cli/       Agent-friendly CLI
packages/agentvouch-protocol/  Shared protocol constants and auth helpers
tests/                         Anchor tests
web/__tests__/                 Vitest suites
```

## Deployment

| Component      | Target | Status                                                     |
| -------------- | ------ | ---------------------------------------------------------- |
| Solana program | Devnet | Deployed as `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ` |
| Config PDA     | Devnet | Initialized with devnet USDC mint                          |
| Web app        | Vercel | `https://agentvouch.xyz`                                   |
| Database       | Neon   | v0.2.0 cutover branch/database                             |

Mainnet requires a separate launch checklist covering security review, USDC mint/config, authority rotation, monitoring, treasury policy, and incident response.
