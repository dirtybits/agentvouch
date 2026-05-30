---
name: multi-file-fixes-p1-p2
overview: "Fix the two pre-merge multi-file skill review findings on feat/multi-file-skills: early upload-size rejection and side-effect-free entitlement gating before Blob/tar work."
todos:
  - id: add-upload-ceiling
    content: Add MAX_SKILL_UPLOAD_BYTES and SkillUploadError, then reject oversized Content-Length and whole-archive base64 payloads before body buffering or decode.
    status: pending
  - id: map-upload-errors
    content: Map SkillUploadError status codes in publish and version POST route catch blocks.
    status: pending
  - id: extract-access-decision
    content: Extract side-effect-free raw-skill entitlement resolution and defer file/blob work until after access succeeds.
    status: pending
  - id: fix-archive-gating
    content: Update archive downloads to use the side-effect-free entitlement helper and increment installs exactly once on successful archive download.
    status: pending
  - id: verify-fixes
    content: Add acceptance tests and run tsc, the web test suite, and the production web build before handoff.
    status: pending
isProject: false
---

# Handoff — Fix P1 + P2 on `feat/multi-file-skills`

## Context
Multi-file skills (directory tree → tar in private Vercel Blob, manifest in Postgres) is implemented and passing (tsc clean, 224 tests, build). A security review found **no P0**, but two issues to fix before merge. Both are about doing expensive/unbounded work **before** the relevant guard. Nothing else in the branch needs changes.

## Constraints
- Work on branch `feat/multi-file-skills`. **Do not push to `main`.**
- Re-run `npx tsc --noEmit -p web/tsconfig.json`, `npm run test --workspace @agentvouch/web`, `npm run build --workspace @agentvouch/web` before handing back. Keep all existing tests green.
- Don't change the storage format, tree-hash, or gating semantics — only *when*/*how much* work happens.

## P1 — Early request-size cap on publish/version upload (memory/DoS)

**Problem:** `web/lib/skillUpload.ts` buffers the entire request body into memory (`request.formData()`, `request.json()`, and `decodeBase64()` of `tar_base64` / `files_base64_json` / per-file `content`) **before** the per-file/tree caps in `normalizeSkillTreeFiles`/`ingestTarArchive` can reject it — and this runs before auth. A multi-hundred-MB body is fully buffered then rejected. The publish endpoint also has no rate-limit yet, so this is an unauthenticated memory amplifier.

**Fix:**
1. Add a constant in `web/lib/skillDraft.ts` (next to `MAX_SKILL_TREE_BYTES`):
   ```ts
   // Whole-request ceiling: max tree (~5MB) as base64 (~1.33x) + multipart overhead.
   export const MAX_SKILL_UPLOAD_BYTES = 8 * 1024 * 1024;
   ```
2. In `web/lib/skillUpload.ts`:
   - Add `export class SkillUploadError extends Error { constructor(message: string, public status = 400) { super(message); } }`.
   - At the **top of `parseSkillUploadRequest`**, before any body read: if `Content-Length` is present and `> MAX_SKILL_UPLOAD_BYTES`, `throw new SkillUploadError("Upload exceeds size limit", 413)`. (Note in a comment that Content-Length can be absent/chunked; the per-file/tree caps + platform body limit remain the backstop — this guard catches the honest + common-abuse case.)
   - Before each `decodeBase64(...)` of a *whole-archive/whole-files* field (`tar_base64`, `files_base64_json`), reject if the base64 string `.length > MAX_SKILL_UPLOAD_BYTES` with `SkillUploadError(..., 413)`. (Per-file base64 in `decodeJsonFiles` is already bounded by the tree/file caps after decode; a string-length guard there is optional.)
3. In **both** route POST handlers — `web/app/api/skills/route.ts` and `web/app/api/skills/[id]/versions/route.ts` — map the error: in the `catch`, `const status = error instanceof SkillUploadError ? error.status : 500;` and return that status. (Import `SkillUploadError`.)

**Acceptance / tests** (`web/__tests__/`): a POST with `Content-Length` > 8MB → **413** (no full buffering); an oversize `tar_base64` string → 413; normal single-file + multi-file publish still succeed; existing tests green.

## P2 — Run the entitlement check *before* the expensive work

**Problem (two parts):**
- **P2a (`raw` route):** `web/app/api/skills/[id]/raw/route.ts` GET eagerly resolves the requested file (`getFileForVersion` → **private Blob fetch + tar extract**) at the top, *before* the entitlement branches (`handleUsdcDirect`/`handleUnpricedSkill`). So an unentitled `?path=scripts/x` hit on a *paid* skill still pays Blob egress + CPU before returning 402.
- **P2b (`archive` route):** `web/app/api/skills/[id]/archive/route.ts` gates by **invoking the full raw `GET`** and checking `status !== 200`. That runs raw's side effects — notably `incrementInstalls` and building/serving the SKILL.md body — purely to gate, so every archive download double-counts installs and does wasted work.

**Target factoring (do this):** extract the entitlement *decision* from serving in the raw route, and have both routes call it.

1. In `web/app/api/skills/[id]/raw/route.ts`, add and `export` a side-effect-free helper, e.g.:
   ```ts
   // Decide access WITHOUT serving, fetching file bytes, or incrementing installs.
   export async function resolveSkillAccess(
     request: NextRequest,
     id: string
   ): Promise<{ ok: true; skill: RawSkillContentRow } | { ok: false; response: NextResponse }>
   ```
   Move the entitlement logic (free vs paid: USDC purchase entitlement, on-chain purchase, x402 bridge, listing-required, unpriced, etc.) into it. It returns `{ ok:true, skill }` when the caller is entitled to the content, else `{ ok:false, response }` with the existing 402/401/409/404 response. It must **not** call `incrementInstalls`, `getFileForVersion`, or serve a body.
2. Rework the raw `GET` to: SELECT → `resolveSkillAccess` → if not ok, return its response → **only then** resolve the requested file via `getFileForVersion` (for `?path=`) and serve, calling `incrementInstalls` on the serve. (i.e., make `serveSkillContent` / the file resolution happen only on the entitled path; **delete the eager top-of-GET `download_bytes` block**.)
3. Rework the `archive` `GET` to call `resolveSkillAccess(request, id)` directly instead of `getRawSkill(...)`. On `ok:false` return its response; on `ok` build + stream the tar and `incrementInstalls` **once**.

If a full extraction proves too large in one pass, the **minimum acceptable** is: (P2a) defer `getFileForVersion` past the entitlement decision in the raw route, and (P2b) give the archive route a side-effect-free entitlement path (no `incrementInstalls`, no SKILL.md body build) — not the client-spoofable-header approach.

**Acceptance / tests:**
- Unentitled `GET /raw?path=scripts/x.mjs` on a paid skill → **402** with **no Blob fetch** (assert `getFileForVersion` / Blob `get` is not called — spy/mock).
- `GET /archive` on a paid, entitled skill → 200 tar; on unentitled → 402; **installs increment exactly once** per successful archive download (assert no double-count).
- Free + entitled paths and existing single-file behavior unchanged; existing tests green.

## Out of scope (don't do here)
Publish rate-limiting, the AI tree-scan, and the prod upload-flag flip — tracked separately. The P3 nits from review (`pgcrypto` extension creation, executable-detection completeness, `archive?path=` ignoring `path`) are optional and can wait.

## Handoff Output
When done, hand back the `git diff`, the gate output, and a note on whether you did the full `resolveSkillAccess` extraction or the minimum.
