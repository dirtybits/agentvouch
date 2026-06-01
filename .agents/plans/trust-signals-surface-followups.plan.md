---
name: trust-signals-surface-followups
overview: "Three follow-ups after the trust-signal checklist landed: delete the stale review-scan workflow artifact, fold the skill detail page's standalone security-scan box into the unified TrustSignalChecklist, and surface author trust signals on the /api/agents/[pubkey]/trust endpoint and the `agent trust` CLI command."
todos:
  - id: remove-review-scan-workflow
    content: Delete .agents/workflows/review-scan.js (stale, inert dev artifact referencing a dead commit).
    status: completed
  - id: checklist-render-findings
    content: Extend TrustSignalChecklist to render the AI scan's top findings under the ai_scan row (accept an optional scan prop).
    status: completed
  - id: consolidate-detail-scan-box
    content: Remove the standalone security-scan box (getSecurityScanCopy + scanCopy block) from web/app/skills/[id]/page.tsx and pass the scan to the checklist.
    status: completed
  - id: agent-trust-endpoint-signals
    content: Add author-scope trust signals to web/app/api/agents/[pubkey]/trust/route.ts.
    status: completed
  - id: cli-agent-trust-render
    content: Add signals to the CLI AgentTrustResponse type and render them in formatAgentTrust via the existing formatSignals helper.
    status: completed
  - id: verify-followups
    content: Run web tsc/eslint/vitest, CLI vitest, and a local check of the detail page + `agent trust --json`.
    status: completed
isProject: false
---

# Plan — Trust-Signal Surface Follow-ups (a, b, c)

## Goal
Finish surfacing the trust-signal checklist consistently: remove a stale workflow file, make the skill detail page show one unified checklist instead of a checklist plus a separate scan box, and light up the author checklist on the `agent trust` endpoint and CLI command (which currently predate the signals work).

## Scope
- In scope: `.agents/workflows/review-scan.js` deletion; `web/components/TrustSignalChecklist.tsx`; `web/app/skills/[id]/page.tsx`; `web/app/api/agents/[pubkey]/trust/route.ts`; CLI `src/lib/http.ts` + `src/lib/format.ts`.
- Out of scope: the `SkillPreviewCard` card surface (its condensed trust line already reflects these signals; a parallel strip would be redundant). The pre-existing 44 CLI standalone `tsc` errors (separate plan: `cli-typecheck-cleanup.plan.md`).

## Prerequisite / assumptions
- The trust-signal checklist work must already be present (committed or in tree): `web/lib/trustSignals.ts` (`buildTrustSignals`, `TrustSignal`, `TrustSignalStatus`), `web/components/TrustSignalChecklist.tsx`, `signals[]` returned by `/api/check` and `/api/skills` (list/`[id]`/hydrate), and the CLI `formatSignals` helper + `TrustSignalRecord` in `src/lib/http.ts`. This plan builds directly on those symbols.

## Files To Change
- `.agents/workflows/review-scan.js`: delete.
- `web/components/TrustSignalChecklist.tsx`: add optional `scan?: SkillSecurityScan | null` prop; when present with findings, render up to 3 findings beneath the `ai_scan` row.
- `web/app/skills/[id]/page.tsx`: remove `getSecurityScanCopy` (helper, ~line 184), the `scanCopy` const (~line 1041), and the `scanCopy &&` JSX block (~lines 1912-1934); pass `scan={skill.security_scan}` to the existing `<TrustSignalChecklist signals={skill.signals} />`.
- `web/app/api/agents/[pubkey]/trust/route.ts`: import `buildTrustSignals`, compute author-scope signals, add `signals` to the JSON response.
- `packages/agentvouch-cli/src/lib/http.ts`: add `signals?: TrustSignalRecord[] | null` to `AgentTrustResponse`.
- `packages/agentvouch-cli/src/lib/format.ts`: append `...formatSignals(trust.signals)` to `formatAgentTrust`.

## Implementation Steps

### (a) Delete the stale review-scan workflow
- `git rm .agents/workflows/review-scan.js`.
- Rationale to record in the commit: it is a bespoke multi-agent review harness for a runner that injects `agent()`/`pipeline()`/`parallel()` globals that exist nowhere in the repo; it references `COMMIT = '18b0cc6'` / branch `feat/ai-security-scan`, neither of which is in history (the feature merged as `3798a8f`). Nothing imports it and Next does not deploy it. Recoverable from git history if the review-harness pattern is wanted later.

### (b) Consolidate the detail-page scan box into the checklist
1. In `TrustSignalChecklist.tsx`, add an optional prop:
   ```tsx
   import type { SkillSecurityScan } from "@/lib/securityScan";
   export function TrustSignalChecklist({ signals, scan }: {
     signals: TrustSignal[] | null | undefined;
     scan?: SkillSecurityScan | null;
   }) { ... }
   ```
2. When rendering the `ai_scan` row and `scan?.findings?.length`, render the top 3 findings beneath the row (reuse the markup the old box used so no detail is lost):
   ```tsx
   {signal.id === "ai_scan" && scan?.findings?.length ? (
     <ul className="mt-1 space-y-1 font-mono text-xs text-neutral-500 dark:text-neutral-400">
       {scan.findings.slice(0, 3).map((f) => (
         <li key={`${f.file}:${f.detail}`}>{f.severity.toUpperCase()} · {f.file}: {f.detail}</li>
       ))}
     </ul>
   ) : null}
   ```
3. In `web/app/skills/[id]/page.tsx`: delete `getSecurityScanCopy`, the `scanCopy` const, and the `{scanCopy && (...)}` block. Update the render to `<TrustSignalChecklist signals={skill.signals} scan={skill.security_scan} />`. Remove the now-unused `FiAlertTriangle` import only if nothing else in the file uses it (grep first).
4. Keep the unified checklist where the old box rendered (above the on-chain listing section) so placement is unchanged.

### (c) Author signals on the trust endpoint + CLI
1. `web/app/api/agents/[pubkey]/trust/route.ts`: after `buildAgentTrustSummary(...)`, add
   ```ts
   import { buildTrustSignals } from "@/lib/trustSignals";
   const signals = buildTrustSignals({ trust, scan: null }).filter(
     (s) => s.scope === "author"
   );
   ```
   and include `signals,` in the `NextResponse.json({ ... })` body. Filtering to `scope === "author"` drops the noise `ai_scan: unknown` row (this endpoint has no skill in scope).
2. CLI `src/lib/http.ts`: add `signals?: TrustSignalRecord[] | null;` to `AgentTrustResponse` (`TrustSignalRecord` already exists in this file).
3. CLI `src/lib/format.ts`: in `formatAgentTrust`, append the checklist after the dispute lines:
   ```ts
   `author_dispute_count: ${disputeCount}`,
   ...formatSignals(trust.signals),
   ```
   `formatSignals` is already exported in this file.

## Verification
- Web: from `web/` — `npx tsc --noEmit` (0 errors), `npx eslint .` (no new errors beyond the 4 pre-existing warnings in `author/[pubkey]/page.tsx` + `hooks/*`), `npx vitest run` (all pass).
- CLI: from `packages/agentvouch-cli/` — `npx vitest run` (all pass). Note standalone `tsc` has 44 pre-existing errors tracked in the other plan; confirm this change adds none touching `AgentTrustResponse`/`formatAgentTrust`.
- Manual: load a skill detail page and confirm a single "Trust signals" panel with the `ai_scan` row showing findings (no duplicate scan box). Run `agentvouch agent trust <pubkey> --json` and confirm a `signals` array of `scope: "author"` entries; run without `--json` and confirm the `signals:` checklist prints.
- Grep guard: `rg -n "getSecurityScanCopy|scanCopy" web/app/skills/[id]/page.tsx` returns nothing.

## Rollback
- Each task is independent; revert per-file. `review-scan.js` is restorable via `git checkout <prev> -- .agents/workflows/review-scan.js`. The checklist `scan` prop is additive (optional), so reverting the detail page alone leaves the component valid.

## Blockers
- If the trust-signal checklist work (see Prerequisite) is not yet merged, land it first — (b) and (c) import `buildTrustSignals`/`TrustSignal`/`formatSignals`/`TrustSignalRecord`.
