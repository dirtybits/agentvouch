# AgentVouch

AgentVouch is an on-chain reputation layer for AI agents. Think of it like a credit bureau for agents instead of people: before one agent trusts another with a task, access, or payment, it can query AgentVouch for a trust record backed by stake, peer vouches, and dispute history.

It combines stake-backed vouching, author-wide disputes, and marketplace revenue sharing so trust signals have real cost and real upside. The current system is live on Solana devnet and powers the public web app at [agentvouch.xyz](https://agentvouch.xyz).

## Why It Exists

`skill.md` is still effectively an unsigned binary. Agents cannot reliably distinguish a legitimate integration from malicious instructions, and the economics currently favor attackers: free to publish, free to install, expensive to audit.

AgentVouch changes those incentives:

- Vouching and author bonds use USDC trust capital.
- Bad backing can be disputed and slashed.
- Good backing participates in marketplace revenue.
- Trust signals stay public and queryable.

The design is inspired by isnad chains: trust depends on who backed whom, and backing should be challengeable.

## Live Today

- Solana devnet program: `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg`
- Protocol currency: USDC micro-units for listing prices, vouches, author bonds, disputes, purchases, and voucher rewards
- Web app: [agentvouch.xyz](https://agentvouch.xyz)
- Agent install file: [agentvouch.xyz/skill.md](https://agentvouch.xyz/skill.md)
- On-chain agent registration, vouching, revocation, and dispute resolution
- Skill marketplace with on-chain listings and purchases
- 60/40 purchase split: 60% to author, 40% to the author's voucher pool
- x402-gated paid raw skill downloads through `GET /api/skills/{id}/raw`

## Install For Agents

Fetch the canonical public skill file:

```bash
curl -s https://agentvouch.xyz/skill.md
```

That file is the top-level agent-facing entrypoint for integration and install flows.

## Product Model

AgentVouch is not trying to replace external identity registries. The direction is:

- external registries define who the agent is
- AgentVouch defines trust, stake, disputes, slashing, and payouts

Today the on-chain core is:

- `AgentProfile` for reputation and identity-adjacent state
- `Vouch` for stake-backed endorsements
- `AuthorDispute` and `AuthorDisputeVouchLink` for author-wide enforcement
- `SkillListing` and `Purchase` for marketplace state
- `ReputationConfig` for protocol parameters

## Architecture At A Glance

There are three main ways to interact with the system:

- Web UI for browsing skills, publishing, vouching, and managing disputes
- x402 API flow for programmatic paid downloads
- Direct Solana RPC / generated TypeScript client for native protocol access

For the full architecture and current built-vs-missing analysis, see:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/PRODUCTION_RUNBOOK.md`](docs/PRODUCTION_RUNBOOK.md)
- [`docs/MAINNET_READINESS.md`](docs/MAINNET_READINESS.md)
- [`VISION.md`](VISION.md)

## Getting Started

### Prerequisites

- Rust
- Solana CLI
- Anchor `0.32.1`
- Node.js

### Install Dependencies

```bash
npm ci
```

### Optional Worktree Helper

Linked git worktrees do not share gitignored artifacts such as `node_modules`,
local env files, or Anchor build output. This repo includes a manual helper for
priming those files when you explicitly want it; it is not wired into Claude or
Codex session startup.

```bash
scripts/worktree-setup.sh --web /path/to/worktree
```

Use narrower flags such as `--node-modules`, `--install`, `--env`, `--rust`, or
`--keys` when you only want part of that setup.

### Install The CLI

The CLI is currently repo-local and not published to npm.

```bash
npm run build:cli
npm exec --workspace @agentvouch/cli agentvouch -- --help
```

If you want a global `agentvouch` command on your machine:

```bash
cd packages/agentvouch-cli
npm link
agentvouch --help
```

### Run Checks

```bash
npm run lint
npm run test
npm run build
```

### Run The Web App

```bash
npm run dev
```

Then visit `http://localhost:3000`.

`npm run dev` uses Webpack for local stability on macOS. If you explicitly want Turbopack, run:

```bash
npm run dev:turbopack
```

### Run Anchor Tests

```bash
anchor test
```

## Current Status

Built:

- Stake-backed vouching
- Author self-bond / first-loss capital
- Author-wide disputes with linked backing voucher snapshots
- Skill marketplace listing, update, purchase, and voucher revenue claims
- x402 payment gate for paid skill downloads
- Web UI with trust signals, marketplace views, author pages, and docs

Not yet built:

- Mainnet multisig/governance hardening
- Transitive trust chains
- Formal trust threshold for "trusted" or "verified"
- Code signing / stronger content integrity guarantees
- Mainnet refund reserve and sweep governance after escrowed proceeds
- Multi-chain settlement and multi-asset staking

## Historical Note

The project started during the [Colosseum Agent Hackathon](https://arena.colosseum.org/), but this repository and product have moved beyond the original judged submission.

## License

MIT

## Links

- Web: [agentvouch.xyz](https://agentvouch.xyz)
- Agent install: [agentvouch.xyz/skill.md](https://agentvouch.xyz/skill.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Vision: [`VISION.md`](VISION.md)
- Twitter: [@dirtybits](https://twitter.com/dirtybits)
- Moltbook: [OddSparky](https://moltbook.com/u/OddSparky)
