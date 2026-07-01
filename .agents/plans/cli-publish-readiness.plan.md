---
name: cli-publish-readiness
overview: "Prepare @agentvouch/cli for a public npm beta by fixing package publish blockers, tightening install/listing behavior, and adding release verification gates."
todos:
  - id: release-metadata
    content: Decide and implement the public npm package strategy for @agentvouch/cli and its @agentvouch/protocol dependency.
    status: pending
  - id: package-tarball
    content: Add release metadata, files allowlists, and package README content so the npm tarballs are small and useful.
    status: pending
  - id: fast-skill-list
    content: Make `agentvouch skill list` use the DB-backed fast skill API path by default, with opt-in live hydration.
    status: pending
  - id: listing-repair
    content: Harden repo skill listing creation and relisting so existing on-chain PDAs are verified or updated instead of silently accepted.
    status: pending
  - id: tree-install-cleanup
    content: Make tree installs and updates with `--force` remove stale files safely.
    status: pending
  - id: network-config
    content: Make devnet program, CAIP-2 network, and USDC mint assumptions explicit and fail closed on unsupported networks.
    status: pending
  - id: docs-and-help
    content: Refresh CLI help, package README, docs, and `web/public/skill.md` so install/publish/purchase flows match current behavior.
    status: pending
  - id: verify-release
    content: Run typecheck, tests, build, npm dry-run, packed install smoke tests, and core command smoke tests before publishing.
    status: pending
isProject: true
---

# CLI Publish Readiness Plan

## Goal
Get `@agentvouch/cli` into a public beta state that agents and developers can install with npm, use against the live AgentVouch devnet marketplace, and trust for the core flows: list, inspect, install, publish, version, vouch, and link/relist paid repo skills. This is a CLI/package hardening plan; it should not change the on-chain program or public web route contracts.

## Scope
- In scope: `packages/agentvouch-cli`, `packages/agentvouch-protocol` if it remains a runtime dependency, root npm workspace metadata, relevant web/docs copy, and release verification.
- In scope: CLI behavior that affects marketplace freshness, publishability, paid listing repair, and local install correctness.
- Out of scope: changing the Solana program, changing `/api/skills` route contracts, enabling protocol-listed x402 settlement, or redesigning the marketplace UI.
- Out of scope: mainnet launch defaults. The first publish should be a devnet beta unless the network/mint configuration is explicitly promoted later.

## Current Findings
- `packages/agentvouch-cli/package.json` still has `"private": true`, so `npm publish --dry-run --workspace @agentvouch/cli --ignore-scripts` skips the package.
- `@agentvouch/cli` depends on `@agentvouch/protocol`, and `packages/agentvouch-protocol/package.json` is also `"private": true`. A public CLI install will fail unless protocol is published too, bundled into the CLI, or removed from runtime dependencies.
- The CLI tarball currently includes too much implementation surface: `src/`, tests, `tsconfig.json`, source maps, and build artifacts. It needs a `files` allowlist and release metadata before public publish.
- `agentvouch skill list` does not expose `pageSize` or request the DB-backed fast mode. The marketplace pages moved toward fast DB-first loading; the CLI should follow that pattern and reserve slower on-chain hydration for an explicit flag.
- `skill link-listing` / relist behavior can silently accept an existing listing PDA. `AgentVouchSolanaClient.createSkillListing` returns `alreadyExists: true` without verifying `skill_uri`, name, description, price, mint, or authority against the repo skill.
- Tree installs with `--force` can leave files that existed in the previous installed archive but were removed from the new archive.
- The Solana client hardcodes the devnet native USDC mint in `packages/agentvouch-cli/src/lib/solana.ts`. That is acceptable for a devnet beta, but the CLI should make it explicit and refuse unsupported network/mint combinations.
- Typecheck, vitest, build, and basic help commands have recently passed; keep those as release gates instead of re-litigating the earlier type cleanup.

## Files To Change
- `packages/agentvouch-cli/package.json`: remove `private` only when release gates are satisfied; add `files`, `license`, `repository`, `homepage`, `bugs`, `engines`, and `publishConfig`; keep `bin.agentvouch` pointing at `dist/bin.js`.
- `packages/agentvouch-cli/README.md`: add install, quickstart, command examples, devnet caveats, keypair handling, paid install flow, and support links.
- `packages/agentvouch-cli/src/cli.ts`: add `skill list --page-size`, `--fast`, and `--live` or `--full`; update help copy and examples.
- `packages/agentvouch-cli/src/lib/http.ts`: extend `ListSkillsOptions` to include API mode and page size; preserve current response parsing.
- `packages/agentvouch-cli/src/lib/solana.ts`: add listing fetch/verification helpers, update-listing support if the program exposes it, and explicit supported-network validation.
- `packages/agentvouch-cli/src/lib/publish.ts`: use the listing verification/update path in `linkRepoSkillListing`; make relist outcomes actionable in CLI output.
- `packages/agentvouch-cli/src/lib/archive.ts`: make tree archive writes support clean/atomic directory replacement or manifest-based stale-file removal.
- `packages/agentvouch-cli/src/lib/install.ts`: call the safe tree writer for repo-backed archive installs and updates.
- `packages/agentvouch-cli/test/*.test.ts`: add tests for fast list options, existing listing mismatch/update behavior, package structure, and stale tree cleanup.
- `packages/agentvouch-protocol/package.json`: if publishing protocol separately, add release metadata, `files`, `license`, `repository`, `homepage`, `bugs`, `engines`, `publishConfig`, and generated type/build outputs.
- `web/public/skill.md` and docs pages that mention CLI usage: update install/publish/version/link-listing examples after CLI behavior is final.

## Implementation Steps

### 1. Decide the package dependency strategy
Pick one strategy before changing publish metadata:

- Preferred for a clean first beta: bundle or inline the small protocol surface that the CLI needs, then remove `@agentvouch/protocol` from `dependencies`. Acceptance criteria: built CLI output has no unresolved `@agentvouch/protocol` import, and the public CLI tarball installs without access to workspace packages.
- Alternative: publish `@agentvouch/protocol` first as a public package. Acceptance criteria: protocol has its own clean tarball, typed exports, npm metadata, and a versioning policy that keeps the CLI dependency stable.

Do not publish `@agentvouch/cli` with a dependency on a private workspace package.

### 2. Tighten npm package metadata and tarball contents
Add metadata to `packages/agentvouch-cli/package.json`:

- `private: false` only after dry-run and packed install smoke are clean.
- `files`: include `dist`, `README.md`, and any required package metadata only.
- `publishConfig.access: "public"`.
- `engines.node`: match the minimum Node version supported by the repo and CI.
- `license`, `repository`, `homepage`, and `bugs`.

Run `npm publish --dry-run --workspace @agentvouch/cli --ignore-scripts` after every packaging change and keep the file list intentionally small. If source maps remain in `dist`, decide explicitly whether to ship them; otherwise remove `--sourcemap` or exclude maps from `files`.

### 3. Make skill listing fast by default
Update `ListSkillsOptions` and the `skill list` command:

- Send `mode=fast` by default if the API supports it.
- Add `--page-size <number>` and pass it as `pageSize` or the API's expected query key.
- Add an explicit opt-in flag for slower/hydrated data, such as `--live` or `--full`, and document that it may wait on on-chain reads.
- Keep `--sort trusted` as a first-class example because it matches the trusted marketplace SEO/product direction.

Acceptance criteria:

- `agentvouch skill list` returns quickly from DB-backed data.
- `agentvouch skill list --live` or equivalent still works for users who want fresh on-chain hydration.
- Tests assert the generated query params for default, `--page-size`, and live mode.

### 4. Harden relist/link-listing behavior
Replace the current "PDA exists, therefore OK" behavior with an explicit reconciliation path:

- Add `fetchSkillListing(skillId)` to `AgentVouchSolanaClient`.
- When the listing PDA exists, compare authority/author, `skill_id`, `skill_uri`, name, description, price, currency mint, and any settlement fields exposed by the IDL.
- If the existing listing matches the repo skill and requested price, return `alreadyExists: true` with a verified status.
- If it differs and the program exposes `update_skill_listing`, call the update instruction and return the update tx.
- If it differs and cannot be updated safely, fail with a `CliError` that says exactly which fields differ and what command or program action is required.
- In `publish.ts`, patch the repo skill link only after the on-chain listing is created, verified, or updated.

Acceptance criteria:

- Relisting the LLM Knowledgebase Management skill with the new program ID cannot silently bind stale metadata.
- Dry-run output shows the expected listing address, URI, price, and whether the listing would be created, verified, or updated.
- Tests cover matching existing listing, mismatched URI, mismatched price, and wrong author.

### 5. Fix tree install stale-file behavior
Make archive tree installs deterministic:

- Prefer a staged write: extract the tar archive into a temporary sibling directory, validate that it contains exactly one top-level `SKILL.md`, then atomically replace the target directory when `--force` is set.
- If atomic directory replacement is too risky for user-managed directories, use the installed metadata manifest to remove files from the previous AgentVouch install that are absent in the new archive, and never delete untracked user files.
- Keep dry-run side-effect free and report the number of files that would be written/removed.

Acceptance criteria:

- Updating a tree skill removes a file that was present in the old archive but absent from the new archive.
- User-created files outside the AgentVouch install manifest are preserved unless the command clearly owns the whole target directory.
- Tests cover install, update, force overwrite, and dry-run.

### 6. Make network and mint support explicit
Keep the first public CLI scoped to the current devnet deployment:

- Add a single supported network config object for `solana:devnet`, program ID `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg`, and native devnet USDC mint.
- Validate `--rpc-url` or detected cluster before transactions that create/vouch/purchase/link listings.
- Print an actionable error for mainnet or unknown RPCs instead of constructing transactions with the devnet mint.
- Keep CAIP-2 labels in help/docs where network identity is shown.

Acceptance criteria:

- CLI publish/vouch/link commands fail closed on unsupported networks.
- Read-only commands can still target `https://agentvouch.xyz` without requiring a wallet.

### 7. Refresh docs and command help
Add `packages/agentvouch-cli/README.md` with:

- `npm install -g @agentvouch/cli` or `npx @agentvouch/cli` once package naming is final.
- `agentvouch skill list --sort trusted --page-size 5`.
- `agentvouch skill inspect <skill-id>`.
- `agentvouch skill install <skill-id> --out ./skills/<name>/ --tree`.
- `agentvouch skill publish --dry-run ...`.
- `agentvouch skill link-listing <repo-skill-id> --price-usdc <amount>` for repo skills whose DB publish succeeded before listing linkage.
- Devnet USDC/keypair caveats and a clear warning not to paste or commit private keys.

After CLI behavior is final, update `web/public/skill.md` and any docs that mention CLI install/publish flows so agent-facing instructions match the package.

## Verification
Run these from the repo root unless a command says otherwise:

- `npm run typecheck --workspace @agentvouch/cli`
- `npm run test --workspace @agentvouch/cli`
- `npm run build --workspace @agentvouch/cli`
- `npm publish --dry-run --workspace @agentvouch/cli --ignore-scripts`
- `npm pack --workspace @agentvouch/cli`
- In `/private/tmp/agentvouch-cli-smoke`, install the packed tarball and run:
  - `agentvouch --help`
  - `agentvouch skill list --sort trusted --page-size 3 --json`
  - `agentvouch skill inspect <known-public-skill-id> --json`
  - `agentvouch skill publish --dry-run ...` against a fixture skill tree
  - `agentvouch skill link-listing <repo-skill-id> --dry-run --price-usdc <amount>` with a devnet keypair

Release acceptance criteria:

- No public tarball contains tests, TypeScript source, stale sourcemaps, or private workspace-only imports unless intentionally documented.
- CLI commands fail with `CliError` messages that are actionable and do not dump private key material, auth payloads, or signed download tokens.
- Existing test count remains green and new tests cover fast listing, listing reconciliation, tree cleanup, and package structure.

## Rollout
- Publish the first public build with a beta tag: `npm publish --workspace @agentvouch/cli --tag beta --access public`.
- Smoke test from a clean temp directory using `npm install -g @agentvouch/cli@beta`.
- Announce the beta as devnet-only until mainnet program/mint configuration is explicitly supported.
- After at least one clean external install and one successful agent-driven list/inspect/install flow, promote the same version or a patch to `latest`.

## Rollback
- If a bad beta is published, deprecate that exact version with a message pointing to the fixed version. Use unpublish only inside npm's allowed short window and only if there is no safer deprecation path.
- Revert package metadata in a normal git commit if public publishing needs to pause; do not rewrite unrelated repo history.
- If a CLI command can cause incorrect on-chain listing linkage, disable that command path in a patch release or make it fail closed until reconciliation is fixed.
- If the public CLI depends on a package that cannot be installed, publish a patch that bundles/removes the dependency or publishes the dependency properly.

## Blockers And Assumptions
- Assumption: `https://agentvouch.xyz` remains the canonical API base URL for agent-facing CLI flows.
- Assumption: the first public package is allowed to be devnet-only and should say so plainly.
- Assumption: `@agentvouch/protocol` only needs a public package if the CLI cannot cleanly bundle or inline the small protocol surface it uses.
- Blocker: if the on-chain program does not expose a safe update path for existing listings, the CLI must refuse mismatched existing PDAs instead of attempting a relist.
- Blocker: if `/api/skills` does not currently accept `mode=fast` or page-size query params, update the web API first or make the CLI flags no-ops only after documenting that behavior in tests.
