---
name: Milestone 4 Tests
overview: Expand the existing Anchor/Mocha localnet suite into a focused USDC protocol test suite before adding a separate LiteSVM/Mollusk harness. The plan prioritizes reusable fixtures, every USDC-moving primitive, negative constraint coverage, and compute/account-count visibility for cutover risk paths.
todos:
  - id: m4-fixtures
    content: Extract reusable USDC localnet fixtures, PDA helpers, token balance helpers, and expected-failure utilities
    status: completed
  - id: m4-bonds-vouches
    content: Add author bond, withdraw, vouch, and revoke positive and negative tests
    status: completed
  - id: m4-marketplace-rewards
    content: Add listing, link/unlink, purchase, reward index, and voucher claim tests
    status: completed
  - id: m4-disputes
    content: Add dispute open, dismissed resolve, upheld resolve, and slash-path tests
    status: completed
  - id: m4-negative-constraints
    content: Cover wrong mint, wrong token program, missing/wrong ATA, wrong owner, insufficient USDC, self-vouch, and floor violations
    status: completed
  - id: m4-compute-accounts
    content: Add account-count and compute visibility for purchase, claim, dispute, and max batch paths
    status: completed
  - id: m4-verify
    content: Run Anchor build/test and record remaining gaps or follow-up LiteSVM/Mollusk decision
    status: completed
isProject: false
---

# Milestone 4 Program Tests

## Scope

Use the existing Anchor test path from [`Anchor.toml`](/Users/andysustic/Repos/agent-reputation-oracle/Anchor.toml) and [`tests/agentvouch-usdc.ts`](/Users/andysustic/Repos/agent-reputation-oracle/tests/agentvouch-usdc.ts) as the Milestone 4 base. Do not add LiteSVM/Mollusk in the first pass; leave that as a follow-up if Anchor runtime gets too slow or negatives become hard to isolate.

## Approach

- Refactor shared setup into a reusable fixture module under [`tests/helpers/`](/Users/andysustic/Repos/agent-reputation-oracle/tests/helpers/) for local USDC mint creation, actor funding, ATA derivation, PDA derivation, token balance assertions, and expected Anchor failure assertions.
- Keep one happy-path E2E suite proving the full publish, vouch, purchase, claim, open dispute, and resolve path.
- Add focused primitive suites for author bonds, vouches, purchases/rewards, disputes, and listing reward positions.
- Add negative tests for the explicit Milestone 4 failure classes: wrong mint, wrong token program, missing/wrong ATA, wrong token owner, insufficient USDC, self-vouch, min stake/price/bond failures, active dispute locks, no pending rewards, duplicate purchase/dispute states, and overflow-facing arithmetic guards where practical.
- Add lightweight account-count and compute visibility helpers that log or assert transaction account counts for purchase, claim, open dispute, dismissed dispute, upheld dispute, max link batch, and max slash batch. Use confirmed transaction metadata when available; avoid making CU assertions brittle until baseline numbers are known.

## File Plan

- Update [`tests/agentvouch-usdc.ts`](/Users/andysustic/Repos/agent-reputation-oracle/tests/agentvouch-usdc.ts) to keep the main E2E flow but consume shared fixtures.
- Add [`tests/helpers/agentvouchUsdc.ts`](/Users/andysustic/Repos/agent-reputation-oracle/tests/helpers/agentvouchUsdc.ts) for setup and assertion helpers.
- Add [`tests/agentvouch-usdc-bonds-vouches.ts`](/Users/andysustic/Repos/agent-reputation-oracle/tests/agentvouch-usdc-bonds-vouches.ts) for deposit/withdraw/vouch/revoke positives and negatives.
- Add [`tests/agentvouch-usdc-marketplace.ts`](/Users/andysustic/Repos/agent-reputation-oracle/tests/agentvouch-usdc-marketplace.ts) for listing, link/unlink, purchase, reward index, and claim coverage.
- Add [`tests/agentvouch-usdc-disputes.ts`](/Users/andysustic/Repos/agent-reputation-oracle/tests/agentvouch-usdc-disputes.ts) for open/resolve dismissed and upheld paths, including author bond slash via remaining accounts.
- Only update package or Anchor scripts if the existing `NO_DNA=1 anchor test` path cannot run the expanded suite reliably.

## Verification

- `NO_DNA=1 anchor build`
- `NO_DNA=1 anchor test`
- `npm run build --workspace @agentvouch/web` only if generated IDL/client files change during fixes
- Targeted searches after tests are added: `rg "price_lamports|author_bond_lamports|system_program::transfer" programs/agentvouch/src tests`

## Acceptance Criteria

- Every instruction that moves or accounts for USDC has at least one positive test and one relevant negative test.
- Token balance deltas and account state are asserted after each money-moving primitive.
- Dismissed and upheld dispute paths are both covered.
- Worst-case account-count/CU paths are visible in test output or baseline assertions.
- `NO_DNA=1 anchor test` passes without relying on devnet state.