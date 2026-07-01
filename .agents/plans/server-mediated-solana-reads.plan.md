---
name: server-mediated-solana-reads
overview: "Move public Solana account reads out of browser hooks and behind server APIs, starting with useMarketplaceOracle, while preserving wallet-side transaction flows."
todos:
  - id: inventory-browser-rpc
    content: Inventory browser-side Solana RPC reads and classify each as public read, buyer-specific read, or wallet transaction support
    status: pending
  - id: add-server-read-apis
    content: Add server API/read helpers for marketplace listings, author-filtered listings, purchases, and any dashboard reads currently fetched through useMarketplaceOracle
    status: pending
  - id: migrate-marketplace-hook
    content: Refactor useMarketplaceOracle public read methods to call the server APIs instead of createSolanaRpc(NEXT_PUBLIC_SOLANA_RPC_URL)
    status: pending
  - id: migrate-consumers
    content: Update dashboard, marketplace, and related consumers to use the refactored hook/API contract without reintroducing client RPC scans
    status: pending
  - id: verify-and-document
    content: Run tests/build, smoke key pages, and update AGENTS.md/docs only after browser public reads are actually server-mediated
    status: pending
isProject: false
---

# Server-Mediated Solana Reads

## Goal
Move public Solana account reads out of browser bundles and behind Next.js API routes that use server-side `SOLANA_RPC_URL`. The first concrete target is `web/hooks/useMarketplaceOracle.ts`, whose `getAllSkillListings` path still does a browser-side `getProgramAccounts` scan. This implements the invariant documented in `AGENTS.md`: browser RPC reads are transitional until public reads are fully server-mediated.

## Scope
- In scope: public marketplace/listing reads, author-filtered listing reads, purchase/account discovery reads used by dashboard or marketplace surfaces, and the browser hook methods that currently wrap those reads.
- In scope: server-side route caching and private/no-store treatment for buyer-specific reads.
- In scope: keeping wallet transaction construction/signing flows functional while reducing public read RPC traffic from the browser.
- Out of scope: removing `NEXT_PUBLIC_SOLANA_RPC_URL` immediately. Keep it until all browser-side public reads are gone and remaining wallet-side RPC use is intentionally documented.
- Out of scope: changing on-chain program interfaces, generated Codama output, or marketplace economics.

## Current Evidence
- `AGENTS.md:27` states the invariant: server-side Solana reads use `SOLANA_RPC_URL`, browser or wallet hooks still calling RPC directly must use `NEXT_PUBLIC_SOLANA_RPC_URL`, and both env vars stay aligned until public reads are fully server-mediated.
- `web/hooks/useMarketplaceOracle.ts:310` calls `rpc.getProgramAccounts(...)` from a client hook in `getAllSkillListings`.
- `web/hooks/useMarketplaceOracle.ts` also contains client-side account reads for author listings, purchases, and purchase lookups.
- `web/app/skills/page.tsx` already avoids `oracle.getAllSkillListings`, and existing tests assert that, but `web/app/dashboard/page.tsx` still calls `oracle.getAllSkillListings()`.

## Files To Change
- `web/hooks/useMarketplaceOracle.ts`: replace public read methods with API fetches; keep transaction send/sign helpers local to the wallet.
- `web/app/api/skills/route.ts`: reuse or extend existing server-mediated skill/listing response where it already covers the needed data.
- `web/app/api/skills/hydrate/route.ts`: keep buyer/preflight hydration server-mediated where applicable.
- New route if needed, for example `web/app/api/chain/marketplace/route.ts`: expose decoded on-chain listing/purchase reads that are not naturally represented by `/api/skills`.
- `web/app/dashboard/page.tsx`: stop using browser RPC listing scans; consume server-mediated data.
- `web/__tests__/...`: add source tests that prevent `oracle.getAllSkillListings()` from returning to marketplace/dashboard hot paths, plus API tests for new server routes.
- `AGENTS.md`, `docs/PRODUCTION_RUNBOOK.md`, `web/public/skill.md`: update only after the migration changes what agents/operators should rely on.

## Implementation Steps
1. Inventory all `createSolanaRpc` and `getProgramAccounts` calls reachable from `"use client"` files.
2. Classify each call:
   - Public read: listing discovery, author listing discovery, purchase aggregate discovery.
   - Buyer-specific read: buyer purchase status or entitlement/preflight.
   - Wallet support: transaction send, signature confirmation, wallet balance checks needed immediately around a signed transaction.
3. Prefer existing APIs before adding new ones:
   - Use `/api/skills` for marketplace listing discovery where its response is sufficient.
   - Use `/api/skills/hydrate` for visible-card trust/preflight/buyer status.
   - Add a narrow server route only for data not already exposed cleanly.
4. Refactor `useMarketplaceOracle` so read methods fetch server JSON and normalize to the existing return shapes expected by consumers.
5. Update `web/app/dashboard/page.tsx` and any remaining consumers to avoid direct listing scans from browser hooks.
6. Keep `NEXT_PUBLIC_SOLANA_RPC_URL` while any browser wallet support path still needs it, but add comments distinguishing wallet transaction support from public reads.
7. Add tests that fail if the marketplace/dashboard pages call the browser hook methods for listing scans again.

## Verification
- `rg -n "getProgramAccounts|createSolanaRpc|NEXT_PUBLIC_SOLANA_RPC_URL" web/hooks web/components web/app` shows no public discovery reads left in client components/hooks.
- `npm run test --workspace @agentvouch/web`.
- `npm run build --workspace @agentvouch/web`.
- Browser smoke:
  - `/skills` loads cards without browser RPC 429 spam.
  - `/dashboard` loads listing/purchase sections without browser `getProgramAccounts` scans.
  - Purchase flow still signs, sends, and confirms transactions.
- Network smoke:
  - Server APIs use `SOLANA_RPC_URL`.
  - Private/buyer-specific responses use `private, no-store`.
  - Public list responses keep existing public cache policy.

## Rollout
- Land behind existing route behavior where possible so UI URLs do not change.
- Deploy preview and compare marketplace/dashboard load time and console noise before merging.
- Keep both `SOLANA_RPC_URL` and `NEXT_PUBLIC_SOLANA_RPC_URL` set to the same endpoint through the rollout.

## Rollback
- Revert the hook/API refactor commit if dashboard or purchase flows regress.
- Because the plan should not remove either env var, rollback should not require Vercel env changes.

## Blockers
- Do not delete `NEXT_PUBLIC_SOLANA_RPC_URL` until `rg` proves no browser-side public read paths remain.
- Do not move transaction signing or wallet-owned signing authority to the server.
- Do not expose unsigned buyer-specific purchase status with public cache headers.
