# USDC Sponsored Checkout Handoff

Last updated: 2026-06-23

## TL;DR

AgentVouch now has a working Solana sponsored checkout path for paid `purchase_skill`.

The user experience is USDC-native:

- buyer signs the purchase
- sponsor pays Solana transaction fee and purchase-receipt rent in SOL
- buyer pays skill price in USDC
- buyer also pays a bounded USDC setup fee to reimburse the sponsor
- the purchase receipt is created on-chain in the same transaction

This does not make Solana fees or rent disappear. It removes the requirement that the buyer hold SOL for the covered checkout flow.

## Current Status

Status: devnet-proven for sponsored paid skill purchase.

Scope that works today:

- paid skill purchase through `purchase_skill`
- sponsor as transaction fee payer
- sponsor as `rent_payer` for the purchase receipt PDA
- buyer USDC setup-fee transfer to sponsor fee destination
- server-side prepare/submit APIs
- explicit warning before falling back to direct SOL-paying purchase
- stale listing layout guard for sponsored checkout

Out of scope today:

- full Kora integration
- buyer USDC ATA creation sponsorship
- author/profile/listing/vouch/dispute sponsorship
- live SOL/USDC oracle pricing
- production-grade shared rate limiting / WAF
- mainnet production enablement

## Proof Transaction

Devnet transaction:

```text
3FBp6ZPnbeSjitEyjvAYnW3AE1Y2LgfW9q15WYvpHdZFMhvELz58MutywdR3GAZf8izhcwQPDqbMmFs1aZnYmCgy
```

Explorer:

```text
https://explorer.solana.com/tx/3FBp6ZPnbeSjitEyjvAYnW3AE1Y2LgfW9q15WYvpHdZFMhvELz58MutywdR3GAZf8izhcwQPDqbMmFs1aZnYmCgy?cluster=devnet
```

Observed result:

- transaction status: `Ok`
- fee payer: `sponFTPyNZZaAPgsCEuB7REzoexaJE62eYKzwrm4eEy`
- buyer: `A9tc7VFXZ9GN61id8GaeM4WcaSEetTEDRFXssvqAB8ZD`
- sponsored listing: `B9J7XyzknLc7wZDYusFSuHgqTugJ4XkChph4mQPmk5gw`
- purchase receipt PDA: `JDM7ipu1dwhjXCQxHgKBMjjV8mSKmnC4VdeVFK4YLcaV`
- sponsor USDC fee destination: `3Qfg1AoHvDJdebXa9NizTM2dwpWissTX7vEaNdteAnUh`
- setup fee: `350000` micro-USDC (`0.35 USDC`)

SOL evidence:

```text
sponsor SOL: 9.99795572 -> 9.99582292
buyer SOL:   0.9977972  -> unchanged
purchase PDA rent: 0 -> 0.0021228 SOL
tx fee: 0.00001 SOL
```

USDC evidence:

```text
buyer USDC:                 21.00 -> 19.65
sponsor fee destination:     0.00 -> 0.35
author proceeds vault:       0.00 -> 0.60
listing reward vault:        0.80 -> 1.20
```

The buyer paid `1.00 USDC` for the skill plus `0.35 USDC` setup fee. The sponsor paid SOL rent/fee and received the USDC reimbursement.

## Gasless Purchase Fixture

The current smoke fixture is:

```text
name: Gasless Purchase
repo skill id: d812364e-8a1b-4d0a-b002-2a74545eaccb
skill id: gasless-purchase-20260623
author slug: wallet-dmt4cben
listing: B9J7XyzknLc7wZDYusFSuHgqTugJ4XkChph4mQPmk5gw
price: 1_000_000 micro-USDC
```

Local detail URL:

```text
http://localhost:3000/skills/wallet-dmt4cben/gasless-purchase-20260623
```

API URL:

```text
http://localhost:3000/api/skills/d812364e-8a1b-4d0a-b002-2a74545eaccb?trust=live
```

Create-listing tx:

```text
3vLkwr76AYX8BLJW4VKtES8cioU745xUmT1YLWvGYVDYDxSyLXHYKi341fByKk7mytSseig3JecvTjVoVatHNrpH
```

The local source artifact for this fixture was created under `.agent-keys/gasless-purchase-skill/SKILL.md`, which is intentionally ignored by git.

## Implementation Surfaces

Server/API:

- `web/app/api/transactions/sponsored/purchase/prepare/route.ts`
- `web/app/api/transactions/sponsored/purchase/submit/route.ts`
- `web/lib/sponsoredPurchase.ts`
- `web/lib/sponsoredCheckout.ts`
- `web/lib/onchain.ts`
- `web/lib/rateLimit.ts`

Client/UI:

- `web/lib/sponsoredPurchaseClient.ts`
- `web/hooks/useMarketplaceOracle.ts`
- `web/hooks/useReputationOracle.ts`

Tests:

- `web/__tests__/lib/sponsoredPurchase.test.ts`
- `web/__tests__/lib/sponsoredCheckout.test.ts`
- `web/__tests__/lib/onchain.test.ts`

Important generated or interface surfaces when `purchase_skill` changes:

- `programs/agentvouch/src/instructions/purchase_skill.rs`
- `web/agentvouch.json`
- `web/generated/agentvouch/`
- `packages/agentvouch-cli/src/idl/agentvouch.ts`
- `packages/agentvouch-cli/src/lib/solana.ts`
- `scripts/devnet-usdc-smoke.mjs`
- `tests/helpers/agentvouchUsdc.ts`

## Environment Variables

Set these in `web/.env.local` for local smoke and in Vercel project env vars for preview/production.

```bash
AGENTVOUCH_SPONSORED_CHECKOUT_ENABLED=1
NEXT_PUBLIC_AGENTVOUCH_SPONSORED_CHECKOUT_ENABLED=1

# Local only.
AGENTVOUCH_SPONSOR_KEYPAIR_PATH=/absolute/path/to/sponsor-keypair.json

# Vercel/prod alternative. Do not use a local file path in Vercel.
# AGENTVOUCH_SPONSOR_SECRET_KEY='[64-byte-json-array]'

AGENTVOUCH_SPONSOR_USDC_FEE_DESTINATION=<sponsor_or_treasury_usdc_token_account>
AGENTVOUCH_SPONSOR_SOL_USDC_MICRO_PRICE=150000000
AGENTVOUCH_SPONSOR_MAX_FEE_USDC_MICROS=350000
```

`AGENTVOUCH_SPONSOR_SOL_USDC_MICRO_PRICE` is micro-USDC per 1 SOL.

Example:

```text
SOL = $150 -> 150000000
```

The static price is a sponsorship risk. If SOL price rises and this env is stale, the sponsor can under-recover. Before broad production enablement, either keep it operationally fresh or replace it with a live quote/oracle path.

The normal Solana/web env must also match devnet/mainnet target:

```bash
SOLANA_RPC_URL=<rpc>
NEXT_PUBLIC_SOLANA_RPC_URL=<same rpc until all browser reads are mediated>
SOLANA_CHAIN_CONTEXT=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
NEXT_PUBLIC_SOLANA_CHAIN_CONTEXT=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
```

## Required Wallet/Account State

Sponsor:

- sponsor keypair configured through env
- sponsor has SOL for fees and rent
- sponsor USDC fee destination exists
- sponsor USDC fee destination uses the configured USDC mint

Buyer:

- buyer has a USDC associated token account
- buyer has enough USDC for `price + setup fee`
- buyer does not need SOL for the sponsored purchase path

Current flow does not create the buyer USDC ATA. If the buyer is missing a USDC account, prepare should fail before wallet signing.

## How The Flow Works

1. Browser calls sponsored prepare:

   ```text
   POST /api/transactions/sponsored/purchase/prepare
   ```

2. Server reads on-chain listing state, validates the listing layout, derives all PDAs, quotes rent/fee, and builds the transaction.

3. Server signs the transaction once as sponsor.

4. Browser asks buyer wallet to sign the already prepared transaction.

5. Browser submits the signed transaction:

   ```text
   POST /api/transactions/sponsored/purchase/submit
   ```

6. Submit path verifies signatures and revalidates the expected transaction shape before relaying.

7. The transaction executes:

   - `purchase_skill`
   - USDC `transferChecked` setup-fee reimbursement

If any instruction fails, the whole transaction fails.

## Security Invariants

These are load-bearing. Do not weaken them when extending sponsorship.

1. Buyer must not equal sponsor.

   If buyer equals sponsor, signer roles collapse and the server sponsor signature can become sufficient to authorize the whole transaction.

2. Server signs only server-constructed transactions.

   The server signs in `prepare`, not in `submit`, and never signs a client-supplied message.

3. Submit revalidates the transaction.

   Submit compares the transaction against the expected account metas, instruction data, fee cap, and buyer balance before relay.

4. Sponsor reimbursement is capped.

   `AGENTVOUCH_SPONSOR_MAX_FEE_USDC_MICROS` limits setup fee collection and sponsor recovery. It is currently `350000` micro-USDC in the devnet smoke.

5. Sponsored endpoints must be gated.

   Current rate limiting is best-effort per instance. Before production-wide enablement, add shared or edge rate limiting, likely Vercel Firewall/WAF or a shared-store limiter.

6. `purchase_skill` account order is brittle by design.

   `web/lib/sponsoredPurchase.ts` manually validates/builds the 16-account `purchase_skill` instruction. Any program/account-interface change must update this file and every generated client/caller in the same branch.

## Stale Listing Guard

Sponsored checkout validates raw listing bytes before trying to decode/build the transaction.

Current `SkillListing::SPACE`:

```text
892 bytes
```

The guard rejects:

- wrong discriminator
- wrong account size
- string lengths above current caps
- invalid `SkillStatus`
- invalid `locked_by_dispute` option tag
- truncated fixed fields

This fixed the earlier stale PDA issue where an old listing looked syntactically present but failed during sponsored submit with:

```text
AccountDidNotDeserialize
```

If the on-chain `SkillListing` layout changes again, update:

- `programs/agentvouch/src/state/skill_listing.rs`
- `web/lib/onchain.ts`
- `web/__tests__/lib/onchain.test.ts`
- generated IDL/client artifacts if the program interface changes

## Direct Purchase Fallback

Sponsored checkout no longer silently falls back to direct purchase.

If sponsored checkout is unavailable, the user sees a confirmation:

```text
Sponsored checkout is unavailable for this purchase.
Use direct purchase instead?
Direct purchase will ask your wallet to pay Solana network fees and rent in SOL.
```

If the user cancels, Phantom should not open a direct SOL-paying purchase.

This matters because the direct path uses the buyer as fee payer and rent payer. The sponsored path uses the sponsor as fee payer and rent payer.

## Manual Smoke Test

Use the current fixture or publish a fresh paid skill.

1. Confirm env is set:

   ```bash
   rg "AGENTVOUCH_SPONSORED_CHECKOUT|AGENTVOUCH_SPONSOR" web/.env.local
   ```

2. Confirm sponsor SOL:

   ```bash
   SPONSOR=$(solana-keygen pubkey /absolute/path/to/sponsor-keypair.json)
   solana balance "$SPONSOR" -u devnet
   ```

3. Confirm buyer has devnet USDC.

4. Start the web app:

   ```bash
   npm run dev:web
   ```

5. Open:

   ```text
   http://localhost:3000/skills/wallet-dmt4cben/gasless-purchase-20260623
   ```

6. Buy with the connected buyer wallet.

7. Check the transaction:

   ```bash
   solana confirm -u devnet -v <signature>
   ```

8. Success criteria:

   - fee payer is sponsor
   - `purchase_skill` account 12 is buyer
   - `purchase_skill` account 13 is sponsor/rent payer
   - buyer SOL is unchanged
   - purchase receipt PDA is created and funded with rent
   - sponsor SOL decreases by rent/fee
   - token instruction transfers setup fee from buyer USDC account to sponsor fee destination
   - buyer USDC decreases by `price + setup fee`

Optional direct prepare probe:

```bash
curl -s 'http://localhost:3000/api/transactions/sponsored/purchase/prepare' \
  -H 'Content-Type: application/json' \
  -d '{
    "buyerPubkey":"<buyer>",
    "listingAddress":"<listing>",
    "expectedPriceUsdcMicros":"1000000",
    "expectedUsdcMint":"4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
  }' | jq '{error, quote, accounts}'
```

Expected quote shape:

```json
{
  "quote": {
    "priceUsdcMicros": "1000000",
    "setupFeeUsdcMicros": "350000",
    "rentLamports": "2122800",
    "transactionFeeLamports": "10000",
    "capped": true
  }
}
```

## Common Failure Modes

### Phantom still shows warnings

Phantom may still show generic simulation or unknown-program warnings. The real question is who is paying SOL. Verify the transaction after submit:

- sponsored: sponsor is fee payer/rent payer
- direct: buyer is fee payer/rent payer

### Buyer pays SOL

This means the UI entered direct purchase, not sponsored checkout. Check:

- `NEXT_PUBLIC_AGENTVOUCH_SPONSORED_CHECKOUT_ENABLED=1`
- wallet supports partial `signTransaction`
- prepare endpoint returns a quote
- user did not approve direct fallback

### Stale listing layout warning

Fresh current listings are `892` bytes. If a listing is rejected with a different size, it is probably stale or from an older program layout. Relink/republish or run a targeted migration only if one exists.

### `AccountDidNotDeserialize`

Usually stale PDA/account data or IDL/program mismatch. Check:

- deployed program matches local binary
- web IDL/generated client matches deployed program
- listing raw account length/discriminator is current
- DB `on_chain_address` points at the current program/listing PDA

### `Cannot find module 'ai'` or CLI commander errors in worktrees

This repo has known worktree dependency/symlink rough edges. For publishing smoke fixtures, using the AgentVouch API/publish library directly is often cleaner than the built CLI until workspace deps are refreshed.

## Current Limitations And Next Steps

Recommended next steps before production enablement:

1. Add edge/shared rate limiting for sponsored endpoints.
2. Add monitoring for sponsor SOL balance, sponsor USDC fee receipts, prepare/submit failure rates, and direct-fallback rate.
3. Replace or operationalize the static SOL/USDC price env.
4. Decide whether to sponsor buyer USDC ATA creation.
5. Add a polished in-app sponsored checkout modal instead of relying on `window.confirm`.
6. Add Vercel env/runbook coverage for sponsor secret handling.
7. Add production alerting for buyer == sponsor rejection spikes or sponsor outflow anomalies.
8. Keep Kora deferred until the simple in-app sponsor path is fully understood.

## Why This Matters

This proves the near-term Solana path can support a USDC-native checkout experience without migrating to Base just to remove native-gas onboarding.

The protocol still uses Solana accounts, rent, and fees. The product no longer needs to expose those costs as a buyer prerequisite for the covered paid purchase path.
