# Devnet Deployment State

Living record of the active `agentvouch` devnet deployment after the Milestone 14 cutover. Update this file whenever the program is upgraded, the config authority rotates, or the canonical smoke fixture changes.

## Active program

| Field | Value |
| --- | --- |
| Cluster | Solana devnet |
| Program ID | `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ` |
| ProgramData address | `Ah7mLz92zNFXYSJWwKYHnS3QMAiAc3LQdNae8uFb1UEA` |
| Upgrade authority | `dmt4CBeNrF6iMV793zfJGiAAqVK9C9bifdL9cvqNTou` |
| Config PDA | `BWcLtsDEaLfBhHweJo6u9kgNn47xJDpz22Q3Q8BhQFVS` |
| Config authority | `dmt4CBeNrF6iMV793zfJGiAAqVK9C9bifdL9cvqNTou` |
| Config layout | M13 (491 bytes, `ReputationConfig` includes `author_proceeds_lock_seconds`) |
| Last deploy slot | `461758145` |
| Last deploy tx | `UX3qqWcXJsaxN5yarVZrxmaoR7FmuGyAqH3kx5sFJzDoBFHLGPJRcXsDwAoE6XSwDXJXj2tCzMemNSAottih3Fc` |
| Local `.so` sha256 | `886440ddabfb8fb2421d06e3fb2f072eb1ae3b20bfad3dab5ca3f7f399eac96f` |
| USDC mint (devnet) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Chain context (CAIP-2) | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |

The deployed program corresponds to source commit that removed `NoActiveAuthorBacking` from `purchase_skill.rs` (permissionless paid purchases). On-chain IDL is intentionally **not** uploaded; clients read `target/idl/agentvouch.json` (synced to `web/agentvouch.json` and `web/generated/agentvouch/`).

To re-verify the binary match locally:

```bash
NO_DNA=1 anchor build
shasum -a 256 target/deploy/agentvouch.so
solana program dump -u devnet AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ /tmp/agentvouch_devnet.so
LOCAL_LEN=$(wc -c < target/deploy/agentvouch.so)
head -c $LOCAL_LEN /tmp/agentvouch_devnet.so | shasum -a 256
```

The trimmed hash must match the local `.so` hash; the trailing bytes on the dump are zero padding inserted by the BPF loader and do not affect equality.

## Instruction surface (22 instructions)

`claim_purchase_refund`, `claim_voucher_revenue`, `close_skill_listing`, `create_refund_pool`, `create_skill_listing`, `deposit_author_bond`, `initialize_config`, `initialize_listing_settlement`, `link_vouch_to_listing`, `migrate_config_m13`, `migrate_skill_listing_m13`, `open_author_dispute`, `purchase_skill`, `register_agent`, `remove_skill_listing`, `resolve_author_dispute`, `revoke_vouch`, `unlink_vouch_from_listing`, `update_skill_listing`, `vouch`, `withdraw_author_bond`, `withdraw_author_proceeds`.

Error codes were renumbered after `NoActiveAuthorBacking` was removed; downstream consumers that parse Anchor error variants by index must use the synced IDL rather than hard-coded numbers.

## Economic semantics

- Paid listings are permissionless. A registered author can sell with zero external vouch stake and zero `AuthorBond`.
- When external vouch stake exists, `purchase_skill` splits payments **60% author / 40% voucher reward pool**.
- When no external vouch stake exists, the full payment routes to author proceeds escrow; no voucher reward pool is created.
- Author proceeds are held in a per-listing `ListingSettlement` escrow until `withdraw_author_proceeds` is called. Upheld disputes against the listing can convert escrowed proceeds into a bounded buyer refund pool via `create_refund_pool` + `claim_purchase_refund` (Milestone 13 mechanics).
- Floors: `0.01 USDC` paid listing minimum, `1.00 USDC` minimum vouch stake, `1.00 USDC` minimum author bond *for free listings only*, `0.50 USDC` dispute bond. Protocol fee: `0%`.

## Canonical smoke fixture

| Field | Value |
| --- | --- |
| State dir | `.agent-keys/m11-devnet-smoke/` (gitignored) |
| `skill_id` | `m13smoke-1778524108` |
| Last verified | `2026-05-11` |

Latest end-to-end smoke transactions on the active program:

| Step | Tx |
| --- | --- |
| `fund-actor-sol` | `kgnhYYyHy4MgbwPRwvwJZZnhKHHXPt8EdwKix2kJpLkT8ATcMun4QuMVsjNAmmD96RdhDdiWRQ3r1iqNTMobmms` |
| `prepare-author-usdc` | `enUqnUaF6GY138Z3azc2gSSKgAbvAtZZioB6D99LJHXXG46YKcts6hL22VoTRcS5THMG5V6Dm8qpAtVWg5VA4Cw` |
| `prepare-actor-usdc` | `47wQmnxFKubzfejoteBXvfHMhKKaJqzVgTtqM1eUqZ1ByDKx7eHdHfxLjYxEame68PvYdH3n3GDCJTGtb4uyJD54` |
| `register-actor-profile` | `2TxfBsnWjPa3UJUfZQp1wBRfijAisHGbMgAbdbrFRar7EWe6bq34bXGhYAHYtr8xL1Y2Tk1Bw2AnfbusSXJ6TnWc` |
| `register-author-profile` | `3uqFVLXbUKhk2Wxs6ohPxCNDygJ4DyLJp289NEr5e5ZuSRXrsSp7haFxqYpT7sZaiKvA2ryxtEgkKQsPsUXuKZuo` |
| `deposit-author-bond` | `3iFCwVX6VkgsxsdsJRjUYcH4o6St2HQNPdRbHzbVHRqhMQ7S2g35p4jPXYrigMMAprntwfZYT7EzMGJaN2XfR1wj` |
| `create-skill-listing` (+ settlement) | `5H2UGQYRuTqbwN32et6K2xGbAokU8h8qqLdT4UENKTTe9ba5WwJA3GytGh4KaFmZupEdnp1UYoZq27Hfyjqfx36f` |
| `create-vouch` | `QsLg74oqdUgbVEpU1hAoDLwCCwZ8snRv1kjvuMWwmtQ8E4eJYaAiaL1dguuY8J2cvXTUsYmspRASrfANfQdDw5A` |
| `purchase-skill` | `eP9uaHkAeCiqnMwEsu65coSbmZiHtwfqj4wmPJWJSzJjKLd1mo6aVz1jMiQKYt2x6yahgQ9LNLKNbsLbSdvvFWY` |
| `claim-voucher-revenue` | `4vW8WNcYCLpMGpKPx2dmCx8TGqgSPzC4rUBonYN5v1PkAMedSHBY99gWzdNpU6uNNEhd5KsDriqBHof3cqXXTJ2w` |

Post-state confirms the 60/40 split:

- Author proceeds escrow: `600_000` micro-USDC (60% of a 1 USDC purchase)
- Voucher cumulative revenue: `400_000` micro-USDC (40%)
- Listing total downloads: `1`, total revenue: `1_000_000` micro-USDC

`resolve_author_dispute` was skipped in this run because `AGENTVOUCH_SMOKE_AUTHORITY_KEYPAIR` was not set; the dispute path is exercised by `anchor test`.

## Reusing or rotating the smoke fixture

Reuse `.agent-keys/m11-devnet-smoke/` as-is for read-only checks. If a fresh, isolated fixture is required (rare; usually only when a smoke run has poisoned the per-listing settlement state or you need a clean reputation graph), pass a new `--skill-id` and let the script create a fresh `ListingSettlement`:

```bash
npm run smoke:devnet-usdc -- --apply --skill-id "m13smoke-$(date +%s)"
```

A new keypair set is generated under a fresh `.agent-keys/...` directory if `AGENTVOUCH_SMOKE_STATE_DIR` is overridden. Do **not** revive any of the historic state dirs (`v02-devnet-smoke-*`, `fresh-reset-smoke-*`); those predate the current Program ID and will fail decoding the M13 layout.

## Stale-fixture hazards

| Symptom | Cause | Recovery |
| --- | --- | --- |
| `Config PDA … is N bytes, expected at least 491` | Smoke script is pointed at a pre-M13 config | Run `npm run migrate:config -- --apply` with the config authority, then retry |
| `AccountNotFound` for `listing_settlement` | A listing predates M13 and was never initialized | Run `npm run migrate:skill-listings -- --apply` (or pass a fresh `--skill-id` to the smoke script) |
| `Fallback functions are not supported` | Client IDL is stale | `cp target/idl/agentvouch.json web/agentvouch.json && npm run generate:client` |
| `0x1772` / `DescriptionTooLong` | Listing description exceeds 256 bytes | Shorten before publish; the `/api/skills` POST handler now enforces this client-side |

## Rebuilds and authority rotation

A new same-ID upgrade should follow [`docs/program-upgrades-and-redploys.md`](program-upgrades-and-redploys.md), capture the new deploy tx and slot in this file, and re-run the smoke. If the upgrade authority or config authority rotates, also update [`AGENTS.md`](../AGENTS.md) and `docs/USDC_NATIVE_MIGRATION.md` so the canonical references stay consistent.
