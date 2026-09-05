---
name: pr-reconciliation-site-check
overview: "Reconcile the approved Stripe and typography PRs with main, verify their combined behavior, and investigate the reported site failure."
todos:
  - id: verify-live-failure
    content: Reproduce the reported site failure and inspect production deployment and browser evidence
    status: in_progress
  - id: reconcile-stripe
    content: Preserve null-body and malformed-ID validation tests while merging current main into PR 161
    status: completed
  - id: reconcile-typography
    content: Resolve PR 171 font configuration conflicts and preserve the merged mobile theme control
    status: completed
  - id: verify-and-ship
    content: Run local gates, review current PR checks and comments, squash-merge approved changes, and verify production
    status: in_progress
isProject: false
---

# PR reconciliation and site verification

## Goal

Finish the approved PR merges and restore any reproduced site failure, with production verification.

## Scope

- Reconcile PRs 161 and 171; review the newly opened PR 172 under the existing open-PR request.
- Inspect public pages, browser errors, deployment state, and relevant runtime logs.
- Preserve authentication, payment, chain, and data semantics.

## Files

- `web/__tests__/api/stripe-routes.test.ts`: retain the null-body and malformed-UUID regressions.
- `web/app/globals.css` and `web/tailwind.config.ts`: retain Crimson Pro titles, Inter body/UI, and Inconsolata code.
- `web/components/AppNavbar.tsx`: verify the merged mobile theme control remains available.
- `web/app/skills/MarketplaceClient.tsx`: retain the loading button until the final requested batch finishes.
- `web/app/globals.css` and `web/__tests__/app/typography-utilities.test.ts`: register semantic fonts in the active Tailwind v4 theme and compile-test font variants.
- Any site-failure fix must follow a reproduced cause; record exact files here before editing.

## Verification

Run Node 24, focused Stripe tests, `npm run format:check`, web lint, typecheck, full web Vitest, `next build --webpack`, and `git diff --check`. Verify current PR head checks before squash merging and inspect the resulting production deployment and public browser behavior.

## Rollout and rollback

Update PR branches with signed merge commits, preserving history. Squash-merge after verification. If a reproduced release regression requires rollback, use a verified prior deployment or a focused revert; do not change live data or feature flags.

## Evidence (2026-09-05)

- Production alias points to deployment `dpl_E9bynP9hLSKYRTMoSQan4pHWNWd4`, commit `ccb432b`, state READY.
- Marketplace loaded 94 skills, pagination reached page 2, and browser error logs were empty.
- Ports 3000, 3001, and 3002 have no local listener; the user has been asked which page/action fails while independent work continues.
- PR 161 conflicts only in its Stripe test insertion; PR 171 conflicts in global CSS and Tailwind font mapping.
- PR 161 resolution passed format, lint, typecheck, all 948 tests, and the webpack production build. The build required network access for Google Fonts and used expected missing-database fallbacks in the isolated checkout. Signed commit `ea7a47c` was published.
- Local marketplace at port 3002 loaded 9 then 18 cards. Searching for `subagent` after appending correctly replaced the list with one result; the suspected search regression was ruled out.
- UI review found the end-of-list label can replace the button while the final page is still in flight, because the requested page advances before its response. Keep the button mounted and disabled until completion; no pagination/API semantics change.
- The final-batch browser check showed a disabled `Loading more` button at 9/12, followed by 12/12 and the end label, with no console errors.
- Skill detail computed styles showed the page title in Crimson Pro, prose in Inter, and code in Inconsolata, but Markdown headings incorrectly inherited Inter. `prose-headings:font-display` has no generated utility because the legacy TypeScript Tailwind config is not loaded by the v4 CSS entrypoint. Register the font tokens with `@theme inline` and verify generated CSS plus rendered styles.
- All four compiled-utility regression tests failed before the theme mapping and passed afterward. The browser confirmed the corrected skill Markdown heading in Crimson Pro, body in Inter, and code in Inconsolata in dark theme. Light-theme marketplace and narrow-layout carousel navigation (01/03 to 02/03) also passed without horizontal overflow.
- PRs 172 and 161 were squash-merged after green CI and Vercel builds; both are integrated into this branch from `origin/main` at `00972b7`.
- Final combined local gate: format, lint, typecheck, 129 test files / 953 tests, and webpack production build all passed. Build retains the existing non-blocking `ox` dynamic-dependency warning. Real wallet signing and paid checkout were not exercised.
- Production homepage, marketplace, dashboard, and sign-in page loaded successfully. Production runtime error checks returned no errors; no specific failing public URL/action has been supplied yet.

## Blockers

- The reported site failure is not yet reproduced; continue public-route checks and await the user's failing URL/action.
