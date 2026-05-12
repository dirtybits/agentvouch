---
name: Milestone 10 Plan
overview: Bring docs, CLI help/examples, and agent-facing skill docs in line with the USDC-native AgentVouch v0.2.0 protocol while preserving explicit legacy-SOL notes only where the product still reads old state. Pitch deck updates are deferred to Milestone 13.
todos:
  - id: m10-source-of-truth
    content: Confirm current program ID, IDL sync, instruction count, account count, and USDC constants
    status: completed
  - id: m10-core-docs
    content: Update architecture, deploy, upgrade, and migration docs for USDC-native v0.2.0
    status: completed
  - id: m10-skill-web-docs
    content: Update skill.md and public docs/landing copy for USDC-native semantics
    status: completed
  - id: m10-cli-usdc
    content: Update CLI help, examples, formatting, and tests for USDC-first publish/list/install flows
    status: completed
  - id: m10-agents-facts
    content: Update AGENTS.md learned facts for USDC-native protocol and defer pitch/deck facts to Milestone 13
    status: completed
  - id: m10-verification
    content: Run stale-copy searches plus CLI/web builds and focused tests
    status: completed
isProject: false
---

# Milestone 10: Docs, CLI, And Skill File

## Scope

Align the public and agent-facing surfaces with the live v0.2.0 model:

- Canonical program: `AgNtCcWfeMYUzHxvGdZP5BJszQhx6NJGB4pQ7AN6XVWz`
- Protocol accounting: USDC micros for author bonds, vouches, listings, purchases, and voucher rewards
- SOL role: transaction fees, rent, ATA creation, and explicit legacy context only
- Canonical chain labels: CAIP-2, with devnet as `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`

Key files:

- [`docs/USDC_NATIVE_MIGRATION.md`](docs/USDC_NATIVE_MIGRATION.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DEPLOY.md`](docs/DEPLOY.md)
- [`docs/program-upgrades-and-redploys.md`](docs/program-upgrades-and-redploys.md)
- [`web/public/skill.md`](web/public/skill.md)
- [`web/app/docs/page.tsx`](web/app/docs/page.tsx)
- [`web/app/docs/how-agentvouch-works/page.tsx`](web/app/docs/how-agentvouch-works/page.tsx)
- [`web/app/page.tsx`](web/app/page.tsx)
- [`packages/agentvouch-cli/src/cli.ts`](packages/agentvouch-cli/src/cli.ts)
- [`packages/agentvouch-cli/src/lib/solana.ts`](packages/agentvouch-cli/src/lib/solana.ts)
- [`packages/agentvouch-cli/src/lib/publish.ts`](packages/agentvouch-cli/src/lib/publish.ts)
- [`packages/agentvouch-cli/src/lib/format.ts`](packages/agentvouch-cli/src/lib/format.ts)
- [`packages/agentvouch-cli/src/lib/install.ts`](packages/agentvouch-cli/src/lib/install.ts)
- [`AGENTS.md`](AGENTS.md)

## Implementation Plan

1. Establish current source-of-truth counts and protocol constants.
   - Count current Anchor instructions from `programs/agentvouch/src/lib.rs`.
   - Count logical account types from `programs/agentvouch/src/state/` and distinguish program accounts from SPL token vault accounts.
   - Confirm current IDL/program ID alignment across `Anchor.toml`, `programs/agentvouch/src/lib.rs`, `target/idl/agentvouch.json`, and `web/agentvouch.json`.

2. Update core docs.
   - Rewrite `docs/ARCHITECTURE.md` around USDC-native trust capital, vault-per-primitive settlement, current account/instruction surfaces, and legacy-SOL read paths only where still relevant.
   - Update `docs/DEPLOY.md` from old `reputation_oracle`/`ELmVn...` wording to active `agentvouch`/`AgNt...` flow, while keeping clearly labeled legacy notes if needed.
   - Mark `docs/program-upgrades-and-redploys.md` as v0.1 same-ID upgrade guidance or replace it with a v0.2 deploy/runbook pointer.
   - Keep `docs/USDC_NATIVE_MIGRATION.md` Milestone 9/10 status aligned without rewriting the plan history.

3. Update agent-facing and public docs.
   - Rewrite `web/public/skill.md` so agents see USDC-native publish, inspect, install, and paid-download semantics first.
   - Replace stale fields/examples like `price_lamports`, SOL author bond, SOL vouch stake, and `0.001 SOL` minimum with USDC micros / human USDC examples.
   - Add a clear first-time author cost note: USDC for protocol capital plus SOL for rent, fees, and ATA creation.
   - Keep x402 bridge memo guidance precise: protocol references only, no PII or free-form buyer text.
   - Update `/docs` pages and landing copy that currently says “staking SOL” or displays protocol trust capital as SOL.

4. Update CLI UX and tests for USDC-first operation.
   - Make help/examples in `packages/agentvouch-cli/src/cli.ts` USDC-first and non-interactive, following the attached CLI-for-agents guidance.
   - Prefer flags such as `--price-usdc` / `--stake-usdc` or existing USDC payloads where available; keep legacy lamport flags only as explicitly labeled compatibility paths.
   - Update publish/list/install formatting so `price_usdc_micros`, `currency_mint`, `payment_flow`, and author trust fields are clear for agents.
   - Preserve idempotent behavior for registration, listing creation, vouching, and purchases.
   - Update CLI tests for help text, formatting, publish payloads, and paid install behavior.

5. Update workspace facts and defer deck work.
   - Update `AGENTS.md` learned facts so future sessions do not reintroduce SOL-native pricing or old program IDs as current behavior.
   - Do not update pitch deck binaries or pitch README in Milestone 10.
   - Leave pitch deck account/instruction counts, architecture slides, and paper-deck regeneration for Milestone 13.

6. Verification.
   - Run targeted stale-copy searches:

```bash
rg "0\.001 SOL|price_lamports|stake SOL|staking SOL|legacy SOL|ELmVnLSN|programs/reputation-oracle|reputation_oracle" docs web/public packages/agentvouch-cli web/app/docs web/app/page.tsx AGENTS.md
```

   - Run CLI verification:

```bash
npm run build --workspace @agentvouch/cli
npm test --workspace @agentvouch/cli
```

   - Run web verification:

```bash
npm run build --workspace @agentvouch/web
```

   - If any Anchor/IDL-facing surface changes, run:

```bash
NO_DNA=1 anchor build
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
npm run build --workspace @agentvouch/web
```

## Risk Controls

- Keep legacy-SOL paths only where they describe existing read/compatibility behavior; do not present them as the v0.2 write path.
- Do not change on-chain program logic unless the docs/CLI audit exposes a real mismatch that cannot be solved in client/docs.
- Avoid broad refactors in CLI internals unless needed to remove incorrect SOL-native defaults.
- Do not touch pitch deck files in Milestone 10; handle those in Milestone 13.