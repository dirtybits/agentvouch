---
name: base-port-chain-adapter
overview: "Port agentvouch.xyz (web/) from Solana to Base/EVM by introducing a ChainAdapter seam UNDER the existing UI — no rebuild. Extract today's Solana logic behind a SolanaAdapter, add a BaseAdapter that lifts the proven contracts/base-poc viem code, make Base canonical, keep Solana dormant behind the seam. Chain coupling is concentrated (~50 of ~375 files, ~6 modules; mapped 2026-06-23); the UI, routes, and DB schema stay."
todos:
  - id: define-chainadapter
    content: "Define the ChainAdapter interface + shared view types in web/lib/chains/adapter.ts and a getAdapter(chainContext) registry. No behavior change yet."
    status: pending
  - id: extract-solana-adapter
    content: "Implement SolanaAdapter by moving existing logic (onchain.ts, sponsoredPurchase.ts, useMarketplaceOracle.ts, browserX402.ts, x402ProtocolBridge.ts, WalletContextProvider.tsx) behind the interface. UI/hooks call the adapter, not @solana/* directly. Verify the Solana flow is unchanged."
    status: pending
  - id: base-adapter-readslice
    content: "Vertical slice: implement BaseAdapter reads (viem publicClient + getListing/getProfile against AgentVouchEvm) and render one Base listing in the real UI, selected by chain_context. Proves the seam end-to-end before refactoring everything."
    status: pending
  - id: base-adapter-wallet
    content: "Add EVM wallet connection into a chain-aware useAgentVouchWallet: Coinbase Smart Wallet passkey (lift contracts/base-poc/ui/src/accounts/passkey.ts) + wagmi/MetaMask. Pick provider stack here (see Open questions)."
    status: pending
  - id: base-adapter-write
    content: "Implement BaseAdapter writes (register/list/buy) by lifting contracts/base-poc/ui/src/flow.ts (sponsored 4337 UserOps). Wire EVM x402 receiveWithAuthorization (Lane B) into /api/transactions/sponsored/* and /api/x402/*."
    status: pending
  - id: db-multichain
    content: "Extend the Postgres schema for EVM alongside Solana: contract address + tx hash columns keyed by chain_context (generalize on_chain_address / tx_signature, or add evm_* columns). Guard reads/writes by chain_context."
    status: pending
  - id: address-type-sweep
    content: "Replace @solana/kit Address (base58/PDA) assumptions with a chain-tagged address type + per-chain explorer helpers across the ~50 touched files. Mostly mechanical."
    status: pending
  - id: make-base-canonical
    content: "Flip the default chain_context to Base (web/lib/chains.ts getConfiguredChainContext). Keep SolanaAdapter registered but dormant behind the seam / a flag."
    status: pending
  - id: verify-e2e
    content: "E2E on Base (passkey register->list->buy gas-free; agent x402 purchase) + regression that the Solana adapter still works when selected. forge (contracts job) + web format/lint/typecheck/vitest green; Vercel build green."
    status: pending
isProject: false
---

# Solana → Base Port via a ChainAdapter Seam

## Decision (2026-06-23)

Base becomes the **canonical** chain; Solana is **demoted, not deleted** — `SolanaAdapter`
stays registered but dormant behind the seam. This is **NOT** a from-scratch rebuild and
**NOT** permanent multi-chain.

Rationale (architecture map, verified 2026-06-23): chain coupling in `web/` is concentrated
— ~50 of ~375 files, real logic in ~6 modules — so a seam-swap keeps the entire UI, routing,
and DB schema, and lets the already-built `contracts/base-poc` code become the Base adapter's
engine. Multi-chain-forever was rejected: two wallet stacks + two settlement paths is
permanent overhead for a pre-PMF product. Revisit only if real demand for both chains appears.
The default-chain flip is the reversible on/off switch (see Rollback).

## Goal

The same agentvouch.xyz UI, serving Base listings by default: passkey/4337 gas-free
register → list → buy for humans, x402/EIP-3009 for agents — with the Solana code path intact
but off by default.

## Scope

- **In scope:** a `ChainAdapter` interface; `SolanaAdapter` (extraction, not rewrite);
  `BaseAdapter` (new, lifting `contracts/base-poc`); EVM wallet connection; DB multi-chain
  columns; address-type generalization; flip the default to Base.
- **Out of scope:** UI redesign (keep it as-is — it is chain-agnostic), disputes/slashing
  (Phase 5-7, still deferred — see [[mvp-ship-minimal-bias]]), deleting Solana code, archiving
  `web/`.

## What already exists to build on

- **Multi-chain seam is half-stubbed:** `web/lib/chains.ts` already defines `base`
  (`eip155:8453`) and the `skills` table already has a `chain_context` column — both used
  only for display/config today. Make them load-bearing.
- **Fixed Base contract:** `AgentVouchEvm` at
  `0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854` (Base Sepolia, F-1-fixed — Lane B uses
  `receiveWithAuthorization`). Mirrors the Solana core economics (60/40 split, USDC micros).
  See [[base-poc-gasfree-spike]].
- **The BaseAdapter's engine already exists** in `contracts/base-poc` — lift, don't rewrite:
  - `contracts/base-poc/ui/src/flow.ts` — register / list / buy as sponsored 4337 UserOps
    (the `listingId`/`skillIdHash` calc + ABI calls).
  - `contracts/base-poc/ui/src/accounts/*` — local-key + Coinbase Smart Wallet passkey connectors.
  - `contracts/base-poc/harness/src/agent-x402-demo.ts` — x402 `receiveWithAuthorization`
    settlement (Lane B), with the exact EIP-712 signing recipe.
  - `contracts/base-poc/harness/src/abi.ts` — AgentVouchEvm ABI fragments.

## The coupling map — what swaps (verified 2026-06-23)

| File / area | Today (Solana) | After (behind the adapter) |
|---|---|---|
| `web/components/WalletContextProvider.tsx` + exported `useAgentVouchWallet` | ConnectorKit / Phantom, hardcoded Solana | chain-aware provider; EVM via wagmi + Coinbase Smart Wallet / passkey |
| `web/lib/onchain.ts` | `getProgramAccounts` browser reads | `SolanaAdapter.listListings`; `BaseAdapter` uses viem `getListing` |
| `web/lib/sponsoredPurchase.ts`, `web/hooks/useMarketplaceOracle.ts` | Solana instructions + PDAs | `adapter.purchaseSkill` (Base lifts `flow.ts`) |
| `web/lib/browserX402.ts`, `web/lib/x402ProtocolBridge.ts`, `/api/x402/*`, `/api/transactions/sponsored/*` | Solana sponsored / x402 | EVM Lane B `receiveWithAuthorization` |
| address handling (`@solana/kit` `Address`, base58, PDAs), explorer URLs | Solana-only | chain-tagged address type + per-chain explorer helpers |

**Chain-agnostic — unchanged:** all routes/pages, the 27 components, styling, copy, the
Postgres schema (extend, not replace), GitHub OAuth, search/indexing, markdown.

## The seam: `ChainAdapter` interface

New file `web/lib/chains/adapter.ts`. Every page/hook talks to this instead of `@solana/*`
or `viem` directly.

```ts
export type ChainContext = string; // "solana:5eykt4…" | "eip155:8453" | "eip155:84532"

export interface SkillListingView {
  listingId: string;        // chain-native id (PDA address | bytes32) as a string
  author: string;           // chain-native address
  name: string;
  description: string;
  uri: string;
  priceUsdcMicros: bigint;
  revision: number;
  active: boolean;
}

export interface TxResult {
  ref: string;              // tx signature | tx hash | userOp hash
  explorerUrl: string;
  paidGas: boolean;         // false when sponsored (4337 / x402)
}

export interface ConnectedWallet {
  address: string;
  chainContext: ChainContext;
  // the adapter holds the signer internally; the UI never touches raw keys
}

export interface ChainAdapter {
  chainContext: ChainContext;

  // identity / formatting
  isValidAddress(value: string): boolean;
  shortenAddress(value: string): string;
  explorerTxUrl(ref: string): string;
  explorerAddressUrl(address: string): string;

  // wallet
  connect(): Promise<ConnectedWallet>;
  disconnect(): Promise<void>;

  // reads
  listSkillListings(): Promise<SkillListingView[]>;
  fetchSkillListing(listingId: string): Promise<SkillListingView | null>;

  // writes (sponsored where supported)
  registerAgent(metadataUri: string): Promise<TxResult>;
  createSkillListing(p: {
    skillId: string; uri: string; name: string; description: string; priceUsdcMicros: bigint;
  }): Promise<TxResult>;
  purchaseSkill(listingId: string): Promise<TxResult>;

  // agent x402 (server-verifiable payment authorization)
  buildX402Payment(listingId: string): Promise<{ header: string; payload: unknown }>;
}

// chain_context -> adapter; default from web/lib/chains.ts getConfiguredChainContext()
export function getAdapter(ctx: ChainContext): ChainAdapter;
```

## Implementation steps (phased — each phase independently verifiable)

1. **define-chainadapter** — add the interface + `getAdapter` registry (throwing stubs). No behavior change.
2. **extract-solana-adapter** — move the Solana modules behind `SolanaAdapter`; repoint UI/hooks at `getAdapter(ctx)`. Verify the live Solana app is byte-for-byte unchanged in behavior.
3. **base-adapter-readslice** — `BaseAdapter` reads only (viem `publicClient` + `getListing`), render one Base listing in the real UI by `chain_context`. First proof the seam works end-to-end.
4. **base-adapter-wallet** — chain-aware `useAgentVouchWallet`; EVM connect via passkey (lift `accounts/passkey.ts`) + wagmi/MetaMask. **Long pole — budget the most time here.**
5. **base-adapter-write** — lift `flow.ts` for register/list/buy (sponsored 4337); wire EVM x402 `receiveWithAuthorization` into the sponsored + x402 API routes.
6. **db-multichain** — EVM contract address + tx-hash columns keyed by `chain_context`.
7. **address-type-sweep** — chain-tagged address type + explorer helpers across the touched files.
8. **make-base-canonical** — flip the default `chain_context` to Base; keep `SolanaAdapter` dormant.
9. **verify-e2e** — full Base flow + Solana regression; all CI green.

## Verification

- **Per phase:** after `extract-solana-adapter`, the Solana flow (connect → browse → sponsored
  purchase) must work exactly as before. After each Base phase, exercise that slice on Base
  Sepolia.
- **Final (verify-e2e):**
  - Human: passkey connect → register → list → buy on Base, user pays 0 gas (ETH delta 0).
  - Agent: x402 purchase settles via `receiveWithAuthorization`.
  - Regression: switch `chain_context` to Solana → the old flow still works.
  - Gates: `forge test` (contracts job, added PR #56) 66/66; web `npm run format:check && lint && typecheck && test`; Vercel build green (Vercel is the real web typecheck gate — the `test` job does not run `next build`). See [[agentvouch-ci-next-build-gate]].

## Gotchas (carried from the Base POC, 2026-06-23)

- Public `https://sepolia.base.org` is load-balanced and lags on read-after-write
  (intermittent `ListingNotFound` right after a fresh write). Use a consistent RPC
  (e.g. `https://base-sepolia-rpc.publicnode.com`) for browser reads; compute balance deltas
  at explicit block numbers.
- The agent (x402 Lane B) must be a plain **EOA** — `receiveWithAuthorization` uses ECDSA, so
  a smart-account / EIP-1271 agent will not work as coded.
- Wallet UX is the long pole: Solana wallet-adapter and EVM passkey/wagmi are different stacks.
- See [[agentvouch-worktree-setup]] for fresh-worktree setup (gitignored node_modules,
  web/.env.local), and [[neon-db-two-projects]] before touching the DB.

## Rollback

The default `chain_context` flip (make-base-canonical) is the on/off switch — set it back to
the Solana context to restore the old UX while keeping both adapters in the tree. No
destructive deletes; Solana code is retained, just dormant.

## Open questions / blockers

- **Agent identity:** `/api/agents/[pubkey]` reads a Solana identity program. Decide the EVM
  story (an on-Base identity contract vs DB-only) before `base-adapter-write`.
- **Mainnet vs Sepolia:** the POC contract is on Base **Sepolia**. A production cutover needs a
  Base **mainnet** deploy + mainnet USDC + CDP mainnet paymaster. Treat as a later gate.
- **Wallet provider choice (Phase 4):** Coinbase Smart Wallet passkey (proven in the POC, best
  gas-free UX) vs wagmi/RainbowKit (broader wallet support) vs both. Pick before building the
  wallet layer.
