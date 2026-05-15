# Devnet Deployment State

Living record of the active `agentvouch` devnet deployment after the Track B x402 settlement bridge cutover. Update this file whenever the program is upgraded, the config authority rotates, or the canonical smoke fixture changes.

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
| Last deploy slot | `462610464` |
| Last deploy tx | `4YgndRgBoqmBZ4jWcVc6rhomZWcjr9Td7Yg2Vh18SDQS2mUZ5kqJnFznTa5G2cwL9Ns59HJBNNku435L9cnZuoGo` |
| Config init tx | `4sabP2jqmF8dNqnCxrdL25NMUijSx5f6TBLcMs7qu6spwcJj5rJkPP9TJ8rjNQ6vkaZ5w24EAk2tdteAMj4sgJJp` |
| Local `.so` sha256 | `a4df8de1f8727950832aff46729951a36b02032110d052a37b31f3f2da2a40ae` |
| USDC mint (devnet) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Chain context (CAIP-2) | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |

The deployed program includes the Track B protocol layer: `settle_x402_purchase`, x402 receipt/signature idempotency guards, and the stock-compatible x402 settlement vault ATA. The on-chain IDL was uploaded with the deploy; clients should still read the synced repo IDL (`target/idl/agentvouch.json`, `web/agentvouch.json`, and `web/generated/agentvouch/`) so local builds stay deterministic.

To re-verify the binary match locally:

```bash
NO_DNA=1 anchor build
shasum -a 256 target/deploy/agentvouch.so
solana program dump -u devnet AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg /tmp/agentvouch_devnet.so
LOCAL_LEN=$(wc -c < target/deploy/agentvouch.so)
head -c $LOCAL_LEN /tmp/agentvouch_devnet.so | shasum -a 256
```

The trimmed hash must match the local `.so` hash; the trailing bytes on the dump are zero padding inserted by the BPF loader and do not affect equality.

## Instruction surface (23 instructions)

`claim_purchase_refund`, `claim_voucher_revenue`, `close_skill_listing`, `create_refund_pool`, `create_skill_listing`, `deposit_author_bond`, `initialize_config`, `initialize_listing_settlement`, `link_vouch_to_listing`, `migrate_config_m13`, `migrate_skill_listing_m13`, `open_author_dispute`, `purchase_skill`, `register_agent`, `remove_skill_listing`, `resolve_author_dispute`, `revoke_vouch`, `settle_x402_purchase`, `unlink_vouch_from_listing`, `update_skill_listing`, `vouch`, `withdraw_author_bond`, `withdraw_author_proceeds`.

Error codes were renumbered after `NoActiveAuthorBacking` was removed; downstream consumers that parse Anchor error variants by index must use the synced IDL rather than hard-coded numbers.

## Economic semantics

- Paid listings are permissionless. A registered author can sell with zero external vouch stake and zero `AuthorBond`.
- When external vouch stake exists, `purchase_skill` splits payments **60% author / 40% voucher reward pool**.
- When no external vouch stake exists, the full payment routes to author proceeds escrow; no voucher reward pool is created.
- `settle_x402_purchase` uses the same split rules, but transfers from the protocol x402 settlement vault ATA after an off-chain x402 payment has already settled into that vault.
- Author proceeds are held in a per-listing `ListingSettlement` escrow until `withdraw_author_proceeds` is called. Upheld disputes against the listing can convert escrowed proceeds into a bounded buyer refund pool via `create_refund_pool` + `claim_purchase_refund` (Milestone 13 mechanics).
- Floors: `0.01 USDC` paid listing minimum, `1.00 USDC` minimum vouch stake, `1.00 USDC` minimum author bond *for free listings only*, `0.50 USDC` dispute bond. Protocol fee: `0%`.

## Canonical smoke fixture

| Field | Value |
| --- | --- |
| State dir | `.agent-keys/track-b-devnet-smoke/` (gitignored) |
| `skill_id` | `m11smoke-mp7dye2i` |
| Last verified | `2026-05-15` |

Latest end-to-end smoke transactions on the active program:

| Step | Tx |
| --- | --- |
| `fund-author-sol` | `3X7MjHJqC36GwJmvBTrtqQXa5KZqDVpKknkPmQXGoTyJDMGs7M2htcrc3nCmqLabDfCNxgvC4crFaCXUNSj4crLn` |
| `fund-actor-sol` | `2ECNRPbJFPLcbQrufm2zxmHsNbkqUHGf2cPsS7YrWxw7eppuqwScFQGicLobuxojVWoTXuPHATTReFMwmwM6CRMR` |
| `prepare-author-usdc` | `5LVtASeVYyUCXLxs4B3RXs4AeKXr2m3qapcZ5CDGGoj88vBWNHKspeXvWKcojPZy6a6cHNPfcHuwLFEwPmwa1Vrt` |
| `prepare-actor-usdc` | `W9kN8kdLJk9RMoTihgrLqHpUYHRAJDPjYYefcQcC7JQXiJDBuz9XjC4crMYzB97Vp6ny8WmkV1K5N3Hh5nR9vMn` |
| `register-actor-profile` | `Z2WigCDtdg1RKfnC1fc2HQZFWsggX1uzfvjmWcE7cQHtYjy5mxRMKpanukGGK8HUgfQ3SKdpq7wR26DyoojnAym` |
| `register-author-profile` | `RwDfpZyWGkJNzawEUXg7bwXiXSJ2p6E5JpnmkipMWs7kCR5yAXtTqwyrNTDjpm4AFw1nGJ616jeHN8dTQVz2d9h` |
| `deposit-author-bond` | `5foWaZQjDpkYmUgEQpWFK6iW7wjtkQVdaqyFxRNYh3t2CnLzQn8nywBTdE6au9neRGvvKtnzjjyoTd4cS2QcNf1T` |
| `create-skill-listing` (+ settlement) | `3yytPbYLGRXS4gaDu1gHs3boFaYStHfttWcqyNzEU1U8GXeoJaMz96MKtmmkBYZocoM1u432Zr4wSQjFMuhjyRUn` |
| `create-vouch` | `24pA82W3QKBf21odndxWRyGd2wjkrqewSeRk1qFoJLyeKKEuzV5ubraRKSESq4s8gUegnmVeSvYFR2mbKWAnjwAi` |
| `purchase-skill` | `5oD2PnAtvqJqCKCCNCdGXaYd98ZGfQXzXmwvRG627cVG2gCXc2TeQ5Bd6w9NzccteRjmyc6Qx69CACoPezwN78ZK` |
| `claim-voucher-revenue` | `3pJFsMDs96DHG6w37jsUFmZadVhf77D4cqntV3v23hGwhYhKNvbJbxpYwCTDa2mhExZLnsebrHPnTBTnG2xTsLSc` |

Post-state confirms the 60/40 split:

- Author proceeds escrow: `600_000` micro-USDC (60% of a 1 USDC purchase)
- Voucher cumulative revenue: `400_000` micro-USDC (40%)
- Listing total downloads: `1`, total revenue: `1_000_000` micro-USDC

`resolve_author_dispute` was skipped in this run because `AGENTVOUCH_SMOKE_AUTHORITY_KEYPAIR` was not set; the dispute path is exercised by `anchor test`. The canonical smoke fixture verifies direct `purchase_skill`; the local bridge-enabled smoke below verifies `settle_x402_purchase` through `/api/skills/{id}/raw`.

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

Reuse `.agent-keys/track-b-devnet-smoke/` as-is for read-only checks. If a fresh, isolated fixture is required (rare; usually only when a smoke run has poisoned the per-listing settlement state or you need a clean reputation graph), pass a new `--skill-id` and let the script create a fresh `ListingSettlement`:

```bash
npm run smoke:devnet-usdc -- --apply --skill-id "trackbsmoke-$(date +%s)"
```

A new keypair set is generated under a fresh `.agent-keys/...` directory if `AGENTVOUCH_SMOKE_STATE_DIR` is overridden. Do **not** revive any of the historic state dirs (`v02-devnet-smoke-*`, `fresh-reset-smoke-*`, `m11-devnet-smoke`); those predate the current Program ID and will fail decoding the current layout.

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

The current `track-b-devnet-smoke` fixture is **active**, not stale; do not drain it unless you are explicitly retiring it (and re-run the smoke against a fresh `--skill-id` first to confirm a replacement fixture exists).

## Stale-fixture hazards

| Symptom | Cause | Recovery |
| --- | --- | --- |
| `Config PDA … is N bytes, expected at least 491` | Smoke script is pointed at a pre-M13 config | Run `npm run migrate:config -- --apply` with the config authority, then retry |
| `AccountNotFound` for `listing_settlement` | A listing predates M13 and was never initialized | Run `npm run migrate:skill-listings -- --apply` (or pass a fresh `--skill-id` to the smoke script) |
| `Fallback functions are not supported` | Client IDL is stale | `cp target/idl/agentvouch.json web/agentvouch.json && npm run generate:client` |
| `0x1772` / `DescriptionTooLong` | Listing description exceeds 256 bytes | Shorten before publish; the `/api/skills` POST handler now enforces this client-side |

## Rebuilds and authority rotation

A new same-ID upgrade should follow [`docs/program-upgrades-and-redploys.md`](program-upgrades-and-redploys.md), capture the new deploy tx and slot in this file, and re-run the smoke. If the upgrade authority or config authority rotates, also update [`AGENTS.md`](../AGENTS.md) and `docs/USDC_NATIVE_MIGRATION.md` so the canonical references stay consistent.
