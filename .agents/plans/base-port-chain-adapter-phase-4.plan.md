---
name: base-port-chain-adapter-phase-4
overview: "Phase 4 of the Base port: add a client-only Base Sepolia ChainWallet connection using the Coinbase Smart Wallet passkey flow from contracts/base-poc, while keeping BaseAdapter server-safe/read-only and preserving the existing Solana wallet path. This is the wallet/connect phase only; Base writes and x402 settlement stay in Phase 5."
todos:
  - id: lock-wallet-boundary
    content: "DONE 2026-06-30: boundary locked. BaseAdapter remains server-safe reads only; Base wallet code lives in client-only baseWallet/baseWalletConfig modules plus an additive provider context. useAgentVouchWallet stays Solana-compatible; useChainWallet exposes the new chain-aware surface."
    status: completed
  - id: add-base-wallet-config
    content: "DONE 2026-06-30: added client-only Base Sepolia wallet config for eip155:84532, AgentVouchEvm, USDC, RPC, optional public CDP paymaster/bundler URL, explorer helpers, and EVM address shortening. eip155:8453 mainnet remains disabled."
    status: completed
  - id: lift-passkey-account
    content: "DONE 2026-06-30: added client-only Base passkey helper that creates Coinbase Smart Wallet accounts from a user-gesture WebAuthn prompt, persists the credential under agentvouch:base-sepolia:passkey, and restores the same smart-account address across reloads."
    status: completed
  - id: introduce-chain-wallet-hook
    content: "DONE 2026-06-30: added useChainWallet()/useBasePasskeyWallet contexts. The Base ChainWallet exposes address/chainContext plus Phase-5-guarded write stubs; existing Solana consumers continue to use the unchanged useAgentVouchWallet shape."
    status: completed
  - id: wire-wallet-ui
    content: "DONE 2026-06-30: wired the header wallet menu with an explicit Base Sepolia Coinbase Smart Wallet passkey option, EVM address formatting, Base disconnect, and unchanged Solana wallet options."
    status: completed
  - id: verify-phase4
    content: "DONE 2026-06-30: browser proof with Chrome virtual WebAuthn connected Base passkey address 0x8C01...4906, reload restored the same address, disconnect cleared it, and the Solana/Base connect menu remained available. Typecheck, lint, vitest, and web build passed."
    status: completed
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

**Implementation decision (2026-06-30):** Phase 4 keeps `useAgentVouchWallet()` Solana-compatible and
adds parallel `useBasePasskeyWallet()` / `useChainWallet()` contexts from the same provider. The Base
session is client-only, exposes a `ChainWallet` with Phase-5-guarded write stubs, and does not change
Solana signer behavior.

**Restore note (2026-06-30):** The Base passkey restore effect intentionally has no one-shot ref
guard. React Strict Mode in local dev runs mount effects twice; a guard can cancel the first async
restore during cleanup and then skip the second run, leaving a valid active passkey disconnected
after reload.

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
