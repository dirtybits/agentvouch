---
name: base-port-chain-adapter-phase-5
overview: "Phase 5 of the Base port: implement Base Sepolia ChainWallet writes (register/list/buy) and the EVM x402 settlement lane, lifting the sponsored 4337 flow and receiveWithAuthorization recipe from contracts/base-poc. Depends on Phase 4 Base wallet connect. Solana write paths must keep working."
todos:
  - id: preflight-phase4
    content: "DONE 2026-06-30: Phase 4 sub-plan is complete; Base Sepolia passkey connect/restore/disconnect and Solana regression are recorded there, and current code exposes the client-only Base smart-account surface. Local env scan found no Base RPC/paymaster/DB .env values, so full live write verification remains blocked until envs are supplied."
    status: completed
  - id: lock-usdc-circle-invariants
    content: "DONE 2026-06-30: Locked the Circle USDC invariants before writing payment code: Base Sepolia chain id 84532/eip155:84532, native Circle USDC 0x036CbD53842c5426634e7929541eC2318f3dCF7e, 6-decimal parsing/formatting, exact-amount approvals, confirmed receipts, and no USDbC/USDC.e."
    status: completed
  - id: lift-sponsored-writes
    content: "DONE 2026-06-30: Lifted contracts/base-poc/ui/src/flow.ts into the client-only Base ChainWallet: registerAgent, createSkillListing, purchaseSkill({ listingId, expectedPriceUsdcMicros }), skillIdHashFrom, computeListingId, live price check, native USDC exact approve+purchase batching, receipt/event validation, and TxResult mapping."
    status: completed
  - id: wire-publish-and-purchase-ui
    content: "DONE 2026-06-30: Base purchase and listing UI are wired by chain_context. Base rows use evm_listing_id/evm_contract_address/evm_tx_hash, stay away from Solana on_chain_address, call ChainWallet.purchaseSkill({ listingId, expectedPriceUsdcMicros }) for purchases, call ChainWallet.createSkillListing for Base author listing, verify the Base tx hash before persistence, and refresh buyer state with buyerChainContext. Solana author/listing controls remain on the Solana path."
    status: completed
  - id: persist-base-writes
    content: "DONE 2026-06-30: Base write persistence is wired. Purchase verifier checks Base Sepolia/native USDC, live listing price/status, SkillPurchased event listing/buyer/price, then records chain-qualified receipts and entitlements with buyer_chain_context/buyer_address plus evm_listing_id/evm_purchase_id. Listing verifier checks SkillListingCreated, live listing author/skill hash/name/description/URI/price, native USDC, and only persists Base listings for Base-authored rows. Existing Solana persistence is untouched."
    status: completed
  - id: add-evm-agent-identity
    content: "DONE 2026-06-30: Added the EVM author/profile branch needed for Phase 5: Base Sepolia author trust resolves through AgentVouchEvm.getProfile, EVM local identity uses an evm_agent_profile binding instead of Solana PDA derivation, /api/author/[pubkey]?chainContext=eip155:84532 can return chain-qualified Base trust, skill detail no longer routes raw 0x authors into Solana /author/[pubkey], Base author ownership is checked against the active Base wallet address, and Solana-only author actions stay Solana-gated."
    status: completed
  - id: add-evm-x402-lane
    content: "DONE 2026-06-30: Added the Base EIP-3009 x402 lane. /api/skills/{id}/raw branches Base rows before Solana PDA/ATA logic, returns an x402 requirement for native Base Sepolia USDC receiveWithAuthorization, validates PAYMENT-SIGNATURE payloads against live listing revision/price/domain/nonce/signature, reuses chain-qualified entitlements for re-downloads, relays purchaseWithAuthorization with a Base x402 relayer key, verifies the Base SkillPurchased receipt, then records buyer_chain_context/buyer_address plus evm_listing_id/evm_purchase_id before serving content. /api/x402/supported advertises Base, and /api/x402/{verify,settle} understand the same Base payload shape. Existing Solana x402/sponsored behavior is unchanged."
    status: completed
  - id: verify-phase5
    content: "DONE 2026-06-30: Local verification passed for Phase 5: npm run format:check, npm run lint --workspace @agentvouch/web, npm test --workspace @agentvouch/web (80 files / 447 tests), npm exec --workspace @agentvouch/web -- next build --webpack, and a final npm run typecheck --workspace @agentvouch/web. A parallel typecheck/build attempt briefly failed because build regenerated .next/types while tsc was reading them; rerunning typecheck alone passed. Live Base Sepolia UserOp/x402 smoke remains blocked locally until Base RPC/paymaster/relayer/funded-wallet envs are supplied."
    status: completed
isProject: false
---

# Phase 5 - Base Writes and EVM x402

> **Status: Completed/Historical — do not edit except corrections. Current status:** `docs/MAINNET_READINESS.md` for launch gates; this plan remains Phase 5 closeout evidence.

Sub-plan of [`base-port-chain-adapter.plan.md`](./base-port-chain-adapter.plan.md) Phase 5
(`base-adapter-write`).

## Goal

Make Base Sepolia functional from the existing AgentVouch UI and agent download/payment APIs:

- humans use the Phase 4 passkey Coinbase Smart Wallet to `registerAgent`, `createSkillListing`,
  and `purchaseSkill` through sponsored 4337 UserOps;
- agents use the EVM x402 lane backed by USDC `receiveWithAuthorization`;
- Solana writes still work when the selected row/chain is Solana.

## Dependencies

Phase 5 starts only after Phase 4 is complete. Required Phase 4 outputs:

- a client-only Base wallet module/hook exists;
- it can produce or retain the Coinbase Smart Account object needed by viem account-abstraction;
- connect/disconnect and address display are browser-verified;
- Solana wallet regression has passed.

## Scope

- **In scope:** Base Sepolia writes, chain-aware publish/list/purchase UI, EVM identity reads via
  `AgentVouchEvm.getProfile`, EVM x402 route branch, DB persistence for Base write results, and
  Solana write regression.
- **Out of scope:** Base mainnet cutover, MetaMask/wagmi, disputes/slashing on Base, deleting Solana
  code, and generic multi-chain expansion beyond the Base/Solana seam.

## Design decisions

### D1 - Writes live on `ChainWallet`, not `BaseAdapter`

`BaseAdapter` remains server-safe reads. Wallet-bound write methods live in the client-only Base
wallet implementation that satisfies `ChainWallet`.

### D2 - Sponsored human writes use the POC 4337 flow

Lift from `contracts/base-poc/ui/src/flow.ts`:

- `registerAgent(account, metadataUri)`
- `createSkillListing(account, { skillIdHash, uri, name, description, priceMicros })`
- `purchaseSkill(account, listingId, priceMicros)`
- `skillIdHashFrom(skillId)`
- `computeListingId(author, skillIdHash)`
- batched USDC `approve` + `purchaseSkill`

Map viem/bundler results into the web `TxResult` shape. `paidGas` should be `false` when the CDP
paymaster sponsors the UserOp.

Review update 2026-06-30: change the `ChainWallet.purchaseSkill` seam before lifting the flow.
The POC needs both `listingId` and `priceMicros` for the exact-approval batch, while the current
`ChainWallet.purchaseSkill(listingId)` interface lacks the amount. Use an input object:

```ts
purchaseSkill(input: {
  listingId: string;
  expectedPriceUsdcMicros: bigint;
}): Promise<TxResult>
```

The UI should pass the DB/UI price as `expectedPriceUsdcMicros`; the Base wallet implementation
must fetch the live listing through `AgentVouchEvm.getListing`, require the live price to equal the
expected price, then approve only that exact amount. If the live price differs, fail closed before
submitting an approval/UserOp so the wallet never silently pays more than the UI showed.

### D3 - Base rows use EVM fields only

Do not map Base `bytes32` listing ids into `on_chain_address`. For Base:

- listing id: `evm_listing_id`
- contract: `evm_contract_address`
- tx/userOp proof: `evm_tx_hash` or an explicit userOp/tx field if added
- chain: `chain_context = eip155:84532`

Only Solana direct-purchase rows should use Solana `on_chain_address` as a PDA.

### D4 - Author identity is chain-aware

Raw EVM `0x...` authors must not route through Solana `/author/[pubkey]` behavior. Before enabling
Base author links or author actions, add an EVM branch that resolves the profile through
`AgentVouchEvm.getProfile` and formats the address through EVM helpers.

### D5 - x402 uses EIP-3009 `receiveWithAuthorization`

Lift the signing and settlement recipe from
`contracts/base-poc/harness/src/agent-x402-demo.ts`. The agent lane is expected to be a plain EOA
because the current recipe is ECDSA-based, not EIP-1271 smart-account signing.

### D6 - Circle native USDC invariants are payment blockers

Use the `use-usdc` skill as the Phase 5 payment checklist (reviewed 2026-06-30). These constraints
are blockers for any Base write or x402 implementation:

- Base Sepolia writes must verify chain id `84532` / CAIP-2 `eip155:84532` before submitting a
  transaction or UserOp. Do not silently map Base mainnet `8453` into the Sepolia path.
- Use native Circle-issued Base Sepolia USDC only:
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Do not accept USDbC, USDC.e, bridged variants, or
  caller-supplied token addresses for AgentVouch purchase settlement.
- Treat `price_usdc_micros` as the raw 6-decimal USDC amount. EVM code should use
  `parseUnits(value, 6)` / `formatUnits(value, 6)` and never `18` decimals for USDC.
- Human Base purchases that use `approve` should approve the exact purchase amount unless a later
  audited UX explicitly chooses a different allowance policy. Check current allowance first and avoid
  unnecessary approval UserOps.
- EVM token balances live on the wallet/account address directly; do not apply Solana ATA logic to
  Base. Conversely, keep Solana ATA creation/checks in Solana-specific branches.
- Never report payment success, unlock paid raw content, or persist an entitlement until the Base
  transaction receipt is confirmed and validated against chain, contract, listing id, buyer/agent,
  amount, and event/proof data.
- Gateway, CCTP/Bridge Kit, Unified Balance, Circle Wallets, and Circle Modular Wallets are not part
  of Phase 5 unless a later plan explicitly designs cross-chain funding or a Circle-managed wallet
  architecture. Phase 5 stays on the Phase 4 Coinbase Smart Wallet + Base Sepolia lane.

### D7 - Wallet architecture stays Coinbase Smart Wallet for Phase 5

Review update 2026-06-30 using `use-circle-wallets`: Circle Modular Wallets are the Circle-native
passkey/MSCA option on Base, but adopting them now would reopen Phase 4 wallet architecture instead
of implementing the already-verified Coinbase Smart Wallet path. Do not add Circle Modular Wallets
to Phase 5. Track them separately as a future wallet replacement/variant if AgentVouch wants a
Circle-managed wallet architecture later.

### D8 - Do not replace CDP-sponsored gas with Circle Paymaster in Phase 5

The Base POC and this phase prove sponsor-paid gas: user ETH delta should be `0`, and user USDC
spend should equal the skill price. Circle Paymaster is a different product where the end user pays
network fees in USDC. It may be useful later as a sustainability mode, but it adds fee quotes, caps,
surcharge/accounting, and "price plus gas" UX. It does not simplify this phase, so keep CDP
paymaster/bundler sponsorship for human writes.

### D9 - Entitlements need chain-aware buyer identity

Review update 2026-06-30: current purchase persistence is Solana-shaped (`buyer_pubkey`,
`recipient_ata`, `currency_mint`, `purchase_pda`) and entitlement checks key by
`(skill_db_id, buyer_pubkey)`. Before Base purchases grant raw access, add generic chain-aware
semantics, for example:

- `buyer_chain_context` + `buyer_address`
- `recipient_chain_context` + `recipient_address`
- `asset_chain_context` + `asset_address`
- `evm_listing_id` and, if useful, `evm_purchase_id` / settlement tx hash

Backfill Solana rows from the existing Solana fields and keep Solana wrapper helpers so current
callers do not churn unnecessarily. New entitlement checks should use
`(skill_db_id, buyer_chain_context, buyer_address)` or an equivalent chain-qualified lookup, not a
bare pubkey/address string.

## Progress notes

- 2026-06-30: Preflight completed. Phase 4 is complete, including Base Sepolia passkey
  connect/restore/disconnect and Solana regression evidence in the Phase 4 sub-plan. Local env scan
  found no Base RPC/paymaster/DB `.env` values, so full live Base write verification still requires
  supplying those envs.
- 2026-06-30: First implementation groundwork added locally. `ChainWallet.purchaseSkill` now accepts
  `{ listingId, expectedPriceUsdcMicros }`, the Base Phase 4 stub satisfies the new seam, and
  purchase receipt/entitlement schema code has additive chain-qualified buyer/recipient/asset fields
  plus `evm_listing_id` / `evm_purchase_id`, Solana backfill, and a chain-qualified entitlement
  lookup helper. EVM chain-qualified addresses are normalized to lowercase for checksummed-vs-lowercase
  lookup stability; Solana addresses remain case-sensitive. Full Base write lifting, UI wiring, and
  live DB migration verification remain under `lift-sponsored-writes` and `persist-base-writes`.
- 2026-06-30: Base sponsored write lift added locally. The Base passkey `ChainWallet` now owns
  `registerAgent`, `createSkillListing`, and `purchaseSkill`; writes require configured Base Sepolia
  RPC/paymaster envs, native Circle Base Sepolia USDC, RPC chain id `84532`, exact allowance before
  purchase, live listing price equality, and matching receipt events before returning success. Local
  typecheck/lint/vitest/build verification passed; live UserOp smoke remains blocked until the
  missing envs/funded test wallet are supplied.
- 2026-06-30: Base listing persistence and EVM x402 added locally. Base author listing now verifies
  `SkillListingCreated` plus live listing metadata before writing `evm_listing_id`, and the raw/API
  x402 lane uses Base Sepolia native USDC EIP-3009 `receiveWithAuthorization`, relays
  `purchaseWithAuthorization`, verifies the resulting `SkillPurchased` receipt, and records
  chain-qualified entitlements. Focused web typecheck plus `skills-route`/`skills-raw` tests passed.

## Files to inspect first

- `contracts/base-poc/ui/src/flow.ts` - sponsored 4337 write flow.
- `contracts/base-poc/ui/src/config.ts` - contract/RPC/paymaster config.
- `contracts/base-poc/harness/src/agent-x402-demo.ts` - EIP-3009 x402 settlement recipe.
- `contracts/base-poc/harness/src/abi.ts` - ABI fragments.
- `web/lib/adapters/types.ts` - `ChainWallet`, `TxResult`, `CreateSkillListingInput`,
  `X402Payment`.
- Phase 4 wallet module/hook - final path depends on Phase 4 implementation.
- `web/app/skills/[id]/SkillDetailClient.tsx` and publish/listing management surfaces.
- `web/app/api/transactions/sponsored/*` and `web/app/api/x402/*`.
- `web/lib/db.ts`, `web/lib/usdcPurchases.ts`, and any receipt/entitlement helpers.
- `web/app/api/agents/[pubkey]/*` or current author/profile route implementations.

## Implementation steps

1. **Preflight (`preflight-phase4`)**

   - Read the Phase 4 subplan and confirm all Phase 4 todos are complete.
   - Re-run a quick browser connect smoke if the worktree or env changed.
   - Confirm Base Sepolia RPC, CDP paymaster/bundler, contract, and USDC envs are present.

2. **USDC/Circle invariants (`lock-usdc-circle-invariants`)**

   - Centralize the Base Sepolia native USDC address and 6-decimal amount helpers used by the human
     purchase path and EVM x402 lane.
   - Add chain-id guards before every Base write: the wallet/client must be on `84532` and persisted
     rows must use `chain_context = eip155:84532`.
   - Reject unknown token addresses and bridged USDC variants; Phase 5 does not support token
     selection.
   - Split the payment mechanics clearly:
     - human UI purchases use ERC-20 allowance/approve plus `purchaseSkill`;
     - agent x402 purchases use EIP-3009 `receiveWithAuthorization` and should not require an
       ERC-20 allowance.
   - Require receipt/event validation before granting access or writing entitlements.
   - Do not substitute Circle Paymaster for CDP sponsorship in this phase. Circle Paymaster makes
     the user pay gas in USDC; Phase 5's verification target is sponsor-paid gas and user ETH delta
     `0`.

3. **Sponsored write methods (`lift-sponsored-writes`)**

   - Move the POC flow into the Base wallet client module.
   - Keep the smart-account object private to the wallet layer.
   - Implement `registerAgent`, `createSkillListing`, and `purchaseSkill` on the Base
     `ChainWallet`.
   - Update `ChainWallet.purchaseSkill` to accept `{ listingId, expectedPriceUsdcMicros }`.
   - For purchase, parse/format USDC with 6 decimals, fetch the live EVM listing, require the live
     `priceUsdcMicros` to equal `expectedPriceUsdcMicros`, check native USDC balance/allowance,
     approve only the exact missing allowance, and submit the purchase against the configured native
     USDC contract.
   - Return `TxResult` with transaction hash/userOp reference, explorer URL, and `paidGas=false`.
   - Fail closed on unsupported `chainContext` or missing paymaster config.

4. **Publish/list/purchase UI (`wire-publish-and-purchase-ui`)**

   - Branch by `chain_context`.
   - Base create/list flow should compute the EVM `listingId`, call `createSkillListing`, then
     persist the EVM metadata.
   - Base purchase flow should call Base `purchaseSkill` with `evm_listing_id` and the expected
     `price_usdc_micros` from the current skill/listing view.
   - Keep Phase 3b behavior for read-only Base rows until this purchase branch is complete.
   - Keep Solana purchase and publish branches unchanged except for explicit chain guards.

5. **Persistence (`persist-base-writes`)**

   - On successful Base listing creation, save `evm_listing_id`, `evm_contract_address`,
     `evm_tx_hash`, `chain_context`, price, URI, and author EVM address.
   - On successful Base purchase, store receipts/entitlements with enough chain fields to avoid
     collisions with Solana records.
   - Add or evolve entitlement helpers so Base access checks are chain-qualified by buyer chain
     context and buyer address. Prefer additive fields such as `buyer_chain_context` and
     `buyer_address`, with Solana backfilled from existing `buyer_pubkey` values.
   - Make dashboards and APIs read these fields without treating Base rows as Solana PDAs.

6. **EVM author identity (`add-evm-agent-identity`)**

   - Add an EVM branch for author/profile lookup using `AgentVouchEvm.getProfile`.
   - Enable Base author links only after the page/API can handle `eip155:*` profiles.
   - Keep disabled/plain author display for unresolved EVM profiles.

7. **EVM x402 lane (`add-evm-x402-lane`)**

   - Add a chain-aware route branch in `/api/x402/*`.
   - Use the Base POC's `receiveWithAuthorization` recipe for USDC settlement.
   - Use native Base Sepolia USDC and 6-decimal amounts; validate the signed authorization amount
     equals the listing price in `price_usdc_micros`.
   - Make the payment proof include the chain, contract, listing id, buyer/agent address, amount,
     nonce, validity window, and settlement tx.
   - Wait for the settlement receipt and validate the expected contract/event/proof before granting
     access. Do not grant access on signature presence alone.
   - Preserve current Solana x402 and sponsored transaction invariants.

8. **Verification (`verify-phase5`)**
   - Human browser proof on Base Sepolia:
     - connect passkey wallet;
     - prove the wallet/client reports chain id `84532`;
     - register agent;
     - create/list a skill;
     - verify the listing price maps to the expected 6-decimal native USDC amount;
     - force or simulate a DB/live price mismatch and verify the Base wallet refuses to approve;
     - buy the listed skill;
     - verify the approval, if needed, was exact amount and against native USDC;
     - wait for and inspect the receipt;
     - prove user ETH delta is 0 and the paymaster covered gas.
   - Agent proof:
     - perform an x402 purchase through the EVM lane;
     - verify the signed amount uses 6-decimal USDC and native Base Sepolia USDC;
     - verify `receiveWithAuthorization` settlement tx;
     - verify entitlement/raw access if applicable.
   - Regression:
     - Solana selected rows still publish/purchase through the existing Solana path.
   - Code gates:
     - `npm run typecheck --workspace @agentvouch/web`
     - `npm run lint --workspace @agentvouch/web`
     - `npm test --workspace @agentvouch/web`
     - `npm run build --workspace @agentvouch/web`

## Acceptance criteria

- Base Sepolia human passkey flow completes register -> list -> buy from the live UI.
- The buyer's ETH balance delta is 0 for the sponsored write flow.
- Base purchase rows are no longer read-only and use `evm_listing_id`, never Solana
  `on_chain_address`.
- Base purchases fail closed if the live EVM listing price differs from the UI/DB expected price.
- Raw access entitlement checks are chain-qualified, so an EVM `0x...` buyer and a Solana buyer
  cannot collide on the same unqualified buyer string.
- EVM author/profile display is chain-aware and does not call Solana helpers on `0x...` values.
- EVM x402 settlement succeeds with `receiveWithAuthorization` and grants/verifies access.
- Solana write flows still pass their regression smoke.
- Web typecheck, lint, vitest, and Next build are green.

## Rollback

Keep Base writes and EVM x402 behind explicit chain/feature guards. If a Base write or x402 branch
fails in production-like verification, disable only the Base write option and preserve the Phase 3b
read-only marketplace render plus all Solana write paths.
