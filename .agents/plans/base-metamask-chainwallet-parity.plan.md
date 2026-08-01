---
name: base-metamask-chainwallet-parity
overview: "Give a MetaMask-controlled Base Sepolia identity functional parity with the Coinbase Smart Wallet across the existing human-facing ChainWallet operations, while preserving Coinbase sponsorship, Base mainnet rejection, and wallet-specific ownership boundaries."
todos:
  - id: confirm-current-parity-matrix
    content: Audit current Coinbase and MetaMask ChainWallet methods, UI call sites, API auth, tests, and live-deployment constraints.
    status: completed
  - id: implement-injected-listing-lifecycle
    content: Add MetaMask create, update, and remove listing transactions with Base Sepolia guards and strict receipt-event validation.
    status: completed
  - id: implement-injected-trust-writes
    content: Add MetaMask author-bond, vouch/revoke, voucher-revenue, and author-proceeds writes with exact sequential USDC approvals where required.
    status: completed
  - id: remove-coinbase-only-ui-gates
    content: Allow the existing source-agnostic Base trust UI to use MetaMask and replace obsolete Coinbase-only guidance without changing unsupported general-report behavior.
    status: completed
  - id: add-behavioral-coverage
    content: Replace unsupported-stub assertions with behavioral MetaMask transaction, approval, validation, and wallet-isolation tests.
    status: completed
  - id: refresh-wallet-status-docs
    content: Supersede the stale follow-up in the historical buyer plan and correct current wallet-capability documentation without changing deployment-readiness claims.
    status: completed
  - id: run-local-gates
    content: Run targeted Vitest, format, web lint, web typecheck, full web Vitest, chain-map verification, and the webpack production build under Node 24.
    status: completed
  - id: run-live-wallet-smokes
    content: Human-smoke Coinbase and MetaMask on Base Sepolia for registration, listing lifecycle, stake, vouch/revoke, purchase/download, and claims; record transaction hashes and exact ETH/USDC deltas.
    status: pending
isProject: false
---

# Base MetaMask ChainWallet Parity

## Goal

Make MetaMask a first-class Base Sepolia wallet for every human-facing operation currently available
through the Coinbase Smart Wallet `ChainWallet`, using the connected MetaMask identity as the actual
on-chain owner and signer. Functional parity means equivalent protocol outcomes; it does not mean
matching Coinbase's sponsored gas or atomic UserOperation UX.

Pre-implementation baseline verified 2026-07-31: MetaMask already supported connection/session
lifecycle, EOA message signing, agent registration, paid skill purchase, entitlement/download,
paid-purchase reports, and report credit claims. The remaining adapter stubs were listing
create/update/remove, author-bond deposit/withdrawal, vouch/revoke, voucher-revenue claim, and
author-proceeds withdrawal.

## Scope

In scope:

- Base Sepolia (`eip155:84532`) only.
- Implement every remaining MetaMask method already present on `ChainWallet` that Coinbase supports.
- Reuse existing Base config, ABI, listing identifiers, exact-allowance planning, receipt waiting,
  and event validation.
- Keep EOA USDC-pull operations safe when approval and protocol calls are separate transactions:
  exact approval, zero-reset when stale, wait for each approval receipt, re-simulate the protocol
  action after approval, and explain residual-allowance recovery on action failure.
- Remove the author-page Coinbase-only vouch restriction after the injected methods work.
- Add behavioral tests that exercise the injected transaction sequence and failure checks.
- Preserve Coinbase and Phantom behavior.

Out of scope:

- Base mainnet (`eip155:8453`) or weakening any mainnet rejection.
- Transferring listings, stake, vouches, or identity from an existing Coinbase smart-account address
  to MetaMask. Contract ownership remains bound to the original address.
- Matching Coinbase paymaster sponsorship or atomic batching. MetaMask ERC-7702/EIP-5792 execution
  remains a separate reviewed enhancement; ordinary EOA transactions are the acceptance path.
- General Base author reports, which are unavailable for Coinbase as well after base-v1-a1.
- Human-wallet x402 construction, resolver/admin/crank/pause operations, deployment, or flag changes.
- Activating paid reports on the live Base Sepolia deployment; that remains owned by
  `base-paid-report-activation-sepolia.plan.md`.

## Files To Change

- `web/lib/adapters/baseInjectedWallet.ts`
  - Replace listing and trust/economic stubs with injected EOA implementations.
  - Use the shared `AGENTVOUCH_EVM_WRITE_ABI`, `skillIdHashFrom`, `computeListingId`, and receipt
    event decoder.
  - Centralize exact sequential USDC approval and result construction.
  - Keep provider access client-only and preserve the explicit Base-mainnet rejection.
- `web/lib/adapters/baseWallet.ts`
  - Export only already-shared constants/helpers needed to keep Coinbase and MetaMask validation
    identical; do not alter Coinbase execution semantics.
- `web/components/WalletContextProvider.tsx`
  - Prefer the authoritative EIP-6963 MetaMask announcement over legacy compatibility providers
    when multiple wallet extensions are installed.
- `web/app/author/[pubkey]/page.tsx`
  - Permit `metamask-injected` for Base vouching once the method is implemented and update copy.
- `web/__tests__/lib/baseInjectedWallet.test.ts`
  - Replace unsupported-write assertions with injected transaction behavior and validation tests.
- `web/__tests__/app/author-page-source.test.ts`
  - Replace the Coinbase-only vouch invariant with a Base trust-wallet invariant.
- `.agents/plans/base-metamask-erc7702-wallet.plan.md`
  - Mark its stale author-write follow-up completed as superseded by this plan.
- `docs/MAINNET_READINESS.md` and `docs/CHAIN_CAPABILITY_MAP.md`
  - Correct source-level wallet support while leaving live deployment and mainnet gate status honest.

## Implementation Steps

1. Add tests for injected call encoding, strict receipt matching, exact approval/reset order,
   insufficient amounts, invalid addresses/listing ids, wrong-chain rejection, and failed receipts.
2. Implement listing create/update/remove with one EOA transaction each and the same event invariants
   as the Coinbase backend.
3. Implement a reusable MetaMask USDC-pull path for author bond deposits and vouches:
   read balance/allowance, compute exact approvals, wait for each approval, re-simulate, submit, and
   validate the protocol event.
4. Implement direct withdrawals/revocation/claims with input validation and receipt-event checks.
5. Remove the Coinbase-source UI gate for Base vouching; keep all wallet/source arbitration intact.
6. Update stale plan/docs claims, then run targeted and full verification.

## Verification

Run under the Node 24 release selected from `.nvmrc`:

```bash
npm exec --workspace @agentvouch/web -- vitest run __tests__/lib/baseInjectedWallet.test.ts __tests__/app/author-page-source.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm run verify:chain-map
npm exec --workspace @agentvouch/web -- next build --webpack
```

Behavioral acceptance:

- Coinbase and MetaMask remain separately selectable and restorable.
- MetaMask can register, publish/list, update, and remove its own Base listing.
- MetaMask can deposit/withdraw self-stake, vouch/revoke, and claim available voucher revenue.
- MetaMask can withdraw available author proceeds through the adapter when a caller exposes it.
- Every USDC-pull write uses an exact allowance and safely handles a stale non-zero allowance.
- Each method rejects a mismatched receipt event instead of reporting success.
- Base mainnet is still rejected before any transaction request.
- Coinbase purchase/trust behavior and Solana seam-isolation tests remain green.

Live smoke evidence must include both wallet sources, starting/final Base Sepolia ETH and USDC,
every approval/action transaction hash, decoded event identity, DB evidence where applicable, and
cancel/retry behavior. A local code gate does not close the live-smoke todo.

## Rollout

- Ship as one feature branch/PR from current `main`.
- Keep Coinbase Smart Wallet visible and unchanged.
- Treat MetaMask functional parity as source-complete only until the live Base Sepolia deployment
  supports the exercised operation and the human wallet smoke passes.
- Do not change paid-report flags, contract pointers, custody, or deployment state in this plan.

## Implementation Closeout (2026-07-31)

- Implemented the remaining MetaMask listing and trust/economic methods without expanding
  `ChainWallet` or changing Coinbase execution.
- Added exact sequential approval handling, post-approval simulation, receipt-event validation,
  and residual-allowance recovery guidance for EOA USDC-pull actions.
- An adversarial review found and verified fixes for two blockers before closeout:
  - generic trust writes now decode `getProfile` through the legacy-compatible ABI while the
    paid-report path retains the A1 ABI;
  - EVM-author vouches now stop on any non-Base wallet instead of falling into Solana routing.
- A guided browser smoke found a third multi-wallet blocker: the first legacy `isMetaMask`
  compatibility provider could remain selected even after the real `io.metamask` EIP-6963
  announcement arrived. The authoritative provider now replaces the legacy candidate, with a
  behavioral regression test.
- Verification under bundled Node `v24.14.0`:
  - targeted injected-wallet suite: 1 file / 18 tests passed after the live-smoke fix;
  - full web Vitest after merging current `main`: 123 files / 874 tests passed;
  - format, web lint, web typecheck, and `verify:chain-map` passed;
  - webpack production build passed. It emitted the existing viem Tempo dynamic-import warning and
    expected offline Neon/Helius fallback warnings during static generation.
- Live attempt 2026-07-31: MetaMask connected and restored as
  `0xB8aadc330247c7887B97f9Ce23691Cf196E689e8` against the selected pre-A1 deployment
  `0x5992dD52Ee2015f558D0A690777C55e27b05B7d1` (`base-v1-candidate`). At Base Sepolia block
  `44880771`, the account had exactly `0 ETH`, `0 USDC`, no registration, no author bond, and no
  contract allowance. No transaction was requested or sent. Full MetaMask and Coinbase live
  lifecycle smokes remain pending a funded test wallet; deployment-missing selectors remain a
  separate recorded constraint. No flag, deployment, persistent environment file, or deployed
  contract pointer was changed.

## Rollback

- Revert the injected method bindings and restore the MetaMask-only UI gate; Coinbase remains the
  existing Base write path.
- If only one MetaMask operation is unstable, restore that operation's explicit unsupported error
  without changing wallet connection or buyer purchase/download support.
- Wider Base rollback remains `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana` plus redeploy.

## Blockers and Decisions

- Decision 2026-07-31: parity is for a MetaMask-controlled identity. Existing Coinbase-owned assets
  cannot be managed by MetaMask without a separate contract authority-transfer/delegation design.
- Decision 2026-07-31: user-paid sequential EOA transactions satisfy functional parity; sponsored
  atomic MetaMask execution is not required.
- Blocker for live closure: the current Base Sepolia deployment is pre-A1 for some merged source
  capabilities. Do not claim live support for an operation the configured contract cannot execute.
- Blocker for live smokes: wallet confirmations and test ETH/USDC are required; never automate or
  bypass the user's MetaMask approval prompts.
