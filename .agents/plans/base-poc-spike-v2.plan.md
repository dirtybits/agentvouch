---
name: base-poc-spike-v2
overview: "MVP gas-free UX spike on the existing Base POC contract: prove that register, author bond, vouch, listing, purchase, and voucher/author revenue split can all run as ERC-4337 UserOps where the user holds zero ETH and a paymaster sponsors gas. Targets Base Sepolia + a hosted paymaster (Coinbase CDP). Decision instrument only; Solana stays canonical and disputes/slashing (Phases 5-7) are explicitly out of scope."
todos:
  - id: confirm-scope
    content: Confirm the spike targets gas-free UX on the already-built Phases 0-4 core flows (register/bond/vouch/list/purchase/rev-split), NOT the Phases 5-7 disputes/slashing port, and pick ERC-4337 + paymaster over ERC-2771
    status: completed
  - id: contract-4337-compat
    content: Verify the existing AgentVouchEvm needs no changes for account-abstraction (every USDC-moving fn uses msg.sender, so a smart account is the actor)
    status: completed
  - id: local-gasfree-proof
    content: Add a Foundry proof (test/gasless) driving the full flow through real ERC-4337 v0.7 UserOps with a sponsoring paymaster, asserting smart accounts spend zero ETH and the revenue split is correct
    status: completed
  - id: deploy-script
    content: Add script/Deploy.s.sol to deploy + initialize AgentVouchEvm on Base Sepolia against Circle testnet USDC
    status: completed
  - id: live-harness
    content: Add a viem + Coinbase Smart Account harness (harness/) that runs the gasless flow on Base Sepolia via a CDP paymaster and reports zero user gas + the USDC split
    status: completed
  - id: live-run
    content: Run the live harness on Base Sepolia with a real CDP paymaster key + funded deployer, capture the gas-sponsored numbers, and confirm the paymaster policy allowlist (AgentVouch + USDC.approve)
    status: pending
  - id: gasfree-report
    content: Write up the gas-free UX findings (per-flow sponsored cost, smart-account UX notes, CDP policy/allowlist gotchas, Coinbase Smart Wallet vs alt accounts) as the spike's decision output
    status: pending
isProject: false
---

# Base POC Spike v2 — Gas-Free UX

## Goal

Answer one question with a runnable artifact: **what does the gas-free UX possible on
Base actually look like for AgentVouch's core flows?** The user should be able to
register, post an author bond, vouch, list a skill, buy a skill, and have the
voucher/author revenue split settle — all without ever holding or spending ETH.

This spike is deliberately scoped to the **already-built Phases 0-4 surface**
(`contracts/base-poc/src/AgentVouchEvm.sol`, merged in #44). It does **not** build the
Phases 5-7 disputes/slashing/refund machinery (`base-full-logic-poc` plan), which is
orthogonal to gas-free UX and was deferred for the MVP.

## Approach: ERC-4337 + paymaster (no contract changes)

Every state-changing function on `AgentVouchEvm` keys off `msg.sender` and pulls USDC
via `safeTransferFrom(msg.sender, ...)`. With ERC-4337 smart accounts the smart account
**is** `msg.sender`, so:

- the existing contract is already account-abstraction-driveable, unchanged; and
- a paymaster sponsors the UserOp gas, so the user's smart account spends **zero ETH**.

This is the Base-native path (Coinbase Smart Wallet + a Coinbase Developer Platform
paymaster). ERC-2771 meta-transactions were considered and rejected: they would require
rewriting `msg.sender` -> `_msgSender()` across the contract for no UX gain here.

The only flow already gasless in-contract is the EIP-3009 `purchaseWithAuthorization`
lane (buyer signs, relayer submits); 4337 generalizes gasless to register/list/vouch
too.

## What's built (this spike)

- `test/gasless/AgentVouchEvm.Gasless4337.t.sol` + `AcceptEverythingPaymaster.sol` —
  the full flow over real EntryPoint v0.7 UserOps; asserts zero user ETH + correct
  split. **66/66 Foundry tests pass.**
- `script/Deploy.s.sol` — Base Sepolia deploy + config init.
- `harness/` — viem + Coinbase Smart Account live demo against Base Sepolia + a CDP
  paymaster; prints per-flow sponsored gas and the resulting USDC split. Typechecks
  clean; needs a CDP key + funded smart accounts to run live.
- `setup.sh` now also vendors `account-abstraction` v0.7 (gitignored, like the other deps).

## What's left (needs the user's infra)

1. **live-run** — provide `CDP_RPC_URL` (paymaster+bundler), a funded `DEPLOYER_PRIVATE_KEY`,
   deploy, fund the three smart-account addresses with Base Sepolia USDC, run `npm run demo`.
   The CDP paymaster policy must allowlist the deployed contract and the USDC `approve` call.
2. **gasfree-report** — capture the numbers and write the decision output.

## Out of scope

Disputes, slashing, refund pools, the A2 governance redesign, switching any marketplace
default to Base. Solana remains canonical.
