# AgentVouch Base POC (`contracts/base-poc`)

Isolated Foundry workspace for the Base/EVM full-logic proof of concept. **Decision
instrument only** — Solana (`programs/agentvouch`) remains canonical. Plan:
`.agents/plans/base-full-logic-poc.plan.md`.

## Why this exists
Ports AgentVouch's USDC-native protocol logic **by spec** (not transpilation) to test
whether Base can preserve the protocol-visible accounting model while removing wallet
friction. Notably, EVM has **no rent**: the Solana flows that bill the user for
PDA/ATA rent today (`register_agent`, `deposit_author_bond`, `vouch`,
`create_skill_listing`, `purchase_skill`, …) become plain paymaster-sponsored state
writes here — there is no `rent_payer` to engineer.

## Setup
```bash
# 1. Foundry toolchain
curl -L https://foundry.paradigm.xyz | bash && foundryup
# 2. Vendored deps (forge-std + OpenZeppelin v5.1, gitignored)
./setup.sh
```

## Build & test
```bash
forge build
forge test -vv
forge test --gas-report
```

## Status
Phase 1 (workspace + config/roles/A3 pause + `registerAgent`) — in progress.
See the plan's Implementation Phases. Build stops at the Phase 4.5 interim decision
gate before any disputes/slashing/refund work.
