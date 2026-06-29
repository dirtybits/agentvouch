---
name: base-port-chain-adapter-phase-5
overview: "Phase 5 of the Base port: implement Base Sepolia ChainWallet writes (register/list/buy) and the EVM x402 settlement lane, lifting the sponsored 4337 flow and receiveWithAuthorization recipe from contracts/base-poc. Depends on Phase 4 Base wallet connect. Solana write paths must keep working."
todos:
  - id: preflight-phase4
    content: "Confirm Phase 4 is complete: Base Sepolia passkey wallet connect/disconnect works in the UI, exposes a smart-account signer/account to the client-only wallet layer, and Solana wallet regression passed."
    status: pending
  - id: lift-sponsored-writes
    content: "Lift contracts/base-poc/ui/src/flow.ts into the client-only Base ChainWallet: registerAgent, createSkillListing, purchaseSkill, skillIdHashFrom, computeListingId, USDC approve+purchase batching, and TxResult mapping."
    status: pending
  - id: wire-publish-and-purchase-ui
    content: "Branch publish/listing/purchase UI by chain_context. Base rows use evm_listing_id/evm_contract_address/evm_tx_hash, stay away from Solana on_chain_address, and become purchasable only through the Base ChainWallet path."
    status: pending
  - id: persist-base-writes
    content: "Persist Base listing and purchase results with chain-aware fields: evm_listing_id, evm_contract_address, evm_tx_hash, chain_context, receipts, and entitlements as appropriate. Keep existing Solana persistence untouched."
    status: pending
  - id: add-evm-agent-identity
    content: "Add the EVM author/profile branch: resolve eip155:* authors via AgentVouchEvm.getProfile and only then enable chain-aware author display/pages. Do not route raw 0x authors through Solana /author/[pubkey] helpers."
    status: pending
  - id: add-evm-x402-lane
    content: "Add the EVM x402 lane in /api/x402/* using the Base POC receiveWithAuthorization/EIP-3009 recipe. Keep Solana x402/sponsored route behavior unchanged and branch by chain_context/payment_flow."
    status: pending
  - id: verify-phase5
    content: "Verify human Base Sepolia passkey register->list->buy with user ETH delta 0, agent x402 settlement via receiveWithAuthorization, Solana write regression, and web typecheck/lint/vitest/build."
    status: pending
isProject: false
---

# Phase 5 - Base Writes and EVM x402

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

2. **Sponsored write methods (`lift-sponsored-writes`)**
   - Move the POC flow into the Base wallet client module.
   - Keep the smart-account object private to the wallet layer.
   - Implement `registerAgent`, `createSkillListing`, and `purchaseSkill` on the Base
     `ChainWallet`.
   - Return `TxResult` with transaction hash/userOp reference, explorer URL, and `paidGas=false`.
   - Fail closed on unsupported `chainContext` or missing paymaster config.

3. **Publish/list/purchase UI (`wire-publish-and-purchase-ui`)**
   - Branch by `chain_context`.
   - Base create/list flow should compute the EVM `listingId`, call `createSkillListing`, then
     persist the EVM metadata.
   - Base purchase flow should call Base `purchaseSkill` with `evm_listing_id`.
   - Keep Phase 3b behavior for read-only Base rows until this purchase branch is complete.
   - Keep Solana purchase and publish branches unchanged except for explicit chain guards.

4. **Persistence (`persist-base-writes`)**
   - On successful Base listing creation, save `evm_listing_id`, `evm_contract_address`,
     `evm_tx_hash`, `chain_context`, price, URI, and author EVM address.
   - On successful Base purchase, store receipts/entitlements with enough chain fields to avoid
     collisions with Solana records.
   - Make dashboards and APIs read these fields without treating Base rows as Solana PDAs.

5. **EVM author identity (`add-evm-agent-identity`)**
   - Add an EVM branch for author/profile lookup using `AgentVouchEvm.getProfile`.
   - Enable Base author links only after the page/API can handle `eip155:*` profiles.
   - Keep disabled/plain author display for unresolved EVM profiles.

6. **EVM x402 lane (`add-evm-x402-lane`)**
   - Add a chain-aware route branch in `/api/x402/*`.
   - Use the Base POC's `receiveWithAuthorization` recipe for USDC settlement.
   - Make the payment proof include the chain, contract, listing id, buyer/agent address, amount,
     nonce, validity window, and settlement tx.
   - Preserve current Solana x402 and sponsored transaction invariants.

7. **Verification (`verify-phase5`)**
   - Human browser proof on Base Sepolia:
     - connect passkey wallet;
     - register agent;
     - create/list a skill;
     - buy the listed skill;
     - prove user ETH delta is 0 and the paymaster covered gas.
   - Agent proof:
     - perform an x402 purchase through the EVM lane;
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
- EVM author/profile display is chain-aware and does not call Solana helpers on `0x...` values.
- EVM x402 settlement succeeds with `receiveWithAuthorization` and grants/verifies access.
- Solana write flows still pass their regression smoke.
- Web typecheck, lint, vitest, and Next build are green.

## Rollback

Keep Base writes and EVM x402 behind explicit chain/feature guards. If a Base write or x402 branch
fails in production-like verification, disable only the Base write option and preserve the Phase 3b
read-only marketplace render plus all Solana write paths.
