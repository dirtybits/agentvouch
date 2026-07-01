---
name: cli-typecheck-cleanup
overview: "Fix the 44 standalone `tsc` errors in packages/agentvouch-cli (which the tsup build currently tolerates), then add a typecheck script so the package stays clean."
todos:
  - id: add-typecheck-script
    content: Add a `typecheck` npm script to packages/agentvouch-cli and capture the baseline (44 errors).
    status: done
  - id: fix-http-response-union
    content: Introduce a readJsonOrThrow<T> helper in src/lib/http.ts and route every fetch method through it (clears ~18 union-narrowing errors).
    status: pending
  - id: fix-x402-settleresponse
    content: Resolve the missing `SettleResponse` export from @x402/fetch (src/lib/http.ts line 6).
    status: pending
  - id: fix-solana-types
    content: Fix the 3 src/lib/solana.ts errors (web3 namespace, typed Anchor account, PublicKey|null assignment).
    status: pending
  - id: fix-install-headers
    content: Fix the headers Record<string,string> mismatch in src/lib/install.ts line 137.
    status: pending
  - id: fix-test-fixtures
    content: Fix the 16 publish.test.ts `never` errors and 5 update.test.ts InstalledSkillMetadata errors by typing the fixtures.
    status: pending
  - id: verify-tsc-clean
    content: Confirm tsc --noEmit reports 0 errors, vitest passes, and the tsup build succeeds.
    status: pending
isProject: false
---

# Plan — CLI Standalone Typecheck Cleanup

## Goal
`packages/agentvouch-cli` builds via `tsup ... --dts` (lenient) but `tsc --noEmit -p tsconfig.json` currently reports **44 errors** across source and tests. Drive that to **0** without changing runtime behavior, and add a `typecheck` script so the package stays clean. These errors are pre-existing tech debt — none were introduced by the trust-signal work (verified via `git stash`).

## Scope
- In scope: `packages/agentvouch-cli/src/lib/{http,solana,install}.ts`, `packages/agentvouch-cli/test/{publish,update}.test.ts`, and `packages/agentvouch-cli/package.json`.
- Out of scope: behavior changes to CLI commands, the web app, and the trust-signal follow-ups (shipped; their plan file was removed).

## Error inventory (baseline: 44)
Capture with: `cd packages/agentvouch-cli && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`.

| File | Count | Pattern | Root cause |
|---|---|---|---|
| `src/lib/http.ts` | 18 | `.error`/`.skills`/`.pagination` access + `return body` on `T \| { error?: string }` (lines 379-388, 400-405, 424-432, 445-451, 579-585, 605-611, 637, 671-677) | Union with an *optional* `error` is not discriminable, so `"error" in body` does not narrow; `body` stays the union after the throw guard |
| `src/lib/http.ts` | 1 | `Module '"@x402/fetch"' has no exported member 'SettleResponse'` (line 6) | Upstream removed/renamed the export |
| `test/publish.test.ts` | 16 | `Property '<x>' does not exist on type 'never'` (lines 85-156, 202, 260, 284-291) | Request/response fixtures inferred as `never` |
| `test/update.test.ts` | 5 | `price_lamports` not in `InstalledSkillMetadata` (37, 88, 150, 235); `undefined` not assignable to `string \| null` (204) | Fixture/type drift |
| `src/lib/solana.ts` | 3 | `Cannot find namespace 'web3'` (68); `skillListing` missing on `AccountNamespace<Idl>` (379); `PublicKey \| null` vs `OmitNever<…>` (524) | Missing import, untyped Anchor `Program`, nullable assignment |
| `src/lib/install.ts` | 1 | `{ "X-AgentVouch-Auth": string \| undefined }` not assignable to `Record<string,string>` (137) | Header value may be `undefined` |

## Implementation Steps

### 1. Add a typecheck script (do first, to measure)
In `packages/agentvouch-cli/package.json` scripts: `"typecheck": "tsc --noEmit -p tsconfig.json"`. Run it to confirm the 44 baseline, then re-run after each cluster to watch the count fall.

### 2. http.ts response-union helper (clears the 18-error cluster)
Add one shared helper and route every method through it; this localizes the single unavoidable `as T` and removes the union at all call sites. Preserve existing `CliError` messages and `exitCode`/`data` exactly (covered by CLI vitest).
```ts
interface ApiErrorBody { error?: string }
function isApiErrorBody(body: unknown): body is { error: string } {
  return (
    !!body && typeof body === "object" && "error" in body &&
    typeof (body as { error?: unknown }).error === "string"
  );
}
async function readJsonOrThrow<T>(
  response: Response,
  action: string,
  isValid?: (body: T) => boolean
): Promise<T> {
  const body = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!response.ok || !body || isApiErrorBody(body) || (isValid && !isValid(body as T))) {
    const message = (body as ApiErrorBody | null)?.error ?? response.statusText;
    throw new CliError(`Failed to ${action}: ${message}`, { exitCode: 1, data: body });
  }
  return body as T;
}
```
Convert each method, e.g.:
```ts
return readJsonOrThrow<SkillListResponse>(response, "list skills",
  (b) => Array.isArray(b.skills) && !!b.pagination);
return readJsonOrThrow<SkillRecord>(response, `inspect skill ${id}`);
```
Apply to: `listSkills` (379-388), `getSkill` (398-405), `listAuthors` (424-432), `getAgentTrust` (445-451), publish/version methods (579-585, 605-611, 637), `checkSkillUpdate` (671-677). Keep each method's validity predicate matching its current guard.

### 3. @x402/fetch SettleResponse (line 6)
- `rg -n "SettleResponse" packages/agentvouch-cli/src` to see usage.
- Inspect the installed types: `cat node_modules/@x402/fetch/package.json` (exports) and its `.d.ts`. Replace the import with the current exported type name. If it is only referenced in one or two type positions and has no current equivalent, define a minimal local `interface SettleResponse { ... }` matching the fields actually used, and drop the import. Do not bump the dependency unless no in-package fix exists (see Blockers).

### 4. solana.ts (3)
- Line 68 `web3` namespace: locate the `web3.<Type>` reference; either `import * as web3 from "@solana/web3.js"` (confirm it is a dependency) or replace with the concrete type already imported elsewhere in the file (prefer the latter to avoid adding a dep).
- Line 379 `skillListing`: the Anchor `Program` is typed with the generic `Idl`. Type it with the generated IDL type (the program's generated types under `generated/agentvouch`) so `program.account.skillListing` resolves; if the generated account type is unavailable, use a localized cast `(program.account as { skillListing: ... })` rather than `any`.
- Line 524: read the surrounding assignment; guard the `null` (early return / `if (!pubkey) throw`) or widen the target type so `PublicKey | null` is valid.

### 5. install.ts (line 137)
Build headers so values are always `string`:
```ts
const headers: Record<string, string> = {};
if (auth) headers["X-AgentVouch-Auth"] = auth;
return { headers };
```
Match the declared `Promise<void | { headers: Record<string, string> }>` return.

### 6. Test fixtures (publish.test.ts 16, update.test.ts 5)
- `publish.test.ts` `never` errors: the fixtures are inferred as `never` (commonly an empty/`as never` literal or an untyped mock return). Give each offending fixture an explicit type matching the request/response interface it stands in for (e.g. `satisfies PublishSkillRequest` / typed mock return), so property access type-checks. Read each cited line; do not change asserted values.
- `update.test.ts`: decide whether `price_lamports` is a real `InstalledSkillMetadata` field. If the install path actually persists it, add `price_lamports?: number | null` to `InstalledSkillMetadata`; if it is stale, remove it from the fixtures. For line 204, pass `null` (not `undefined`) for the `string | null` field.

## Verification
- `cd packages/agentvouch-cli`
- `npm run typecheck` → **0 errors** (was 44).
- `npx vitest run` → all pass (50 currently).
- `npm run build` → tsup `--dts` succeeds.
- Optional regression guard: `npm run typecheck` wired into the repo's lint/CI step so the count cannot creep back up.

## Rollout
- Land in cluster-sized commits (http helper, x402, solana, install, tests) so a regression bisects cleanly. The http.ts helper refactor is the largest blast radius — verify CLI vitest after it specifically.

## Rollback
- Per-cluster revert. The `readJsonOrThrow` refactor is behavior-preserving (same `CliError` shape); if a command misbehaves, revert just `src/lib/http.ts`. The `typecheck` script is inert to remove.

## Blockers
- `@x402/fetch` `SettleResponse`: if the export was intentionally removed upstream and there is no current equivalent type, this needs a dependency decision (pin a prior version vs. define a local type). Prefer a local type to avoid a version pin; escalate only if the runtime shape is unclear.
- `InstalledSkillMetadata.price_lamports`: confirm with the install/update code path whether the field is real before adding it to the type vs. deleting it from fixtures.
