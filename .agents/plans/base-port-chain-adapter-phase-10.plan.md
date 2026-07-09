---
name: base-port-chain-adapter-phase-10
overview: "BLOCKED gate plan: cut the AgentVouch default over to Base mainnet (eip155:8453) only after the Phase 9 v1 trust/security gates and mainnet contract/RPC/USDC/paymaster prerequisites all exist."
todos:
  - id: confirm-phase10-prerequisites
    content: Confirm every blocking row in the docs/MAINNET_READINESS.md Base Mainnet Gate Table has recorded evidence before any code change.
    status: pending
  - id: parameterize-base-chain-modules
    content: Introduce a configured-Base-chain seam (analogous to getConfiguredSolanaChainContext) and sweep the ~13 Sepolia-pinned Base modules — chain context/id literals, the viem baseSepolia chain object, contract/USDC/RPC/explorer constants, evmAuth verification RPC, and the x402 routes — so Base Sepolia vs mainnet is env-selected, not hardcoded. This is the bulk of the Phase 10 code work.
    status: pending
  - id: enable-mainnet-adapter
    content: Extend getAdapter()/chain config to accept eip155:8453 with mainnet contract/RPC/USDC/paymaster values, removing the Phase 8a mainnet rejection with explicit tests.
    status: pending
  - id: flip-mainnet-default
    content: Flip getDefaultChainContext() default from Base Sepolia to Base mainnet behind the same env rollback seam, keeping Solana and Sepolia selectable as configured.
    status: pending
  - id: verify-phase10
    content: Run the full local gate suite plus a mainnet smoke (register/list/buy/raw download with real funds policy approved by the human) and record evidence before rollout.
    status: pending
isProject: false
---

# Phase 10 - Base Mainnet Cutover [BLOCKED]

## Status

**BLOCKED.** Do not start this plan until the Base Mainnet Gate Table in
`docs/MAINNET_READINESS.md` has the required recorded evidence for the chosen launch tier. Any code
that enables `eip155:8453` before then is a stop-the-line bug (see the Phase 8a plan). This file
used to be drafted as "Phase 8b," but was renamed on 2026-07-02 so the roadmap reads in dependency
order: Phase 8a (Base Sepolia default), Phase 9 (Base E2E + trust/security), then Phase 10
(mainnet cutover).

## Goal

Flip the AgentVouch default chain from Base Sepolia (`eip155:84532`) to Base mainnet
(`eip155:8453`) once — and only once — the trust, security, and infrastructure gates pass.
Solana stays selectable; the Phase 8a env rollback seam keeps working as the emergency switch.

## Context

- Umbrella plan: `.agents/plans/base-port-chain-adapter.plan.md` (Phase 8 section, PR #58 review
  2026-06-29 defined the two-gate split).
- Phase 8a (`.agents/plans/base-port-chain-adapter-phase-8a.plan.md`) makes Base Sepolia the
  default behind a Solana rollback env and explicitly rejects `eip155:8453`.
- Phase 9 (`.agents/plans/base-port-chain-adapter-phase-9.plan.md`) owns the Base Sepolia E2E
  proof and the minimal Base v1 trust layer, ownership policy, and security review that gate this
  plan.
- The original Base fallback contract is the `base-poc-v0` spike (`0x6Fd9…D854`). Phase 9 now also
  has a Base Sepolia v1 candidate (`0x5992…B7d1`, `base-v1-candidate`) for report/vouch smokes. Neither
  contract may ship to mainnet without the readiness table passing.

## Gate Pointer (all required before starting)

The canonical go/no-go checklist is the
`docs/MAINNET_READINESS.md` **Base Mainnet Gate Table**. Do not duplicate those rows here; this
plan starts only after every Base-alpha-blocking row needed for the chosen launch tier has recorded
evidence there. Phase 10 then implements the cutover mechanics below.

## Scope (once unblocked)

- **Base chain parameterization (the bulk of the work — verified 2026-07-02):** the Base stack is
  currently Sepolia-pinned in ~13 modules, not just `getAdapter()`. Hardcoded surfaces include
  `BASE_SEPOLIA_CHAIN_CONTEXT`/`BASE_SEPOLIA_CHAIN_ID` literals, the viem `baseSepolia` chain
  object, and contract/USDC/RPC/explorer constants across `lib/adapters/baseConstants.ts`,
  `baseConfig.ts`, `baseWalletConfig.ts`, `baseWallet.ts`, `base.ts`, plus
  `lib/baseListingVerification.ts`, `basePurchaseVerification.ts`, `baseX402.ts`,
  `baseX402Api.ts`, `baseAuthorTrust.ts`, `lib/evmAuth.ts` (signature verification RPC must
  follow the wallet's chain), and the three `app/api/x402/*` routes. Introduce a configured-Base-
  chain seam (analogous to `getConfiguredSolanaChainContext`) rather than sed-swapping constants,
  so Sepolia remains selectable after the flip and the family-guard/source tests keep passing.
- Chain config: accept `eip155:8453` in `getAdapter()`/`web/lib/adapters/*` with mainnet
  contract/RPC/USDC/paymaster values; remove the Phase 8a mainnet rejection and replace the
  "mainnet-blocked" tests with "mainnet-enabled" equivalents (including the Phase 7
  `chainAddress` tests that assert eip155:8453 explorer/shorten degradation — those flip from
  "degrades" to "resolves").
- Default flip: `getDefaultChainContext()` defaults to `eip155:8453`; Sepolia and Solana remain
  reachable via the env seam. Rollback stays the single client-inlined var from the Phase 8a P2
  fix — `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT` (`solana` or `base-sepolia`), then
  redeploy. The seam's fail-closed branch must be updated deliberately: today any non-Sepolia,
  non-Solana value falls back to Solana; after Phase 10 the mainnet context is the no-env default.
- DB: no schema migration expected. Phase 6 chain-qualified rows key everything by chain context,
  so `eip155:8453` rows coexist with `eip155:84532` and Solana rows; apply the Sepolia-row
  display/purchase policy from the readiness table at the read/UI layer.
- Trust surfaces: mainnet Base authors flow through the Phase 9 trust reads/snapshots; no
  synthesized trust.
- Docs: update `docs/MAINNET_READINESS.md`, deployment state doc, and `web/public/skill.md` for
  mainnet semantics.

Out of scope:

- Removing Solana or Sepolia support.
- Multi-EVM beyond Base.
- Any trust/contract feature work — that belongs to Phase 9; this plan only cuts over.

## Verification

- Full local gate suite (format, lint, typecheck, vitest, webpack build).
- Mainnet smoke with human-approved funds policy: register/list/buy/raw download plus x402
  settlement evidence (tx hashes, USDC deltas, entitlement rows).
- Rollback rehearsal: prove the env rollback (set env + redeploy) restores the prior default in a
  preview before production rollout.

## Rollback

- Set `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=base-sepolia` (or `solana`) and redeploy —
  single var per the Phase 8a P2 fix; `NEXT_PUBLIC_*` values are build-time inlined, so an env
  change alone is not a runtime switch.
- If the mainnet contract itself is the problem, `setPaused(true)` under PAUSE_ROLE per the v1
  ownership policy, then follow the incident runbook. Note the pause stops writes but not reads:
  already-listed mainnet skills keep rendering, so the incident runbook should also cover the
  display policy while paused.

## Open Questions

- Sepolia-row policy (readiness-table item): recommended default is badge-as-testnet + exclude from
  the default browse sort, keep detail pages renderable. Decide before implementation.
- Whether `evmAuth` should verify ERC-1271/6492 signatures against the wallet's own chain (mainnet
  wallets verify on mainnet RPC) or pin to the default chain — smart-account signatures are
  chain-dependent, so this must be explicit in the parameterization sweep.
- Whether the mainnet flip ships dark first (mainnet enabled + Sepolia still default for one
  deploy) to smoke the parameterized stack in production before changing the default.
