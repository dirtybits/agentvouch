---
name: base-port-chain-adapter
overview: "Port agentvouch.xyz (web/) from Solana to Base/EVM by introducing a ChainAdapter seam UNDER the existing UI — no rebuild. Extract today's Solana logic behind a SolanaAdapter, add a BaseAdapter that lifts the proven contracts/base-poc viem code, make Base canonical, keep Solana dormant. Coupling is concentrated (~50 of ~375 files, ~6 modules; mapped 2026-06-23). Each phase below is one PR-sized, independently-verifiable unit so a different session can take over by reading the todo statuses."
todos:
  - id: define-chainadapter
    content: "Phase 1. Add the ChainAdapter interface + view types (web/lib/adapters/types.ts) and a getAdapter(chainContext) registry (web/lib/adapters/index.ts) returning not-implemented stubs. No wiring, no behavior change."
    status: completed
  - id: extract-solana-adapter
    content: "Phase 2. Implement SolanaAdapter (web/lib/adapters/solana.ts) by moving existing logic (onchain.ts, sponsoredPurchase.ts, useMarketplaceOracle.ts, browserX402.ts, x402ProtocolBridge.ts, WalletContextProvider.tsx) behind it; repoint UI/hooks at getAdapter(ctx). LIVE-APP refactor - must be behavior-preserving for Solana. Sub-status: 2a reads DONE; 2b design DONE; 2b-impl/2c/2d DEFERRED. Current sequencing 2026-07-01: circle back immediately after Phase 6 DB hardening and before Phase 7/8 default-chain work."
    status: in_progress
  - id: base-adapter-readslice
    content: "Phase 3 DONE 2026-06-29. BaseAdapter reads are live-verified, DB-driven Base Sepolia row hydration is wired into /skills + /api/skills + /api/skills/hydrate, one seeded Base listing renders in the real marketplace with on_chain_address=NULL and plain-text EVM author, and Solana listings still render. A local Playwright screenshot was captured during verification."
    status: completed
  - id: base-adapter-wallet
    content: "Phase 4 DONE 2026-06-30. Chain-aware wallet: Base Sepolia Coinbase Smart Wallet passkey connect/restore/disconnect works in a client-only ChainWallet hook/module, not in server-safe BaseAdapter. Browser WebAuthn restore smoke and Solana regression passed. wagmi/MetaMask injected deferred. See sub-plan .agents/plans/base-port-chain-adapter-phase-4.plan.md."
    status: completed
  - id: base-adapter-write
    content: "Phase 5 DONE 2026-07-01 via PR #67. Base ChainWallet writes (register/list/buy), Base purchase verification, Base listing persistence, EVM author/profile identity, chain-qualified purchase groundwork, and EIP-3009 x402 settlement are merged. Live Base write smoke remains env-dependent. See sub-plan .agents/plans/base-port-chain-adapter-phase-5.plan.md."
    status: completed
  - id: db-multichain
    content: "Phase 6 DONE 2026-07-01. Multichain DB hardening landed via PR #69 and post-merge DB gate: EVM listing identity indexes, additive chain-qualified receipt/entitlement lookup coverage, Base/Solana raw-access separation, activity/dashboard chain-aware reads, disposable Neon branch rehearsal, live guarded migrate on agentvouch-postgres main, and production API smoke. Legacy (skill_db_id, buyer_pubkey) entitlement PK intentionally remains until a later multi-EVM phase. See sub-plan .agents/plans/base-port-chain-adapter-phase-6.plan.md and [[neon-db-two-projects]]."
    status: completed
  - id: address-type-sweep
    content: "Phase 7. After Phase 6 and the Phase 2 circle-back, replace @solana/kit Address (base58/PDA) assumptions with a chain-tagged address type + per-chain explorer helpers across the touched files. Mostly mechanical."
    status: pending
  - id: make-base-canonical
    content: "Phase 8, TWO gates (PR #58 review 2026-06-29). 8a: default chain_context -> Base SEPOLIA (eip155:84532) behind a flag, Solana still selectable. 8b (LATER, blocked): mainnet cutover once mainnet RPC/contract/USDC/paymaster exist and getAdapter accepts eip155:8453. Do NOT flip the default to generic Base/eip155:8453 before 8b."
    status: pending
  - id: verify-e2e
    content: "Phase 9. E2E on Base (passkey register->list->buy gas-free; agent x402) + Solana regression. forge contracts job + web format/lint/typecheck/vitest green; Vercel build green."
    status: pending
isProject: false
---

# Solana → Base Port via a ChainAdapter Seam

## Decision (2026-06-23)

Base is the **frontrunner to become the canonical** chain — chosen as the x402/Coinbase
distribution bet (confirmed 2026-06-25), but **not yet written in stone**; the reversible commit
point is the Phase 8 default-chain flip. Solana is **demoted to fallback, not deleted** —
`SolanaAdapter` stays registered but dormant behind the seam. **NOT** a from-scratch rebuild and
**NOT** permanent multi-chain.

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

As of 2026-07-01, completed Base-port phases land through one PR branch per phase off current
`main`. The current active branch for Phase 6 planning/execution is **`feat/base-port-phase-6`**.
To take over:

1. `git fetch origin`, then either check out the active phase branch or create the next phase branch
   from `origin/main` (fresh worktree setup: [[agentvouch-worktree-setup]]).
2. Read the frontmatter `todos` **and the dated sequencing notes below**. Do not blindly use the
   first non-`completed` id: Phase 2 is intentionally `in_progress`/paused while Phase 6 runs, then
   Phase 2 resumes before Phase 7/8.
3. Read the relevant phase section under "## Phases" plus its dedicated sub-plan when one exists.
   Each phase is self-contained (files, steps, Done-when), but dated sequencing notes override
   frontmatter order when they say so.
4. Set the todo to `in_progress` when you start; `completed` only when its **Done when** passes
   (verification, not just compile). If you diverge from the plan, append a dated note at that
   phase. See the plan-writing skill for status discipline.
5. **One phase = one PR** off current `main`, so each step is reviewable and the handoff boundary is
   clean. Suggested branch per phase: `feat/base-port-phase-<N>`.

> **NEXT STEP OVERRIDE (2026-06-24 review).** The strict "first non-`completed` todo = next phase"
> rule (step 2) is **overridden once**: do **Phase 3 (`base-adapter-readslice`) NEXT**, before the
> remaining Phase 2 work (2b-impl, 2c, 2d). Why: Phase 3 reads are **wallet-free** and test whether
> the seam generalizes to Base (the actual architectural bet); 2b-impl/2c need a running app + wallet
> and only prove the Solana refactor didn't regress (no new capability). Phase 3 does **not** depend
> on 2c — it adds `base.ts` + one `chain_context` read branch while Solana keeps working via its
> current path (satisfying Phase 3's "Solana still renders" gate); 2c later unifies the transitional
> dual read path (trivial churn on one call site). See the Phase 3 block for the verified read-path
> recon.
>
> **POST-PHASE-5 SEQUENCING (2026-07-01).** Phase 5 has now landed, and Phase 6 is the next
> correctness gate because it hardens the chain-qualified DB semantics that Base raw access depends
> on. After Phase 6 completes, circle back to the remaining Phase 2 work (Solana wallet/write wrapper,
> caller repointing, and x402 seam cleanup) **before** Phase 7 address sweep and Phase 8 Base Sepolia
> default flip. The Base default switch should not happen while Solana still has transitional paths
> outside the seam.

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

| File / area                                                                                               | Today (Solana)                           | After (behind the adapter)                                              |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| `web/components/WalletContextProvider.tsx` + exported wallet hooks                                        | ConnectorKit / Phantom, hardcoded Solana | chain-aware provider; EVM via Coinbase Smart Wallet passkey; wagmi later |
| `web/lib/onchain.ts`                                                                                      | `getProgramAccounts` browser reads       | `SolanaAdapter.listSkillListings`; `BaseAdapter` uses viem `getListing` |
| `web/lib/sponsoredPurchase.ts`, `web/hooks/useMarketplaceOracle.ts`                                       | Solana instructions + PDAs               | `adapter.purchaseSkill` (Base lifts `flow.ts`)                          |
| `web/lib/browserX402.ts`, `web/lib/x402ProtocolBridge.ts`, `/api/x402/*`, `/api/transactions/sponsored/*` | Solana sponsored / x402                  | EVM Lane B `receiveWithAuthorization`                                   |
| address handling (`@solana/kit` `Address`, base58, PDAs), explorer URLs                                   | Solana-only                              | chain-tagged address type + per-chain explorer helpers                  |

**Chain-agnostic — unchanged:** all routes/pages, the 27 components, styling, copy, the Postgres
schema (extend, not replace), GitHub OAuth, search/indexing, markdown.

## The seam: `ChainAdapter` (reads) + `ChainWallet` (writes)

> **Source of truth for the interfaces is `web/lib/adapters/types.ts`.** Per the Phase 2b
> signer-injection decision (2026-06-23) the seam is **split**: `ChainAdapter` = server-safe reads
>
> - pure helpers (from `getAdapter(ctx)`); `ChainWallet` = client-only, wallet-bound writes (from a
>   chain-aware `useChainWallet()` hook — connection stays in each chain's React provider). The
>   illustrative block below should stay aligned with types.ts when the seam changes.

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
  listingId: string; // chain-native id (PDA address | bytes32) as a string
  author: string; // chain-native address
  name: string;
  description: string;
  uri: string;
  priceUsdcMicros: bigint;
  revision: number;
  active: boolean;
}

export interface TxResult {
  ref: string; // tx signature | tx hash | userOp hash
  explorerUrl: string;
  paidGas: boolean; // false when sponsored (4337 / x402)
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
}

export interface CreateSkillListingInput {
  skillId: string;
  uri: string;
  name: string;
  description: string;
  priceUsdcMicros: bigint;
}

export interface X402Payment {
  header: string;
  payload: unknown;
}

export interface ChainWallet {
  readonly chainContext: ChainContext;
  readonly address: string;

  disconnect(): Promise<void>;

  registerAgent(metadataUri: string): Promise<TxResult>;
  createSkillListing(input: CreateSkillListingInput): Promise<TxResult>;
  purchaseSkill(input: {
    listingId: string;
    expectedPriceUsdcMicros: bigint;
  }): Promise<TxResult>;

  // agent x402 (server-verifiable payment authorization)
  buildX402Payment(listingId: string): Promise<X402Payment>;
}

// chain_context -> adapter; default from web/lib/chains.ts getConfiguredChainContext()
export function getAdapter(ctx: ChainContext): ChainAdapter;
export function useChainWallet(): ChainWallet | null;
```

## Next.js boundaries (App Router) — keep these straight

- **Wallet provider is a client boundary.** `WalletContextProvider` is `'use client'`; the EVM
  provider (Coinbase Smart Wallet passkey; wagmi/injected later) is too. Keep wallet/write methods
  behind dynamic (`await import(...)`) imports inside the client adapter so wallet SDKs + viem
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

### Phase 2 — `extract-solana-adapter` [in_progress] ⚠ live-app refactor

- **Goal:** route all existing Solana behavior through `SolanaAdapter` with zero UX change.
- **Why sub-sliced:** this spans server (API routes) + client (hooks/components/provider), ~20
  files, and only some slices are verifiable without a running app + wallet. Split into separate
  verifiable commits:
  - **2a — adapter reads [completed 2026-06-23]:** `web/lib/adapters/solana.ts` implements reads
    (delegating to `lib/onchain.ts`, mapping `OnChainSkillListingRecord` → `SkillListingView`) +
    identity/explorer (delegating to `lib/chains.ts`). `getAdapter("solana:…")` returns it only
    when the requested context matches the configured Solana environment; context-aware Solana
    RPC/explorer helpers are deferred until Phase 2c. `onchain` is dynamically imported inside the
    read methods so the adapter registry never pulls it (Buffer/RPC) into a client bundle.
    Wallet/write methods throw (Phase 2b). **No callers repointed — live app untouched.**
    typecheck + prettier green; `git grep getAdapter web/app web/components web/hooks` empty.
  - **2b — wallet + writes [design settled 2026-06-23; impl pending]:** SIGNER-INJECTION DECISION:
    wallet connection is irreducibly chain-specific + React-bound (Solana ConnectorKit/Phantom;
    Base wagmi/passkey), so the adapter does NOT own connection. The seam is SPLIT: `ChainAdapter`
    (server-safe reads/format — done) + a separate client-only `ChainWallet` (writes), produced by
    a chain-aware hook `useChainWallet()` (evolve `useAgentVouchWallet`) that captures the active
    chain's connected signer and returns writes already bound to it — the UI calls
    `wallet.purchaseSkill(input)` uniformly (no signer threading, no per-chain branching). Interfaces
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

### Phase 3 — `base-adapter-readslice` [completed 2026-06-29]

- **Goal:** prove the seam end-to-end with a real Base read in the live UI — the first test that
  `ChainAdapter` actually generalizes to a second chain. (2c does NOT test this; it only re-routes
  Solana through a Solana-shaped abstraction.)
- **Files:** new `web/lib/adapters/base.ts` (reads only): viem `createPublicClient` on Base Sepolia.

#### Sub-status (2026-06-24)

- **3a — adapter reads [DONE, verified]:** `web/lib/adapters/base.ts` (`BaseAdapter`) implements
  `fetchSkillListing` (= `getListing`; maps the SkillListing tuple → `SkillListingView`; returns null on
  `exists=false`), `listSkillListings` (event scan — see RPC caveat), and pure identity/format helpers
  (EVM `isValidAddress`, `6+"..."+4` shorten, basescan explorer URLs). Read ABI is hand-written in
  `web/lib/adapters/agentVouchEvmAbi.ts` (human-readable strings, no viem at module top); config in
  `web/lib/adapters/baseConfig.ts`; `getAdapter("eip155:84532")` / `getAdapter("base-sepolia")`
  returns it; Base mainnet and other `eip155:*` contexts fail fast until mainnet config exists;
  `viem ^2.21.40` added to `web`; `eip155:84532` registered in `web/lib/chains.ts`. viem is
  dynamically imported inside the async reads so the registry never bundles it client-side
  (mirrors SolanaAdapter). **Verified:** typecheck + lint + 424/424 vitest (incl.
  `web/__tests__/lib/base-adapter.test.ts` — routing + helpers) green; a LIVE read
  against the deployed `0x6Fd9…D854` returned `null` for an absent id, proving the tuple ABI decodes
  correctly (a wrong ABI throws, not returns null). **No UI callers repoint — live app untouched.**
- **RPC caveat (finding 2026-06-24):** `listSkillListings`' event scan needs an **archive-capable RPC** —
  `publicnode` / `sepolia.base.org` free tiers reject historical `eth_getLogs` ("Archive requests require a
  personal token"). The method is now disabled by default; enable it only with
  `BASE_AGENTVOUCH_EVENT_SCAN_ENABLED=1`, a nonzero `BASE_AGENTVOUCH_FROM_BLOCK`, and an archive-capable
  `BASE_SEPOLIA_RPC_URL`. This reinforces the DB-driven enumeration choice for 3b (per-row `getListing`
  is a normal `eth_call`, no `getLogs`).
- **3b — seed + render [DONE 2026-06-29]:** seeded one Base Sepolia listing on
  `0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854`
  (`listingId=0x658b604e9f71b05d580d1fe24891b2686c46ba4fc1961f3027d908a8ad2bcb11`,
  `tx=0x31e858a4916c50f6e50f11d704ed19604c2139152358a0d03b9d6b0f1bfdc548`) and
  upserted the live Neon row at `/skills/base-phase-3b/phase-3b-demo-skill`. The DB stores
  `evm_listing_id`, `evm_contract_address`, and `evm_tx_hash`; `on_chain_address` stays NULL.
  `hydrateEvmRepoSkillRows()` calls `getAdapter(ctx).fetchSkillListing(evm_listing_id)` server-side
  and overlays live contract fields onto the repo row in place. The marketplace card renders as
  read-only with a Base Sepolia chip, 1 USDC price, and plain-text EVM author. The activity strip was
  also made chain-aware so it does not link EVM actors through `/author/[pubkey]`. A local Playwright
  screenshot was captured during verification.

#### Read-path recon (verified 2026-06-24 against `contracts/base-poc`)

- **View functions on `AgentVouchEvm`** (`src/AgentVouchEvm.sol`):
  `getListing(bytes32 id) → SkillListing memory` (L551), `getProfile(address) → AgentProfile` (L543),
  `getConfig() → Config` (L539). So `fetchSkillListing(id)` == `getListing(id)` — trivial.
- **ABI gap:** the minimal `contracts/base-poc/harness/src/abi.ts` is **WRITE-ONLY** (no `getListing`,
  no events) — do NOT lift it for reads. Run `forge build` in `contracts/base-poc` (the `out/` dir is
  not built in fresh worktrees) and lift the full ABI from `out/AgentVouchEvm.sol/AgentVouchEvm.json`,
  or hand-add the read fragments + struct tuples.
- **Enumeration — NO `getProgramAccounts` equivalent.** Solana's `listOnChainSkillListings()` enumerates
  all listings on-chain; EVM cannot. Two options for marketplace listing discovery:
  1. **DB-driven (recommended):** the `skills` table is already the discovery index — take its
     `chain_context = eip155:*` rows, derive each `listingId`, then `multicall` `getListing` for current
     state. Fits the architecture (DB = discovery, chain = economic truth). Legitimately different from
     the Solana adapter's chain-enumeration — that asymmetry is exactly why the seam exists.
  2. **Event-driven (fallback/reconciliation only):** query `SkillListingCreated(bytes32 indexed listingId,
address indexed author, uint256 price, bool free)` logs minus `SkillListingRemoved(bytes32 indexed
listingId)`, then `getListing` each. Use only to discover listings not in the DB, and only when
     explicitly configured with an archive-capable RPC and deploy block.
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

- **Steps:** done — ABI/read adapter, seeded listing, explicit EVM DB fields, DB-driven per-row
  `fetchSkillListing(listingId)` hydration, and `/skills` render proof.
- **Done when:** done — the Base listing renders in the real UI, fetched live from the contract
  server-side; Solana listings still render on the unfiltered marketplace.

### Phase 4 — `base-adapter-wallet` [completed 2026-06-30]

Dedicated sub-plan: [`base-port-chain-adapter-phase-4.plan.md`](./base-port-chain-adapter-phase-4.plan.md).

- **Goal:** connect a Base Sepolia EVM wallet through the chain-aware wallet layer.
- **Status:** done — Base Sepolia Coinbase Smart Wallet passkey connect/restore/disconnect is wired
  through the provider, exposes the Base `ChainWallet` surface with Phase-5-guarded write stubs,
  and keeps Solana wallet behavior available.
- **DECIDED (2026-06-25; reaffirmed 2026-06-30):** Coinbase Smart Wallet **passkey** for the MVP
  (POC-proven, gas-free via the CDP paymaster). wagmi/MetaMask injected support is deferred.
  Circle Modular Wallets are the Circle-native passkey/MSCA option on Base, but adopting them now
  would reopen Phase 4 rather than implement writes; track as a future wallet replacement/variant.
- **Key boundary:** wallet SDKs, WebAuthn, `localStorage`, and viem account-abstraction imports stay
  in client-only wallet modules/hooks. `web/lib/adapters/base.ts` remains read-only/server-safe.
- **Done when:** done — a user connects a Base Sepolia passkey wallet in the live UI, the EVM
  smart-account address renders with chain-aware formatting, disconnect/reload behaves correctly,
  and switching back to Solana still connects the existing Solana wallet.
- **Verification:** browser connect/restore proof plus web typecheck, lint, vitest, and
  `npm run build --workspace @agentvouch/web`; see the Phase 4 sub-plan for exact evidence.

### Phase 5 — `base-adapter-write` [completed 2026-07-01]

Dedicated sub-plan: [`base-port-chain-adapter-phase-5.plan.md`](./base-port-chain-adapter-phase-5.plan.md).

- **Goal:** register/list/buy on Base Sepolia from the UI plus agent x402 settlement.
- **Status:** done - PR #67 merged as `a61f65d` on `main`. The implementation includes Base
  ChainWallet writes, purchase/listing verification, Base author identity, chain-qualified purchase
  groundwork, and EVM x402 settlement/entitlement paths. Local source/test/build verification is
  recorded in the Phase 5 sub-plan; live Base write/x402 smoke still requires the Base RPC,
  paymaster, relayer, funded wallet, and intended DB envs.
- **DECIDED (2026-06-25):** on-chain identity via `AgentVouchEvm.registerAgent` / `getProfile`
  (already deployed; mirrors the Solana identity program). The EVM author/profile branch must read
  `getProfile` before routing EVM authors through an author page.
- **Key boundary:** Base writes live on the client-only `ChainWallet` from Phase 4; `BaseAdapter`
  remains server-safe reads. Base listing ids stay in `evm_listing_id`, never Solana
  `on_chain_address`.
- **Purchase safety:** `ChainWallet.purchaseSkill` takes `{ listingId, expectedPriceUsdcMicros }`.
  The Base wallet fetches the live EVM listing, requires the live price to match the UI/DB expected
  price, then approves only that exact native USDC amount.
- **Entitlement safety:** Base raw access must be chain-qualified by buyer chain context and buyer
  address. Do not grant EVM access through bare `buyer_pubkey` semantics shared with Solana.
- **Gas model:** keep CDP-sponsored UserOps for the Phase 5 proof. Circle Paymaster makes users pay
  gas in USDC; it is a later sustainability option, not a simplification of this sponsor-paid phase.
- **Done when:** human passkey flow register -> list -> buy on Base Sepolia with **user ETH delta
  0**; an agent x402 purchase settles via `receiveWithAuthorization`; Solana writes still work.
- **Verification:** Base browser write proof, EVM x402 settlement proof, Solana write regression,
  and web typecheck, lint, vitest, and `npm run build --workspace @agentvouch/web`.

### Phase 6 — `db-multichain` [completed]

Dedicated sub-plan: [`base-port-chain-adapter-phase-6.plan.md`](./base-port-chain-adapter-phase-6.plan.md).

- **Goal:** harden multi-chain persistence after the minimum Phase 5 write/access path lands.
- **Files:** `web/lib/db.ts`, `web/lib/usdcPurchases.ts`, raw access/purchase/x402 routes, skill
  detail and marketplace/activity read surfaces, plus focused tests. Phase 5 already added many
  additive fields (`evm_listing_id`, `evm_contract_address`, `evm_tx_hash`, `buyer_chain_context`,
  `buyer_address`, recipient/asset chain fields, and EVM purchase ids). Phase 6 must make those
  fields useful and consistently populated: add/verify EVM listing identity indexes, backfill
  chain-qualified buyer fields, route eligible reads/writes through chain-qualified helpers, and guard
  all relevant reads/writes by `chain_context`. Do **not** swap the legacy
  `(skill_db_id, buyer_pubkey)` entitlement primary key in Phase 6; that destructive migration is
  deferred until a later multi-EVM phase.
- **Done when:** a Base purchase persists (contract addr + tx hash), raw-access entitlements are
  chain-qualified, and dashboards/activity render without treating EVM rows as Solana PDAs; existing
  Solana rows are unaffected. Mind [[neon-db-two-projects]] (use the live project). After this phase,
  return to Phase 2 before Phase 7/8.
- **Pre-prod DB gate:** before running `db:phase6-chain-identity migrate` against the live Neon
  project, rehearse the exact `migrate` command on a disposable Neon branch/database copied from the
  intended production project. Capture the target host/database, `EXPECTED_DATABASE_HOST` guard,
  preflight output, index creation success, and a post-run constraint/index check. This rehearsal is
  not for finding duplicates (live read-only preflight already does that); it proves the guarded
  migration script and SQL order execute end-to-end before production DDL.
- **Post-merge result (2026-07-01):** `neonctl` context was fixed to the Vercel-managed
  `agentvouch-postgres` project (`calm-meadow-36819154`), the disposable branch rehearsal passed on
  `br-young-feather-af5t7y1c`, live `db:phase6-chain-identity migrate` passed on main
  (`ep-morning-firefly-afjzu0sp.c-2.us-west-2.aws.neon.tech/neondb`), both Phase 6 unique indexes
  were verified in `pg_indexes`, and production API smoke returned 200 for `/api/skills?mode=fast`,
  `/api/skills/activity`, and `/api/x402/supported`.

### Phase 7 — `address-type-sweep` [pending]

- **Goal:** stop assuming Solana base58/PDA addresses app-wide.
- **Files:** a chain-tagged address type + `explorerTxUrl`/`explorerAddressUrl` helpers (already on
  the adapter); replace `@solana/kit` `Address`/`isAddress` assumptions across the touched files.
- **Done when:** addresses + explorer links render correctly for both a Base and a Solana listing;
  `npm run typecheck` green.

### Phase 8 — `make-base-canonical` [pending]

Two explicit gates (PR #58 review 2026-06-29): the adapter/config today support Base **Sepolia**
only, and `getAdapter()` deliberately **rejects mainnet** (`eip155:8453`) until mainnet
RPC/contract/USDC/paymaster config exists — so do NOT flip the default to generic `Base`/`eip155:8453`.

- **8a — Base Sepolia default for port smoke [pending]:** `web/lib/chains.ts`
  `getConfiguredChainContext()` defaults to **`eip155:84532`** (Sepolia), behind a flag that keeps
  Solana selectable. Done when a fresh visit defaults to Base **Sepolia**; the flag restores Solana
  (the rollback switch).
- **8b — Base mainnet cutover [LATER gate — blocked]:** only after a mainnet `AgentVouchEvm` deploy
  + mainnet RPC + mainnet USDC + a CDP mainnet paymaster exist and `getAdapter()` accepts
  `eip155:8453`. Flip the default to mainnet then. Do NOT ask a follow-on agent to do this until those exist.

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
- Wallet UX was the long pole for Phase 4: Solana wallet-adapter and EVM passkey/wagmi are different
  stacks. Coinbase Smart Wallet passkey is now the MVP path; future wallet variants should stay
  separate from Phase 5 writes.
- Keep wallet SDK + viem `account-abstraction` imports dynamic in the client adapter so they don't
  leak into Server Component bundles.
- Phase 5's gas-free claim means sponsor-paid gas via the CDP bundler/paymaster and user ETH delta
  `0`. Do not swap in Circle Paymaster for this phase; Circle Paymaster is user-paid gas in USDC.
- Base purchases must not approve from stale UI data. Pass `expectedPriceUsdcMicros`, re-read the
  live EVM listing, and fail closed before approval if the price changed.

## Rollback

The default `chain_context` flip (Phase 8) is the on/off switch — set it back to the Solana context
to restore the old UX while keeping both adapters in the tree. No destructive deletes; Solana code is
retained, just dormant. Per-phase: revert that phase's single PR.

## Open questions / blockers

- **Agent identity (gates Phase 5) — RESOLVED 2026-06-25:** on-chain via `AgentVouchEvm`
  `registerAgent`/`getProfile` (already deployed; mirrors the Solana identity program). Not DB-only.
- **Wallet provider (gates Phase 4) — RESOLVED 2026-06-25:** Coinbase Smart Wallet passkey for the
  MVP (POC-proven, gas-free). wagmi/MetaMask injected = roadmapped follow-on, reconsidered if it
  proves too much lifting; not in the MVP.
- **Circle Modular Wallets / Circle Paymaster (reviewed 2026-06-30):** not Phase 5. Modular Wallets
  are a future Circle-native wallet variant; Circle Paymaster is a future user-pays-gas-in-USDC
  option. The Base port MVP stays on Coinbase Smart Wallet + CDP-sponsored UserOps.
- **Mainnet vs Sepolia (later gate):** the POC contract is Base **Sepolia**. Production needs a
  Base **mainnet** deploy + mainnet USDC + CDP mainnet paymaster.
