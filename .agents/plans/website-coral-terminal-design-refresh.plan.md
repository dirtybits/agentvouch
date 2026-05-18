---
name: website-coral-terminal-design-refresh
overview: "Refresh AgentVouch's homepage, marketplace cards, and skill detail purchase/trust surfaces around a sharper Coral Terminal trust-ledger design system without changing protocol or API behavior."
todos:
  - id: define-ledger-design-tokens
    content: Add shared Coral Terminal trust-ledger CSS utilities and token refinements that keep the existing lobster/sea palette but improve hierarchy and texture.
    status: pending
  - id: redesign-homepage-first-viewport
    content: Rework the homepage first viewport into an active trust-ledger product surface with marketplace, author backing, x402, and purchase-state signals.
    status: pending
  - id: redesign-skill-preview-cards
    content: Update SkillPreviewCard so marketplace browsing scans by title, price, trust status, backing, and action state without the current flat metric stack.
    status: pending
  - id: redesign-skill-detail-action-surface
    content: Reframe the skill detail page around trust, capability, and purchase/download state with a stronger desktop action panel and mobile stacking.
    status: pending
  - id: align-wallet-and-status-controls
    content: Tighten wallet, nav, status pill, tag, and CTA styling so buttons remain compact, consistent, and non-generic across light and dark themes.
    status: pending
  - id: verify-responsive-design
    content: Run tests/build plus desktop and mobile browser screenshots to verify layout, contrast, text fit, and purchase-state clarity.
    status: pending
isProject: true
---

# Website Coral Terminal Design Refresh

## Goal

Make AgentVouch feel like an on-chain trust desk for agents rather than a generic crypto marketplace. The refreshed UI should preserve the existing sharp, compact product feel while making the core proof obvious: every skill has author trust, backing, purchase state, and protocol economics behind it.

## Design Direction

**Coral Terminal / trust ledger.** Keep the current coral `#fd522e`, muted sea-blue accents, compact spacing, and `rounded-sm` bias. Push the visual language toward receipts, ledger rows, protocol event strips, and account-address rails. Avoid decorative gradient blobs, oversized marketing cards, soft SaaS radii, or a generic Web3 dashboard look.

The memorable first impression should be: **AgentVouch shows the economic receipt behind an agent skill.**

## Scope

- In scope: visual redesign and component structure for `web/app/page.tsx`, `web/app/skills/page.tsx`, `web/components/SkillPreviewCard.tsx`, `web/app/skills/[id]/page.tsx`, shared button/status styles, and minimal global CSS utilities.
- In scope: copy tightening only where it improves scanability of existing flows. Keep claims aligned to shipped protocol behavior.
- In scope: responsive behavior for desktop and mobile, including text fit in cards/buttons and no overlapping action surfaces.
- Out of scope: protocol changes, x402 bridge behavior changes, new API fields, DB migrations, Phantom/ConnectorKit changes, checkout logic changes, and Stripe/fiat flows.
- Out of scope: full docs redesign, author profile redesign, dashboard redesign, and major navigation restructuring. Those can follow after the first three surfaces land.

## Current State

- `web/app/globals.css` already defines the core lobster/sea/gold tokens and normalizes rounded utilities toward sharp corners.
- `web/app/layout.tsx` uses Inconsolata globally through `font-mono`, which supports the terminal identity but flattens hierarchy when every label, heading, and paragraph carries the same voice.
- `web/app/page.tsx` has useful live metrics and featured skills, but the first viewport is still mostly text plus a getting-started card.
- `web/components/SkillPreviewCard.tsx` exposes the right marketplace data, but the trust metrics currently read as an even-weight table rather than a quick buy/install decision surface.
- `web/app/skills/[id]/page.tsx` has the correct purchase and trust information, but the decision path is spread across many similar bordered panels.

## Files To Change

- `web/app/globals.css`: add ledger-oriented utilities and token refinements such as thin rail borders, receipt backgrounds, compact status strips, and reduced-motion-safe reveal styles.
- `web/lib/buttonStyles.ts`: keep button dimensions consistent while changing radii/classes from generic pill-like controls to compact command buttons.
- `web/components/AppNavbar.tsx`: ensure top-level nav actions, theme toggle, and `ClientWalletButton` stay visually aligned after button changes.
- `web/components/ClientWalletButton.tsx`: remove the lingering purple embedded-wallet button treatment and align wallet menu rows with the Coral Terminal palette.
- `web/app/page.tsx`: replace the current first viewport with a product-led trust ledger hero using existing `/api/landing` metrics and featured skills.
- `web/components/SkillPreviewCard.tsx`: redesign the marketplace card hierarchy around title, price, trust state, author backing, and action state.
- `web/app/skills/page.tsx`: adjust marketplace grid, tabs, filter row, activity feed, and empty states to support the new card rhythm.
- `web/app/skills/[id]/page.tsx`: restructure the upper detail page and purchase/trust area into a clearer decision flow with a sticky desktop action panel where practical.
- Existing source tests under `web/__tests__`: update source assertions that key on class names, status copy, or visible UI strings.

## Implementation Steps

1. Define shared ledger primitives.
   - Add CSS variables/utilities for `ledger-panel`, `ledger-strip`, `ledger-label`, `ledger-value`, `status-stamp`, and subtle paper/terminal textures.
   - Keep backgrounds quiet and inspectable: no decorative orbs, no heavy one-note dark-blue palette, no purple gradients.
   - Preserve `rounded-sm`/sharp component language and keep cards at 8px radius or less.
   - Add `prefers-reduced-motion` handling for any reveal or hover motion.

2. Redesign the homepage first viewport.
   - Keep `AgentVouch` and the existing hero subline substance, but make the first viewport show a live product ledger rather than a marketing card.
   - Use existing data already fetched in `LandingResponse`: authors, skills, revenue, staked, downloads, and `featuredSkills`.
   - Build a primary visual composed of real product signals: protocol-listed skill row, author backing, voucher reward split, x402/direct purchase status, and recent download/purchase counters.
   - Keep the first screen actionable with `Browse Skills`, `Agent Integration`, and wallet connect, but avoid visible tutorial-style text beyond necessary labels.
   - Let the next section peek below the fold on desktop and mobile.

3. Redesign marketplace skill cards.
   - Make the top scan line: skill name, price/status stamp, and source/version.
   - Collapse trust into a ledger strip with 3-4 dominant signals: reputation, backing, vouches, disputes.
   - Keep author wallet linked but secondary; avoid letting address text dominate the card.
   - Pin the primary action area so card heights feel stable across free, paid, listing-required, purchased, and own-skill states.
   - Keep tags compact; avoid rounded pills where a small stamped label or tag rail fits better.

4. Reframe the skill detail page.
   - Top section should answer three questions in order: "Can I trust this author?", "What does the skill do?", and "What happens if I buy/install?"
   - On desktop, move purchase/download state into a sticky right-side action panel if it does not fight the existing long detail content.
   - On mobile, stack purchase/download before long docs/API blocks so the primary action is not buried.
   - Keep author-owned skills on the `Manage Listing` path and preserve all current `listing-required`, embedded wallet fallback, signed re-download, refund status, and preflight copy.
   - Avoid hiding protocol details; make them more scannable with receipt rows.

5. Align controls and status language.
   - Update `navButton*` classes so wallet, theme, Dashboard, and primary CTAs share height/proportion.
   - Replace any purple Phantom/social wallet styling with sea/coral/gold tokens.
   - Standardize status stamps for `Free`, `USDC`, `Listing Required`, `Purchased`, `Your Skill`, `Devnet`, and `Protocol Listed`.
   - Check button text fits at mobile widths; shorten labels where needed rather than shrinking viewport-based fonts.

6. Update tests and snapshots/source checks.
   - Adjust tests that assert old text or class strings.
   - Add or update source tests for the new status vocabulary only when it protects an important behavior, not for every class.

## Verification

- Static/test commands:
  ```bash
  npm run test --workspace @agentvouch/web
  npm run build --workspace @agentvouch/web
  npm run build
  ```

- Browser verification:
  - Start the local web app with the repo's existing dev command.
  - Use the in-app browser or Playwright to inspect:
    - `http://localhost:3000/`
    - `http://localhost:3000/skills`
    - one free skill detail page
    - one protocol-listed paid skill detail page
    - one listing-required skill detail page if available
  - Capture desktop and mobile screenshots for the homepage, marketplace, and skill detail page.
  - Confirm text does not overlap or overflow in cards, buttons, wallet menus, status stamps, or purchase panels.
  - Confirm light and dark themes both preserve contrast, hierarchy, and the coral/sea/gold balance.

- Acceptance criteria:
  - Homepage first viewport communicates AgentVouch as an active trust/economics product, not a generic landing page.
  - Marketplace cards can be scanned by price, trust, backing, and action state in under a few seconds.
  - Skill detail page makes the trust and purchase decision path clearer without removing protocol details.
  - No protocol/API behavior changes are introduced.
  - Existing paid/free/listing-required/author-owned purchase states remain behaviorally unchanged.

## Rollout

1. Implement behind normal frontend code paths; no feature flag is expected because this is a visual refresh only.
2. Run the full verification gate locally.
3. Deploy a Vercel preview and compare homepage, marketplace, and skill detail pages against production.
4. Smoke the critical flows in preview:
   - browse marketplace
   - connect wallet
   - view paid listing as author and buyer
   - view purchased state
   - view listing-required state
5. Promote to production only after visual QA passes on desktop and mobile.

## Rollback

- Because this plan should not change APIs or protocol behavior, rollback is a normal revert of the visual refresh commit.
- Keep any test-only updates in the same commit as the UI changes so rollback restores the previous test expectations.
- If only one surface regresses, revert that surface independently:
  - homepage: `web/app/page.tsx` plus any homepage-only CSS
  - marketplace cards: `web/components/SkillPreviewCard.tsx` and `web/app/skills/page.tsx`
  - detail page: `web/app/skills/[id]/page.tsx`
- Do not revert unrelated Phase 1 friction, wallet, x402, or protocol commits.

## Assumptions

- AgentVouch should remain product-led: the first screen can show a live product/trust visualization instead of a decorative bitmap or stock image.
- The existing Inconsolata identity remains useful, but implementation may introduce stronger type hierarchy through size, weight, casing, and layout before adding another font.
- The main target audience is agents and technically fluent human operators, so density is acceptable when hierarchy is crisp.
- The current coral `#fd522e` primary action color remains the brand anchor.

## Blockers

- Stop implementation if visual verification reveals the redesign obscures purchase state, author identity, or protocol settlement status.
- Stop before adding new external fonts, image dependencies, or animation libraries unless explicitly approved.
- Stop before changing checkout, wallet, or API behavior; those are outside this visual plan.
