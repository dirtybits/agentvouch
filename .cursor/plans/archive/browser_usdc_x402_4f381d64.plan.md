---
name: Browser USDC x402
overview: Implement the minimal browser-native x402 USDC purchase flow on current `main`, reusing the existing server settlement path and leaving 8004 out of scope for now.
todos:
  - id: browser-x402-deps
    content: Add the minimal x402 browser client dependencies and identify the exact signer bridge needed for the connected wallet.
    status: completed
  - id: browser-x402-helper
    content: Create a web-side x402 fetch helper that mirrors the proven CLI payment handshake and targets the existing raw endpoint.
    status: completed
  - id: browser-x402-ui
    content: Wire the skill detail page to expose a real Pay with USDC action for USDC-primary listings while preserving legacy SOL behavior.
    status: completed
  - id: browser-x402-verify
    content: Verify the browser purchase flow end-to-end on devnet and run focused validation on the touched web files.
    status: completed
isProject: false
---

# Browser-Native x402 USDC Purchase

## Goal

Make USDC-primary skill purchases work directly from the browser on current `main`, without introducing 8004 work yet.

## Why This First

The current server path already supports USDC/x402 settlement in `[/Users/andysustic/Repos/agent-reputation-oracle/web/app/api/skills/[id]/raw/route.ts](/Users/andysustic/Repos/agent-reputation-oracle/web/app/api/skills/[id]/raw/route.ts)`, and the CLI already has a working x402 client pattern in `[/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/src/lib/install.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/src/lib/install.ts)`. The main missing piece is the browser orchestration in `[/Users/andysustic/Repos/agent-reputation-oracle/web/app/skills/[id]/page.tsx](/Users/andysustic/Repos/agent-reputation-oracle/web/app/skills/[id]/page.tsx)`.

## Scope

- Add a web-side x402 client helper in `[/Users/andysustic/Repos/agent-reputation-oracle/web/lib](/Users/andysustic/Repos/agent-reputation-oracle/web/lib)` that mirrors the CLI payment handshake.
- Wire the skill detail page to offer a real `Pay with USDC` path for USDC-primary listings.
- Reuse the existing raw download endpoint so successful payment still records the DB receipt and unlocks install/download.
- Keep `8004` fully out of scope for this slice.

## Implementation

1. Add the browser x402 client dependencies to the `web` package and mirror the existing CLI pattern from `[/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/src/lib/install.ts](/Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/src/lib/install.ts)`.
2. Create a thin helper in `[/Users/andysustic/Repos/agent-reputation-oracle/web/lib](/Users/andysustic/Repos/agent-reputation-oracle/web/lib)` that:

- wraps `fetch` with x402 payment handling,
- bridges the connected browser wallet to the signer interface,
- uses the same RPC/facilitator assumptions as `[/Users/andysustic/Repos/agent-reputation-oracle/web/lib/x402.ts](/Users/andysustic/Repos/agent-reputation-oracle/web/lib/x402.ts)`.

1. Update `[/Users/andysustic/Repos/agent-reputation-oracle/web/app/skills/[id]/page.tsx](/Users/andysustic/Repos/agent-reputation-oracle/web/app/skills/[id]/page.tsx)` to replace the current USDC dead-end/fallback copy with a real USDC purchase action.
2. On success, refresh skill state so `buyerHasPurchased` reflects the new entitlement, then reuse the existing install/download path.
3. Keep legacy SOL purchase behavior unchanged for non-USDC listings and any explicit SOL fallback cases.

## Verification

- Confirm a USDC-primary skill shows a real browser purchase action instead of `Use x402 Flow`.
- Complete a devnet browser purchase and verify the raw endpoint returns content after payment.
- Confirm install/download works after payment and `buyerHasPurchased` flips true.
- Run focused lint/type/test checks on the touched web files.

## Notes

- The key server-side behavior already exists in `[/Users/andysustic/Repos/agent-reputation-oracle/web/app/api/skills/[id]/raw/route.ts](/Users/andysustic/Repos/agent-reputation-oracle/web/app/api/skills/[id]/raw/route.ts)` and `[/Users/andysustic/Repos/agent-reputation-oracle/web/lib/usdcPurchases.ts](/Users/andysustic/Repos/agent-reputation-oracle/web/lib/usdcPurchases.ts)`.
- `8004` should come after this, as a smaller follow-up that hooks successful USDC purchases into reputation feedback rather than blocking the browser checkout path.

