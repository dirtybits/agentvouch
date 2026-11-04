---
name: homepage-agent-flow
overview: "Add the approved animated AgentVouch explainer at twice its original speed and remove the public metrics bar while preserving metric collection."
todos:
  - id: implement-diagram
    content: Add the seven-second accessible diagram and replace the homepage metrics bar.
    status: completed
  - id: verify-web
    content: Run formatting, lint, typecheck, Vitest, and the webpack production build.
    status: completed
  - id: verify-browser
    content: Check animation, pause, mobile layout, both themes, and metrics API availability.
    status: completed
isProject: false
---

# Explain AgentVouch on the homepage

## Scope and files
- `web/components/AgentVouchDiagram.tsx` and `.module.css`: reuse the approved layout and existing logo; seven-second loop, pause/play, reduced-motion support.
- `web/app/page.tsx`: replace only the public metrics bar with the explainer. Preserve the shared metrics loader, snapshot refresh, API, and existing content.
- The homepage component implements the requested two-times speed; retain the earlier standalone visualization as the original design reference.
- Do not adopt the instruction drafts, change protocol/data collection, deploy, or publish.

## Verification
Use Node 24. Run `npm run format:check`, web lint, typecheck, Vitest, and `npm exec --workspace @agentvouch/web -- next build --webpack`. Inspect the local homepage at desktop/mobile sizes in both themes. Check pause/play and reduced-motion handling. Confirm `/api/landing` still returns the six metrics. Record any unavailable checks.

## Rollback
Remove the new component and restore the metrics-bar markup from the previous revision. No database or infrastructure rollback is needed.

## Notes
- 2026-11-03: User approved the diagram, requested twice the speed, and asked to remove the public metrics bar only. The existing metrics loader refreshes snapshots, so retain that call even though the values are no longer rendered.

- Implementation note: the website uses native SVG animation on one seven-second clock, with pause/play and OS reduced-motion support. No new runtime dependency is needed. The earlier standalone prototype remains unchanged; the requested faster version is the homepage component.

## 2026-11-04 verification

- Passed formatting, web lint, typecheck, Vitest (154 files; 1,386 tests), and the webpack production build. Logs are under `/private/tmp/agentvouch-homepage-{format,lint,typecheck,test,build}.log`.
- Verified the local homepage at desktop and mobile sizes, in light and dark themes. The approved logo renders, the loop uses seven-second timings, pause/play works, and the public aggregate metrics bar is gone. No browser console errors were observed. Restored light theme and resumed the animation.
- `/api/landing` still returns all six metrics; the shared loader and snapshot refresh remain active.
- Reduced-motion handling was checked in the source and CSS. The OS setting was not emulated in the browser, so that behavior is not claimed as a live browser test.
- Screenshot: `/Users/andy/.codex/visualizations/2026/11/04/01a1a558-dfd3-78f1-ba79-bd50f556eacd/agentvouch-homepage.jpg`.
- The user's later request separately authorized instruction adoption; it is recorded in `simplify-agent-instructions.plan.md`. No deployment or publication occurred.

## 2026-11-04 final design and release scope

Later user requests supersede the original diagram design: one compact product-card scene below the hero, 3.5-second search/review/return cycle, a 1.75-second five-tool logo carousel, and no visible pause control. Reduced-motion settings stop automatic motion. The old SVG diagram and separate workflow list were replaced; the earlier verification notes describe historical revisions.

The user authorized committing, opening a PR, monitoring checks/reviews, and squash-merging when ready. The approved instruction adoption is included as a separate commit. No protocol, wallet, database schema, or money-flow behavior changed. Metrics collection and the landing API remain available.

Final browser checks covered mobile light/dark layout, logo loading, stable carousel height, and no horizontal overflow. Review caught and fixed CSS specificity that kept return packets moving horizontally on mobile. Production performance and OS reduced-motion emulation were not measured.
