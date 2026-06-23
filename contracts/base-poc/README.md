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
# 2. Vendored deps (forge-std + OpenZeppelin v5.1 + account-abstraction v0.7, gitignored)
./setup.sh
```

## Build & test
```bash
forge build
forge test -vv
forge test --gas-report
```

## Status
Phase 4.5 gate reached on `feat/base-poc-spike`: Phases 0-4 are implemented
and verified with 65/65 Foundry tests. The POC now includes the rent-touching
core flows plus two x402 lanes:

- Lane B: `purchaseWithAuthorization` using EIP-3009.
- Lane C: `settleX402Purchase` with settlement-role attestation and dual
  idempotency guards.

The interim decision memo is `docs/BASE_POC_INTERIM.md`. Per that gate, the POC
stops before disputes/slashing/refunds (Phases 5-7) unless AgentVouch explicitly
funds the Base/x402 distribution bet.

## Gas-free UX spike (v2)
Plan: `.agents/plans/base-poc-spike-v2.plan.md`. Proves the core flow runs as
ERC-4337 UserOps where the user holds **zero ETH** and a paymaster sponsors gas — no
contract changes (every fn keys off `msg.sender`, so a smart account is the actor).

- **Local proof (runs now):** `test/gasless/AgentVouchEvm.Gasless4337.t.sol` drives
  register → bond → vouch → list → purchase → voucher claim → author proceeds through a
  real EntryPoint v0.7 + a sponsoring paymaster, asserting smart accounts spend 0 ETH
  and the USDC split is correct. `forge test` is now **66/66**.
- **Deploy:** `script/Deploy.s.sol` (Base Sepolia + Circle testnet USDC).
- **Live harness:** `harness/` — viem + Coinbase Smart Account demo against Base Sepolia
  via a Coinbase Developer Platform paymaster. Prints per-flow sponsored gas and the
  resulting USDC split. See `harness/README.md`.

```bash
forge test --match-path "test/gasless/*"        # the gas-free proof
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
cd harness && npm i && cp .env.example .env     # then fill .env and `npm run demo`
```
