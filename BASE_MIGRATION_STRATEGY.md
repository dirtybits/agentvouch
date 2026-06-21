# AgentVouch Base Migration Strategy

**Authoring**: dirtybits <dirtybitsofficial@gmail.com>
**Date**: 2026-06-20
**Status**: Draft for Review
**Goal**: Execute a clean expansion/port of AgentVouch to Base as the primary long-term home while preserving (and hardening) the core protocol logic developed on Solana.

## Executive Decision

**Recommendation**: 
1. **Finish hardening the protocol logic on current Solana devnet first** (do **not** launch mainnet on Solana yet).
2. Once the economic rules, dispute flows, slashing, refund mechanics, pause, and governance model are solid and documented, **port the validated design to Base** as v1.
3. Treat Solana as the R&D / validation environment. Base becomes the production + multi-chain settlement layer.

**Rationale**:
- The remaining MAINNET_READINESS blockers (dispute governance v1, refund reserve policy, pause, authority model) are high-value protocol work, not Solana-specific plumbing.
- Doing this work on the existing devnet (with recent slashing + dispute smoke tests) is the fastest way to validate.
- Porting a still-evolving protocol to Base would cause rework.
- Base better serves the core product goals: x402 ease of use, gas abstraction (ERC-4337 + EIP-3009 + CDP facilitator), no rent, and agent-first UX.
- Multi-chain settlement was already in the long-term roadmap. Starting the "real" implementation on Base positions us correctly.

## Core Protocol Invariants (Must Preserve)

From current Solana implementation (v0.2.0 devnet + recent changes):

- **USDC-native** for all economic actions (listings, vouches, author bonds, dispute bonds, purchases, rewards, slashing).
- **Stake-backed vouching** with skin-in-the-game.
- **60/40 revenue split** on paid purchases when external vouch stake exists (author gets 60%, vouchers share 40%).
- **Author self-bond** as first-loss capital for free listings.
- **Author-wide disputes** with snapshot of backing vouches at dispute creation time.
- **Dispute resolution** → upheld disputes create refund pools for harmed buyers; slashed vouch stakes go to a controlled destination (currently trending toward refund pool / harmed buyers).
- **Permissionless slashing crank** for upheld disputes.
- **Listing locking** during active disputes.
- **x402-gated paid skill downloads**.
- Trust signals must remain public, queryable, and machine-readable for agents.

These rules are chain-agnostic. Only the on-chain representation changes.

## Major Architectural Differences

### Solana (Current)
- Heavy PDA model (`AgentProfile`, `Vouch`, `AuthorDispute`, `SkillListing`, `Purchase`, `ReputationConfig`).
- Token accounts + ATAs for USDC.
- Rent-exempt balances required.
- Anchor + Rust.
- Single program with many account types.
- Fee delegation / SOL for gas.

### Base / EVM (Target)
- Contract storage (mappings, structs) + events for indexing.
- ERC-20 (USDC) with `transfer`, `transferFrom`, or better: EIP-3009 `transferWithAuthorization` via facilitator.
- No rent.
- Mature Account Abstraction (ERC-4337) + paymasters for gas sponsorship.
- OpenZeppelin libraries (AccessControl, Pausable, TimelockController, ReentrancyGuard).
- Foundry or Hardhat.
- Much cleaner admin/governance patterns.
- Native multi-chain friendly with CAIP-2 identifiers.

**Key wins on Base**:
- True gas abstraction for agents (sign one EIP-3009 message → facilitator handles gas + settlement).
- No SOL / rent management.
- Easier integration with CDP x402 facilitator (EIP-3009 USDC on Base has excellent support and fee-free tiers in some configs).
- Better tooling for complex escrow + dispute logic.

## Proposed Base Contract Architecture (High-Level)

Recommended structure (Foundry-style):

```
contracts/
├── AgentVouchBase.sol          # Main entry / registry (or split)
├── libraries/
│   ├── VouchLib.sol
│   ├── DisputeLib.sol
│   └── RevenueLib.sol
├── interfaces/
│   └── IAgentVouch.sol
├── mocks/                      # For testing
└── governance/
    ├── AgentVouchTimelock.sol
    └── PauseController.sol
```

Core contracts / modules:

1. **AgentVouch** (main contract)
   - Registry of authors, skills, vouches.
   - Handles registration, vouching, unvouching.
   - Purchase flow + 60/40 split logic.
   - Dispute creation.

2. **DisputeManager**
   - AuthorDispute creation with vouch snapshot (store array of (voucher, stake) at creation time).
   - Resolution (multisig/timelock protected).
   - Slashing + refund pool creation.
   - Permissionless `executeSlashing` crank.

3. **RevenueEscrow** (per listing or global vault pattern)
   - Holds author proceeds.
   - Handles withdraws + refund claims.

4. **Config** (or use a simple struct + events)
   - Economic parameters (min vouch, bond floors, slash %, time windows, challenger reward bps).
   - Authorities (upgrade, pause, resolver, treasury).

**Storage patterns**:
- Use `mapping(bytes32 => ...)` with deterministic IDs (keccak256 of author + skill_id or similar).
- Or simple incremental IDs + mappings.
- Heavy use of events for off-chain indexing of reputation (cheaper + more flexible than on-chain queries for agents).

**x402 Integration on Base**:
- Keep the existing x402 flow for paid raw skill downloads.
- Use CDP (or self-hosted) facilitator on Base.
- Payment receipt verification can stay similar (signature or on-chain event check).
- Agents pay in USDC via EIP-3009 → gas sponsored → seamless.

## Phased Execution Plan

### Phase 0 (Now — Solana Devnet)
- Merge `feat/a3-emergency-pause`
- Implement multisig/timelock for dispute resolver + other authorities
- Define + implement proper refund reserve / backstop policy
- Finalize economic parameters
- More devnet soak tests + authority rotation tests
- Document final protocol spec (state transitions, invariants, edge cases)
- **Deliverable**: Solid, reviewed protocol design document + passing devnet flows

### Phase 1 (Base Foundation)
- Set up Foundry project for AgentVouch on Base
- Implement core storage + basic flows (register author, create listing, vouch, purchase with 60/40)
- Implement EIP-3009 / facilitator-friendly payment paths
- Add Pausable + AccessControl (or Roles)
- Basic tests

### Phase 2 (Dispute + Slashing + Refund Logic)
- Port the full dispute flow with vouch snapshot at creation time
- Resolution via TimelockController (multisig)
- Slashing logic + refund pool creation
- Permissionless execute functions
- Tests for all paths (happy + unhappy)

### Phase 3 (Governance, Config, x402 Polish)
- Full authority model (Timelock for sensitive ops)
- Emergency pause with correct allow/deny lists
- Config setters behind governance
- x402 receipt verification + entitlement system (port from current web/API layer)
- Multi-chain identifiers (store chain + address where relevant)

### Phase 4 (Migration / Dual Support)
- Decide on dual-chain vs. Base-primary + Solana settlement later
- Cross-chain query layer or unified API for reputation
- Migration scripts for existing devnet data (if any valuable state)

## Open Questions / Decisions Needed Soon

1. **Refund routing on upheld disputes**: Should slashed vouch funds primarily go to harmed buyers (via refund pool) or have a challenger reward component? Current Solana trend is moving toward buyer protection.
2. **Long-term dispute resolution**: Keep on-chain multisig/timelock for v1, or plan optimistic oracle / LLM-assisted jury later?
3. **Storage model on Base**: Fully on-chain reputation scores vs. event-heavy + off-chain indexer (recommended for cost + flexibility).
4. **Multi-chain from day one?** Should the Base contracts already emit `chainId` / CAIP-2 and support cross-chain vouches via CCIP or just start single-chain clean?
5. **Upgradeability**: UUPS or transparent proxy from the start, or keep simple and redeploy on breaking changes?
6. **Economic parameter finalization**: Do we lock values before Base implementation or keep them configurable behind governance?

## Next Immediate Actions (Recommended)

1. On Solana devnet: Merge pause branch, implement multisig resolver, define refund policy.
2. Create this repo structure in a new branch (`feat/base-migration-strategy`).
3. Start Foundry setup + basic contract scaffolding.
4. Write detailed protocol spec document from the hardened Solana flows.

This strategy minimizes rework and maximizes the quality of the final Base implementation while respecting the significant work already done on Solana.

---

**Ready for review and iteration by the team and other agents.**
