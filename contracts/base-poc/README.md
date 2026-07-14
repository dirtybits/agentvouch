# AgentVouch Base contracts (`contracts/base-poc`)

Isolated Foundry workspace for the Base/EVM protocol candidate. The deployed Base Sepolia contract is
still the pre-A1 `base-v1-candidate`; the current merged source is the clean-break, linked-library
`base-v1-a1` candidate described by
`.agents/plans/base-a1-voucher-slashing-port.plan.md`. It has not been deployed or approved for
broadcast.

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

## Build and test

```bash
forge fmt --check --root contracts/base-poc
forge test --root contracts/base-poc
forge build --root contracts/base-poc --sizes
npm run verify:base-size
```

## Status

The merged `base-v1-a1` source preserves the core registration, listing, purchase, bond, vouch, reward,
and x402 surfaces and replaces generic Base reports with one paid-purchase mechanism:

- an eligible Direct or EIP-3009 buyer receipt can open a bonded report;
- `RESOLVER_ROLE` accepts/rejects and upholds/dismisses;
- uphold slashes the author bond first and then author-wide active vouches;
- permissionless bounded pages settle voucher positions;
- the initiating buyer receives a capped pull credit and excess goes to an immutable reserve recipient.

Terminal accounting lives in the externally linked `PaidPurchaseSettlement` library and executes by
`DELEGATECALL` in the facade's storage context. The facade remains the only public API, role boundary,
storage owner, event origin, and USDC custodian. Under the pinned Foundry profile, runtime sizes are:

| Artifact | Runtime | EIP-170 headroom | 23,500-byte soft headroom |
| --- | ---: | ---: | ---: |
| `AgentVouchEvm` | 23,487 bytes | 1,089 bytes | 13 bytes |
| `PaidPurchaseSettlement` | 5,939 bytes | 18,637 bytes | 17,561 bytes |

The current suite passes 116 Foundry tests, including variable-order conservation fuzzing, a
128,000-call stateful liability invariant, malicious-token reentrancy, adversarial token behavior,
max-page gas, role handoff, and successor isolation. A 31-transaction ephemeral linked Anvil rehearsal
completed deployment, role handoff, report, resolution, paginated slashing, claims, and residual
reclaim. Deployment preflight now requires the settlement library's code hash to match the exact
compiled artifact after solc's embedded self-address is linked. Security review and live Base Sepolia
evidence remain launch blockers.

The reusable local-only rehearsal is `script/RehearseA1.s.sol`; the one-command driver at
`scripts/local-a1-rehearsal.sh` starts a disposable Anvil chain with ID 84532, derives local-only test
actors, broadcasts the uninitialized deploy, pause-before-initialize, complete role handoff, and full
settlement lifecycle, then stops the node. Its terminal assertions cover exact buyer-credit, reserve,
and voucher-residual balance deltas while the contract is re-paused.

The purchase lanes are:

- Lane A: `purchaseSkill` using an exact USDC allowance pull.
- Lane B: `purchaseWithAuthorization` using EIP-3009.
- Lane C: `settleX402Purchase` with settlement-role attestation and dual
  idempotency guards.

Lane C receipts are deliberately ineligible for paid-purchase reports because their provenance depends
on a trusted settlement attestation.

## Gas-free UX spike (v2)

Plan: `.agents/plans/base-poc-spike-v2.plan.md`. Proves the core flow runs as
ERC-4337 UserOps where the user holds **zero ETH** and a paymaster sponsors gas — no
contract changes (every fn keys off `msg.sender`, so a smart account is the actor).

- **Local proof:** `test/gasless/AgentVouchEvm.Gasless4337.t.sol` drives
  register → bond → vouch → list → purchase → voucher claim → author proceeds through a
  real EntryPoint v0.7 + a sponsoring paymaster, asserting smart accounts spend 0 ETH
  and the USDC split is correct. The targeted test is included in the 116-test full suite.
- **Deploy:** `script/Deploy.s.sol` creates an uninitialized facade with a non-broadcaster staging admin.
- **Stage:** `script/StageA1.s.sol` verifies artifacts, pauses, initializes, hands off every role, and
  leaves the candidate paused.
- **Live harness:** `harness/` — viem + Coinbase Smart Account demo against Base Sepolia
  via a Coinbase Developer Platform paymaster. Prints per-flow sponsored gas and the
  resulting USDC split. See `harness/README.md`. The harness ABI is synchronized to the local A1
  candidate, but no paid-report write UI is included.

```bash
forge test --match-path "test/gasless/*"        # the gas-free proof
contracts/base-poc/scripts/local-a1-rehearsal.sh
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL # dry-run only; broadcast requires approval
cd harness && npm i && cp .env.example .env     # then fill .env and `npm run demo`
```
