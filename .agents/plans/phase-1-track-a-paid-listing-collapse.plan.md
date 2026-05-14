---
name: phase-1-track-a-paid-listing-collapse
overview: "Disable new repo-only paid x402 marketplace purchases and require paid repo-backed skills to link an on-chain SkillListing before they are purchasable."
todos:
  - id: add-listing-required-flow
    content: Add listing-required as the unavailable payment flow for paid repo skills without an on-chain SkillListing.
    status: pending
  - id: disable-repo-only-paid-x402
    content: Stop the raw skill route from issuing repo-only x402 payment requirements for new unlinked paid purchases.
    status: pending
  - id: preserve-existing-entitlements
    content: Keep signed raw re-downloads working for buyers who already have valid entitlements.
    status: pending
  - id: enforce-publish-must-link
    content: Make paid publish/link flows report failure or incomplete setup until an on-chain SkillListing is linked.
    status: pending
  - id: update-web-cli-and-docs
    content: Update web UI, API responses, CLI output, and docs to explain listing-required paid skills.
    status: pending
  - id: clean-devnet-unlinked-paid-skills
    content: Dry-run and then clean devnet paid repo skills with price_usdc_micros but no on_chain_address after explicit approval.
    status: pending
  - id: verify-track-a
    content: Run focused tests and web build proving unlinked paid skills no longer produce repo-only x402 purchases.
    status: pending
isProject: true
---

# Phase 1 Track A: Paid Listing Collapse

## Goal

Paid marketplace purchases should preserve AgentVouch protocol economics. A paid repo-backed skill is not purchasable until it has an on-chain `SkillListing`; linked paid skills continue through direct `purchase_skill`, which creates protocol purchase state and voucher rewards.

## Scope

- In scope: web/API payment-flow modeling, raw download gating, install/update route behavior, marketplace/detail UI copy, CLI install/publish/link behavior, public docs, focused tests, and devnet cleanup runbook.
- Out of scope: `settle_x402_purchase`, x402 facilitator bridge work, Anchor account/interface changes, mainnet data cleanup, and Phantom embedded paid checkout.
- Free repo-backed skills remain repo-only. Existing valid paid entitlements may continue to re-download raw content through signed `X-AgentVouch-Auth`.

## Current State

- `docs/PHASE_1_FRICTION.md` records that Phase 1 has Track A and Track B.
- `web/app/api/skills/[id]/raw/route.ts` still creates repo-only x402 requirements for paid repo skills with no `on_chain_address`.
- `web/lib/listingContract.ts` maps paid skills with no `on_chain_address` to `x402-usdc`.
- `purchase_skill` is the only shipped path that creates a `Purchase` PDA and voucher reward accounting.
- Repo-only x402 receipts and entitlements are off-chain compatibility artifacts; they must not be the new paid marketplace purchase path.

## Files To Change

- `web/lib/listingContract.ts`: add `listing-required` to `SkillPaymentFlow` and return it for paid repo skills without `on_chain_address`.
- `web/app/api/skills/[id]/raw/route.ts`: stop issuing repo-only x402 requirements for unlinked paid skills; keep existing signed entitlement downloads.
- `web/app/api/skills/route.ts`, `web/app/api/skills/[id]/route.ts`, `web/app/api/skills/[id]/install/route.ts`, `web/app/api/skills/[id]/update/route.ts`: return and honor `listing-required` state.
- `web/components/SkillPreviewCard.tsx`, `web/app/skills/page.tsx`, `web/app/skills/[id]/page.tsx`: show listing-required status without buyer purchase CTAs.
- `packages/agentvouch-cli/src/lib/http.ts`, `packages/agentvouch-cli/src/lib/install.ts`, `packages/agentvouch-cli/src/lib/publish.ts`, `packages/agentvouch-cli/src/lib/format.ts`: refuse listing-required installs and make paid publish/link completion explicit.
- `web/public/skill.md`, `web/app/docs/page.tsx`, `docs/USDC_NATIVE_MIGRATION.md`: align public docs with the Track A behavior.
- Relevant tests under `web/__tests__` and `packages/agentvouch-cli/test`.

## Implementation Steps

1. Add `listing-required` to the payment-flow model.
   - Update the `SkillPaymentFlow` union in `web/lib/listingContract.ts`.
   - Return `listing-required` when `normalizeUsdcMicros(priceUsdcMicros)` is truthy and `onChainAddress` is null.
   - Update API and CLI type handling so `listing-required` is unavailable, not a payment option.

2. Disable new repo-only paid x402 sales.
   - In `web/app/api/skills/[id]/raw/route.ts`, branch before x402 requirement creation when a paid repo skill has no `on_chain_address`.
   - If `X-AgentVouch-Auth` proves an existing entitlement, continue returning raw content.
   - If no entitlement exists, return a `402` JSON body with `payment_flow: "listing-required"`, `amount_micros`, `currency_mint`, and a clear setup message.
   - Do not include `PAYMENT-REQUIRED`, `Accept-Payment`, or facilitator payment requirements for `listing-required`.
   - Keep linked paid skills on `direct-purchase-skill`.

3. Update install, update, and listing APIs.
   - Ensure skill list/detail responses expose `listing-required` for unlinked paid skills.
   - Ensure install/update routes do not offer repo-only x402 instructions for unlinked paid skills.
   - Preserve free skill install/update behavior.

4. Enforce Publish Must Link.
   - Keep the current CLI flow if needed: create repo skill, then create/link the on-chain listing.
   - Treat a paid link failure as an incomplete paid publish, not as a successful purchasable listing.
   - Print the retry command: `agentvouch skill link-listing <repo-skill-id> --price-usdc <amount>`.
   - Make sure failed-link rows cannot later produce repo-only x402 payment requirements.

5. Update web UI and docs.
   - On marketplace/detail surfaces, hide paid buyer purchase/unlock CTAs for `listing-required`.
   - Show author-facing setup copy when the connected wallet matches `skill.author_pubkey`.
   - Use buyer-facing copy such as "Purchase unavailable while the author links the on-chain listing" for other users.
   - Update `web/public/skill.md` and `/docs#paid-skill-download` so agents do not treat repo-only paid x402 as current marketplace behavior.

6. Add devnet cleanup runbook.
   - Dry-run query:
     ```sql
     SELECT id, skill_id, author_pubkey, price_usdc_micros, on_chain_address
     FROM skills
     WHERE price_usdc_micros IS NOT NULL
       AND price_usdc_micros::bigint > 0
       AND on_chain_address IS NULL;
     ```
   - After explicit approval in the execution turn, delete or archive those devnet rows. Prefer deleting stale devnet fixtures so versions, receipts, and entitlements cascade cleanly.
   - Do not run destructive cleanup against production or mainnet data.

## Verification

- Unit/API tests:
  - Unlinked paid repo skill returns `payment_flow: "listing-required"` with no `PAYMENT-REQUIRED` header.
  - Existing entitlement for an unlinked paid repo skill still re-downloads with signed `X-AgentVouch-Auth`.
  - Linked paid skill still returns `direct-purchase-skill`.
  - Free skill raw/install behavior is unchanged.
  - CLI install refuses listing-required paid skills with clear copy.
  - Paid publish reports incomplete setup when linking fails and prints the retry command.

- Commands:
  ```bash
  npm run test --workspace @agentvouch/web
  npm run test --workspace @agentvouch/cli
  npm run build --workspace @agentvouch/web
  rg "listing-required|repo-only x402|direct-purchase-skill" web packages docs
  ```

- Manual devnet smoke:
  - Create or inspect an unlinked paid repo skill and confirm raw download returns `listing-required`, not x402.
  - Confirm a signed existing entitlement can still re-download.
  - Link a paid repo skill to an on-chain `SkillListing` and confirm direct `purchase_skill` still unlocks raw content.

## Rollout

1. Ship Track A with all x402 bridge flags disabled.
2. Deploy a Vercel preview and smoke the unlinked paid, free skill, and linked paid paths.
3. Dry-run the devnet cleanup query and review the result count.
4. After explicit approval, clean stale devnet unlinked paid rows.
5. Redeploy production devnet after cleanup if marketplace metrics or list views depend on those rows.

## Rollback

- Revert the raw route and payment-flow changes if an emergency requires legacy repo-only paid x402, but document that voucher rewards are bypassed.
- Keep `listing-required` docs in `PHASE_1_FRICTION.md` unless the product decision changes.
- If CLI publish changes regress unpaid publishing, revert the CLI publish/link changes only and keep raw route fail-closed.
- Do not restore deleted devnet rows unless a pre-cleanup export or Neon branch snapshot is available.

## Blockers

- None expected for the web/API/CLI collapse path.
- Devnet cleanup requires explicit approval in the execution turn because it is destructive.
- If existing tests assume `x402-usdc` for paid unlinked skills, update those expectations to `listing-required` rather than preserving legacy behavior.
