---
name: kora-usdc-fee-abstraction
overview: "Integrate Kora as the Solana fee relayer/paymaster path so AgentVouch users can pay network and, after protocol payer changes, rent costs in USDC instead of holding SOL."
todos:
  - id: operator-decision
    content: Choose self-hosted Kora vs. managed provider, signer backend, auth mode, fee token, and pricing model for devnet and mainnet
    status: pending
  - id: fee-only-spike
    content: Add a feature-flagged Kora fee-only sponsored transaction path for direct purchase_skill on devnet without changing the Anchor interfaces
    status: pending
  - id: rent-payer-design
    content: Design and implement explicit rent_payer accounts for init/init_if_needed program paths that must become fully no-SOL for end users
    status: pending
  - id: web-transaction-proxy
    content: Add server-mediated sponsored transaction prepare/submit APIs and a shared web transaction helper that never exposes Kora secrets to the browser
    status: pending
  - id: extend-flows
    content: Extend sponsorship from purchase_skill to register_agent, vouch, author bond, publish/listing, dispute, claim, and withdraw flows in priority order
    status: pending
  - id: copy-and-docs
    content: Update preflight copy, /docs, public skill.md, CLI help, and operator runbooks only after the relevant sponsored paths are live
    status: pending
  - id: verification
    content: Run unit tests, NO_DNA=1 anchor build after program changes, npm run generate:client after IDL changes, web build, and devnet sponsored smoke tests
    status: pending
isProject: false
---

# Kora USDC Fee Abstraction

## Status

Deferred as of 2026-06-22 behind `.agents/plans/solana-usdc-sponsored-checkout.plan.md`.

Kora remains the preferred production hardening path for Solana fee abstraction, but the next implementation branch should first prove the native sponsored checkout shape without Kora: typed server-side prepare/submit, buyer partial signing, sponsor-paid SOL fee/rent, buyer-signed USDC reimbursement, and direct `purchase_skill` verification. If that spike works, Kora can replace the bespoke sponsor service with stronger validation policy, signer custody, rate limits, fee collection, and monitoring.

## Goal

Make Solana transaction friction stop being the reason a buyer, author, voucher, or challenger fails an AgentVouch flow. The target user experience is: users hold USDC, sign AgentVouch actions, and do not need to acquire SOL. Kora pays SOL at the transaction layer and receives a configured SPL-token fee, preferably USDC.

External references verified 2026-06-19:

- Solana Cookbook: `feePayer` plus batched token reimbursement enables paying fees with any token.
- Kora docs: Kora is a Solana signing/paymaster service with JSON-RPC, TypeScript SDK, allowlists, API key/HMAC auth, fee pricing models, spend protection, and monitoring.
- Kora fee docs: Margin pricing includes base fees, account creation costs when Kora funds account creation, Kora signature fee, fee-payer outflow, payment instruction cost, transfer fees, and margin. Fixed/free pricing is dangerous if fee-payer outflow is not tightly blocked.

## Scope

- In scope: Kora-backed fee payment for AgentVouch Solana transactions, initially on devnet.
- In scope: feature-gated web checkout path for `purchase_skill` as the first buyer-facing proof.
- In scope: operator configuration, server-side proxying, Kora validation policy, monitoring, and fallback to the current wallet-paid path.
- In scope: Anchor account interface changes where needed to split the domain actor (`buyer`, `voucher`, `author`, `challenger`) from the account/rent payer.
- Out of scope: moving AgentVouch to Base or another EVM chain.
- Out of scope: treating x402 as a replacement for protocol-visible purchases. x402 remains the HTTP payment envelope; `purchase_skill` / `settle_x402_purchase` remain the protocol state anchors.
- Out of scope: credit-card onboarding, custodial marketplace accounts, or Stripe/fiat rails.

## Current Evidence

- Browser transaction sends go through `sendIx` helpers that call `getClientTransactionHelper().prepareAndSend(...)`, using the connected wallet signer as authority and implicit payer.
- `purchase_skill` preflight still tells buyers they need USDC plus SOL for receipt rent and network fees.
- `purchase_skill` currently initializes the `Purchase` PDA with `payer = buyer` and initializes the author reward vault with `payer = buyer` when needed.
- Other first-time paths have similar payer coupling: `register_agent` uses `payer = authority`, `vouch` uses `payer = voucher`, `deposit_author_bond` uses `payer = author`, `create_skill_listing` uses `payer = author`, `open_author_dispute` uses `payer = challenger`, and `claim_purchase_refund` uses `payer = buyer`.
- `settle_x402_purchase` already demonstrates the pattern we want for backend-mediated settlement: `settlement_authority` pays program-created purchase/receipt accounts while preserving protocol state.

## Design

### Layer 1: Fee-Only Kora Spike

Implement a devnet-only, feature-flagged path where Kora is the transaction `feePayer` and the user reimburses Kora in USDC.

This proves:

- Wallets can partially sign AgentVouch transactions while a separate Kora signer pays fees.
- Kora validates our program instructions and refuses unexpected transactions.
- The UI can quote the extra USDC fee and preserve the current direct `purchase_skill` semantics.
- The app can fall back cleanly to the current wallet-paid path.

Limitation: fee-only Kora does not remove all SOL requirements if the Anchor instruction still has `payer = buyer` / `payer = voucher` / `payer = author`. The user may still need lamports for PDA/vault rent on first-time flows.

### Layer 2: Avoid Unsafe Rent Prefunding

A quick prototype could prepend a bounded SOL transfer from the Kora fee payer to the user so the existing `payer = user` Anchor constraints have lamports to spend in the same transaction. Do not ship this as the main design unless security review blesses it.

Reasons:

- It requires permitting SOL outflow from the Kora payer.
- Kora's fee docs explicitly warn that fixed/free pricing plus fee-payer outflow can drain the payer if policies are loose.
- Leftover lamports could strand on the user account unless the transaction also reclaims them safely.

If used for a smoke test, enforce low `max_allowed_lamports`, margin pricing, HMAC/API-key auth, and transaction-shape validation that proves the outflow is bounded by expected AgentVouch account rent.

### Layer 3: Explicit Rent Payer Program Interfaces

For real no-SOL UX, split account creation payment from business authority:

- `buyer` remains the signer and USDC token authority for `purchase_skill`.
- `rent_payer` becomes the payer for `Purchase` PDA and any `init_if_needed` vaults.
- Kora signs as `rent_payer` and transaction fee payer, then charges the buyer in USDC.

Apply the same pattern to:

- `register_agent`: `authority` owns the profile; `rent_payer` creates it.
- `vouch`: `voucher` authorizes USDC transfer; `rent_payer` creates `Vouch` and vault accounts.
- `deposit_author_bond`: `author` authorizes USDC transfer; `rent_payer` creates bond/vault accounts.
- `create_skill_listing` / `initialize_listing_settlement`: `author` owns listing; `rent_payer` pays listing and settlement account rent.
- `open_author_dispute`: `challenger` authorizes bond; `rent_payer` creates dispute/vault accounts.
- `claim_purchase_refund`: `buyer` claims; `rent_payer` creates the refund receipt.
- Client-side ATA creation instructions: use the Kora/rent payer where the ATA payer can safely differ from the token-account owner.

Store refund recipients deliberately. Existing account structs record rent payers in several places; if Kora pays rent, close paths should return SOL rent to the intended sponsor/treasury account, not imply the user funded it.

## Operator Configuration

### Devnet

- Self-host Kora first so validation and metrics are inspectable.
- Use devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- Use API key or HMAC auth; do not expose write-capable Kora credentials in browser bundles.
- Use conservative spend/rate limits and a small SOL-funded payer.
- Free pricing is acceptable only for isolated devnet testing with fee-payer outflow blocked. Use margin pricing when testing rent-payer outflow.

### Mainnet

- Prefer Turnkey, Privy, Vault, or another managed signer over a raw private key.
- Use mainnet USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
- Use HMAC or API key auth plus IP/service-level controls.
- Use margin pricing unless the payer policy blocks all fee-payer outflow.
- Set `max_allowed_lamports` and per-wallet/per-IP/per-session rate limits.
- Monitor payer SOL balance, USDC fee receipts, Kora errors, rejected validation attempts, and abnormal outflow.

### Validation Policy

Allow only the minimum required programs and accounts:

- AgentVouch program ID.
- SPL Token and Associated Token programs.
- System Program only for expected account creation/rent flows.
- Compute Budget when needed.
- Memo only if a specific flow needs it.

Reject:

- Unknown program IDs.
- Arbitrary SOL transfers from the Kora fee payer.
- Token transfers from Kora-controlled token accounts.
- Authority-changing instructions.
- Transactions where user-paid USDC fee exceeds the quoted cap.
- Transactions where the AgentVouch instruction does not match a typed server-side intent.

## Web/API Architecture

Do not let the browser call a privileged Kora endpoint directly.

Preferred flow:

1. Client submits a typed action intent to a server route, for example `POST /api/transactions/sponsored/prepare`.
2. Server validates the action against current app state and builds the AgentVouch transaction shape.
3. Server asks Kora for payer/payment info and fee quote, appends the Kora USDC fee payment instruction, and returns a serialized transaction plus a human-readable quote.
4. Client wallet signs the transaction.
5. Client sends the signed transaction to `POST /api/transactions/sponsored/submit`.
6. Server re-validates shape/signatures and calls Kora `signAndSendTransaction`.
7. Server returns the confirmed signature and the UI runs the same post-confirmation verification already used by the direct path.

This keeps Kora secrets server-side and avoids a generic "sign arbitrary transaction for this user" API. Route names can change during implementation, but the invariant should not: server accepts typed AgentVouch intents, not arbitrary base64 transactions, until a security review approves broader validation.

## Files To Change

- `web/hooks/useMarketplaceOracle.ts`: route `purchaseSkill` through the sponsored transaction helper when feature-enabled.
- `web/hooks/useReputationOracle.ts`: migrate write flows after `purchaseSkill` proves out.
- `web/lib/solanaTransactionHelper.ts`: add or delegate to a sponsored send helper.
- `web/lib/purchasePreflight.ts`: replace SOL-required copy with sponsor-aware status and fallback copy once the path is live.
- `web/lib/agentvouchUsdc.ts`: include Kora fee summaries in transaction logs/receipts.
- `web/app/api/...`: add server-mediated Kora prepare/submit endpoints.
- `programs/agentvouch/src/instructions/*.rs`: add explicit `rent_payer` accounts where first-time account creation must be no-SOL for the user.
- `web/generated/agentvouch/`, `web/agentvouch.json`, `packages/agentvouch-cli/src/idl/agentvouch.ts`: regenerate after Anchor IDL changes.
- `packages/agentvouch-cli`: add optional sponsored transaction flags only after the web path is stable.
- `docs/ARCHITECTURE.md`, `docs/PHASE_1_FRICTION.md`, `docs/PRODUCTION_RUNBOOK.md`, `web/public/skill.md`: update public/operator docs when behavior ships.

## Implementation Steps

1. Decide operator path and record env names:
   - `KORA_RPC_URL`
   - `KORA_API_KEY` or `KORA_HMAC_SECRET`
   - `KORA_FEE_TOKEN_MINT`
   - `AGENTVOUCH_KORA_SPONSORSHIP_ENABLED`
   - optional `AGENTVOUCH_KORA_RENT_PAYER_ENABLED`
2. Stand up Kora on devnet with AgentVouch allowlists and USDC fee token support.
3. Add a server-side Kora client wrapper that supports config, fee estimate, payment instruction, sign, and sign-and-send calls.
4. Add the typed prepare/submit API for `purchase_skill` only.
5. Add web helper support and a UI/preflight branch for sponsored `purchase_skill`.
6. Smoke direct purchase on devnet with:
   - buyer has USDC but no SOL
   - buyer has USDC ATA
   - author reward vault already exists
   - Kora fee quote shown before signing
7. Decide the rent-payer interface change based on spike results; do not advertise "no SOL" until first-time account creation is covered.
8. Implement `rent_payer` Anchor changes for `purchase_skill`; rebuild IDL and generated client.
9. Extend to `register_agent`, `vouch`, `deposit_author_bond`, `create_skill_listing`, `open_author_dispute`, claims, and withdrawals.
10. Update docs and public copy only after each flow is actually sponsored.

## Verification

For docs-only planning changes:

- `git diff --check`

For fee-only implementation:

- Unit tests for Kora wrapper validation and API route shape checks.
- Web tests for sponsor-aware purchase preflight and fallback copy.
- `npm run build --workspace @agentvouch/web`.
- Devnet smoke: buyer with USDC and insufficient SOL completes `purchase_skill` when no new rent-funded accounts are needed.

For Anchor rent-payer implementation:

- `NO_DNA=1 anchor build`
- Copy `target/idl/agentvouch.json` to `web/agentvouch.json`
- `npm run generate:client`
- Anchor tests covering old direct payer and new rent-payer paths.
- Web tests/build after client regen.
- Devnet smoke: fresh buyer with USDC but no SOL completes first `purchase_skill`, creates receipt/vaults as needed, verifies entitlement, and downloads raw content.

## Rollout

1. Devnet-only hidden feature flag.
2. Preview deployment with Kora pointing at a low-balance devnet payer.
3. Enable only for direct `purchase_skill` on a known smoke listing.
4. Expand to all devnet purchases after several clean runs.
5. Add rent-payer protocol changes and re-smoke from fresh wallets.
6. Only consider mainnet after authority, signer custody, monitoring, limits, and incident response are documented.

## Rollback

- Disable `AGENTVOUCH_KORA_SPONSORSHIP_ENABLED` to fall back to wallet-paid transactions.
- Keep existing direct transaction path until sponsored flows are proven.
- If Anchor rent-payer changes regress, redeploy the previous devnet program build or use the normal clean-break process before mainnet.
- Do not remove SOL fallback copy until Kora has production soak.

## Blockers / Open Questions

- Does the current `@solana/client` transaction helper expose enough hooks to set an external fee payer and return a transaction for user partial signing, or should sponsored paths use `@solana/kora` directly?
- Should AgentVouch absorb Kora fees for purchases, or charge the buyer in USDC as a separate line item?
- Who receives rent refunds when Kora pays rent: Kora fee payer, protocol treasury, or a dedicated rent sponsor account?
- Can the sponsored transaction API remain typed by action through all flows, or do we need a generic validator for advanced CLI/MCP use?
- Does Kora validation see and price Anchor CPI account creation cleanly when the Kora signer is an account inside the AgentVouch instruction, or do we need explicit System Program instructions?
- What mainnet sponsor liability is acceptable for sybil-heavy actions like `register_agent` and free listing creation?
