---
name: reject-non-object-skill-upload-body
overview: "Return client errors for malformed, null, scalar, or array JSON upload bodies before either skill publishing route reaches storage, database, or authentication work."
todos:
  - id: normalize-json-upload-root
    content: "Harden web/lib/skillUpload.ts so JSON parsing failures and non-object roots raise SkillUploadError with HTTP 400 semantics — completed 2026-08-23."
    status: completed
  - id: cover-upload-body-boundaries
    content: "Add route regressions for skill creation and version publishing that prove invalid JSON roots return 400 without side effects — completed 2026-08-23 (40 focused tests passed)."
    status: completed
  - id: verify-and-open-pr
    content: "Run focused and repository quality gates and inspect the focused diff — completed 2026-08-23 (128 files / 931 tests; webpack build passed)."
    status: completed
isProject: false
---

# Reject Non-Object Skill Upload Bodies

## Goal
Ensure the shared JSON upload parser rejects malformed JSON and JSON roots that cannot satisfy its object contract (`null`, arrays, and scalars) as `400` client errors. This keeps `POST /api/skills` and `POST /api/skills/[id]/versions` from converting malformed client input into generic `500` responses.

## Scope
- In scope: JSON-root validation in the shared upload parser and focused API regressions for both consumers.
- Out of scope: multipart upload behavior, valid upload schema changes, storage changes, database migrations, wallet/chain behavior, or request-size policy.

## Files To Change
- `web/lib/skillUpload.ts`: convert JSON parsing/root-shape failures into `SkillUploadError` with status 400.
- `web/__tests__/api/skills-route.test.ts`: prove invalid create-upload bodies return 400 before database/auth work.
- `web/__tests__/api/skills-versions.test.ts`: prove invalid version-upload bodies return 400 before SQL, signature verification, storage, or pinning.

## Verified Gap (2026-08-23)
`parseJson()` casts `await request.json()` directly to `JsonRecord` at `web/lib/skillUpload.ts:137`, then immediately reads `body.files`. A valid literal `null`, scalar, or malformed JSON can therefore throw an untyped runtime/parser error. Both API consumers only map `SkillUploadError` to a client response, so these inputs otherwise reach their generic `500` catches. The parser is shared only by the create and version-publish routes (verified 2026-08-23).

## Implementation Steps
1. Wrap `request.json()` in the shared parser and throw `new SkillUploadError("Request body must be valid JSON")` on parse failure.
2. Require a non-null, non-array object root before accessing upload properties; raise `new SkillUploadError("Request body must be a JSON object")` for other JSON roots.
3. Add table-driven raw-body regressions in both route suites for malformed JSON and a literal `null`; assert the exact 400 error and absence of route side effects.
4. Preserve current content-length rejection precedence and valid JSON/multipart upload behavior.

## Verification
```bash
npm exec --workspace @agentvouch/web -- vitest run __tests__/api/skills-route.test.ts __tests__/api/skills-versions.test.ts --maxWorkers=1 --no-fileParallelism
npm run format:check
npm run lint:web
npm run typecheck
npm test --workspace @agentvouch/web -- --maxWorkers=1 --no-fileParallelism
npm exec --workspace @agentvouch/web -- next build --webpack
git diff --check
```

Acceptance criteria:
- Malformed JSON and literal `null` return HTTP 400 from both upload consumers.
- No database initialization/SQL, signature verification, IPFS pinning, or tree storage runs on those invalid paths.
- The focused diff passes formatting, lint, typecheck, tests, webpack production build, and whitespace checks.

## Rollout
Deploy through the normal PR/Vercel pipeline. This is request-boundary hardening only; no feature flag or database migration is required.

## Rollback
Revert the focused commit if valid JSON uploads unexpectedly reject. Multipart paths remain unchanged, so rollback does not require data repair.

## Blockers
None identified. No live wallet, database, or upload-provider smoke is required because the change is limited to parser error classification and mocked route boundaries.

## Execution Notes
- **2026-08-23:** Implemented the shared parser guard. Malformed JSON now returns `400 Request body must be valid JSON`; literal `null` and every other non-object JSON root return `400 Request body must be a JSON object`. The root check also covers arrays and scalar JSON values, while multipart parsing and content-length precedence are unchanged.
- **2026-08-23:** Verified focused route coverage (40 tests), repository formatting, web lint, web typecheck, the full web suite (128 files / 931 tests), `git diff --check`, and the webpack production build. The build retained the existing `ox` dynamic-dependency warning and expected no-local-`DATABASE_URL` static-generation fallbacks, but exited successfully.
