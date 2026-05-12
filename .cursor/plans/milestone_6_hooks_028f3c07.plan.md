---
name: Milestone 6 Hooks
overview: "Implement Milestone 6 from `docs/USDC_NATIVE_MIGRATION.md`: move app on-chain write hooks onto the v0.2.0 USDC-native generated instructions, fix active preflight/guard logic, and verify the web build."
todos:
  - id: m6-map-generated-inputs
    content: Map every hook write flow to the generated v0.2.0 instruction inputs and PDA/ATA requirements
    status: completed
  - id: m6-usdc-helpers
    content: Add shared USDC amount, ATA, token account, balance, and transaction summary helpers
    status: completed
  - id: m6-reputation-hook-writes
    content: Update `useReputationOracle.ts` write flows to typed USDC instruction calls without `as any`
    status: completed
  - id: m6-purchase-hook-unify
    content: Unify `useMarketplaceOracle.ts` and `useReputationOracle.ts` purchase behavior and preflight errors
    status: completed
  - id: m6-preflight-simulation
    content: Replace active SOL preflight checks with USDC balance/token-account checks and add feasible simulation/summary plumbing
    status: completed
  - id: m6-verify
    content: Run grep, lints, and `npm run build --workspace @agentvouch/web`; record any Milestone 8 x402 leftovers
    status: completed
isProject: false
---

# Milestone 6: Web Hook Integration

## Scope
- Target `web/hooks/useReputationOracle.ts`, `web/hooks/useMarketplaceOracle.ts`, and active shared hook helpers in `web/lib/purchasePreflight.ts` / `web/lib/pricing.ts`.
- Keep x402 bridge cleanup out of this milestone unless it blocks the hook flows; note any remaining legacy x402 grep hits as Milestone 8 follow-up.
- Preserve existing read-only legacy display paths only where they are not used for v0.2.0 writes.

## Implementation Plan
1. Add or consolidate small USDC helpers: decimal conversion to `*_usdc_micros`, formatting, configured USDC mint, ATA derivation, and account existence/balance checks.
2. Replace `useReputationOracle.ts` write calls that currently use `as any`, lamport field names, or missing token accounts with typed generated instruction inputs for:
   - author bond deposit/withdraw
   - vouch/revoke
   - create/update listing
   - purchase skill
   - claim voucher revenue
   - open/resolve dispute
3. Share the correct purchase path between `useReputationOracle.ts` and `useMarketplaceOracle.ts` so both derive buyer/author USDC ATAs, use `listing.data.rewardVault`, and produce the same errors.
4. Replace the active SOL purchase preflight model with a USDC-aware model:
   - check buyer USDC token balance against `priceUsdcMicros`
   - check fee-payer SOL only for rent/fees
   - report missing/wrong token accounts clearly
   - remove author SOL rent-floor blocking from v0.2.0 purchases
5. Add transaction summary plumbing near `sendIx` for wallet-facing/debug context: token, amount, key recipient/vault, fee payer, and configured cluster. If the current wallet send abstraction cannot surface a confirmation UI summary directly, log/return a normalized summary object from each write path.
6. Add simulate-before-sign where the existing Solana client abstraction supports it cleanly. If it requires a larger transaction-construction refactor, add a contained simulation helper for generated instructions and document any remaining wallet-adapter limitation.

## Verification
- Run targeted searches for stale active-hook names: `rg "as any|LAMPORTS_PER_SOL|priceLamports|authorBondLamports|stakeAmount" web/hooks web/lib`.
- Run lints on edited files with `ReadLints`.
- Run `npm run build --workspace @agentvouch/web`.
- If hook changes touch generated instruction assumptions, run `NO_DNA=1 anchor build` only if needed; otherwise skip Anchor build and state why.