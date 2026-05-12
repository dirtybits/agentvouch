---
name: Milestone 11 Plan
overview: Verify and, only if needed, redeploy the USDC-native v0.2.0 AgentVouch program on devnet, then smoke-test the full author/vouch/listing/purchase/reward/dispute flow and document the cutover gates.
todos:
  - id: m11-baseline
    content: Baseline branch state, artifact alignment, and live program/config assumptions
    status: completed
  - id: m11-build-compare
    content: Build Anchor artifacts and compare local IDL/binary against devnet
    status: completed
  - id: m11-config
    content: Dry-run and verify idempotent config bootstrap with devnet USDC mint
    status: completed
  - id: m11-smoke-tooling
    content: Update or add v0.2-compatible smoke tooling if existing scripts are stale
    status: completed
  - id: m11-live-smoke
    content: Run staged devnet read/write smoke tests with approval gates for live transactions
    status: completed
  - id: m11-api-cutover
    content: Verify API, web, entitlement, and dual-read cutover behavior
    status: completed
  - id: m11-verification
    content: Run test/build verification and collect deployment evidence
    status: completed
isProject: false
---

# Milestone 11: Devnet Deploy And Smoke Test

## Scope

Treat `AgNtCcWfeMYUzHxvGdZP5BJszQhx6NJGB4pQ7AN6XVWz` as the target v0.2.0 devnet program. Start with verification because the program and config may already be deployed; redeploy only if local build, on-chain executable, or IDL drift proves it is needed.

Relevant files:
- [docs/USDC_NATIVE_MIGRATION.md](docs/USDC_NATIVE_MIGRATION.md)
- [docs/DEPLOY.md](docs/DEPLOY.md)
- [Anchor.toml](Anchor.toml)
- [programs/agentvouch/src/lib.rs](programs/agentvouch/src/lib.rs)
- [scripts/init-agentvouch-config.ts](scripts/init-agentvouch-config.ts)
- [scripts/smoke-flow-surface.mjs](scripts/smoke-flow-surface.mjs)
- [web/scripts/generate-client.ts](web/scripts/generate-client.ts)
- [web/app/api/skills/[id]/purchase/verify/route.ts](web/app/api/skills/[id]/purchase/verify/route.ts)
- [web/public/skill.md](web/public/skill.md)

## Plan

1. Baseline the working tree and source-of-truth artifacts.
   - Confirm current branch, dirty files, and M10 changes are not accidentally mixed with generated artifacts.
   - Verify program ID alignment across `Anchor.toml`, `programs/agentvouch/src/lib.rs`, `packages/agentvouch-protocol`, `web/agentvouch.json`, and generated client constants.
   - Verify `target/idl/agentvouch.json` exists or regenerate it with `NO_DNA=1 anchor build`.

2. Build and compare before any redeploy.
   - Run `NO_DNA=1 anchor build` and sync IDL/client only if generated artifacts changed.
   - Fetch on-chain metadata/IDL and dump the live program binary.
   - Compare local `target/deploy/agentvouch.so` against the devnet dump.
   - Decision gate: if binary + IDL + source agree, skip redeploy; if not, prepare a redeploy summary for explicit approval before sending anything.

3. Bootstrap and verify config state.
   - Run `anchor run init-agentvouch-config` in dry-run/idempotent mode with devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` and chain context `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`.
   - Confirm `ReputationConfig`, protocol treasury vault, and x402 settlement vault exist and match the configured mint, authorities, token program, and economic floors.
   - Only submit config initialization if it is missing, and only after approval.

4. Make the smoke tooling v0.2-compatible if needed.
   - Update `scripts/smoke-flow-surface.mjs` from stale `--price-lamports` usage to `--price-usdc`.
   - Add or extend a devnet smoke script only if existing CLI/API surfaces cannot cover the full on-chain flow cleanly.
   - Keep the smoke script agent-friendly: explicit env vars, dry-run default, JSON output, and no hidden prompts.

5. Execute staged devnet smoke tests.
   - Read-only smoke: API list/inspect/trust, discovery manifests, CLI list/inspect/install dry-run, and publish dry-run.
   - Live write smoke with explicit approval before each transaction batch: register test agents, deposit author bond, create vouch, link vouch to listing, publish/list skill, purchase skill, verify purchase entitlement, claim voucher revenue, open/resolve a test dispute if authority and test funds are available.
   - For each transaction batch, surface cluster, fee payer, USDC mint, source/destination token accounts or vaults, amount, and expected post-state before sending.

6. Verify web/API cutover behavior.
   - Confirm `/api/skills`, `/skills`, `/author/[pubkey]`, `/api/agents/[pubkey]/trust`, `/api/skills/[id]/raw`, and `/api/skills/[id]/purchase/verify` use v0.2.0 as the primary path.
   - Confirm v0.1 historical data is readable only as compatibility data and no primary write path depends on SOL instructions.
   - Confirm raw downloads work for freshly purchased v0.2.0 entitlements and preserved x402/re-download paths.

7. Final verification and evidence bundle.
   - Run `NO_DNA=1 anchor test` if local tests are expected to pass in the current environment; otherwise document the exact blocker.
   - Run `npm test --workspace @agentvouch/cli`, `npm run build --workspace @agentvouch/cli`, and `npm run build --workspace @agentvouch/web`.
   - Record program show output, config PDA fields, smoke transaction signatures, API entitlement checks, and stale-copy search results.
   - Update docs only for discovered drift or final smoke evidence; do not touch pitch deck files in Milestone 11.

## Risk Controls

- No mainnet actions.
- No live transaction is sent without explicit approval and a transaction summary.
- Redeploy is a decision gate, not the default path.
- Do not rotate authorities or change config parameters unless explicitly approved.
- Keep SOL framed as fees/rent/ATA funding only, except explicitly historical v0.1 data.
- If smoke tests expose a protocol mismatch, stop and re-plan instead of layering a workaround.