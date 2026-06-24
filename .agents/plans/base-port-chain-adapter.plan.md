---
name: base-port-chain-adapter
overview: "Port agentvouch.xyz (web/) from Solana to Base/EVM by introducing a ChainAdapter seam UNDER the existing UI — no rebuild. Extract today's Solana logic behind a SolanaAdapter, add a BaseAdapter that lifts the proven contracts/base-poc viem code, make Base canonical, keep Solana dormant. Coupling is concentrated (~50 of ~375 files, ~6 modules; mapped 2026-06-23). Each phase below is one PR-sized, independently-verifiable unit so a different session can take over by reading the todo statuses."
todos:
  - id: define-chainadapter
    content: "Phase 1. Add the ChainAdapter interface + view types (web/lib/adapters/types.ts) and a getAdapter(chainContext) registry (web/lib/adapters/index.ts) returning not-implemented stubs. No wiring, no behavior change."
    status: completed
  - id: extract-solana-adapter
    content: "Phase 2. Implement SolanaAdapter (web/lib/adapters/solana.ts) by moving existing logic (onchain.ts, sponsoredPurchase.ts, useMarketplaceOracle.ts, browserX402.ts, x402ProtocolBridge.ts, WalletContextProvider.tsx) behind it; repoint UI/hooks at getAdapter(ctx). LIVE-APP refactor — must be behavior-preserving for Solana. Sub-status: 2a reads DONE; 2b design DONE; 2b-impl/2c/2d DEFERRED to an app+wallet session — do Phase 3 FIRST (see NEXT STEP OVERRIDE). Full Done-when needs running-app devnet verification."
    status: in_progress
  - id: base-adapter-readslice
    content: "Phase 3. RECOMMENDED NEXT (wallet-free reads; do before 2c — see NEXT STEP OVERRIDE). Implement BaseAdapter reads only (web/lib/adapters/base.ts: viem publicClient + getListing vs AgentVouchEvm; lift full ABI via `forge build` — harness abi.ts is write-only). listSkillListings has NO getProgramAccounts equivalent — enumerate DB-driven (skills table) or via SkillListingCreated events. Contract 0x6Fd9…D854 likely has no listing yet (zero activity ~53d, verified 2026-06-24) — seed first. Render one Base listing in the real UI selected by chain_context."
    status: in_progress
  - id: base-adapter-wallet
    content: "Phase 4. Chain-aware wallet: EVM connect (Coinbase Smart Wallet passkey lifted from contracts/base-poc/ui/src/accounts/passkey.ts, + wagmi/MetaMask) behind the adapter + a 'use client' provider. LONG POLE. Resolve the wallet-provider open question first."
    status: pending
  - id: base-adapter-write
    content: "Phase 5. BaseAdapter writes (register/list/buy) lifting contracts/base-poc/ui/src/flow.ts (sponsored 4337). Wire EVM x402 receiveWithAuthorization into the route handlers /api/transactions/sponsored/* and /api/x402/*. Resolve the agent-identity open question first."
    status: pending
  - id: db-multichain
    content: "Phase 6. Extend Postgres for EVM alongside Solana: contract address + tx hash keyed by chain_context (generalize on_chain_address/tx_signature or add evm_* columns). Guard reads/writes by chain_context. See [[neon-db-two-projects]]."
    status: pending
  - id: address-type-sweep
    content: "Phase 7. Replace @solana/kit Address (base58/PDA) assumptions with a chain-tagged address type + per-chain explorer helpers across the touched files. Mostly mechanical."
    status: pending
  - id: make-base-canonical
    content: "Phase 8. Flip the default chain_context to Base (web/lib/chains.ts getConfiguredChainContext). Keep SolanaAdapter registered but dormant behind a flag."
    status: pending
  - id: verify-e2e
    content: "Phase 9. E2E on Base (passkey register->list->buy gas-free; agent x402) + Solana regression. forge contracts job + web format/lint/typecheck/vitest green; Vercel build green."
    status: pending
isProject: false
---

# Solana → Base Port via a ChainAdapter Seam

## Decision (2026-06-23)

Base becomes the **canonical** chain; Solana is **demoted, not deleted** — `SolanaAdapter`
stays registered but dormant behind the seam. **NOT** a from-scratch rebuild and **NOT**
permanent multi-chain.

Rationale (architecture map, verified 2026-06-23): chain coupling in `web/` is concentrated
— ~50 of ~375 files, real logic in ~6 modules — so a seam-swap keeps the entire UI, routing,
and DB schema, and lets the already-built `contracts/base-poc` code become the Base adapter's
engine. Multi-chain-forever was rejected: two wallet stacks + two settlement paths is permanent
overhead for a pre-PMF product. Revisit only if real demand for both chains appears. The
default-chain flip (Phase 8) is the reversible on/off switch.

## Goal

The same agentvouch.xyz UI, serving Base listings by default: passkey/4337 gas-free
register → list → buy for humans, x402/EIP-3009 for agents — with the Solana code path intact
but off by default.

## Scope

- **In scope:** the `ChainAdapter` seam; `SolanaAdapter` (extraction, not rewrite); `BaseAdapter`
  (new, lifting `contracts/base-poc`); EVM wallet connection; DB multi-chain columns;
  address-type generalization; flip default to Base.
- **Out of scope:** UI redesign (keep as-is — it is chain-agnostic), disputes/slashing
  (deferred — see [[mvp-ship-minimal-bias]]), deleting Solana code, archiving `web/`,
  Base **mainnet** cutover (the POC contract is Sepolia — see Open questions).

## Resuming this plan in a fresh session (HANDOFF)

The plan and the implementation live together on branch **`feat/base-port-chain-adapter`**
(the plan also exists on `main` as commit `d4c8b68`, but the up-to-date copy travels with the
branch). To take over:

1. `git checkout feat/base-port-chain-adapter` (fresh worktree setup: [[agentvouch-worktree-setup]]).
2. Read the frontmatter `todos`. **The first non-`completed` id is the next phase.**
3. Read that phase's section under "## Phases" — each is self-contained (files, steps,
   Done-when). **Phases are ordered; each depends on the previous.**
4. Set the todo to `in_progress` when you start; `completed` only when its **Done when** passes
   (verification, not just compile). If you diverge from the plan, append a dated note at that
   phase. See the plan-writing skill for status discipline.
5. **One phase = one commit/PR** off `feat/base-port-chain-adapter`, so each step is reviewable
   and the handoff boundary is clean. Suggested branch per phase:
   `feat/base-port-p<N>-<slug>`.

> **NEXT STEP OVERRIDE (2026-06-24 review).** The strict "first non-`completed` todo = next phase"
> rule (step 2) is **overridden once**: do **Phase 3 (`base-adapter-readslice`) NEXT**, before the
> remaining Phase 2 work (2b-impl, 2c, 2d). Why: Phase 3 reads are **wallet-free** and test whether
> the seam generalizes to Base (the actual architectural bet); 2b-impl/2c need a running app + wallet
> and only prove the Solana refactor didn't regress (no new capability). Phase 3 does **not** depend
> on 2c — it adds `base.ts` + one `chain_context` read branch while Solana keeps working via its
> current path (satisfying Phase 3's "Solana still renders" gate); 2c later unifies the transitional
> dual read path (trivial churn on one call site). Batch **2b-impl + 2c + Phases 4/5** into a single
> app+wallet session. See the Phase 3 block for the verified read-path recon.

## What already exists to build on

- **Seam is half-stubbed:** `web/lib/chains.ts` already defines `base` (`eip155:8453`) and the
  `skills` table already has a `chain_context` column — both used only for display/config today.
  Make them load-bearing.
- **Fixed Base contract:** `AgentVouchEvm` at `0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854`
  (Base Sepolia, F-1-fixed — Lane B uses `receiveWithAuthorization`). Mirrors the Solana core
  economics (60/40 split, USDC micros). See [[base-poc-gasfree-spike]].
- **The BaseAdapter's engine already exists** in `contracts/base-poc` — lift, don't rewrite:
  - `contracts/base-poc/ui/src/flow.ts` — register/list/buy as sponsored 4337 UserOps
    (`listingId`/`skillIdHash` calc + ABI calls).
  - `contracts/base-poc/ui/src/accounts/*` — local-key + Coinbase Smart Wallet passkey connectors.
  - `contracts/base-poc/harness/src/agent-x402-demo.ts` — x402 `receiveWithAuthorization`
    (Lane B) with the exact EIP-712 signing recipe.
  - `contracts/base-poc/harness/src/abi.ts` — AgentVouchEvm ABI fragments.

## The coupling map — what swaps (verified 2026-06-23)

| File / area | Today (Solana) | After (behind the adapter) |
|---|---|---|
| `web/components/WalletContextProvider.tsx` + exported `useAgentVouchWallet` | ConnectorKit / Phantom, hardcoded Solana | chain-aware provider; EVM via wagmi + Coinbase Smart Wallet / passkey |
| `web/lib/onchain.ts` | `getProgramAccounts` browser reads | `SolanaAdapter.listSkillListings`; `BaseAdapter` uses viem `getListing` |
| `web/lib/sponsoredPurchase.ts`, `web/hooks/useMarketplaceOracle.ts` | Solana instructions + PDAs | `adapter.purchaseSkill` (Base lifts `flow.ts`) |
| `web/lib/browserX402.ts`, `web/lib/x402ProtocolBridge.ts`, `/api/x402/*`, `/api/transactions/sponsored/*` | Solana sponsored / x402 | EVM Lane B `receiveWithAuthorization` |
| address handling (`@solana/kit` `Address`, base58, PDAs), explorer URLs | Solana-only | chain-tagged address type + per-chain explorer helpers |

**Chain-agnostic — unchanged:** all routes/pages, the 27 components, styling, copy, the Postgres
schema (extend, not replace), GitHub OAuth, search/indexing, markdown.

## The seam: `ChainAdapter` (reads) + `ChainWallet` (writes)

> **Source of truth for the interfaces is `web/lib/adapters/types.ts`.** Per the Phase 2b
> signer-injection decision (2026-06-23) the seam is **split**: `ChainAdapter` = server-safe reads
> + pure helpers (from `getAdapter(ctx)`); `ChainWallet` = client-only, wallet-bound writes (from a
> chain-aware `useChainWallet()` hook — connection stays in each chain's React provider). The
> illustrative block below predates the split (it showed `connect`/writes on one interface); see
> types.ts for the current shape.

New directory **`web/lib/adapters/`** (NOT `web/lib/chains/` — `web/lib/chains.ts` already
exists and a sibling dir of the same name causes import ambiguity):

- `web/lib/adapters/types.ts` — the interface + view types (below). **Server-safe**: no
  `'use client'`, no browser-only or wallet-SDK imports at module top, so Server Components and
  route handlers can import the types and call read methods.
- `web/lib/adapters/index.ts` — `getAdapter(ctx)` registry.
- `web/lib/adapters/solana.ts` — `SolanaAdapter` (Phase 2).
- `web/lib/adapters/base.ts` — `BaseAdapter` (Phases 3/5).

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

  // identity / formatting (pure — safe on server)
  isValidAddress(value: string): boolean;
  shortenAddress(value: string): string;
  explorerTxUrl(ref: string): string;
  explorerAddressUrl(address: string): string;

  // reads (safe on server — prefer calling these from Server Components / route handlers)
  listSkillListings(): Promise<SkillListingView[]>;
  fetchSkillListing(listingId: string): Promise<SkillListingView | null>;

  // wallet + writes (CLIENT-ONLY — only invoked from 'use client' code)
  connect(): Promise<ConnectedWallet>;
  disconnect(): Promise<void>;
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

## Next.js boundaries (App Router) — keep these straight

- **Wallet provider is a client boundary.** `WalletContextProvider` is `'use client'`; the EVM
  provider (wagmi / Coinbase Smart Wallet) is too. Keep wallet/write methods behind dynamic
  (`await import(...)`) imports inside the client adapter so wallet SDKs + viem
  `account-abstraction` never get pulled into Server Component / RSC bundles.
- **Reads can be server-side.** The `listSkillListings`/`fetchSkillListing` methods are
  server-safe; prefer fetching listings in Server Components to avoid client RPC waterfalls (and
  the read-after-write lag bites less server-side). Use a consistent RPC regardless.
- **Settlement stays in Route Handlers, not Server Actions.** `/api/x402/*` and
  `/api/transactions/sponsored/*` are agent- and client-facing endpoints (external callers),
  so they remain `route.ts` handlers — don't convert them to Server Actions.

## Phases

> Order matters; each phase depends on the previous. One commit/PR per phase.

### Phase 1 — `define-chainadapter` [completed 2026-06-23]
- **Status:** done — `web/lib/adapters/types.ts` (interface + view types) and
  `web/lib/adapters/index.ts` (`getAdapter` registry, not-implemented stubs per family) added;
  `cd web && npm run typecheck` green; no UI callers yet. Family routing reuses
  `normalizeInputChainContext` from `web/lib/chains.ts`.
- **Goal:** materialize the seam with no behavior change.
- **Files:** create `web/lib/adapters/types.ts` (interface + view types above) and
  `web/lib/adapters/index.ts` (`getAdapter(ctx)` mapping `eip155:*`→Base stub, `solana:*`→Solana
  stub; stubs throw `Error("<adapter> not implemented")`). Reuse `normalizeChainContext` from
  `web/lib/chains.ts` to resolve `ctx`.
- **Steps:** define types; write `getAdapter` returning the two stub objects; export nothing into
  UI yet (no callers change).
- **Done when:** `cd web && npm run typecheck` passes; `getAdapter("eip155:84532")` returns the
  Base stub and `getAdapter(<solana ctx>)` the Solana stub; the live app is otherwise untouched
  (`git grep -l getAdapter web/app web/components web/hooks` is empty).

### Phase 2 — `extract-solana-adapter` [in_progress]  ⚠ live-app refactor
- **Goal:** route all existing Solana behavior through `SolanaAdapter` with zero UX change.
- **Why sub-sliced:** this spans server (API routes) + client (hooks/components/provider), ~20
  files, and only some slices are verifiable without a running app + wallet. Split into separate
  verifiable commits:
  - **2a — adapter reads [completed 2026-06-23]:** `web/lib/adapters/solana.ts` implements reads
    (delegating to `lib/onchain.ts`, mapping `OnChainSkillListingRecord` → `SkillListingView`) +
    identity/explorer (delegating to `lib/chains.ts`). `getAdapter("solana:…")` returns it.
    `onchain` is dynamically imported inside the read methods so the adapter registry never pulls
    it (Buffer/RPC) into a client bundle. Wallet/write methods throw (Phase 2b). **No callers
    repointed — live app untouched.** typecheck + prettier green; `git grep getAdapter web/app
    web/components web/hooks` empty.
  - **2b — wallet + writes [design settled 2026-06-23; impl pending]:** SIGNER-INJECTION DECISION:
    wallet connection is irreducibly chain-specific + React-bound (Solana ConnectorKit/Phantom;
    Base wagmi/passkey), so the adapter does NOT own connection. The seam is SPLIT: `ChainAdapter`
    (server-safe reads/format — done) + a separate client-only `ChainWallet` (writes), produced by
    a chain-aware hook `useChainWallet()` (evolve `useAgentVouchWallet`) that captures the active
    chain's connected signer and returns writes already bound to it — the UI calls
    `wallet.purchaseSkill(id)` uniformly (no signer threading, no per-chain branching). Interfaces
    materialized in `web/lib/adapters/types.ts`; `SolanaAdapter` + the registry stub trimmed to
    reads/format (typecheck green). IMPL remaining (needs a running app to verify): `SolanaWallet`
    (wrap `useMarketplaceOracle`'s prepare→sign→submit bound to the context signer), `BaseWallet`
    (lift `flow.ts`), and the `useChainWallet()` hook.
  - **2c — repoint callers [pending]:** flip server read routes (`app/api/skills/*`) and client
    orchestration (`useMarketplaceOracle`, the `useAgentVouchWallet` consumers) to `getAdapter(ctx)`.
    Behavior-touching: routes read `OnChainSkillListingRecord` fields — confirm `SkillListingView`
    carries everything they use, or map at the boundary. **Needs a running app + wallet to verify.**
    NOTE (2026-06-24 review): UI address-shortening is NOT uniform today. `shortenAddress` in
    `solana.ts` now matches the dominant content format — `6 + "..." + 4` (author page,
    `SkillDetailClient`) — and the bogus `…` (U+2026) char it shipped with (used by NO call site)
    was fixed. But other sites use bespoke lengths: `ClientWalletButton.tsx` (4/4),
    `AgentIdentityPanel.tsx` (12/6), and a tx-sig truncation (8/8) in `SkillDetailClient`. When
    repointing these to `adapter.shortenAddress`, decide per-site: accept the unified `6/4`, keep
    the inline logic, or add an optional length param to the `ChainAdapter` interface. Do NOT
    silently change rendered output — that breaks the "behavior-preserving" contract of this phase.
  - **2d — x402 [pending]:** `browserX402` / `x402ProtocolBridge` + `/api/x402/*` behind the adapter.
- **Files:** `web/lib/adapters/solana.ts` (2a ✓); then `web/lib/onchain.ts`,
  `web/lib/sponsoredPurchase.ts`, `web/hooks/useMarketplaceOracle.ts`, `web/lib/browserX402.ts`,
  `web/lib/x402ProtocolBridge.ts`, `web/components/WalletContextProvider.tsx` + their callers.
- **Done when (full phase):** the live Solana flow (connect → browse → sponsored purchase) works
  **identically on devnet** — requires a running app + wallet, **NOT verifiable in a headless
  session**; `git grep -l "@solana/" web/app web/components web/hooks` shows only adapter/provider
  files; `npm run typecheck && npm test` green.

### Phase 3 — `base-adapter-readslice` [pending — RECOMMENDED NEXT, see NEXT STEP OVERRIDE]
- **Goal:** prove the seam end-to-end with a real Base read in the live UI — the first test that
  `ChainAdapter` actually generalizes to a second chain. (2c does NOT test this; it only re-routes
  Solana through a Solana-shaped abstraction.)
- **Files:** new `web/lib/adapters/base.ts` (reads only): viem `createPublicClient` on Base Sepolia.

#### Read-path recon (verified 2026-06-24 against `contracts/base-poc`)
- **View functions on `AgentVouchEvm`** (`src/AgentVouchEvm.sol`):
  `getListing(bytes32 id) → SkillListing memory` (L551), `getProfile(address) → AgentProfile` (L543),
  `getConfig() → Config` (L539). So `fetchSkillListing(id)` == `getListing(id)` — trivial.
- **ABI gap:** the minimal `contracts/base-poc/harness/src/abi.ts` is **WRITE-ONLY** (no `getListing`,
  no events) — do NOT lift it for reads. Run `forge build` in `contracts/base-poc` (the `out/` dir is
  not built in fresh worktrees) and lift the full ABI from `out/AgentVouchEvm.sol/AgentVouchEvm.json`,
  or hand-add the read fragments + struct tuples.
- **Enumeration — NO `getProgramAccounts` equivalent.** Solana's `listOnChainSkillListings()` enumerates
  all listings on-chain; EVM cannot. Two options for `listSkillListings()`:
  1. **DB-driven (recommended):** the `skills` table is already the discovery index — take its
     `chain_context = eip155:*` rows, derive each `listingId`, then `multicall` `getListing` for current
     state. Fits the architecture (DB = discovery, chain = economic truth). Legitimately different from
     the Solana adapter's chain-enumeration — that asymmetry is exactly why the seam exists.
  2. **Event-driven (fallback/reconciliation):** query `SkillListingCreated(bytes32 indexed listingId,
     address indexed author, uint256 price, bool free)` logs minus `SkillListingRemoved(bytes32 indexed
     listingId)`, then `getListing` each. Use only to discover listings not in the DB.
- **`listingId` derivation (must match the contract exactly — `ui/src/flow.ts`):**
  `skillIdHash = keccak256(stringToHex(skillId))`;
  `listingId = keccak256(abiEncode(["address","bytes32"], [author, skillIdHash]))`.
  On-chain pure check: `listingId(address,bytes32)` (L529).
- **`SkillListing` → `SkillListingView` mapping** (`src/libraries/AgentVouchTypes.sol`):
  `listingId` ← the bytes32 you queried with (`getListing` does NOT return the id — caller supplies it);
  `author` ← `author` (EVM checksum addr, not base58 — Phase 7 sweep); `name`/`description`/`uri` direct;
  `priceUsdcMicros` ← `priceUsdcMicros` (same 6-dec USDC micros as Solana — parity); `revision` ←
  `Number(currentRevision)`; `active` ← `status === ListingStatus.Active` (enum: `Active=0, Suspended=1,
  Removed=2` — match the Solana adapter, which keys `active` on status alone).
- **Seeded state (verified 2026-06-24):** contract code IS deployed at `0x6Fd9…D854`, but **zero
  `SkillListingCreated` and zero `AgentRegistered`** over blocks 41,000,000→43,283,619 (~53 days) via
  `https://base-sepolia-rpc.publicnode.com`. This is the F-1-fixed contract (PR #56), newer than the
  earlier POC test contracts — so it almost certainly has **no listing to read**. Phase 3 step 0 is to
  **seed one** (base-poc harness register→list, or the POC UI). To confirm zero definitively, scan
  `SkillListingCreated` from the deploy block (broadcast file is not committed — find the block via the
  deploy tx or just attempt a seed).
- **Headless-verifiable:** reads need **NO wallet** (viem `readContract`/`getContractEvents`). A non-app
  session can write `base.ts` and prove `getListing` + the mapping against a seeded id via `cast`/a
  script; only the final "renders in `/skills`" gate needs the dev server. (Contrast 2c, which needs a
  wallet click-through — that is why Phase 3 goes first.)

- **Steps:** `forge build` + lift ABI; seed one listing; implement `fetchSkillListing` (=`getListing`)
  and `listSkillListings` (DB-driven); render on `/skills` when `chain_context = eip155:84532`.
- **Done when:** the Base listing renders in the real UI, fetched live from the contract (server-side
  read); the Solana listings still render. Use `https://base-sepolia-rpc.publicnode.com` (read lag).

### Phase 4 — `base-adapter-wallet` [pending]  ⚠ long pole
- **Goal:** connect an EVM wallet through the chain-aware wallet layer.
- **Prereq:** resolve the **wallet-provider** open question.
- **Files:** EVM connect in `web/lib/adapters/base.ts` (lift `contracts/base-poc/ui/src/accounts/passkey.ts`
  + `localKey.ts`); make `WalletContextProvider`/`useAgentVouchWallet` chain-aware (a `'use client'`
  EVM provider, e.g. wagmi, mounted alongside the Solana one and selected by `chain_context`).
- **Steps:** add the EVM provider; implement `connect`/`disconnect`/`ConnectedWallet` for Base;
  keep wallet SDK imports dynamic so they stay out of server bundles.
- **Done when:** a user connects a Base wallet (passkey) in the live UI and the address renders;
  switching `chain_context` back to Solana still connects a Solana wallet (no regression).

### Phase 5 — `base-adapter-write` [pending]
- **Goal:** register/list/buy on Base from the UI + agent x402 settlement.

> **Note (2026-06-24 review). Rev-split is already contract-proven — Phase 5 is wiring, not
> mechanism.** The 60/40 author/voucher split is shared settlement math (`_recordPurchase`) and
> passes green on both x402 lanes (`test_laneB_backedSplit6040`, `test_laneC_backedSplitAndClaim`;
> run locally 2026-06-24 — CI runs no forge, so re-run before trusting). **vs Solana, Base is more
> seamless:** Lane B (`purchaseWithAuthorization`) fuses the USDC pull + the 60/40 split into ONE
> atomic tx via USDC's EIP-3009 `receiveWithAuthorization` (buyer signs one EIP-712 msg, relayer
> submits; **no backend key, no custodial vault**). The Solana x402-bridge (`web/lib/x402ProtocolBridge.ts`,
> not yet enabled) has no EIP-3009 analog, so it is two-step + custodial: the x402 payment lands in an
> intermediate `x402_settlement_vault`, then a trusted backend `settlementAuthority` runs a separate
> `settle_x402_purchase` to do the split. **Wire Base Lane B for the agent path** — it drops the hot
> settlement key and the custodial-float failure mode the Solana bridge carries. (Base Lane C /
> `settleX402Purchase` under `SETTLEMENT_ROLE` also exists if a facilitator-settled model is ever needed.)

- **Prereq:** resolve the **agent-identity** open question.
- **Files:** `web/lib/adapters/base.ts` writes (lift `contracts/base-poc/ui/src/flow.ts`); EVM
  branch in route handlers `web/app/api/transactions/sponsored/*` and `web/app/api/x402/*`
  (lift the `receiveWithAuthorization` signing recipe from `agent-x402-demo.ts`).
- **Steps:** implement `registerAgent`/`createSkillListing`/`purchaseSkill` as sponsored 4337
  UserOps; add the EVM x402 lane to the settlement route handlers; branch by `chain_context`.
- **Done when:** human passkey flow register→list→buy on Base Sepolia with **user ETH delta 0**;
  an agent x402 purchase settles via `receiveWithAuthorization`; Solana writes still work.

### Phase 6 — `db-multichain` [pending]
- **Goal:** persist EVM purchases/listings alongside Solana.
- **Files:** a migration + `web/lib/db.ts`. Generalize `on_chain_address`/`tx_signature` (or add
  `evm_contract_address`/`evm_tx_hash`) keyed by `chain_context`; guard reads/writes by chain.
- **Done when:** a Base purchase persists (contract addr + tx hash) and renders in the dashboard;
  existing Solana rows are unaffected. Mind [[neon-db-two-projects]] (use the live project).

### Phase 7 — `address-type-sweep` [pending]
- **Goal:** stop assuming Solana base58/PDA addresses app-wide.
- **Files:** a chain-tagged address type + `explorerTxUrl`/`explorerAddressUrl` helpers (already on
  the adapter); replace `@solana/kit` `Address`/`isAddress` assumptions across the touched files.
- **Done when:** addresses + explorer links render correctly for both a Base and a Solana listing;
  `npm run typecheck` green.

### Phase 8 — `make-base-canonical` [pending]
- **Goal:** Base by default, Solana dormant.
- **Files:** `web/lib/chains.ts` `getConfiguredChainContext()` default → Base; a flag to keep
  Solana selectable.
- **Done when:** a fresh visit defaults to Base listings/wallet; setting the flag restores Solana
  (this is the rollback switch).

### Phase 9 — `verify-e2e` [pending]
- **Goal:** prove the whole thing + no regression.
- **Done when:** Base human flow (passkey, 0 gas) + agent x402 both pass; Solana regression passes
  when selected; all CI gates below green.

## Cross-cutting verification & CI gates

- `forge test` runs in CI (contracts `job`, added PR #56) — keep it green if contracts change.
- Web `test` job = `npm run format:check && lint && typecheck && test` (vitest). It does **not**
  run `next build` — **Vercel is the real web build/typecheck gate**. See [[agentvouch-ci-next-build-gate]].
- The UI dir under `contracts/base-poc/ui` is `.prettierignore`d; `web/` is not — keep `web/` prettier-clean.

## Gotchas (carried from the Base POC, 2026-06-23)

- Public `https://sepolia.base.org` is load-balanced and lags on read-after-write (intermittent
  `ListingNotFound` right after a fresh write). Use `https://base-sepolia-rpc.publicnode.com` for
  reads; compute balance deltas at explicit block numbers.
- The agent (x402 Lane B) must be a plain **EOA** — `receiveWithAuthorization` uses ECDSA, so a
  smart-account / EIP-1271 agent will not work as coded.
- Wallet UX is the long pole (Phase 4): Solana wallet-adapter and EVM passkey/wagmi are different stacks.
- Keep wallet SDK + viem `account-abstraction` imports dynamic in the client adapter so they don't
  leak into Server Component bundles.

## Rollback

The default `chain_context` flip (Phase 8) is the on/off switch — set it back to the Solana context
to restore the old UX while keeping both adapters in the tree. No destructive deletes; Solana code is
retained, just dormant. Per-phase: revert that phase's single PR.

## Open questions / blockers

- **Agent identity (gates Phase 5):** `/api/agents/[pubkey]` reads a Solana identity program.
  Decide the EVM story — an on-Base identity contract vs DB-only.
- **Wallet provider choice (gates Phase 4):** Coinbase Smart Wallet passkey (proven in the POC,
  best gas-free UX) vs wagmi/RainbowKit (broader wallets) vs both.
- **Mainnet vs Sepolia (later gate):** the POC contract is Base **Sepolia**. Production needs a
  Base **mainnet** deploy + mainnet USDC + CDP mainnet paymaster.
