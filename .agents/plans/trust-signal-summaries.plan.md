---
name: trust-signal-summaries
overview: "Add cached AI-generated skill one-liners via Vercel AI Gateway for marketplace, landing, and skill detail surfaces."
todos:
  - id: prepare-ai-gateway
    content: Install AI SDK dependencies, refresh Vercel OIDC envs, verify model IDs, and create the shared Gateway client.
    status: pending
  - id: design-summary-storage
    content: Choose and implement summary storage using the repo's initializeDatabase migration pattern.
    status: pending
  - id: generate-summaries
    content: Generate and cache structured summaries on publish, version update, and backfill.
    status: pending
  - id: render-summaries
    content: Render cached AI one-liners on marketplace, landing, and skill detail surfaces without overriding author copy unnecessarily.
    status: pending
  - id: verify-summaries
    content: Verify cache-hit behavior, Gateway usage, tests, lint, build, and local preview.
    status: pending
isProject: false
---

# Plan — Skill Summaries via Vercel AI Gateway

## Goal

Give every skill a clean, AI-generated one-liner so the marketplace, landing, and skill detail surfaces read well even when authors write thin descriptions. This is the lowest-risk slice of the AI Gateway work: it proves Gateway auth, model invocation, cost controls, caching, and rendering before any adversarial/open-world use.

> Split note: this plan was split out of the former `trust-signal-ai.gateway.plan.md`. The open-world security scan + `/api/check` endpoint (former Phases 2–3) now live in `trust-signal-open-world.plan.md`. The two plans are independently shippable and each carries the shared AI Gateway setup below.

**Strategic framing (why this, why now):**
- Reads are already free/walletless (`/api/skills`, `/api/agents/{pubkey}/trust`). Thin or missing descriptions still hurt discovery and conversion.
- A cached AI one-liner is an immediate UX win that also validates the Gateway integration end-to-end at minimal cost.

---

## Scope

- In scope: AI summary generation for repo-backed skill content, cache by content hash, publish/update hooks, backfill, and rendering summary fallback copy.
- Out of scope: security verdicts, `/api/check`, open-world URL fetching, staked trust changes, x402 settlement, and any on-chain changes.
- Note: only **repo-backed** skills have inline `skill_versions.content`. Chain-only skills (IPFS `skill_uri`) are out of v1 summary scope; cards/detail fall back to the author description via `descriptionFallback` and must render cleanly with no summary.

## Tooling readiness (verified 2026-05-29)

| Need | Status |
|---|---|
| `vercel:ai-gateway`, `vercel:ai-sdk`, `vercel:env*`, `vercel:vercel-functions` skills | ✅ available |
| Vercel CLI | ✅ v54.0.0 (`vercel env`, deploy) |
| Project linked | ✅ `.vercel/project.json` → `agentvouch` (`prj_Nm6…`, team `team_eHn…`); $5/mo Gateway credit tied to this team |
| Vercel MCP server | ❌ not connected — **not required** (CLI covers it) |
| AI SDK in repo | ❌ **not installed** — need `npm i ai zod` in `web/` |
| Gateway auth | ✅ logged in as `dirtybitsofficial`; `web/.env.local` has a fresh `VERCEL_OIDC_TOKEN` (refresh via `vercel env pull` from `web/`; expires ~12h). `AI_GATEWAY_API_KEY` is **not** a project env var (confirmed via `vercel env ls`) — pulling can't fetch it. Try OIDC first; if a gateway call 401s, Andy adds the key (`vercel env add AI_GATEWAY_API_KEY`, all envs) and re-pulls. Agents must not create/paste the key. |
| Local Vercel package | ⚠️ root `package.json` still has `vercel@^50.25.6`; global CLI is 54.0.0. Prefer global `vercel` or upgrade the local dependency before relying on `npm exec vercel`. |

---

## Cross-cutting setup (shared AI Gateway foundation)

> Shared with `trust-signal-open-world.plan.md`. Whichever plan ships first lands this; the other reuses it.

- **`web/lib/ai/gateway.ts`** — AI SDK v6 client; models as plain `"provider/model"` strings through AI Gateway; zero-data-retention config (we pipe untrusted third-party skill content through it).
- **Cost discipline (load-bearing):** hash skill **content** (`sha256`); cache lookups key on (`content_sha256`, `model`) so swapping the summary model regenerates instead of serving stale copy. Pay the model **once per unique skill version**, never per request. Cheap model for summaries; generate only on first-sight / version change. Log anything truncated. (No public abuse surface here — summaries only run on publish/update/backfill, never on arbitrary request input.)
- **Summaries do not affect trust.** A summary is descriptive copy only — it never feeds the trust verdict, never grants `allow`, and is not styled like a staked vouch. (The trust-lowering / stake-asymmetry invariants live in `trust-signal-open-world.plan.md`, where AI output actually informs a verdict.)

---

## Files To Change

- `web/package.json`, `package-lock.json`: add `ai` and `zod` using npm.
- `web/lib/ai/gateway.ts`: shared AI Gateway client, model constants, tags, and OIDC/API-key notes.
- `web/lib/ai/summarize.ts`: structured summary generation and schema validation.
- `web/lib/db.ts`: `initializeDatabase()` migration for summary storage.
- `web/app/api/skills/route.ts`: generate summary on publish and include cached summary fields in API responses as needed.
- `web/app/api/skills/[id]/versions/route.ts`: generate summary when appending a new version.
- `web/app/api/skills/[id]/update/route.ts`: ensure update/version metadata returns summary-aware state if needed.
- `web/components/SkillPreviewCard.tsx`: use AI summary only as fallback/supporting copy.
- `web/app/page.tsx`, `web/app/skills/page.tsx`, `web/app/skills/[id]/page.tsx`: pass and render summary fallback where cards/details are composed.
- `web/scripts/backfill-skill-summaries.ts`: one-shot backfill for existing versions.
- `web/__tests__/**`: add focused tests for summary cache/storage and API response behavior.

## Implementation Steps

Non-adversarial, cheap, immediate UX win; validates Gateway auth + the $5 path + caching + render in one pass.

- [ ] `npm i ai zod` in `web/`; `vercel env pull` to refresh OIDC.
- [ ] Verify AI SDK v6 APIs from installed `web/node_modules/ai/docs` or source before coding structured output. Do not rely on memory.
- [ ] Verify available Gateway model IDs at implementation time with AI Gateway docs or `gateway.getAvailableModels()`; do not assume the example model still exists.
- [ ] `web/lib/ai/gateway.ts` — client + model constants. Use plain `provider/model` strings through AI Gateway, tags like `feature:skill-summary`, and no provider API keys.
- [ ] `web/lib/ai/summarize.ts` — `summarizeSkill(content) → {oneLiner, capabilities[]}` via a small model (e.g. `anthropic/claude-haiku-4.5`), structured output.
- [ ] Storage: `summary` (+ `summary_model`, `summary_sha256`) on `skill_versions`, or a `skill_summaries` cache table keyed by `content_sha256`. Migration in the `initializeDatabase()` pattern in `web/lib/db.ts`.
- [ ] Generate on publish/version-update (`api/skills/route.ts`, `.../update/route.ts`); backfill script for existing rows.
- [ ] Surface: AI one-liner as `descriptionFallback` in `SkillPreviewCard` (marketplace + landing) and the skill detail page.

**Acceptance:** every skill shows a clean AI one-liner; regenerate is cache-hit (no model call); $5 budget visibly sufficient at current catalog size; type-check + preview clean.

**Recommended starting slice:** install deps → `gateway.ts` → summarize ONE skill end-to-end (call → cache → render on its card) → verify in preview. Then fan out.

---

## Verification

- Run `npm run lint --workspace @agentvouch/web -- <edited files>` for focused lint.
- Run `npm run test --workspace @agentvouch/web -- <focused tests>` for summary/cache/API coverage.
- Run `npm run build --workspace @agentvouch/web`.
- Locally publish or backfill one skill and verify:
  - first generation creates a summary and records `summary_sha256` / model metadata
  - repeated generation for identical content is a DB cache hit and does not call the model
  - changed content creates a new summary tied to the new hash
  - summary appears as fallback on `SkillPreviewCard`, landing cards, and skill detail
  - Vercel AI Gateway logs show bounded usage with the expected feature tags

## Rollout

- Start with one local skill and one preview deployment smoke.
- Backfill the current catalog after cache behavior is proven — first print the count, then batch it; do not fan out N model calls against the $5 ceiling in one shot.
- Keep author-authored `description` as primary copy; use AI summary as fallback/supporting text to avoid surprising authors.

## Rollback

- Hide the rendered summary fields if copy quality or Gateway auth fails.
- Disable summary generation on publish/version update by guarding calls in the API route while leaving stored summaries untouched.
- Keep DB columns/table additive. Do not drop summary data during rollback unless explicitly cleaning up after a failed experiment.

## Blockers

- Andy must choose storage shape: columns on `skill_versions` vs separate `skill_summaries` table keyed by `content_sha256`.
- Andy should confirm the default summary model after checking Gateway model availability and rough per-skill cost.
- If OIDC auth fails locally, stop and ask Andy to generate/configure credentials; agents must not create manual `AI_GATEWAY_API_KEY` credentials.
- Do not proceed if the local Vercel CLI path resolves to the old root `vercel@^50.25.6` for commands that require v54 behavior.

## Open decisions for Andy

1. Default summary model (cost vs. quality) — confirm via `vercel:ai-gateway`.
2. Summary storage: column on `skill_versions` vs. separate cache table.
