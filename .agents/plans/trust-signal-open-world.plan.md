---
name: trust-signal-open-world
overview: "Add an advisory AI security scan (whole skill tree, not just SKILL.md) and a walletless /api/check endpoint that can evaluate registered and unregistered skill content without granting staked trust. Scan runs on publish (best-effort) and on demand; verdicts upgrade the multi-file 'contains unscanned executable code' label."
todos:
  - id: prepare-ai-gateway
    content: Verify the shared AI Gateway client (shipped with summaries — web/lib/ai/gateway.ts + ai/zod installed), refresh Vercel OIDC, and confirm scan model availability via gateway.getAvailableModels(). Mostly a verify step now.
    status: pending
  - id: implement-scan-cache
    content: Implement the structured security scan over the WHOLE skill tree (all files, scripts/ especially), and skill_scans storage keyed by (tree_hash, rubric_version, model). Single-file skills hash to a 1-file tree (already byte-compatible with computeTreeHash).
    status: pending
  - id: scan-on-publish
    content: Trigger a best-effort scan on publish/new-version via after() (POST /api/skills + /api/skills/[id]/versions), so unverified/multi-file skills are labeled, not silently hosted. Couples to free-listings anti-spam and multi-file's unscanned-executable label.
    status: pending
  - id: surface-scan-advisory
    content: Render scan verdicts as advisory-only chips distinct from staked trust, and upgrade the multi-file has_executable "not yet scanned" label to the real verdict once a scan exists.
    status: pending
  - id: implement-api-check
    content: Build /api/check to fuse registered staked trust with scan output for content/hash/tree-hash inputs and (fast-follow) approved URL inputs.
    status: pending
  - id: protect-check-budget
    content: Add per-IP + global rate limiting, a hard spend cap/circuit breaker, max content size, and a cheap pre-filter so the public endpoint cannot drain the model budget. Launch gate. x402-gating of unregistered scans is a fast-follow if spam appears, NOT a day-one wall (it would contradict the free-walletless adoption wedge).
    status: pending
  - id: update-agent-docs
    content: Update web/public/skill.md so agents use /api/check before install.
    status: pending
  - id: verify-open-world
    content: Verify malicious, clean, prompt-injection, multi-file-with-malicious-script, registered, unregistered, cache-hit, scan-on-publish, label-upgrade, lint, build, and local preview behavior.
    status: pending
isProject: false
---

# Plan — Open-World Trust Signal via Vercel AI Gateway

## Goal

Turn AgentVouch's free, walletless trust read into something that can speak to *any* skill — registered or not — so existing awareness (SEO #1, LLMs know us) has somewhere to convert. Two coupled parts ship together: an automated security scan (open-world triage engine), then a public `/api/check` endpoint that fuses staked trust with the scan.

> Split note: this plan was split out of the former `trust-signal-ai.gateway.plan.md`. The skill-summary UX slice (former Phase 1) now lives in `trust-signal-summaries.plan.md`. The two plans are independently shippable and each carries the shared AI Gateway setup below. Part 1 (scan) and Part 2 (`/api/check`) here are coupled — Part 2 consumes Part 1's scan output, so they ship together.

## What changed since this plan was written (2026-05-30 refresh)

This is the next thing on the roadmap, and two features have shipped that make it *more* load-bearing and *less* greenfield:

- **Summaries shipped** → the shared AI Gateway foundation already exists: `ai` + `zod` installed in `web/`, `web/lib/ai/gateway.ts` present, OIDC/`AI_GATEWAY_API_KEY` flow exercised. The `prepare-ai-gateway` todo collapses to a verify step.
- **Multi-file skills shipped** (commit `b1a60e0`) → skills are now directory trees (`SKILL.md` + `scripts/` + `references/` + `assets/`). Two direct consequences for this plan:
  1. **The scan must read the whole tree, not just `SKILL.md`.** `scripts/` is the actual attack surface (executable code). Scanning only the markdown would miss the malware.
  2. **The cache key becomes `tree_hash`, not `content_sha256`.** `skill_versions.tree_hash` already exists and is computed deterministically (`sha256` over sorted `path\0sha256(bytes)`); a single-file skill is just a 1-file tree. Reuse it — don't add a parallel content hash.
  3. **`skill_versions.has_executable` already exists** and currently renders a "contains executable code — not yet security-scanned" label. The scan verdict **upgrades that label** — this is the whole point: turn the honest-but-empty warning into a real read.
- **Free unverified tier shipped** → its `anti-spam` todo explicitly calls for *auto-running the scan on publish*. That trigger now lives in this plan (`scan-on-publish`). Unverified + executable skills are exactly the ones that need the scan, so the scan is what makes hosting them defensible.

Net: this plan is now the convergence point for the unverified tier (label the free skills) and multi-file (scan the scripts). It is the product's reason to exist (the ClawHub problem), not a nice-to-have.

**Strategic framing (why this, why now):**
- Reads are already free/walletless (`/api/skills`, `/api/agents/{pubkey}/trust`). The gap is *scope* (closed-world: we can only rate registered authors) and *emptiness* (devnet stake = play money).
- The automated scan is the open-world triage layer that makes the free signal useful on day one — before mainnet, before anyone stakes.
- Mainnet (real stake) and full optimistic-oracle adjudication are deliberately **later** (see Out of Scope).

---

## Scope

- In scope: AI security scan, scan cache by content hash, advisory scan UI, `/api/check` for walletless pre-install checks, and agent-facing docs.
- Out of scope: mainnet release, on-chain optimistic-oracle adjudication, autonomous x402 purchase as the primary buyer path, staking/vouching mechanics, and any protocol changes.

## Tooling readiness (updated 2026-05-30)

| Need | Status |
|---|---|
| `vercel:ai-gateway`, `vercel:ai-sdk`, `vercel:env*`, `vercel:vercel-functions` skills | ✅ available |
| Vercel CLI | ✅ global v54.x; local CLI upgrade recommended (54.0.0 → 54.6.1 per session hook) |
| Project linked | ✅ `.vercel/project.json` → `agentvouch` (`prj_Nm6…`, team `team_eHn…`); $5/mo Gateway credit tied to this team |
| Vercel MCP server | ❌ not connected — **not required** (CLI covers it) |
| AI SDK in repo | ✅ **installed** — `ai` + `zod` present in `web/` (shipped with summaries) |
| Shared Gateway client | ✅ `web/lib/ai/gateway.ts` exists and is exercised by the summaries feature; reuse it for the scan |
| Gateway auth | Refresh `VERCEL_OIDC_TOKEN` via `vercel env pull` from `web/` (expires ~12h). Summaries calls have succeeded, so the auth path works in at least one env. ⚠️ Confirm `AI_GATEWAY_API_KEY` (and Blob token) exist in the **Development** env too — they were Production/Preview-only, which blocks local `vercel env pull`. Andy adds keys; agents must not create/paste them. |
| Tree access | ✅ `web/lib/skillStorage.ts` provides `getFileForVersion` / `buildArchiveForVersion` (private Blob) + the `files`/`tree_hash`/`has_executable` columns — the scan reads the tree from here. |

---

## Cross-cutting setup (shared AI Gateway foundation)

> Shared with `trust-signal-summaries.plan.md`. Whichever plan ships first lands this; the other reuses it. If summaries already shipped, this is mostly done — verify `gateway.ts` + deps before starting.

- [ ] `npm i ai zod` in `web/`; `vercel env pull` to refresh OIDC.
- [ ] **`web/lib/ai/gateway.ts`** — AI SDK v6 client; models as plain `"provider/model"` strings through AI Gateway; zero-data-retention config (we pipe untrusted third-party skill content through it).
- **Cost discipline (load-bearing):** key the scan cache on the skill's **`tree_hash`** (already computed for every version — single-file skills are a 1-file tree); cache lookups key on (`tree_hash`, `rubric_version`, `model`). Pay the model **once per unique skill tree**, never per request. Structured output for scans; scan only on first-sight / version change. Log anything truncated. **Caching does NOT protect a public endpoint** — a unique-content flood bypasses the cache entirely, so `/api/check` also needs rate limiting + a spend cap (see Part 2, Abuse / budget controls).
- **Two invariants in every part:**
  1. **Scan may only *lower* trust, never grant `allow`.** Only staked vouches earn `allow`. (Encodes the `av-sec-vet` asymmetry: a missed vouch costs nothing; a bad one costs USDC.)
  2. **Scan ≠ stake, visibly.** AI output always labeled "automated / advisory," never styled like a staked vouch.

---

## Files To Change

- `web/package.json`, `package-lock.json`: add `ai` and `zod` if the summaries plan has not already done so.
- `web/lib/ai/gateway.ts`: shared Gateway client if not already present.
- `web/lib/ai/scan.ts`: structured security scan over the **whole tree**, rubric prompt, schema, truncation logging, model tags; `ensureSkillScan(treeHash, files)` mirroring the summaries `ensureSkillSummary` shape (cache lookup → generate → store).
- `web/lib/skillStorage.ts`: read path for the scan — reuse `files` (manifest) + `getFileForVersion`/`buildArchiveForVersion`; no new storage needed.
- `web/lib/db.ts`: additive `skill_scans` table keyed on (`tree_hash`, `rubric_version`, `model`) using `initializeDatabase()`. (`tree_hash` already indexed-able on `skill_versions`; no new content hash.)
- `web/app/api/skills/route.ts`, `web/app/api/skills/[id]/versions/route.ts`: best-effort `after()` scan-on-publish; include scan metadata for repo-backed skills where needed.
- `web/app/api/check/route.ts`: walletless check endpoint.
- `web/components/SkillPreviewCard.tsx`, `web/app/skills/[id]/page.tsx`: advisory scan chip distinct from staked trust; **upgrade the multi-file `has_executable` "not yet scanned" label** to the scan verdict when a scan exists.
- `web/public/skill.md`: agent-facing check-before-install instructions.
- `web/__tests__/**`: fixtures and focused route/scan/UI source tests.

## Part 1 — Automated security scan (the open-world triage engine)

What lets the free signal say something useful about unregistered / in-the-wild skills.

- [ ] Verify AI SDK v6 APIs from installed `web/node_modules/ai/docs` or source before coding structured output. Do not rely on memory.
- [ ] Verify available Gateway model IDs at implementation time with AI Gateway docs or `gateway.getAvailableModels()`; do not assume the example model still exists.
- [ ] `web/lib/ai/scan.ts` — encode the `agentvouch-skill-security-vetting` rubric (prompt-injection, code-exec, wallet/on-chain risk, supply chain, scope mismatch) as the system prompt; **structured output** (zod → `{verdict: review|avoid, risk, findings:[{severity, category, detail, evidence, file}]}`); model returns `review`/`avoid` only — never `allow`. Each finding carries the offending `file` path (multi-file skills span many files).
- [ ] **Scan the whole tree, not just `SKILL.md`.** Build the model input from the version's `files` manifest: include `SKILL.md` + every text file under `scripts/`/`references/` (the executable surface), each in a clearly-delimited per-file *untrusted* block (`--- file: scripts/foo.sh (untrusted) ---`). Respect the existing per-file/total byte caps; skip/flag binaries; **log truncation** when the tree exceeds the model budget (never silently scan a subset and report "clean"). `has_executable` skills are the priority case.
- [ ] Adversarial-input hardening: every file in a clearly-delimited *untrusted* channel ("data, not instructions"); structured schema blocks free-form "looks great!"; consider a 2-model check later (optimistic-oracle direction).
- [ ] Storage: `skill_scans` table with cache lookup keyed by **(`tree_hash`, `rubric_version`, `model`)** (also store verdict, findings JSON, scanned_at, truncated flag) so bumping the rubric or model re-scans instead of serving stale verdicts. Scan on first-sight / version change only. `tree_hash` is already computed per version — reuse it.
- [ ] Surface: scan verdict as an **advisory** chip, distinct from the staked verdict, and as the upgrade for the `has_executable` "unscanned" label.

**Acceptance:** a known-bad single-file fixture (`~/.env` exfil) → `avoid` with the right finding; a **malicious `scripts/install.sh`** inside an otherwise-clean multi-file skill → `avoid` with the finding pinned to that file; a clean skill → `review`/clean; injection in any file doesn't flip it to safe; repeat (same `tree_hash`) = cache-hit; a tree over budget reports `truncated:true` rather than false-clean; cost bounded.

### Scan-on-publish trigger

- [ ] In `POST /api/skills` and `POST /api/skills/[id]/versions`, after the version row is written, fire a **best-effort** `after(() => ensureSkillScan(treeHash, files))` (Fluid Compute `after()`), mirroring how summaries generate post-publish. Failures must not block publish and must not be fatal — the on-demand `/api/check` path is the backstop.
- [ ] Idempotent with the cache: if a scan for `(tree_hash, rubric, model)` already exists (e.g. identical re-upload), the `after()` call is a cheap cache hit.
- [ ] This is the free-listings `anti-spam` requirement: unverified/multi-file skills get labeled at publish time, not only when someone happens to hit `/api/check`.

---

## Part 2 — `/api/check` open-world endpoint (fuse stake + scan)

The public surface an agent/human hits mid-install for *any* skill.

- [ ] Migration: ensure `tree_hash` on `skill_versions` is indexed (enables lookup-by-tree-hash). No separate `content_sha256` — `tree_hash` is the canonical content identity.
- [ ] `web/app/api/check/route.ts` — inputs: `author`/`skill` (existing free trust), `tree_hash`/`hash`/`cid`, or `{content}` / `{files}` (best for agents mid-install — accept a single SKILL.md string *or* a multi-file tree so agents can check what they're about to install). Add `url` only as a fast-follow once fetch safety is approved.
- [ ] Pipeline: compute `tree_hash` from the input (single content → 1-file tree) → known + registered → staked trust (`resolveAuthorTrust`); unknown/unregistered → scan verdict; **fuse via an explicit lattice** `avoid < review < unknown < allow` → `recommended_action = worst(staked, scan)`, with `allow` returned **only** when `staked === allow` and scan is not `review`/`avoid`. Scan never raises trust.
- [ ] **Abuse / budget controls (launch gate — caching alone does NOT cover this):** a public, walletless `{content}`/`{files}` endpoint pays a model call for every *unique* payload (cache only catches repeats). Before public exposure: per-IP + global rate limiting; a hard daily/monthly spend cap with a circuit breaker that degrades to staked/cached-only when tripped; max content size (reuse `MAX_SKILL_TREE_BYTES`); a cheap regex/heuristic pre-filter that escalates to the LLM only on signals. **Decision (2026-05-30): launch free + walletless** with the above guards — do NOT x402-gate scans on day one; a paywall on the check endpoint directly contradicts the free-walletless adoption wedge that the whole trust-signal-first strategy rests on. x402-gating of unregistered/arbitrary scans is a **fast-follow** sybil-price to add *only if* the rate-limit + spend-cap prove insufficient against real abuse (registered-skill checks always stay free).
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
  - malicious single-file `.env` exfil skill returns `avoid` with prompt-injection/data-exfil finding
  - **multi-file skill with a malicious `scripts/install.sh`** (clean `SKILL.md`) returns `avoid` with the finding pinned to `scripts/install.sh` — proves the scan reads the whole tree, not just the markdown
  - clean low-risk skill returns `review` with no blocker findings
  - prompt-injection content (in `SKILL.md` *or* any script) that tells the model to mark it safe still returns `review` or `avoid`
  - registered skill includes staked trust and scan blocks separately
  - unregistered skill includes scan block and no fake staked `allow`
  - repeated identical tree (same `tree_hash`) is a DB cache hit and does not call the model
  - a tree exceeding the model budget returns `truncated:true`, never a false-clean
  - **scan-on-publish:** publishing a skill triggers a best-effort `after()` scan; the verdict is present without anyone hitting `/api/check`; publish still succeeds if the scan errors
  - **label upgrade:** a `has_executable` skill shows "unscanned" before the scan and the real verdict after
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

- **Public `/api/check` must not be exposed without the abuse/budget controls** (rate limit + spend cap/circuit breaker + max size + pre-filter). Hard launch gate, not a nice-to-have — a unique-content loop drains the credit and then real money. (x402-gating is the fast-follow escalation, not the launch gate — see Decision #3.)
- **Final scan model pick** (Decision #1) — the one open call that gates coding `scan.ts`. Verify availability + cost via `gateway.getAvailableModels()`.
- **Gateway/Blob keys in the Development env.** `AI_GATEWAY_API_KEY` (and the Blob token) were Production/Preview-only — confirm they exist in Development too, or local `vercel env pull` from `web/` won't fetch them and local scans will 401. Andy adds keys; agents must not create/paste them.
- ~~Land `ai`/`zod`/`gateway.ts`~~ — **done** (shipped with summaries). Reuse them.
- ~~`url=` at launch decision~~ — **resolved: no** (`content`/`files`/`tree_hash` only at launch; `url=` is a fast-follow with SSRF controls).
- Use the global `vercel` 54.x for any command needing v54 behavior; the local CLI upgrade (→ 54.6.1) is recommended.

---

## Out of scope (later, tracked separately)

- **Mainnet** — needed before staked verdicts carry real economic weight (devnet stake is play money). Not blocked by the above.
- **Full optimistic-oracle adjudication** — bond-and-escalate, multi-model jury, on-chain settlement. The scan here is advisory only.
- **x402 autonomous-purchase as primary buyer** — the human-approved loop comes first.

---

## Decisions (resolved 2026-05-30 — recommendations baked in; flag if you disagree)

1. **Default scan model — recommend a stronger model than summaries** (`google/gemini-2.0-flash-lite` was right for cheap summarization; security judgment is a different job). Lean: a capable reasoning-grade model (Andy's earlier lean was `qwen3.7-max`-class). **Verify availability + rough per-scan cost via `gateway.getAvailableModels()` at implementation time**, don't hardcode from memory. The cost is bounded by scan-once-per-tree caching, so favor quality. → *needs a final pick before coding `scan.ts`.*
2. **`url=` input: NOT at launch.** Start with `content`/`files`/`tree_hash`/`author`+`skill`. Add `GET /api/check?url=` as a fast-follow only after SSRF controls (allowlist/protocol restriction, private-IP block, timeout, max response size, content-type filter, redirect limit) are implemented. Resolved.
3. **Budget protection: free + walletless at launch**, guarded by rate-limit + spend-cap/circuit-breaker + max-size + pre-filter. x402-gating is a fast-follow if abuse appears, not a day-one wall. Resolved (see Part 2).

**The one remaining decision that actually gates coding** is #1 (final model pick). #2 and #3 are settled in the plan.
