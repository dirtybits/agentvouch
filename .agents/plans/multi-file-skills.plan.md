---
name: multi-file-skills
overview: "Represent a skill as a directory (canonical Agent Skills format: SKILL.md + scripts/ + references/ + assets/) with pluggable off-chain-default storage (Vercel Blob; IPFS optional), a backend-agnostic tree hash for integrity, directory upload, a file-tree browser, and whole-tree archive download. Safety posture (b): cheap manifest-based executable detection + a hard 'unscanned executable code' label ship with this; the full AI whole-tree scan is the immediate fast-follow (trust-signal-open-world), not a publish gate."
todos:
  - id: add-blob-dep
    content: Add @vercel/blob; provision BLOB_READ_WRITE_TOKEN (vercel env) for dev + prod.
    status: pending
  - id: skill-storage-lib
    content: Create web/lib/skillStorage.ts — storage interface (putTree/getFile/buildArchive) with Blob (default) + IPFS (Pinata, optional) backends, deterministic computeTreeHash, tar builder, and HARDENED tar ingest (reject path traversal/absolute paths/symlinks; cap uncompressed size). Generalize web/lib/ipfs.ts behind it.
    status: pending
  - id: migrate-tree-schema
    content: Add files (JSONB manifest), tree_hash, storage_backend, has_executable (bool) to skill_versions in web/lib/db.ts via initializeDatabase; backfill existing rows to 1-file trees (SKILL.md only, has_executable=false).
    status: pending
  - id: publish-directory
    content: Update POST /api/skills + POST /api/skills/[id]/versions to accept a file set (multipart for web; tar or base64-JSON for API), enforce tree caps, require exactly one top-level SKILL.md, ingest safely, store via skillStorage, persist manifest + tree_hash + backend + has_executable. SKILL.md still written inline + summarized.
    status: pending
  - id: detect-executables-label
    content: Manifest-based executable detection (scripts/ path, executable extensions, shebang) → set has_executable; surface a hard "contains executable code — not yet security-scanned" label on the skill card + detail page for unverified skills.
    status: pending
  - id: publish-ui-folder
    content: web/app/skills/publish/page.tsx — folder-picker (webkitdirectory) + drag-drop, file-list preview, SKILL.md-required check.
    status: pending
  - id: skill-detail-tree
    content: web/app/skills/[id]/page.tsx + new web/components/SkillFileTree.tsx — tree sidebar (grouped SKILL.md / scripts / references / assets) + content viewer (markdown for SKILL.md, code/text for others); show tree_hash, file count, total size, executable label.
    status: pending
  - id: archive-endpoint
    content: New GET /api/skills/[id]/archive → tar/zip of the tree, reusing the paid/raw entitlement gating from raw/route.ts; expose content reference (tree_hash + url/cid).
    status: pending
  - id: agent-install-doc
    content: Update web/public/skill.md install flow from curl-the-file to fetch-the-folder (archive or per-path).
    status: pending
  - id: verify-multi-file
    content: tsc + web tests + build; preview checks for single-file back-compat, upload, browse, archive download, tree-hash stability, caps, executable labeling, malicious-tar rejection (traversal/symlink/bomb), and a Blob<->IPFS backend swap.
    status: pending
isProject: false
---

# Plan — Multi-File Skills (directory format)

## Goal
Represent a skill as the canonical **Agent Skills** standard does — a folder (`SKILL.md` + optional `scripts/`, `references/`, `assets/`) — instead of a single `SKILL.md`. Publishers upload a directory; users browse the file tree and download the whole tree; integrity is a backend-agnostic tree hash; storage defaults off-chain (Vercel Blob) with IPFS optional. Skills containing executable files are detected and **hard-labeled "unscanned"** at publish; the full AI whole-tree scan follows immediately as a separate step. Single-file skills remain valid (a 1-file tree) — fully backward compatible.

## Locked decisions
1. **Storage:** Vercel Blob default; Pinata/IPFS optional (esp. bonded tier). One interface; `storage_backend` per version.
2. **Safety posture = (b):** executable detection + hard "unscanned executable code" label ship now; the AI whole-tree scan (`trust-signal-open-world`) is the immediate fast-follow that upgrades the label to a real verdict — **not** a hard publish gate.
3. **Blob layout:** one content-addressed tar per version (`skills/{tree_hash}.tar`); manifest in Postgres so the tree UI renders with zero Blob hits; extract-on-read (cached) for individual file views; serve the tar directly for archive download. (IPFS backend uses a native dir pin; `getFile(path)` hides the difference.)
4. **Upload transport:** web → `multipart/form-data`; agent API → tarball (primary) + small base64-JSON (convenience).
5. **Caps:** 200 files / 5 MB total / 1 MB per file; `SKILL.md` keeps its 256 KB cap. Tunable constants in `web/lib/skillDraft.ts`.
6. **File-type policy:** cap-and-label everything; never block file *types* (scripts are the point). Block only **structural dangers** (path traversal, absolute paths, symlinks, over-cap, decompression bombs).

## Integrity (independent of storage)
Tree hash = `sha256( "\n".join( sorted( "{path}\0{sha256(bytes)}" ) ) )`, computed by us. This is the supply-chain-swap protection and the cache key for summary/scan. It does **not** depend on IPFS; bonded skills will commit this hash on-chain (deferred, see Out of scope). Same bytes → same hash across Blob and IPFS, so backends are swappable.

## Security — tar/tree ingest hardening (must)
Any uploaded/tarred tree is hostile input. The ingest path (`skillStorage`) MUST:
- Reject entries with `..`, absolute paths, or paths escaping the root (zip-slip).
- Reject symlinks / hardlinks / non-regular entries.
- Enforce caps on **uncompressed** size and file count *during* extraction (decompression-bomb guard), not just on the upload size.
- Normalize to a canonical sorted tree before hashing/storing.
A vulnerable extractor would itself be a supply-chain hole, so this is non-negotiable and covered by Verification.

## Scope
- **In scope:** directory model + manifest + tree hash + `has_executable`; `web/lib/skillStorage.ts` (Blob default, IPFS optional, hardened ingest); directory upload on publish + version routes; folder-upload UI; file-tree browser + viewer; archive endpoint; executable detection + hard labeling; agent-install-doc update; backward-compat for single-file skills.
- **Out of scope:** the full AI whole-tree scan (tracked in `trust-signal-open-world` as the fast-follow); on-chain protocol change so bonded listings commit `tree_hash` (defer with the paused program work); voucher slashing / adjudication (paused); in-browser tree editing; rate-limiting (tracked in `free-listings-unverified-tier`).

## Files To Change
- `web/package.json`: add `@vercel/blob`.
- `web/lib/skillStorage.ts` (new): `putTree(files)->{backend,ref,treeHash,manifest,hasExecutable}`, `getFile(version,path)->bytes`, `buildArchive(version)->tar`, `computeTreeHash`, `detectExecutable(manifest)`, hardened tar ingest. Reuse `web/lib/ipfs.ts` (`pinSkillContent`) as the IPFS backend.
- `web/lib/db.ts`: `skill_versions` += `files JSONB`, `tree_hash VARCHAR(64)`, `storage_backend VARCHAR(16)`, `has_executable BOOLEAN DEFAULT false`; migration + backfill.
- `web/lib/skillDraft.ts`: add `MAX_SKILL_TREE_FILES`, `MAX_SKILL_TREE_BYTES`, `MAX_SKILL_FILE_BYTES` (keep `MAX_SKILL_CONTENT_BYTES`).
- `web/app/api/skills/route.ts`, `web/app/api/skills/[id]/versions/route.ts`: accept + validate + ingest a tree; persist manifest/hash/backend/has_executable; keep `resolvePublisherAuth` + `after(generateSummarySafe)`.
- `web/app/api/skills/[id]/archive/route.ts` (new): tar/zip stream with entitlement gating.
- `web/app/api/skills/[id]/raw/route.ts`: keep SKILL.md (back-compat) + add `?path=` for individual files.
- `web/components/SkillFileTree.tsx` (new) + `web/app/skills/[id]/page.tsx`: the browser + executable label.
- `web/components/SkillPreviewCard.tsx`: show the "unscanned executable code" flag where applicable.
- `web/app/skills/publish/page.tsx`: folder upload UI.
- `web/public/skill.md`: fetch-the-folder install instructions.

## Implementation Steps
1. `add-blob-dep`: `npm i @vercel/blob -w @agentvouch/web`; provision `BLOB_READ_WRITE_TOKEN`; scratch round-trip put/get.
2. `skill-storage-lib`: `computeTreeHash` (+ determinism unit test); Blob backend (store `skills/{tree_hash}.tar`); IPFS backend; `buildArchive`; **hardened ingest** (zip-slip/symlink/bomb guards); `detectExecutable`.
3. `migrate-tree-schema`: additive columns + boot-safe backfill (existing rows → 1-file tree).
4. `publish-directory` + version route: accept file set, enforce caps, require one top-level SKILL.md, safe-ingest, store, persist. SKILL.md still inline + summarized.
5. `detect-executables-label`: set `has_executable`; render the hard label on card + detail.
6. `publish-ui-folder`: folder-picker + drag-drop + preview.
7. `skill-detail-tree`: `SkillFileTree` + viewer.
8. `archive-endpoint`: tar/zip with entitlement gating.
9. `agent-install-doc`: update `web/public/skill.md`.
10. `verify-multi-file`: run Verification.

## Verification
- `npx tsc --noEmit -p web/tsconfig.json` clean; `npm run test --workspace @agentvouch/web` green (add: tree-hash determinism, publish-with-tree, single-file back-compat, archive contents, caps rejection, **malicious-tar rejection** — `../escape`, absolute path, symlink, oversize/bomb).
- `npm run build --workspace @agentvouch/web` passes.
- Preview: upload a folder (SKILL.md + scripts/ + references/), browse tree, render SKILL.md, view a script, confirm the **"unscanned executable code"** label shows, download archive and confirm it unpacks to the original tree.
- Integrity: identical content → identical `tree_hash`; one file changed → new hash. Blob vs IPFS of the same tree → identical hash, both retrievable.
- Existing single-file skills render + install unchanged.

## Rollout
- Land model + storage + read-side first (existing skills backfilled to 1-file trees; nothing user-visible changes).
- Gate **directory upload** behind a flag (e.g., `NEXT_PUBLIC_MULTIFILE_UPLOAD`); enable in preview, then prod.
- **Do not enable the upload flag in prod until executable detection + hard labeling are live** (the (b) safety bar).
- New uploads default to Blob; IPFS is an explicit opt-in.

## Rollback
- Disable the upload flag → publishing falls back to single SKILL.md (inline path untouched). Browse/download of existing multi-file skills can remain read-only or be hidden via the same flag.
- All schema changes are additive (nullable `files`/`tree_hash`/`storage_backend`, defaulted `has_executable`) — do not drop columns or stored blobs on rollback.
- Archive/tree endpoints can be 404'd via flag without data loss.

## Blockers
1. **`BLOB_READ_WRITE_TOKEN`** must be provisioned (dev pull + prod) before upload works. Andy generates it (no agent credential creation).
2. **Executable detection + hard labeling must ship before enabling directory upload in prod** — this is the (b) safety bar; the upload flag stays off without it.
3. **AI whole-tree scan is the committed fast-follow** (`trust-signal-open-world`): until it lands, the executable label stays "not yet security-scanned" (honest, but no verdict). Tracked dependency, not a hard stop for shipping multi-file under (b).
