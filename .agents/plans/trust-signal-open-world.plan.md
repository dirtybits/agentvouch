---
name: trust-signal-open-world
overview: "Add an advisory AI security scan and walletless /api/check endpoint that can evaluate registered and unregistered skill content without granting staked trust."
todos:
  - id: prepare-ai-gateway
    content: Verify or create the shared AI Gateway client, install dependencies if needed, refresh Vercel OIDC, and confirm scan model IDs.
    status: pending
  - id: implement-scan-cache
    content: Implement the structured security scan, content hashing, and skill_scans storage keyed by content_sha256.
    status: pending
  - id: surface-scan-advisory
    content: Render scan verdicts as advisory-only chips distinct from staked trust.
    status: pending
  - id: implement-api-check
    content: Build /api/check to fuse registered staked trust with scan output for content/hash inputs and approved URL inputs.
    status: pending
  - id: protect-check-budget
    content: Add rate limiting, a hard spend cap/circuit breaker, max content size, and a cheap pre-filter (and/or x402-gate scans of unregistered content) so the public endpoint cannot drain the model budget. Launch gate.
    status: pending
  - id: update-agent-docs
    content: Update web/public/skill.md so agents use /api/check before install.
    status: pending
  - id: verify-open-world
    content: Verify malicious, clean, prompt-injection, registered, unregistered, cache-hit, lint, build, and local preview behavior.
    status: pending
isProject: false
---

# Plan — Open-World Trust Signal via Vercel AI Gateway

## Goal

Turn AgentVouch's free, walletless trust read into something that can speak to *any* skill — registered or not — so existing awareness (SEO #1, LLMs know us) has somewhere to convert. Two coupled parts ship together: an automated security scan (open-world triage engine), then a public `/api/check` endpoint that fuses staked trust with the scan.

> Split note: this plan was split out of the former `trust-signal-ai.gateway.plan.md`. The skill-summary UX slice (former Phase 1) now lives in `trust-signal-summaries.plan.md`. The two plans are independently shippable and each carries the shared AI Gateway setup below. Part 1 (scan) and Part 2 (`/api/check`) here are coupled — Part 2 consumes Part 1's scan output, so they ship together.

**Strategic framing (why this, why now):**
- Reads are already free/walletless (`/api/skills`, `/api/agents/{pubkey}/trust`). The gap is *scope* (closed-world: we can only rate registered authors) and *emptiness* (devnet stake = play money).
- The automated scan is the open-world triage layer that makes the free signal useful on day one — before mainnet, before anyone stakes.
- Mainnet (real stake) and full optimistic-oracle adjudication are deliberately **later** (see Out of Scope).

---

## Scope

- In scope: AI security scan, scan cache by content hash, advisory scan UI, `/api/check` for walletless pre-install checks, and agent-facing docs.
- Out of scope: mainnet release, on-chain optimistic-oracle adjudication, autonomous x402 purchase as the primary buyer path, staking/vouching mechanics, and any protocol changes.

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

> Shared with `trust-signal-summaries.plan.md`. Whichever plan ships first lands this; the other reuses it. If summaries already shipped, this is mostly done — verify `gateway.ts` + deps before starting.

- [ ] `npm i ai zod` in `web/`; `vercel env pull` to refresh OIDC.
- [ ] **`web/lib/ai/gateway.ts`** — AI SDK v6 client; models as plain `"provider/model"` strings through AI Gateway; zero-data-retention config (we pipe untrusted third-party skill content through it).
- **Cost discipline (load-bearing):** hash skill **content** (`sha256`); cache lookups key on (`content_sha256`, `rubric_version`, `model`). Pay the model **once per unique skill version**, never per request. Structured output for scans; scan only on first-sight / version change. Log anything truncated. **Caching does NOT protect a public endpoint** — a unique-content flood bypasses the cache entirely, so `/api/check` also needs rate limiting + a spend cap (see Part 2, Abuse / budget controls).
- **Two invariants in every part:**
  1. **Scan may only *lower* trust, never grant `allow`.** Only staked vouches earn `allow`. (Encodes the `av-sec-vet` asymmetry: a missed vouch costs nothing; a bad one costs USDC.)
  2. **Scan ≠ stake, visibly.** AI output always labeled "automated / advisory," never styled like a staked vouch.

---

## Files To Change

- `web/package.json`, `package-lock.json`: add `ai` and `zod` if the summaries plan has not already done so.
- `web/lib/ai/gateway.ts`: shared Gateway client if not already present.
- `web/lib/ai/scan.ts`: structured security scan, rubric prompt, schema, truncation logging, and model tags.
- `web/lib/db.ts`: additive `skill_scans` table and `content_sha256` index on `skill_versions` using `initializeDatabase()`.
- `web/app/api/check/route.ts`: walletless check endpoint.
- `web/app/api/skills/route.ts`, `web/app/api/skills/[id]/route.ts`: include scan metadata for registered/repo-backed skills where needed.
- `web/components/SkillPreviewCard.tsx`, `web/app/skills/[id]/page.tsx`: advisory scan chip distinct from staked trust.
- `web/public/skill.md`: agent-facing check-before-install instructions.
- `web/__tests__/**`: fixtures and focused route/scan/UI source tests.

## Part 1 — Automated security scan (the open-world triage engine)

What lets the free signal say something useful about unregistered / in-the-wild skills.

- [ ] Verify AI SDK v6 APIs from installed `web/node_modules/ai/docs` or source before coding structured output. Do not rely on memory.
- [ ] Verify available Gateway model IDs at implementation time with AI Gateway docs or `gateway.getAvailableModels()`; do not assume the example model still exists.
- [ ] `web/lib/ai/scan.ts` — encode the `agentvouch-skill-security-vetting` rubric (prompt-injection, code-exec, wallet/on-chain risk, supply chain, scope mismatch) as the system prompt; **structured output** (zod → `{verdict: review|avoid, risk, findings:[{severity, category, detail, evidence}]}`); model returns `review`/`avoid` only — never `allow`.
- [ ] Adversarial-input hardening: skill content in a clearly-delimited *untrusted* channel ("data, not instructions"); structured schema blocks free-form "looks great!"; consider a 2-model check later (optimistic-oracle direction).
- [ ] Storage: `skill_scans` table with cache lookup keyed by **(`content_sha256`, `rubric_version`, `model`)** (also store verdict, findings JSON, scanned_at) so bumping the rubric or model re-scans instead of serving stale verdicts. Scan on first-sight / version change only.
- [ ] Surface: scan verdict as an **advisory** chip, distinct from the staked verdict.

**Acceptance:** a known-bad fixture (e.g. `~/.env` exfil skill) → `avoid` with the right finding; a clean skill → `review`/clean; injection in content doesn't flip it to safe; repeat = cache-hit; cost bounded.

---

## Part 2 — `/api/check` open-world endpoint (fuse stake + scan)

The public surface an agent/human hits mid-install for *any* skill.

- [ ] Migration: indexed `content_sha256` on `skill_versions` (enables lookup-by-content).
- [ ] `web/app/api/check/route.ts` — inputs: `author`/`skill` (existing free trust), `cid`/`hash`, or `{content}` (best for agents mid-install). Add `url` only if fetch safety is approved in Blockers.
- [ ] Pipeline: `sha256(content)` → known + registered → staked trust (`resolveAuthorTrust`); unknown/unregistered → scan verdict; **fuse via an explicit lattice** `avoid < review < unknown < allow` → `recommended_action = worst(staked, scan)`, with `allow` returned **only** when `staked === allow` and scan is not `review`/`avoid`. Scan never raises trust.
- [ ] **Abuse / budget controls (launch gate — caching alone does NOT cover this):** a public, walletless `{content}` endpoint pays a model call for every *unique* payload (cache only catches repeats). Before public exposure: per-IP + global rate limiting; a hard daily/monthly spend cap with a circuit breaker that degrades to staked/cached-only when tripped; max content size; a cheap regex/heuristic pre-filter that escalates to the LLM only on signals. Strongly consider **x402-gating scans of unregistered/arbitrary content** (funds the model cost; registered-skill checks stay free) — an on-thesis, agent-native payment use case.
- [ ] Scope: content-hash scans cover **repo-backed** skills (`skill_versions.content`). Chain-only skills (IPFS `skill_uri`) are out of v1 scan scope; the endpoint still returns staked trust for them.
- [ ] Response keeps `staked` and `scan` as separate, labeled blocks + disclaimer ("absence of findings ≠ safe").
- [ ] Do **not** reuse `getRecommendedAction()` as-is — its `!isRegistered → "avoid"` rule is the closed-world wall; the fusion replaces it for open-world inputs.
- [ ] Make it the hero flow in `skill.md` so LLMs invoke "check before install" reflexively. Free + walletless.

**Acceptance:** `POST /api/check` with raw content for an unregistered skill returns a real scan verdict; a registered skill returns staked trust; both are free/walletless; repeat checks are cache hits; documented in `skill.md`. If `url=` is approved, `GET /api/check?url=<github raw>` must follow the same behavior with fetch safety controls.

---

## Verification

- Run `npm run lint --workspace @agentvouch/web -- <edited files>` for focused lint.
- Run `npm run test --workspace @agentvouch/web -- <focused tests>` for scan/cache/API coverage.
- Run `npm run build --workspace @agentvouch/web`.
- Fixture checks:
  - malicious `.env` exfil skill returns `avoid` with prompt-injection/data-exfil finding
  - clean low-risk skill returns `review` with no blocker findings
  - prompt-injection content that tells the model to mark it safe still returns `review` or `avoid`
  - registered skill includes staked trust and scan blocks separately
  - unregistered skill includes scan block and no fake staked `allow`
  - repeated identical content is a DB cache hit and does not call the model
  - Gateway logs show bounded usage with expected feature tags
- Local preview smoke:
  - advisory chip is visually distinct from staked trust
  - `web/public/skill.md` instructions point agents to `/api/check`
  - absence-of-findings disclaimer is present in API response and UI where applicable

## Rollout

- Launch `content`/`hash` inputs first if URL fetching has not been reviewed.
- Add `url=` only after SSRF controls are implemented: allowlist or protocol restrictions, private-IP blocking, timeout, max response size, content-type filtering, and redirect limits.
- Keep scan verdict advisory-only in UI and API copy.
- Do not make `/api/check` public until rate limiting + a spend circuit breaker are live and tested (simulate a unique-content flood against a low cap and confirm it degrades to staked/cached-only).
- Start on preview/local with seeded malicious and clean fixtures before exposing the endpoint as the public agent flow.

## Rollback

- Hide advisory scan chips if scan quality, Gateway auth, or budget behavior is unacceptable.
- Keep `/api/check` returning staked trust for registered `author`/`skill` inputs while disabling model-backed scans behind a server-side guard.
- Preserve additive `skill_scans` data. Do not drop cache tables/columns during rollback unless explicitly cleaning up.
- Revert `web/public/skill.md` check-before-install instructions if `/api/check` is disabled.

## Blockers

- **Public `/api/check` must not be exposed without the abuse/budget controls** (rate limit + spend cap/circuit breaker + max size + pre-filter, and/or x402-gating unregistered scans). Hard launch gate, not a nice-to-have — a unique-content loop drains the credit and then real money.
- Andy must choose the default scan model after checking Gateway model availability and rough per-scan cost.
- Decide whether `/api/check` accepts `url=` at launch. If yes, implement SSRF/fetch-safety controls before rollout; otherwise start with `content`/`hash` only.
- If summaries already shipped the Gateway client/deps, reuse them. If not, this plan must land `ai`, `zod`, OIDC refresh, and `web/lib/ai/gateway.ts`.
- Auth (verified 2026-05-29): logged in as `dirtybitsofficial`; `web/.env.local` has a fresh `VERCEL_OIDC_TOKEN`; `AI_GATEWAY_API_KEY` is **not** a project env var. Try OIDC first; if the first gateway call 401s, Andy adds the key (`vercel env add AI_GATEWAY_API_KEY`, all envs) and re-pulls. Agents must not create/paste the key.
- Do not proceed if the local Vercel CLI path resolves to the old root `vercel@^50.25.6` for commands that require v54 behavior (use the global `vercel` 54.x).

---

## Out of scope (later, tracked separately)

- **Mainnet** — needed before staked verdicts carry real economic weight (devnet stake is play money). Not blocked by the above.
- **Full optimistic-oracle adjudication** — bond-and-escalate, multi-model jury, on-chain settlement. The scan here is advisory only.
- **x402 autonomous-purchase as primary buyer** — the human-approved loop comes first.

---

## Open decisions for Andy

1. Default scan model (cost vs. quality) — confirm via `vercel:ai-gateway`.
2. Whether `/api/check` accepts raw `url=` fetches at launch (SSRF / fetch-safety considerations) or starts with `content`/`hash` only.
3. How to protect the `/api/check` model budget: rate-limit + hard spend cap/circuit breaker, and/or x402-gate scans of unregistered/arbitrary content (registered checks stay free). Gates public launch.
