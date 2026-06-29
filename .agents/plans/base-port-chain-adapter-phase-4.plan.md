---
name: base-port-chain-adapter-phase-4
overview: "Phase 4 of the Base port: add a client-only Base Sepolia ChainWallet connection using the Coinbase Smart Wallet passkey flow from contracts/base-poc, while keeping BaseAdapter server-safe/read-only and preserving the existing Solana wallet path. This is the wallet/connect phase only; Base writes and x402 settlement stay in Phase 5."
todos:
  - id: lock-wallet-boundary
    content: "Confirm the file/module boundary before coding: BaseAdapter remains server-safe reads only; all viem account-abstraction, WebAuthn, Coinbase Smart Wallet, localStorage, and wallet SDK imports live only in client modules."
    status: pending
  - id: add-base-wallet-config
    content: "Expose the minimal Base Sepolia wallet config needed by the client-only wallet layer: CAIP-2 chain_context=eip155:84532, AgentVouchEvm contract, USDC, RPC, CDP paymaster/bundler URL, and explorer helpers. Do not enable eip155:8453 mainnet."
    status: pending
  - id: lift-passkey-account
    content: "Lift/adapt contracts/base-poc/ui/src/accounts/passkey.ts into the web app as a client-only helper. Preserve user-gesture WebAuthn creation, localStorage credential persistence, and Coinbase Smart Account address stability across reloads."
    status: pending
  - id: introduce-chain-wallet-hook
    content: "Introduce or evolve useChainWallet()/useAgentVouchWallet so the UI can connect/disconnect a ChainWallet for Base Sepolia while existing Solana consumers continue to receive the same wallet shape they expect."
    status: pending
  - id: wire-wallet-ui
    content: "Wire the marketplace/header wallet controls to support selecting or connecting the Base Sepolia passkey wallet. Render the EVM smart-account address with chain-aware formatting and keep Solana connect/disconnect working."
    status: pending
  - id: verify-phase4
    content: "Verify in browser: Base passkey connect shows an EVM smart-account address, disconnect works, reload restores the same account, Solana wallet connect still works when selected. Run web typecheck, lint, tests, and npm run build --workspace @agentvouch/web."
    status: pending
isProject: false
---

# Phase 4 - Base Chain Wallet Connect

Sub-plan of [`base-port-chain-adapter.plan.md`](./base-port-chain-adapter.plan.md) Phase 4
(`base-adapter-wallet`).

## Goal

Connect a Base Sepolia wallet through the chain-aware wallet layer, using the POC-proven Coinbase
Smart Wallet passkey path, without letting wallet SDKs leak into server-safe adapter modules.

Done means a human can click the live UI, create or reuse a passkey-backed Coinbase Smart Account,
see the Base Sepolia EVM address rendered, disconnect, and still use the existing Solana wallet path
when Solana is selected.

## Scope

- **In scope:** Base Sepolia (`eip155:84532`) wallet connect/disconnect, Coinbase Smart Wallet
  passkey account creation, chain-aware wallet state, address display, and Solana wallet regression.
- **Out of scope:** Base mainnet (`eip155:8453`), MetaMask/wagmi injected wallets, writes
  (`registerAgent`, `createSkillListing`, `purchaseSkill`), x402 settlement, author page EVM profile
  resolution, and making Base the default chain.

## Design decisions

### D1 - Keep reads and wallet code split

`web/lib/adapters/base.ts` and `web/lib/adapters/index.ts` must remain safe for Server Components
and route handlers. Do not import any of these from server-safe modules:

- `viem/account-abstraction`
- browser WebAuthn helpers
- Coinbase Smart Wallet SDK helpers
- React wallet providers
- `window`, `localStorage`, or other browser-only globals

Put wallet code in a client-only module such as `web/lib/adapters/baseWallet.ts` or a
client-only hook such as `web/hooks/useChainWallet.ts`.

### D2 - Base Sepolia only

Use `eip155:84532` for this phase. The parent plan's Phase 8b mainnet cutover is blocked until
mainnet contract, RPC, USDC, and paymaster configuration exist. Do not accept or silently map
`eip155:8453` to the Sepolia adapter.

### D3 - Preserve the existing Solana context contract

`WalletContextProvider` and `useAgentVouchWallet` are already consumed across the web app. Prefer an
additive shape or an internal adapter that keeps existing Solana call sites compiling. If the hook
return type changes, update every consumer in the same phase and keep the behavior identical for
Solana.

### D4 - Passkeys require a user gesture

The POC's `createWebAuthnCredential()` opens an OS passkey prompt and must run from a click/tap
handler. Do not move account creation into render, `useEffect`, route handlers, or server actions.

## Files to inspect first

- `contracts/base-poc/ui/src/accounts/passkey.ts` - source passkey/Smart Account connector.
- `contracts/base-poc/ui/src/accounts/localKey.ts` - fallback/dev-only local account reference;
  use only if needed for tests or explicit debug mode.
- `contracts/base-poc/ui/src/config.ts` - Base Sepolia contract, USDC, RPC, and CDP config pattern.
- `web/components/WalletContextProvider.tsx` - current Solana/Phantom wallet provider.
- `web/lib/adapters/types.ts` - `ChainWallet` interface.
- `web/lib/adapters/base.ts` and `web/lib/adapters/index.ts` - server-safe read adapter boundary.
- Header/nav/purchase components that call `useAgentVouchWallet`.

## Implementation steps

1. **Boundary audit (`lock-wallet-boundary`)**
   - Grep for current `useAgentVouchWallet` consumers and categorize them as display-only,
     Solana signer use, purchase, publish, or author actions.
   - Decide whether Phase 4 introduces a new `useChainWallet()` hook or extends the existing
     provider. Record the decision in this file before coding.

2. **Client-safe config (`add-base-wallet-config`)**
   - Expose Base Sepolia client config without requiring server secrets in browser bundles.
   - Keep CDP paymaster/bundler URL handling explicit. If it must be public for the client flow,
     use a clearly named `NEXT_PUBLIC_*` env and document that this is a paymaster endpoint, not a
     private key.
   - Fail closed with a clear UI state if the required Base wallet config is missing.

3. **Passkey account helper (`lift-passkey-account`)**
   - Lift the POC passkey logic into a client-only module.
   - Use a production-localStorage namespace such as `agentvouch:base-sepolia:passkey`.
   - Return the smart-account address and signer/account object needed by Phase 5, but keep write
     methods as unsupported stubs until Phase 5.

4. **Chain-aware wallet state (`introduce-chain-wallet-hook`)**
   - Represent the active wallet as a `ChainWallet` or a narrow connected-wallet state that includes
     `chainContext`, `address`, `walletName`, `source`, `connect`, and `disconnect`.
   - Keep Solana signer APIs available to existing Solana-only flows.
   - Make effect dependencies stable/memoized to avoid repeated connect attempts or RPC spam.

5. **UI wiring (`wire-wallet-ui`)**
   - Add Base Sepolia as an explicit wallet/network option wherever the user chooses a chain.
   - Render EVM addresses through chain-aware formatting (`0x1234...abcd`), not Solana helpers.
   - Keep Phase 3b Base cards non-purchasable. The connected Base wallet should not unlock Base
     purchases until Phase 5.

6. **Verification (`verify-phase4`)**
   - Browser proof: open the app, connect Base passkey, record the smart-account address, reload,
     verify the same address restores, disconnect, and confirm Solana connect still works.
   - Code gates:
     - `npm run typecheck --workspace @agentvouch/web`
     - `npm run lint --workspace @agentvouch/web`
     - `npm test --workspace @agentvouch/web`
     - `npm run build --workspace @agentvouch/web`

## Acceptance criteria

- Base Sepolia passkey wallet connect/disconnect works in the live UI.
- The connected Base address is displayed with EVM formatting and no Solana `address()` coercion.
- Existing Solana wallet flows still connect and expose the signer shape expected by current
  Solana purchase/publish code.
- No wallet SDK or browser-only import is reachable from server-safe modules.
- Base mainnet stays disabled/rejected.
- Web typecheck, lint, vitest, and Next build are green.

## Rollback

Keep the Base wallet path behind a feature flag or chain selection branch. If passkey connect causes
runtime issues, disable the Base wallet option while leaving the read-only Phase 3b marketplace render
intact. Do not remove or rewrite the Solana wallet provider as rollback.
