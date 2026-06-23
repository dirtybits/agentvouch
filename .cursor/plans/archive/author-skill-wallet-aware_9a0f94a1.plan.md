---
name: author-skill-wallet-aware
overview: Hide the paid buyer CTA on the skill detail page when the connected wallet is the skill author, and verify the page still shows the correct author-only controls.
todos:
  - id: inspect-skill-detail-branch
    content: Add an explicit author-aware branch to the paid install/buy card in `web/app/skills/[id]/page.tsx`.
    status: completed
  - id: add-regression-check
    content: Update `web/__tests__/app/skill-detail-source.test.ts` to cover the author-aware UI branch.
    status: completed
  - id: verify-web-checks
    content: Run the relevant web verification steps (`test` if targeted, `npm run build`, lints for edited files) before finishing.
    status: completed
isProject: false
---

# Make Skill Detail Wallet-Aware

## Goal
Stop showing the paid `Buy & Unlock` flow to the connected author on the skill detail page for repo-backed skills like `/skills/<uuid>`.

## Findings
- The skill detail page already computes author identity in [web/app/skills/[id]/page.tsx](/Users/andysustic/Repos/agent-reputation-oracle/web/app/skills/[id]/page.tsx) with `const isAuthor = !!skill && !!walletAddress && walletAddress === skill.author_pubkey;`.
- The paid install card in that same file currently ignores `isAuthor` and falls through to the buyer CTA (`Buy & Unlock`) whenever `buyerHasPurchased` is false.
- Author-only controls already exist lower on the page (`Edit Listing`, `Publish New Version`, `List on Marketplace`), so the minimal fix is to reuse the existing `isAuthor` signal rather than introduce new API or wallet logic.
- There is an existing source-level regression test in [web/__tests__/app/skill-detail-source.test.ts](/Users/andysustic/Repos/agent-reputation-oracle/web/__tests__/app/skill-detail-source.test.ts) that checks the paid skill copy and CTA strings.

## Plan
- Update [web/app/skills/[id]/page.tsx](/Users/andysustic/Repos/agent-reputation-oracle/web/app/skills/[id]/page.tsx) so the install/buy action card has an explicit `isAuthor` branch before buyer purchase logic.
- In that branch, replace the buyer CTA/copy with author-aware messaging, for example indicating that this wallet is the author and pointing the user to the existing author actions instead of purchase.
- Keep the existing non-author behavior unchanged: disconnected users still see connect-wallet copy, buyers still see `Buy & Unlock` or `Sign & Download`, and free-skill author hints remain intact.
- Add or update a focused regression check in [web/__tests__/app/skill-detail-source.test.ts](/Users/andysustic/Repos/agent-reputation-oracle/web/__tests__/app/skill-detail-source.test.ts) so the page source is expected to contain the author-aware branch/copy and continues to keep purchase/download strings for non-author paths.
- Verify in `web/` with the existing frontend checks: targeted test run if practical, then `npm run build`, and read lints for the edited files.

## Notes
- No API route change should be required because [web/app/api/skills/[id]/route.ts](/Users/andysustic/Repos/agent-reputation-oracle/web/app/api/skills/[id]/route.ts) already returns `author_pubkey`, and the page already derives `isAuthor` from the connected wallet.
- This stays intentionally narrow: it fixes the misleading buyer CTA without changing paid download authorization rules or adding an author bypass for paid raw downloads.