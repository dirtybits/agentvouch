# Devnet Deployment State

Living record of the active `agentvouch` devnet deployment after the Track B x402 settlement bridge cutover and A1 voucher-slashing upgrade. Update this file whenever the program is upgraded, the config authority rotates, or the canonical smoke fixture changes.

## Active program

| Field | Value |
| --- | --- |
| Cluster | Solana devnet |
| Program ID | `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg` |
| ProgramData address | `KzkKz12Jbv8EYQ3iLkZepW3xpB7UwGD1r83XKYxVFQs` |
| Upgrade authority | `dmt4CBeNrF6iMV793zfJGiAAqVK9C9bifdL9cvqNTou` |
| Config PDA | `8RQ1ySTxbmsYwcnucZZ4VgYg5pzwEbmBreEKJHLfdgha` |
| Config authority | `dmt4CBeNrF6iMV793zfJGiAAqVK9C9bifdL9cvqNTou` |
| Config layout | Track B / M13-compatible (491 bytes, `ReputationConfig` includes `author_proceeds_lock_seconds` and a stock-compatible x402 settlement vault ATA) |
| Protocol treasury vault authority | `DUcUxw3r4t91ezbCUeoHeCrQppgfzLFCn8Yxhw8Zh3Aw` |
| Protocol treasury vault | `3LihXhStfS7jx3gmzK2NALCWr5fAmgtJrJU2ZKffK6hT` |
| x402 settlement vault authority | `3ueLzqB5SiFLdGqGqJ55PNBffcgUqJ5iLf7pJMGrfCdj` |
| x402 settlement vault ATA | `3Z7VPVVA4ehG7hcsdGbKJcZgvAfPNbSSbFGJCyEFbzdr` |
| Last deploy slot | `468574856` |
| Last deploy tx | `2FYWJ3QfJLLTKr157tmkRFcQJs4fpRATiZWEs3MAQMZVwvbW8tcqUeGjGWVugKHasuu8qVJfEkBbRSGyyuU7Shrg` |
| Config init tx | `4sabP2jqmF8dNqnCxrdL25NMUijSx5f6TBLcMs7qu6spwcJj5rJkPP9TJ8rjNQ6vkaZ5w24EAk2tdteAMj4sgJJp` |
| Local `.so` sha256 | `641b9cd8536c8f9f7fabdc955553208fd76920ad045fa97517d38977560991b1` |
| USDC mint (devnet) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Chain context (CAIP-2) | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |

The deployed program includes the Track B protocol layer (`settle_x402_purchase`, x402 receipt/signature idempotency guards, and the stock-compatible x402 settlement vault ATA) plus the A1 voucher-slashing layer. Upheld paid disputes with linked voucher positions can park in `SlashingVouchers`, be cranked permissionlessly through `slash_dispute_vouches`, ring-fence slashed deposits for refund pools, and keep listing membership/removal/close flows locked until settlement clears the dispute lock. The on-chain IDL was uploaded with the deploy; clients should still read the synced repo IDL (`target/idl/agentvouch.json`, `web/agentvouch.json`, and `web/generated/agentvouch/`) so local builds stay deterministic.

To re-verify the binary match locally:

```bash
NO_DNA=1 anchor build
shasum -a 256 target/deploy/agentvouch.so
solana program dump -u devnet AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg /tmp/agentvouch_devnet.so
LOCAL_LEN=$(wc -c < target/deploy/agentvouch.so)
head -c $LOCAL_LEN /tmp/agentvouch_devnet.so | shasum -a 256
```

The trimmed hash must match the local `.so` hash; the trailing bytes on the dump are zero padding inserted by the BPF loader and do not affect equality.

## Instruction surface (24 instructions)

`claim_purchase_refund`, `claim_voucher_revenue`, `close_skill_listing`, `create_refund_pool`, `create_skill_listing`, `deposit_author_bond`, `initialize_config`, `initialize_listing_settlement`, `link_vouch_to_listing`, `migrate_config_m13`, `migrate_skill_listing_m13`, `open_author_dispute`, `purchase_skill`, `register_agent`, `remove_skill_listing`, `resolve_author_dispute`, `revoke_vouch`, `settle_x402_purchase`, `slash_dispute_vouches`, `unlink_vouch_from_listing`, `update_skill_listing`, `vouch`, `withdraw_author_bond`, `withdraw_author_proceeds`.

Error codes were renumbered after `NoActiveAuthorBacking` was removed; downstream consumers that parse Anchor error variants by index must use the synced IDL rather than hard-coded numbers.

## Economic semantics

- Paid listings are permissionless. A registered author can sell with zero external vouch stake and zero `AuthorBond`.
- When external vouch stake exists, `purchase_skill` splits payments **60% author / 40% voucher reward pool**.
- When no external vouch stake exists, the full payment routes to author proceeds escrow; no voucher reward pool is created.
- `settle_x402_purchase` uses the same split rules, but transfers from the protocol x402 settlement vault ATA after an off-chain x402 payment has already settled into that vault.
- Author proceeds are held in a per-listing `ListingSettlement` escrow until `withdraw_author_proceeds` is called. Upheld disputes against the listing can convert escrowed proceeds into a bounded buyer refund pool via `create_refund_pool` + `claim_purchase_refund` (Milestone 13 mechanics).
- Upheld paid-listing disputes can slash linked voucher positions at `slash_percentage` through `slash_dispute_vouches`; slashed deposits are refund-pool-only and excluded from the challenger reward base.
- Floors: `0.01 USDC` paid listing minimum, `1.00 USDC` minimum vouch stake, `1.00 USDC` minimum author bond *for free listings only*, `0.50 USDC` dispute bond. Protocol fee: `0%`.

## Canonical smoke fixture

| Field | Value |
| --- | --- |
| State dir | `.agent-keys/a1-devnet-dispute-smoke/` (gitignored) |
| `skill_id` | `a1smoke-20260611` |
| Last verified | `2026-06-11` |

Latest end-to-end smoke transactions on the active program:

| Step | Tx |
| --- | --- |
| `fund-author-sol` | `2dWY2vmokyAQHaNpR1N1AKNVEuNL3LUxXsdD6RjUW3G2mkjZ5TWmJqbxnxbKPs4J7RVHvf2byAdsMJnmBhwAsVc8` |
| `fund-actor-sol` | `4wvR7oAVdstXNQvcviPZjsVSGjQk2srWS2KcZoyKFWFWRtsu9u5XCBnCGhvW5NjHmZBqBhLmgACgD3bqhtkqr6v4` |
| `prepare-author-usdc` | `3pWxGgL8XoNtdHPnbTeA45N19tmyGT4MZZRm8r3Bxub3QkUZwaQbgMGEbi8C3DXZpyJi2d3jhoYaeXerL5nGTehW` |
| `prepare-actor-usdc` | `q4qLy9LDp9uq8Dz51p8LCdc1AAkhVsZErWfYssgq1WHNTe4eFgjZhoJkEHfjcqJHqQXjdVURWVqUdRsqVRH1Csi` |
| `register-actor-profile` | `31nhpEP42Hp4Jyqs6yJs3f2sUqWm9dLQKkEkRsBc5LgjM4H4FN4SzR8vxeUiH3kgGVtG4oWMCr7yQKrJcD4pDvFx` |
| `register-author-profile` | `3DvuXTAYFsdTzuv51dvb46QyBzfEkcNtkBvFFf3z4L1RMh2aabaRLQp42aEcYrYnKq577515CTn3wgxjwMwC8Zv6` |
| `deposit-author-bond` | `eZ5FvNSx5xWLiAg9jkV8BsusCXLAG3P5uyFCo7qs8Ypk1dRFmTYQWwRBXgFs4dGotd7TdoSZK6Z9ug65arfzowp` |
| `create-skill-listing` (+ settlement) | `4tLtqfnW3zZvVNdWTvuwC9sM3bVm34EUqgnzHFHbRoYwJmQTfCt53RxaqwvdEWEmctCG7hCVzhdnARu949thbtak` |
| `create-vouch` | `4dS3wEnMYXwpAehuuzsya3CXJ1cBsrEbR2LSoS1k3JiXUDF1AtYDcgwtVNAGZS7BkMd5eEbZptyhw6TY4Z3Q9Y6N` |
| `link-vouch-to-listing` | `3sQhmJgxXsV8aZiHdee3tncfx85LJT4pzmPdvWB59y5hzHKm8b3iy1YPP2Krpkn57tyu6Equ6t7rnh14Cx1zNuRr` |
| `purchase-skill` | `29gBwV2TuV8AsZkrSNhgupN1cB8D91EFmuwqvBowwf3W9Q6HAbiKhurczs1k1DmuHziQNHCqsjbxakeQZey2kaBN` |
| `claim-voucher-revenue` | `3bimBSZcT3CrEQR2Y94fCQcnTeudQo2WpHH7QT9V9WoxMLx1habNM2YoirUwjCrz9prxEUqJjmqbb44PQQ5U6zbJ` |
| `open-author-dispute` | `2bRrA2gTa9QMWnsMzaeLdeHN2sBNp8voKKZyv5WGHSm7J1XCkPWZhpgP61WrE7nVgiQeDuw7UgRxW6K1Qw7RMBFF` |
| `resolve-author-dispute-upheld` | `3AaQmZHWvEFgJMMuFVGzw2VABWo8Y7HHF7ziQdS3c8EBYPPmQboekxxHfa2CzTNKKbhf3nBrjvrsE7kqCidEMDhX` |
| `slash-dispute-vouches` | `3rmuiizS8HX6hvAZvi4ycUY2q4CHRviWiWn4uERz4mPvFFvMGgeKpkBL3hr82frVcUTBzE8bPnevY1JjdEJR3pHS` |
| `create-refund-pool` | `wxUCry9JrWofknFF6D9RcBoFSGEnKsWoYD3UxmkEErhH83sKwwSa7YGZiebc8GUSK2i2TDdgyd25R4QG6uauzCL` |
| `claim-purchase-refund` | `pcSRsNq6JTVJEHSbDeZ6ad3korPhXCNkzGtttFmkcp5o2fzG5Fe4Jr4CkZvEFgbwPa3HSc2kKhJPGCFiFbeCPH8` |

Post-state confirms the full A1 path:

- The 1 USDC purchase split `600_000` micro-USDC to author proceeds and `400_000` micro-USDC to voucher rewards, then the voucher reward was claimed.
- The upheld dispute slashed `500_000` micro-USDC from the author bond and `500_000` micro-USDC from the linked vouch.
- The vouch is `slashed`, active listing reward positions fell to `0`, and the residual vouch vault holds `500_000` micro-USDC for later reclaim.
- `create_refund_pool` built a `1_000_000` micro-USDC refund pool; `claim_purchase_refund` claimed all `1_000_000`, leaving `0` in the refund pool.
- The listing settlement dispute lock cleared (`locked_by_dispute = null`), with `40_000` micro-USDC left in author proceeds after the configured challenger reward.

The canonical smoke fixture now verifies direct `purchase_skill`, paid-listing vouch linking, authority-keyed `resolve_author_dispute`, permissionless `slash_dispute_vouches`, refund-pool creation, and buyer refund claim. The local bridge-enabled smoke below separately verifies `settle_x402_purchase` through `/api/skills/{id}/raw`.

## A1 deploy verification

The 2026-06-10 A1 deploy was verified with:

- `NO_DNA=1 anchor test` — 31 passing, including voucher slashing, multi-page crank, stale-position skip-settle, remove/close dispute-lock, and refund-pool paths.
- `AGENTVOUCH_SMOKE_AUTHORITY_KEYPAIR=/Users/andysustic/dev-keypair.json npm run smoke:devnet-usdc -- --apply --state-dir .agent-keys/a1-devnet-dispute-smoke --skill-id a1smoke-20260611` — passed on 2026-06-11 with live open → upheld resolve → slash → refund-pool → refund-claim path.
- Binary match: `target/deploy/agentvouch.so` and `solana program dump` both hashed to `641b9cd8536c8f9f7fabdc955553208fd76920ad045fa97517d38977560991b1`.
- On-chain IDL: upgraded at IDL account `BK3kFBTsNRVVhWae4ucHKV2huiioEWD1RRWAKrM68RT4`; fetched IDL semantically matches `target/idl/agentvouch.json` / `web/agentvouch.json`.
- Web and CLI: `npm run test --workspace @agentvouch/web` (65 files, 332 tests), `npm run test --workspace @agentvouch/cli` (10 files, 50 tests), `npm run build --workspace @agentvouch/web`, and `npm run build --workspace @agentvouch/cli` passed.
- x402 bridge POC: `npm run x402:bridge-poc --workspace @agentvouch/web -- --strict` passed with production bridge support still feature-flagged off.
- Public flow surface: `npm run smoke:flow-surface` passed after the web deployment/promotion.

## Track B x402 bridge smoke

Latest local bridge-enabled smoke against the active devnet program:

| Field | Value |
| --- | --- |
| Local feature flag | `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED=true` |
| Repo skill id | `2f2f0656-0f92-4938-bb2e-6c4433c9ba28` |
| `skill_id` | `tbx402-mp7i3ti6` |
| Listing PDA | `4ctei7obzastUX5Z4dMBoyLSjvj2X5gKXD51QVFKuGdQ` |
| Buyer | `F6vv6SiX1bv3DNDDHv5LwekGyz81nqMoK9PsUqSNYr2u` |
| Author | `7bnztynmPtsrPVdcgNrrPAccHv8rp8ub5f98mGHqU56Z` |
| Price | `10_000` micro-USDC (`0.01 USDC`) |
| x402 settlement tx | `4VkC1s9dKxoBCSGQC5B5mAAr7ykXzLLTkbCjg9KF2cxxU92in5v9dyGkWFo9Kh2WccVPDijp5A3J9f5CihveTLUz` |
| Program settlement tx | `5iyHDc5nZRvZxuCaoobcGemhEgPWEqqwrkFLbp7bVUEzfkGsF8Z6eCPMAvnADaYKmqDJ5nvUxW9gsXzdtRjFZfPL` |
| Purchase PDA | `FiVat41bAwSf8o82bgwPyT72SZQzqYGXnRhkB1oyuvR7` |
| x402 receipt PDA | `AvwDfdRGpf1doZd7yxGW2sG66hLhnYhohnxkdQLyFz1U` |
| Voucher claim tx | `5fdFjBA5Z9DqDsWpza4davEsFLbWcNyb5vDthnBT88utFndMej3YqCDM5BdwEddZBYdew4YqxJmvWjFbh2MYKBPe` |

This proves `/api/skills/{id}/raw` can return an x402 requirement for a protocol-listed paid repo skill, receive a stock exact-SVM USDC payment into the protocol settlement vault ATA, call `settle_x402_purchase`, create normal purchase state, persist a bridge receipt/entitlement, serve the signed raw download, and fund claimable voucher revenue.

## Reusing or rotating the smoke fixture

Reuse `.agent-keys/a1-devnet-dispute-smoke/` as-is for read-only checks. If a fresh, isolated fixture is required (rare; usually only when a smoke run has poisoned the per-listing settlement state or you need a clean reputation graph), pass a new `--state-dir` and `--skill-id` and let the script create a fresh `ListingSettlement`:

```bash
AGENTVOUCH_SMOKE_AUTHORITY_KEYPAIR=~/dev-keypair.json npm run smoke:devnet-usdc -- --apply --state-dir ".agent-keys/a1-devnet-dispute-smoke-$(date +%s)" --skill-id "a1smoke-$(date +%s)"
```

A new keypair set is generated under a fresh `.agent-keys/...` directory if `AGENTVOUCH_SMOKE_STATE_DIR` is overridden. Do **not** revive any of the historic state dirs (`v02-devnet-smoke-*`, `fresh-reset-smoke-*`); those predate the current Program ID and will fail decoding the current layout.

## Draining before deletion

**Before `rm -rf` on any `.agent-keys/*` directory, drain the SOL on every keypair back to a recoverable address.** The directories are intentionally gitignored, so a plain `rm -rf` is irreversible — the Ed25519 secrets are gone and any on-chain balance becomes unrecoverable. This is bounded on devnet (faucet-replenishable), but the same procedure must hold for any future testnet or mainnet fixture, so make it muscle memory now.

Recommended drain loop, run from the repo root with `solana` on `PATH`:

```bash
STALE_DIR=.agent-keys/<dir-to-retire>
FUNDER=$(solana-keygen pubkey ~/.config/solana/id.json)   # or whichever address should reclaim funds

# 1. Enumerate balances first; abort if anything looks unexpected.
for f in "$STALE_DIR"/*-keypair.json; do
  PK=$(solana-keygen pubkey "$f")
  BAL=$(solana balance -u devnet "$PK")
  echo "$f  $PK  $BAL"
done

# 2. Drain non-trivial balances back to the funder.
for f in "$STALE_DIR"/*-keypair.json; do
  solana transfer \
    --from "$f" \
    --keypair "$f" \
    --fee-payer "$f" \
    --allow-unfunded-recipient \
    -u devnet \
    "$FUNDER" ALL
done

# 3. Confirm balances are zero, then delete.
for f in "$STALE_DIR"/*-keypair.json; do
  solana balance -u devnet "$(solana-keygen pubkey "$f")"
done
rm -rf "$STALE_DIR"
```

If the directory holds USDC ATAs as well (the smoke fixtures typically do), also close them with `spl-token close <ata>` against each owner keypair before deletion so the rent-exempt SOL is reclaimed. Skipping this step is what stranded the SOL in the `v02-devnet-smoke-1778533434`, `v02-devnet-smoke-1778533564`, and `fresh-reset-smoke-20260511` directories deleted during the M14 cutover — devnet only, but the procedural lesson applies anywhere.

The current `a1-devnet-dispute-smoke` fixture is **active**, not stale; do not drain it unless you are explicitly retiring it (and re-run the smoke against a fresh `--state-dir` and `--skill-id` first to confirm a replacement fixture exists).

## Stale-fixture hazards

| Symptom | Cause | Recovery |
| --- | --- | --- |
| `Config PDA … is N bytes, expected at least 491` | Smoke script is pointed at a pre-M13 config | Run `npm run migrate:config -- --apply` with the config authority, then retry |
| `AccountNotFound` for `listing_settlement` | A listing predates M13 and was never initialized | Run `npm run migrate:skill-listings -- --apply` (or pass a fresh `--skill-id` to the smoke script) |
| `Fallback functions are not supported` | Client IDL is stale | `cp target/idl/agentvouch.json web/agentvouch.json && npm run generate:client` |
| `0x1772` / `DescriptionTooLong` | Listing description exceeds 256 bytes | Shorten before publish; the `/api/skills` POST handler now enforces this client-side |

## Rebuilds and authority rotation

A new same-ID upgrade should follow [`docs/program-upgrades-and-redploys.md`](program-upgrades-and-redploys.md), capture the new deploy tx and slot in this file, and re-run the smoke. If the upgrade authority or config authority rotates, also update [`AGENTS.md`](../AGENTS.md) and `docs/USDC_NATIVE_MIGRATION.md` so the canonical references stay consistent.
