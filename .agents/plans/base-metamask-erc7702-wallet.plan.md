---
name: base-metamask-erc7702-wallet
overview: "Add MetaMask and ERC-7702-capable Base Sepolia buyer support behind the existing ChainWallet seam so Phase 8/9 smokes can use an independent EVM wallet without changing the AgentVouch contract or enabling Base mainnet."
todos:
  - id: map-current-base-wallet-seams
    content: Audit the current Coinbase Smart Wallet Base path, ChainWallet interfaces, and purchase/download call sites; record the exact split between shared Base logic and wallet-specific execution.
    status: pending
  - id: add-injected-base-wallet-provider
    content: Add MetaMask/injected EIP-1193 detection, connect, disconnect, chain switching, address restore, and wallet-menu UI alongside Coinbase Smart Wallet.
    status: pending
  - id: refactor-base-wallet-execution
    content: Extract shared Base register/list/purchase helpers so Coinbase Smart Wallet keeps UserOp batching while MetaMask can use ERC-7702 when available and approve-then-purchase fallback otherwise.
    status: pending
  - id: implement-metamask-buyer-flow
    content: Implement MetaMask Base Sepolia purchase, entitlement detection, signed raw download, friendly duplicate/already-purchased errors, and expected-price guard preservation.
    status: pending
  - id: cover-wallet-isolation-tests
    content: Add or update tests proving Coinbase, MetaMask, and Solana wallet paths stay isolated and Base code does not import Solana write/x402-only seams.
    status: pending
  - id: run-live-smokes
    content: Browser-smoke MetaMask as a distinct Base Sepolia buyer, confirm DB receipt/entitlement rows, unsigned raw 402, signed download success, and Coinbase/Solana regressions.
    status: pending
  - id: verify-and-close
    content: Run format, lint/typecheck/vitest/build gates per AGENTS.md, update phase smoke evidence, and document any ERC-7702 capability gaps discovered.
    status: pending
isProject: false
---

# Base MetaMask / ERC-7702 Wallet Plan

## Goal

Add MetaMask as a first-class Base Sepolia wallet for AgentVouch and make the Base purchase path
ERC-7702-aware where the wallet exposes that capability. The practical outcome is a better smoke
surface for Phase 8/9: Coinbase Smart Wallet can remain the author/current buyer path, while
MetaMask can act as a distinct EVM buyer for purchase, entitlement, and signed-download tests.

This is **not** a Base mainnet cutover and not an AgentVouch contract migration. Verified
2026-07-06: the current Base human wallet path is Coinbase Smart Wallet-specific, builds a
`SmartAccount`, and batches USDC `approve` plus `purchaseSkill` through `sendBaseUserOperation` in
`web/lib/adapters/baseWallet.ts`.

## Scope

In scope:

- Add injected EIP-1193 / MetaMask support for Base Sepolia (`eip155:84532`) alongside Coinbase
  Smart Wallet.
- Preserve Coinbase Smart Wallet passkey behavior and CDP/UserOp batching.
- Preserve Phantom/Solana behavior and rollback/default-chain behavior.
- Keep MetaMask writes pinned to Base Sepolia; reject Base mainnet (`eip155:8453`) until the Phase 10
  gate passes.
- Implement a MetaMask buyer flow:
  - connect/switch to Base Sepolia;
  - show address, copy affordance, disconnect, and USDC balance in the existing wallet menu style;
  - buy a paid Base skill;
  - detect existing entitlement and render `Purchased` plus `Sign & Download`;
  - sign the raw-download proof and download the skill;
  - show friendly duplicate/already-purchased and pending-receipt messages.
- Use ERC-7702 only as an optional execution improvement. If unavailable, MetaMask must fall back to
  ordinary EOA `approve` then `purchaseSkill`.

Out of scope:

- Enabling Base mainnet (`eip155:8453`).
- Changing `contracts/base-poc/src/AgentVouchEvm.sol` unless a hard blocker is proven and approved.
- Replacing Coinbase Smart Wallet.
- Adding broad multi-EVM support.
- x402 agent settlement fixes; those remain in the Phase 9 plan unless this implementation directly
  uncovers a shared Base wallet bug.

## Files To Inspect / Likely Change

- `web/lib/adapters/types.ts`
  - Keep `ChainWallet` as the UI-facing write seam. Add capability metadata only if the UI needs to
    distinguish wallet execution mode.
- `web/lib/adapters/baseWallet.ts`
  - Preserve Coinbase passkey functions:
    `createBasePasskeyAccount`, `createBasePasskeyChainWallet`, `purchaseBaseSkill`.
  - Extract shared pure helpers for Base Sepolia config, listing fetch, price/balance/allowance
    checks, receipt parsing, duplicate purchase detection, and user-facing error normalization.
  - Add a MetaMask/injected implementation that returns a `ChainWallet`.
- `web/lib/adapters/baseWalletConfig.ts`
  - Reuse existing Base Sepolia constants and env validation. Do not add `eip155:8453` paths.
- `web/components/WalletContextProvider.tsx`
  - Add injected Base wallet state next to `BasePasskeyWalletContextValue`, or generalize the Base
    context to support more than one Base wallet source.
  - Preserve the single-active-wallet restore guard against Base/Solana collisions.
- `web/components/ClientWalletButton.tsx`
  - Add a MetaMask option under the Base Sepolia connect section when an injected provider is
    present.
  - Keep Coinbase Smart Wallet visible and unchanged.
  - Keep wallet-menu controls consistent with the existing address/copy/USDC balance treatment.
- `web/hooks/useWritableChainWallet.ts`
  - Ensure it returns the active Base `ChainWallet` regardless of whether the Base source is
    Coinbase Smart Wallet or MetaMask.
- `web/app/skills/[id]/SkillDetailClient.tsx`
  - Confirm no wallet-specific assumptions remain around Base purchase, duplicate purchase, and
    signed raw download.
- `web/app/skills/publish/page.tsx`
  - Keep Base author publish/listing behavior working with Coinbase. MetaMask author support is
    acceptable if it falls out of the shared seam, but buyer smoke is the primary acceptance path.
- `web/__tests__/lib/phase2-circleback.test.ts`
  - Extend source guards if new Base files are added.
- `web/__tests__/lib/phase8-default-chain.test.ts`
  - Extend wallet/default-chain assertions for the injected Base option.
- Add focused tests near existing Base wallet tests if present, or under `web/__tests__/lib/`.

## Implementation Steps

1. Map the current wallet seams.

   Run:

   ```bash
   rg -n "BasePasskey|createBasePasskey|purchaseBaseSkill|sendBaseUserOperation|useWritableChainWallet|useChainWallet|BASE_PASSKEY|MetaMask|ethereum|wallet_switchEthereumChain|7702" web/components web/hooks web/lib web/app web/__tests__
   ```

   Record whether each hit is:

   - shared Base behavior;
   - Coinbase Smart Wallet-only behavior;
   - UI selection/restoration behavior;
   - Solana-only behavior that must not move.

2. Add injected provider detection.

   - Detect `window.ethereum` and EIP-6963 providers if the repo already has a helper pattern; if
     not, start with conservative MetaMask detection through the injected provider and keep the API
     small.
   - Prefer a named MetaMask provider when multiple injected providers exist.
   - Require Base Sepolia:
     - request accounts;
     - verify `chainId === 0x14a34`;
     - call `wallet_switchEthereumChain` or `wallet_addEthereumChain` for Base Sepolia when needed.
   - Store only enough local state to restore the selected injected wallet source. Do not persist
     secrets.

3. Refactor Base execution without changing contract semantics.

   - Keep Coinbase Smart Wallet using the current smart-account UserOp path and batched calls.
   - Move shared validation into wallet-agnostic helpers:
     - `requireBaseWriteConfig`;
     - `fetchLiveListing`;
     - expected-price check;
     - USDC balance and allowance reads;
     - `SkillPurchased` receipt parsing;
     - `DuplicatePurchase()` handling.
   - For MetaMask fallback:
     - if allowance is non-zero and not equal to price, send `approve(spender, 0)`;
     - send `approve(spender, price)` when allowance is insufficient or stale;
     - send `purchaseSkill(listingId)`;
     - wait for receipts and verify events after each write that matters.
   - For ERC-7702:
     - probe capability explicitly and log/store the detected mode for debugging;
     - use it only when MetaMask exposes a supported, reviewed path for Base Sepolia;
     - keep the ordinary approve-then-purchase fallback mandatory.

4. Bind MetaMask to `ChainWallet`.

   The MetaMask ChainWallet must provide:

   - `chainContext = BASE_SEPOLIA_CHAIN_CONTEXT`;
   - lowercased storage-safe `address` at API boundaries and display formatting only in UI;
   - `disconnect`;
   - `signMessage` compatible with server-side EVM auth verification in `web/lib/evmAuth.ts`;
   - `purchaseSkill`.

   `registerAgent` and `createSkillListing` may either work through the same injected wallet or
   return a clear unsupported error if buyer smoke is intentionally first. Do not silently route
   MetaMask author writes through Coinbase.

5. Update the wallet UI.

   - Base section should show both:
     - Coinbase Smart Wallet;
     - MetaMask, when detected.
   - Disabled/unavailable states should explain missing provider or wrong network in plain product
     language.
   - Connected MetaMask should reuse the existing compact wallet menu pattern:
     - full address click/copy;
     - copy icon;
     - USDC balance;
     - disconnect.

6. Preserve purchase and download UX honesty.

   - `DuplicatePurchase()` should become an entitled state, not a raw viem error.
   - Pending receipt errors should say the transaction is still indexing and invite retry/refresh.
   - Already-purchased Base listings should render `Purchased` and `Sign & Download`.
   - Non-buyers should still receive a 402/x402 response from the raw endpoint.

## ERC-7702 Notes

Treat ERC-7702 as a capability path, not a protocol dependency.

- If MetaMask supports the needed delegation/batching flow on Base Sepolia, use it to collapse the
  buyer experience where possible.
- If the wallet, chain, or RPC rejects the capability, fall back without changing user-visible
  correctness.
- Do not require ERC-7702 to pass the smoke. The acceptance path is: MetaMask can buy and download;
  ERC-7702 support is an enhancement with evidence recorded in the plan closeout.

## Verification

Local code gates:

```bash
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm test --workspace @agentvouch/web -- --run
npm exec --workspace @agentvouch/web -- next build --webpack
```

Use the Node 24 PATH prefix if the shell picks an older Node:

```bash
export PATH="$HOME/.nvm/versions/node/v24.1.0/bin:$PATH"
```

Targeted tests to add or extend:

- MetaMask/injected provider detection chooses Base Sepolia and rejects Base mainnet.
- `useWritableChainWallet()` returns the active Base wallet for Coinbase or MetaMask.
- Coinbase Smart Wallet remains the first Base option under the current default unless the design
  intentionally changes that order.
- Solana rollback/default-chain tests still pass.
- Base source guards still prevent imports from Solana-only write/x402 modules.
- Duplicate purchase and pending receipt errors normalize to product-safe messages.

Live browser smoke acceptance:

- Coinbase Smart Wallet still connects and shows the current Base wallet menu.
- MetaMask connects on Base Sepolia as a different buyer than the Coinbase author/current buyer.
- MetaMask buyer USDC balance is shown.
- MetaMask buyer purchases an existing paid Base listing.
- DB confirms:
  - `usdc_purchase_receipts.buyer_chain_context = eip155:84532`;
  - `usdc_purchase_receipts.payment_flow` is the Base direct-purchase flow;
  - `usdc_purchase_entitlements.asset_chain_context = eip155:84532`;
  - buyer address is the MetaMask address, lowercased at storage boundaries.
- Unsigned raw content request returns HTTP 402 for a non-buyer.
- Signed raw download succeeds for the MetaMask buyer.
- Coinbase Smart Wallet buyer still sees existing purchased state.
- Solana/Phantom connect and trust display still work on a Solana row.

## Rollout

- Ship on a feature branch first; do not merge into Phase 8/9 until local gates and at least one
  MetaMask live smoke pass.
- Keep Coinbase Smart Wallet visible while MetaMask is introduced.
- Keep Base Sepolia as the only EVM write chain.
- Update the Phase 9 smoke evidence with:
  - MetaMask address;
  - purchase tx hash;
  - receipt/entitlement row ids;
  - signed download result;
  - whether ERC-7702 path was used or fallback path was used.

## Rollback

- If MetaMask introduces instability, hide only the MetaMask connect option and keep Coinbase Smart
  Wallet behavior intact.
- Do not change the Phase 8 default-chain rollback. If a wider Base issue is found, use the existing
  rollback path: set `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana` and redeploy.
- If ERC-7702 probing is unstable, disable the ERC-7702 execution branch and retain standard
  approve-then-purchase.
- Revert the feature branch or PR if tests show Solana write/import isolation regressed.

## Blockers / Open Questions

- Which MetaMask ERC-7702 API is available in the target browser/channel on Base Sepolia as of the
  implementation date? Verify from runtime behavior and official MetaMask docs before relying on it.
- Does the selected Base Sepolia RPC support the receipt/log range needed for post-purchase
  verification? Use `https://sepolia.base.org` in `<=1,999` block chunks for recovery if the local
  publicnode endpoint rejects archive-style log scans.
- Is MetaMask expected to support author publish/listing in this phase, or only buyer purchase?
  Recommendation: implement buyer first and allow author support only if the shared seam makes it
  low-risk.
- If MetaMask returns multiple injected providers, the implementation must avoid accidentally
  selecting Coinbase Wallet extension when the user asked for MetaMask.
