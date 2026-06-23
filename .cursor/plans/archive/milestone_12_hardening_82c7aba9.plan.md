---
name: Milestone 12 Hardening
overview: Implement Milestone 12 by removing stale primary-flow SOL assumptions, normalizing USDC listing/access contracts across repo-backed and chain-only skills, updating UI/CLI/tests/scripts, and adding production/mainnet readiness runbooks. Escrow/refunds remain a Milestone 13 handoff only, not a protocol implementation in this pass.
todos:
  - id: normalize-contract
    content: Normalize effective USDC listing/access contract and update shared chain price naming.
    status: completed
  - id: api-cutover
    content: Update skills, raw/install/update/index/activity API routes to use the normalized contract and hard-gate legacy SOL fallback.
    status: completed
  - id: ui-cli-consumers
    content: Update marketplace, detail, author, publish, and CLI consumers to use USDC fields/payment_flow instead of primary price_lamports.
    status: completed
  - id: scripts-docs-runbooks
    content: Retire or rewrite obsolete lamport operator scripts and add production/mainnet readiness runbooks.
    status: completed
  - id: tests-verification
    content: Replace stale SOL tests, add USDC contract coverage, and run the M12 verification suite.
    status: completed
isProject: false
---

# Milestone 12 Production Hardening Plan

## Scope
- Implement [docs/USDC_NATIVE_MIGRATION.md](file:///Users/andysustic/Repos/agent-reputation-oracle/docs/USDC_NATIVE_MIGRATION.md) Milestone 12.
- Do not implement Milestone 13 escrow/refund protocol changes. Only inventory the handoff items already called out in the migration doc.
- Keep SOL references only where they are truly about rent, fees, ATA creation, historical v0.1 metadata, or explicit legacy read-only notices.

## Implementation Order
1. Normalize the listing/access contract first.
   - Add or reuse a shared web helper under [web/lib](file:///Users/andysustic/Repos/agent-reputation-oracle/web/lib) that derives effective `price_usdc_micros`, `currency_mint`, `payment_flow`, source, listing address, and buyer access without stuffing USDC micros into `price_lamports`.
   - Rename misleading internal reads like `getOnChainPrice().price` in [web/lib/onchain.ts](file:///Users/andysustic/Repos/agent-reputation-oracle/web/lib/onchain.ts) to make USDC micros explicit.
   - Treat `price_lamports` as historical/legacy only.

2. Update API routes around the normalized contract.
   - [web/app/api/skills/route.ts](file:///Users/andysustic/Repos/agent-reputation-oracle/web/app/api/skills/route.ts): merge chain overlays into repo rows using USDC fields, fix chain-only buyer access, and stop deriving `legacy-sol` from USDC amounts.
   - [web/app/api/skills/[id]/route.ts](file:///Users/andysustic/Repos/agent-reputation-oracle/web/app/api/skills/%5Bid%5D/route.ts): return one coherent detail shape for repo-backed and chain-only listings.
   - [web/app/api/skills/[id]/raw/route.ts](file:///Users/andysustic/Repos/agent-reputation-oracle/web/app/api/skills/%5Bid%5D/raw/route.ts): disable or hard-gate legacy SOL payment fallback so USDC micros cannot become SOL payment requirements.
   - [web/app/api/skills/[id]/install/route.ts](file:///Users/andysustic/Repos/agent-reputation-oracle/web/app/api/skills/%5Bid%5D/install/route.ts), [web/app/api/skills/[id]/update/route.ts](file:///Users/andysustic/Repos/agent-reputation-oracle/web/app/api/skills/%5Bid%5D/update/route.ts), [web/app/api/index/skills/route.ts](file:///Users/andysustic/Repos/agent-reputation-oracle/web/app/api/index/skills/route.ts), and [web/app/api/skills/activity/route.ts](file:///Users/andysustic/Repos/agent-reputation-oracle/web/app/api/skills/activity/route.ts): align projections and payment flow labels.

3. Update UI and CLI consumers.
   - [web/app/skills/page.tsx](file:///Users/andysustic/Repos/agent-reputation-oracle/web/app/skills/page.tsx), [web/app/skills/[id]/page.tsx](file:///Users/andysustic/Repos/agent-reputation-oracle/web/app/skills/%5Bid%5D/page.tsx), [web/app/skills/publish/page.tsx](file:///Users/andysustic/Repos/agent-reputation-oracle/web/app/skills/publish/page.tsx), and [web/app/author/[pubkey]/page.tsx](file:///Users/andysustic/Repos/agent-reputation-oracle/web/app/author/%5Bpubkey%5D/page.tsx) should display USDC pricing/trust by default and reserve SOL copy for fees/rent or explicit legacy paths.
   - [packages/agentvouch-cli](file:///Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli) should branch on `payment_flow` and `price_usdc_micros`, not `price_lamports`, for install/list/metadata output.

4. Retire obsolete operator paths and update docs.
   - Rewrite or clearly deprecate [scripts/init-config.ts](file:///Users/andysustic/Repos/agent-reputation-oracle/scripts/init-config.ts) and [scripts/vouch.ts](file:///Users/andysustic/Repos/agent-reputation-oracle/scripts/vouch.ts) so maintainers do not run lamport-denominated v0.1 scripts by accident.
   - Add a production runbook, likely [docs/PRODUCTION_RUNBOOK.md](file:///Users/andysustic/Repos/agent-reputation-oracle/docs/PRODUCTION_RUNBOOK.md), covering Vercel, Neon, Solana RPC/env, authorities, rollback, and smoke checks.
   - Add a mainnet readiness policy, likely [docs/MAINNET_READINESS.md](file:///Users/andysustic/Repos/agent-reputation-oracle/docs/MAINNET_READINESS.md), extracting the operational checklist from the migration doc into an operator-readable form.
   - Patch [README.md](file:///Users/andysustic/Repos/agent-reputation-oracle/README.md), [docs/DEPLOY.md](file:///Users/andysustic/Repos/agent-reputation-oracle/docs/DEPLOY.md), and [docs/program-upgrades-and-redploys.md](file:///Users/andysustic/Repos/agent-reputation-oracle/docs/program-upgrades-and-redploys.md) so they point at USDC-native v0.2 and the new runbooks.

5. Replace stale tests and add focused coverage.
   - Update source-string and API tests under [web/__tests__](file:///Users/andysustic/Repos/agent-reputation-oracle/web/__tests__) for repo-backed paid USDC, chain-only paid USDC, free skills with author-bond requirements, buyer access, and disabled legacy fallback behavior.
   - Update CLI tests under [packages/agentvouch-cli/test](file:///Users/andysustic/Repos/agent-reputation-oracle/packages/agentvouch-cli/test) to mock USDC-native fields and payment flows.
   - Keep tests that intentionally cover SOL rent/fees, but rename fixtures/copy so they do not imply SOL pricing.

## Verification
- Targeted searches:
  - `rg "0\.001 SOL|legacy SOL|ELmVnLSN|Use SOL Fallback|Buy & Unlock" README.md docs web packages scripts`
  - `rg "price_lamports|priceLamports|LAMPORTS_PER_SOL|formatSol" web packages scripts docs`
- Test/build gates:
  - `npm test --workspace @agentvouch/web`
  - `npm test --workspace @agentvouch/cli`
  - `npm run build --workspace @agentvouch/web`
  - `NO_DNA=1 anchor test`
  - `npm run smoke:flow-surface`
- Live devnet write smoke remains approval-gated: simulate/preflight first, then only run `npm run smoke:devnet-usdc -- --apply` after explicit approval.