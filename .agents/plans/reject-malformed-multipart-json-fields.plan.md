---
name: reject-malformed-multipart-json-fields
overview: "Return deterministic 400 client errors when multipart skill uploads contain malformed JSON in structured form fields, before authentication, database, storage, or pinning work begins."
todos:
  - id: add-multipart-parser-regressions
    content: Add focused create- and version-upload regressions for malformed multipart JSON fields and prove no downstream side effects
    status: completed
  - id: normalize-multipart-json-errors
    content: Convert malformed structured multipart field JSON into SkillUploadError responses in the shared upload parser
    status: completed
  - id: verify-multipart-error-contract
    content: Run targeted web tests, formatting, lint, typecheck, full web tests, and diff checks — webpack build attempted; static prerender blocked by missing local DATABASE_URL
    status: completed
isProject: false
---

# Reject Malformed Multipart JSON Fields

## Goal
Make malformed JSON supplied in structured multipart upload fields return the existing client-error class instead of escaping as a generic `500`, for both skill creation and version-upload consumers.

## Scope
- In scope: the shared multipart parser in `web/lib/skillUpload.ts`; route-level regressions for `POST /api/skills` and `POST /api/skills/[id]/versions`.
- Out of scope: valid multipart schema changes, JSON-body behavior, upload size limits, storage/database changes, wallet/chain behavior, and runtime dependency changes.

## Files To Change
- `web/lib/skillUpload.ts`: translate malformed JSON in multipart structured fields into `SkillUploadError`.
- `web/__tests__/api/skills-route.test.ts`: assert malformed multipart create fields return `400` before auth/database/storage work.
- `web/__tests__/api/skills-versions.test.ts`: assert malformed multipart version fields return `400` before SQL/auth/storage/pinning work.

## Implementation Steps
1. Add focused multipart `FormData` test requests whose structured `auth` or `tags` field is malformed JSON. Verify each route returns a deterministic `400` error and its relevant mocked downstream work was not called.
2. Run the targeted route tests first to reproduce the current misclassification (verified 2026-09-30: `parseJsonField` calls `JSON.parse` directly at `web/lib/skillUpload.ts:39-42`, while both route handlers reserve explicit `400` classification for `SkillUploadError`).
3. Catch only `JSON.parse` failures in the shared multipart-field parser and rethrow `SkillUploadError` with a stable client-facing error message. Keep valid fields and raw JSON upload handling unchanged.
4. Re-run the focused regressions and broader web quality gates.

## Verification
- `npm test --workspace @agentvouch/web -- __tests__/api/skills-route.test.ts __tests__/api/skills-versions.test.ts --maxWorkers=1 --no-fileParallelism`
- `npm run format:check`
- `npm run lint:web`
- `npm run typecheck`
- `npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism`
- `git diff --check`

## Rollout
No migration, flag, deployment, or external state change is needed. The change only turns malformed client form fields into the intended `400` response before existing side effects.

## Rollback
Revert the focused commit. Valid multipart uploads and JSON-body behavior are not changed, so no data repair is required.

## Blockers
- None. `FormData` requests work in the existing Vitest/Next harness without an added dependency.

## Implementation Notes
- **2026-09-30:** Added two route-level multipart regressions. Before the parser change, malformed `auth` and `tags` form fields escaped as raw `SyntaxError`s and both routes returned `500`; focused tests reproduced that failure before the fix. `parseJsonField` now rethrows only JSON parse failures as field-named `SkillUploadError`s, preserving `400` classification and preventing authentication, database, storage, and pinning work.
- **2026-09-30:** Focused tests (46), formatting, lint, typecheck, and the full web suite (141 files / 1,184 tests) passed. `next build --webpack` compiled and typechecked, then stopped while prerendering `/sitemap.xml` because this checkout has no `web/.env.local` `DATABASE_URL`; no build success is claimed. The build also emitted the existing `ox` dynamic-dependency warning.
