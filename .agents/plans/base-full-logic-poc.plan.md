---
name: base-full-logic-poc
overview: "Build an isolated Base/EVM proof of concept that ports AgentVouch's current USDC-native trust, listing, purchase, dispute, slashing, refund, pause, and x402 settlement logic by spec, without migrating production authority away from Solana."
todos:
  - id: source-parity-spec
    content: Freeze the Solana-to-EVM parity map (23 core instructions, 14 account structs, A3 pause behavior) and commit the Decision Rubric thresholds (per-action cost ceiling) before building
    status: in_progress
  - id: evm-workspace
    content: Add an isolated Foundry workspace under contracts/base-poc plus package-level ABI/type export strategy without disturbing Solana workspaces
    status: in_progress
  - id: core-state-roles
    content: Implement AgentVouchEvm config, roles, pause, profiles, bonds, vouches, listings, settlements, and internal USDC accounting
    status: completed
  - id: purchase-and-rewards
    content: Implement direct Base purchase flow with USDC custody, purchase receipts, author proceeds, author-wide voucher reward index, and claims
    status: completed
  - id: x402-settlement
    content: Implement and compare x402-compatible settlement lanes with payment-ref idempotency and protocol-visible purchase receipts
    status: completed
  - id: interim-decision-gate
    content: Score the Decision Rubric on Phases 0-4 evidence (gas-free UX, settlement trust, cost, custody, accounting parity) and decide go/no-go before porting disputes/slashing/refunds
    status: completed
  - id: disputes-slashing-refunds
    content: Port author disputes, liability scopes, dispute locks, voucher slashing, refund pools, claims, and close/expiry behavior
    status: pending
  - id: parity-tests
    content: Add Foundry tests that mirror the Solana Anchor happy paths, adversarial paths, accounting invariants, and gas measurements
    status: pending
  - id: app-api-cli-spike
    content: Add feature-flagged web/API/CLI adapter stubs for Base chain_context, receipts, and read-only inspection without changing default Solana flows
    status: pending
  - id: decision-report
    content: Produce the comparison report scored against the Decision Rubric: Solana plus Kora/backing alpha vs Base full-logic POC for UX, cost, custody, security, and operational complexity
    status: pending
isProject: false
---

# Base Full-Logic POC

## Goal

Build a Base proof of concept that ports AgentVouch's current protocol logic by spec, not by mechanical Anchor-to-Solidity transpilation. The POC should answer whether Base can preserve AgentVouch's protocol-visible USDC accounting while materially simplifying the user flow through smart accounts, paymasters, and x402-compatible Base USDC.

This is a decision instrument, not a migration branch. Solana remains the current canonical implementation unless the POC proves better UX and lower operating complexity without weakening the trust/accounting model.

## Status And Assumptions

- Drafted 2026-06-21; lives on branch `feat/base-poc` (3 doc-only commits ahead of `main`).
- A3 emergency pause is merged and on `main` (verified 2026-06-21): `set_paused` exists at `programs/agentvouch/src/instructions/set_paused.rs`, is gated by `config.pause_authority`, and `.agents/plans/a3-emergency-pause.plan.md` shows all todos completed. The earlier "this worktree is pre-A3, refresh from `main`" hedge no longer applies; `set_paused` is already in the parity map below. Branch from current `main`/`feat/base-poc` and A3 is present.
- Parity surface verified against `main` 2026-06-21: `programs/agentvouch/src/lib.rs` exposes **25 instruction handlers** (`pub fn`). Two are M13 migration helpers (`migrate_config_m13`, `migrate_skill_listing_m13`) that the POC does not port, which leaves **23 core protocol instructions** as the parity surface (the 23 rows in the parity map below, `set_paused` included) plus **14 `#[account]` structs**.
- A3 pause enforcement is distributed, not centralized: `set_paused` only flips `config.paused`; each instruction enforces its own paused behavior. Derive the exact allowed/blocked flow set by grepping `paused` across `programs/agentvouch/src/instructions/*.rs` during Phase 0, not from `set_paused.rs` alone.
- Existing CAIP-2 labels already include Base as `eip155:8453` (`web/lib/chains.ts`).
- Do not call this a "transpile." The business rules port; Solana PDAs, rent, ATAs, Anchor constraints, and SPL token vault structure do not.

### Implementation log

- 2026-06-22: Implementation started on branch `feat/base-poc-spike` (off `main`, which now carries this plan after #41). Foundry 1.7.1; deps OpenZeppelin Contracts v5.1.0 + forge-std, vendored under `contracts/base-poc/lib/` (gitignored, reproduce via `setup.sh`). **Phase 1 green:** `AgentVouchEvm` with `Config` + roles (`CONFIG/RESOLVER/TREASURY/SETTLEMENT/PAUSE`) + `Pausable` A3 parity + `registerAgent` (first rent-touching flow — a plain sponsored write on Base, no rent/payer), plus `MockUSDC` and `AgentVouchTypes`. `forge build` + 8/8 `forge test` pass. Scope target: Phases 0–4 (rent-touching core + x402), stop at the 4.5 gate. Cost-ceiling rubric threshold still to be set before the gate.
- 2026-06-22 (Phase 2): bonds + vouches + listings green; **22/22 forge tests**. `depositAuthorBond`/`withdrawAuthorBond` (exit, locked by open disputes + free-listing bond-floor exposure), `vouch`/`revokeVouch` (USDC custody, reward-index entry snapshot, A1 open-dispute revoke lock), `createSkillListing` (+ implicit settlement init, free-listing floor / min-paid-price) and `removeSkillListing`. A3 pause: risk-increasing inflows are `whenNotPaused`, exits stay open. **Porting hazard surfaced + fixed:** Solana `VouchStatus::Active` is enum value `0`, which is also a fresh EVM storage slot's default — so existence is gated on a non-zero `voucher`, not on status (EVM mappings have no membership). Deferred to fold into later phases: `updateSkillListing` revision bump and `closeSkillListing` (on EVM, close ≈ remove — no rent to recoup). Next: Phase 3 (`purchaseSkill` + 60/40-vs-100% split + author-wide reward-index accrual + proceeds/claims).
- 2026-06-22 (Phase 3): purchase + reward index + proceeds + claims green; **36/36 forge tests**. `purchaseSkill` (split: no-backing→100% author / backed→authorBps/voucherBps with `require voucher_pool>0`; revision-scoped receipt; duplicate-purchase guard; dispute + settlement locks; atomic — revert moves no USDC and writes no receipt), `claimVoucherRevenue` (NOT pause-guarded), `withdrawAuthorProceeds` (NOT pause-guarded; dispute lock + author-proceeds time lock), and `_accrueAuthorRewards` mirroring Solana's shared helper exactly: `index_delta = pool * 1e12 / activeStake`, per-voucher `stake * (authorIndex − entryIndex) / 1e12`, non-live/zero-stake skip accrual but keep pending, and **revoke accrues first** so pre-revoke earnings survive. `REWARD_INDEX_SCALE = 1e12`. Covered: 60/40 + 100% routing, single/multi-voucher pro-rata, late-voucher-earns-nothing, dup guard, proceeds time-lock, rewards-survive-revoke, pause set, and a solvency invariant. **A3 fidelity correction** (from grepping the real `require!(!config.paused)` set, not the ROADMAP prose): `register_agent` is NOT paused-guarded (allowed while paused) and `withdraw_author_bond` IS (blocked) — Phase 1/2 had both backwards; fixed + retested. Next: adversarial verification of the accounting (subagent fan-out), then Phase 4 (x402 lanes).
- 2026-06-22 (Phase 3 adversarial verification): fanned out 3 read-only auditors (Solana-parity / insolvency / Solidity-security). Confirmed faithful: split, index math, accrue/claim, revoke-accrues-first, and solvency (both `indexDelta` and per-voucher accrual truncate DOWN, so `sum(accrued) <= voucherPool` always — the unclaimed `-=` can't underflow; ~`n-1` micros dust per purchase, negligible). **Fixed 4 real issues surfaced:** (1) re-vouch silently zeroed earned-but-unclaimed pending rewards → permanent USDC lockup (now preserved across re-vouch); (2) `withdraw_author_proceeds` was NOT pause-guarded here but Solana guards it — my earlier `paused` grep was `head`-truncated (now `whenNotPaused`); (3) proceeds time-lock used `createdAt` (fixed window) vs Solana's `updatedAt` (rolling lock, reset each purchase) (now `updatedAt`, refreshed in `purchaseSkill`); (4) `vouch` didn't require the vouchee registered, Solana does (now checked); plus a self-vouch error-clarity nit. Deferred to Phase 5 (latent — no slashing path exists yet): Slashed-residual revoke reclaim, Suspended-free-listing count decrement, `slashedDeposit` drain, `totalVouchStake` under slash.
- 2026-06-22 (Base protocol-fee guard): follow-up patch fixed the Base POC split/fee hazard before Phase 4. `initializeConfig` now requires `authorShareBps + voucherShareBps + protocolFeeBps == 10_000` and rejects nonzero `protocolFeeBps` until `purchaseSkill` actually collects/routes protocol fees. Added under-allocation and reserved-fee regression tests; `forge fmt --check`, `git diff --check`, and `forge test -vv` pass with **43/43 forge tests**. The Solana-side `protocol_fee_bps` collect-vs-defer decision remains tracked separately and should not be hidden inside the Base POC.
- 2026-06-22 (Phase 4 + interim gate): x402 lanes green; **65/65 forge tests**. Lane B `purchaseWithAuthorization` (EIP-3009 contract-consumed, trust-minimized; the authorization nonce is bound to `(buyer, listingId, revision, price)` so a relayer can't redirect a signed payment; the token consumes the nonce) + Lane C `settleX402Purchase` (`SETTLEMENT_ROLE` attestation with `paymentRefHash` + `settlementTxHash` idempotency guards). `MockUSDC` gained EIP-3009/EIP-712; `purchaseSkill` refactored into a shared `_recordPurchase` used by all three lanes. Used the user's `ethereum-development` skill (EIP-712 + adversarial-test discipline) and the Coinbase `agentic-wallet` x402 skill (payer-side context). Three adversarial auditors confirmed the core sound (nonce binding, redirect-prevention, replay, CEI, cross-lane dup guard, Solana parity) and surfaced fixes now applied: split routes the sub-cent remainder to the author so every lane pulls/credits exactly `price` (no stranded dust); `buyer != address(0)` guard; corrected a stale withdraw-proceeds NatSpec; +7 coverage tests. **Headline finding (documented + tested, deliberately NOT fixed in the POC): Lane B mempool-stranding (F-1)** — the EIP-3009 auth names the contract as `to`, so anyone can submit it directly to the token, depositing funds + consuming the nonce with no receipt → stranded (no sweep). A real wrinkle of contract-consumed x402; feeds the decision. Gas measured (~260–284k purchase, ~63k settle; ≈ $0.01–0.04/purchase at Base L2). **Phase 4.5 gate memo: `docs/BASE_POC_INTERIM.md`.** Recommendation: keep Solana canonical, ship Solana + Kora for the RC, and do NOT fund Phases 5–7 unless the x402/Coinbase distribution bet is made explicitly — gas-free UX is achievable on both chains, so the call is strategic/distribution, not UX/accounting. **STOPPING at the gate** as designed (Phases 5–7 disputes/slashing/refunds not built).

## External References Verified 2026-06-21

- x402 uses CAIP-2 network identifiers; Base is `eip155:8453`.
- x402 default Base USDC is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals, EIP-3009.
- x402 EVM payments prefer EIP-3009 for USDC and Permit2 as fallback.
- x402 default facilitator is testnet-oriented; production Base settlement depends on a production facilitator or self-hosted facilitator.
- CDP Paymaster supports Base Mainnet and Base Sepolia, uses smart accounts/UserOperations, evaluates policy allowlists/spend caps, and does not sponsor traditional EOAs unless EIP-7702/smart-account support is in play.
- OpenZeppelin Contracts v5 provides AccessControl, Pausable, ReentrancyGuard, SafeERC20, and timelock/admin patterns suitable for an EVM POC.
- Foundry is the preferred EVM test harness for this POC because it gives fast Solidity unit/invariant tests and gas reports.

## Non-Goals

- No production migration decision.
- No Solana state migration.
- No mainnet Base deployment without a separate launch plan, audit, authority policy, paymaster policy, and x402 facilitator decision.
- No attempt to replicate Solana rent, ATAs, PDAs, or account-close/rent-recoup mechanics.
- No broad web UI rewrite in the first POC. App/API integration should be feature-flagged and inspection-oriented until contract parity is proven.
- No "direct author x402" bypass for protocol-listed paid skills. Paid settlement must create protocol-visible purchase receipts and preserve author/voucher accounting.

## Success Criteria

The POC is successful only if it proves all of the following:

1. A buyer can complete a paid skill purchase on Base using USDC without holding ETH in the user wallet, through either CDP smart-account/paymaster flow or x402-compatible EIP-3009 settlement. Native Base gas is still paid by a relayer, paymaster, facilitator, or keeper; the POC must make that actor and its USDC reimbursement policy explicit.
2. The Base contract records the same purchase semantics as Solana: buyer, listing, revision, price, author share, voucher pool, timestamp, and idempotency guard.
3. Paid purchases preserve current economics:
   - if the author has external vouch backing, split by configured `author_share_bps` / `voucher_share_bps`;
   - if no external vouch backing exists, route the full price to author proceeds and create no voucher reward pool.
4. Voucher rewards remain author-wide reward-index accounting, matching current `AgentProfile.reward_index_usdc_micros_x1e12` semantics.
5. Author proceeds, voucher claims, author bonds, vouches, disputes, voucher slashing, refund pools, refunds, and pause behavior have Foundry tests that mirror the Solana tests.
6. Duplicate purchases and duplicate x402/payment settlement attempts fail deterministically.
7. Gas and paymaster cost are measured for the core flows, not guessed.
8. Atomic purchase lanes prove that if the transaction reverts, no purchase receipt is written and no USDC is moved.
9. The final report clearly compares Base POC complexity against Solana plus Kora/backing-alpha path.

## Decision Rubric

This POC is a decision instrument, so the go/no-go criteria are fixed here before the build, not inferred after the effort is sunk. The Phase 7 report scores every dimension below against measured evidence. "Go" means Base earns a separate funded migration plan; "no-go" means Solana stays canonical and the Kora/backing-alpha path carries the friction work.

Score each dimension Pass / Marginal / Fail with evidence, not impression:

| Dimension | Pass | Fail |
| --- | --- | --- |
| Buyer gas-free UX | Buyer completes a paid purchase holding only USDC (no ETH, no per-purchase approval ceremony) on at least one lane. | Buyer needs ETH, or per-purchase friction is worse than the Solana + Kora target. |
| Settlement trust | Winning lane's trust model is no worse than the current Solana x402 bridge; prefer Lane B (contract-consumed EIP-3009) over Lane C (settlement-authority attestation). | Only Lane C works and its settlement authority is an unbounded trusted writer. |
| Per-action cost | Measured gas + paymaster cost per purchase is within the Phase 0 ceiling (set a concrete USD number, e.g. <= $0.05/purchase at target gas); low-value voucher claims have a viable threshold/batching fix. | Cost exceeds ceiling, or low-value claims go net-negative after reimbursement with no fix. |
| Operator custody burden | Paymaster/relayer/settlement signer policy is bounded (allowlisted contract + selectors, per-user and global spend caps) and runnable without continuous manual intervention. | Requires a hot unbounded signer, constant babysitting, or worse custody posture than current Solana ops. |
| Accounting parity (Phases 0-4) | Invariants hold under test: unique purchase receipt, one-use payment-ref/settlement guards, correct 60/40-vs-100% routing, no insolvency under rounding. | Any invariant fails or needs a weakened trust/accounting model to pass. |
| Implementation cost | Net engineering + audit + ops complexity is credibly lower than, or justified by a decisive UX win over, Solana + Kora for the same user outcomes. | Comparable-or-higher complexity with no decisive UX win. |

Commit the concrete cost ceiling and any numeric thresholds during Phase 0 (record them here, dated) so they exist before results do. Dispute/slashing/refund parity is required only for the full Phase 7 report, not for the interim gate; see Phase 4.5.

## Contract Layout

Add an isolated EVM workspace:

```text
contracts/base-poc/
  foundry.toml
  remappings.txt
  src/
    AgentVouchEvm.sol
    interfaces/
      IERC20TransferWithAuthorization.sol
    libraries/
      AgentVouchTypes.sol
      AgentVouchMath.sol
  test/
    AgentVouchEvm.State.t.sol
    AgentVouchEvm.Purchase.t.sol
    AgentVouchEvm.Disputes.t.sol
    AgentVouchEvm.X402.t.sol
    AgentVouchEvm.Invariants.t.sol
  script/
    DeployBaseSepolia.s.sol

packages/agentvouch-evm/
  package.json
  src/
    index.ts
    chains.ts
    abi.ts
    addresses.ts
```

For the first POC, prefer a single `AgentVouchEvm.sol` contract with libraries. Splitting into many upgradeable contracts too early will hide accounting bugs behind integration complexity. If the monolith becomes too large, split only after parity tests are green.

Use:

- `AccessControl` for `CONFIG_ROLE`, `RESOLVER_ROLE`, `TREASURY_ROLE`, `SETTLEMENT_ROLE`, and `PAUSE_ROLE`.
- `Pausable` for A3 parity.
- `ReentrancyGuard` for every USDC-moving external function.
- `SafeERC20` for USDC transfers.
- `uint256` for EVM arithmetic, but keep names in `usdcMicros` and require 6-decimal USDC.
- `bytes32` ids derived from the Solana seed concepts, but not exposed as PDAs:
  - `profileId = bytes32(uint256(uint160(agent)))` or plain `address`.
  - `listingId = keccak256(abi.encode(author, skillIdHash))`.
  - `vouchId = keccak256(abi.encode(voucher, vouchee))`.
  - `purchaseId = keccak256(abi.encode(buyer, listingId, revision))`.
  - `disputeKey = keccak256(abi.encode(author, disputeId))`.
  - `paymentRefHash` and `settlementTxHash` remain explicit `bytes32` guards.

## Solana-To-Base Parity Map

| Solana instruction | Base POC function | Notes |
| --- | --- | --- |
| `initialize_config` | constructor + `initializeConfig` if needed | Set USDC, chain context `eip155:8453`, economic floors, roles, pause state. |
| `set_paused` from A3 | `setPaused(bool)` | User-provided as merged/deployed; refresh from `main` for exact allowed/blocked flow set. |
| `register_agent` | `registerAgent(string metadataUri)` | Mapping by wallet address; no rent payer. |
| `deposit_author_bond` | `depositAuthorBond(uint256 amount)` | Contract pulls USDC into internal author-bond ledger. |
| `withdraw_author_bond` | `withdrawAuthorBond(uint256 amount)` | Enforce active-dispute and free-listing exposure locks. |
| `vouch` | `vouch(address vouchee, uint256 stake)` | Contract pulls USDC into internal vouch stake ledger. |
| `revoke_vouch` | `revokeVouch(address vouchee)` | Return eligible stake/residual; preserve slashed residual rules. |
| `create_skill_listing` | `createSkillListing(bytes32 skillIdHash, string uri, string name, string description, uint256 price)` | Store author-scoped listing id; enforce free listing author-bond floor. |
| `update_skill_listing` | `updateSkillListing(...)` | Bump revision on content/price changes; block when dispute-locked. |
| `remove_skill_listing` | `removeSkillListing(bytes32 listingId)` | Block when dispute-locked. |
| `close_skill_listing` | `closeSkillListing(bytes32 listingId)` | Solidity cannot delete history cheaply if receipts reference it; mark closed/removed for POC. |
| `initialize_listing_settlement` | implicit in create/update | Create settlement struct for each listing revision internally. |
| `purchase_skill` | `purchaseSkill(bytes32 listingId)` | Pull USDC from buyer; record purchase; split author/voucher proceeds. |
| `settle_x402_purchase` | `settleX402Purchase(...)` and/or `purchaseWithAuthorization(...)` | See x402 lanes below. Must record receipt and idempotency guards. |
| `claim_voucher_revenue` | `claimVoucherRevenue(address author)` | Use author-wide reward index; no listing-only reward claim unless tests prove needed. |
| `withdraw_author_proceeds` | `withdrawAuthorProceeds(bytes32 listingId, uint64 revision, uint256 amount)` | Check settlement lock and withdrawable balance. |
| `open_author_dispute` | `openAuthorDispute(bytes32 listingId, uint64 disputeId, reason, evidenceUri, optional purchaseId)` | Pull dispute bond; lock listing/settlement per liability scope. |
| `resolve_author_dispute` | `resolveAuthorDispute(bytes32 disputeKey, ruling)` for current parity, or A2-style proposal later | For current parity, one resolver role may resolve; mark A2-governed flow as follow-up unless explicitly folded in. |
| `slash_dispute_vouches` | `slashDisputeVouches(bytes32 disputeKey, uint256 start, uint256 count)` | Keep paging for gas predictability even though EVM has no Solana account-list limit. |
| `create_refund_pool` | `createRefundPool(bytes32 disputeKey, uint256 requestedAmount)` | Match current Solana semantics first; document A2 buyer-first redesign as a future parity upgrade. |
| `claim_purchase_refund` | `claimPurchaseRefund(bytes32 refundPoolId, bytes32 purchaseId)` | One claim per purchase; transfer USDC from refund pool accounting. |
| `link_vouch_to_listing` | `linkVouchToListing(bytes32 listingId, address vouchee)` if retained | Current docs label this legacy/devnet cleanup for old listing positions; POC can keep it only for dispute slash-set parity. |
| `unlink_vouch_from_listing` | `unlinkVouchFromListing(bytes32 listingId, address vouchee)` if retained | Block when locked; preserve A1 behavior if listing-linked positions are modeled. |

## State Model

### Config

```solidity
struct Config {
  address usdc;
  string chainContext; // "eip155:8453" or "eip155:84532" for Base Sepolia
  uint256 minVouchStakeUsdcMicros;
  uint256 disputeBondUsdcMicros;
  uint256 minAuthorBondForFreeListingUsdcMicros;
  uint256 minPaidListingPriceUsdcMicros;
  uint16 authorShareBps;
  uint16 voucherShareBps;
  uint16 protocolFeeBps;
  uint8 slashPercentage;
  uint256 authorProceedsLockSeconds;
  uint256 refundClaimWindowSeconds;
  uint16 challengerRewardBps;
  uint256 challengerRewardCapUsdcMicros;
  uint32 stakeWeightPerUsdc;
  uint256 riskComponentCap;
  uint32 vouchWeight;
  uint256 vouchComponentCap;
  uint32 longevityBonusPerDay;
  uint256 longevityComponentCap;
  uint256 upheldDisputePenalty;
  uint256 reputationScoreCap;
}
```

Authority fields are OpenZeppelin roles rather than config addresses.

### AgentProfile

Map `address => AgentProfile`. Preserve:

- metadata URI
- reputation score
- total vouches received/given
- total vouch stake received
- author bond balance
- active free listing count
- open/upheld/dismissed disputes
- author-wide reward index
- unclaimed voucher revenue
- registered timestamp

No reward vault address is needed; the contract holds USDC and tracks internal accounting.

### AuthorBond

Either fold into `AgentProfile.authorBondUsdcMicros` or keep `mapping(address => AuthorBond)`. For parity clarity, keep an explicit struct in the POC:

- author
- amount
- created/updated timestamps

No vault/rent payer fields.

### Vouch

`mapping(bytes32 => Vouch)` where `vouchId = keccak256(voucher, vouchee)`.

Preserve:

- voucher
- vouchee
- stake
- status `Active | Revoked | Slashed`
- cumulative revenue
- linked listing count
- entry author reward index
- pending rewards
- last payout timestamp

No vault/rent payer fields.

### SkillListing And ListingSettlement

Use `mapping(bytes32 listingId => SkillListing)` and `mapping(bytes32 listingId => mapping(uint64 revision => ListingSettlement))`.

Preserve:

- author
- skill URI/name/description
- price in USDC micros
- current revision
- total downloads/revenue
- active reward stake and position count if listing-linked positions are retained
- author proceeds settlement pointer by revision
- status `Active | Suspended | Removed`
- dispute lock

In EVM, the settlement is internal storage, not a token account. `authorProceedsVault` becomes internal withdrawable accounting.

### Purchases

`mapping(bytes32 purchaseId => Purchase)`.

Purchase id must include `buyer`, `listingId`, and `revision`, matching Solana's revision-scoped receipt model. Duplicate purchase for the same buyer/listing/revision should revert.

### Disputes

`mapping(bytes32 disputeKey => AuthorDispute)` and optional arrays/mappings for linked vouch snapshots.

Preserve current statuses:

- `Open`
- `Resolved`
- `SlashingVouchers`

Preserve current liability scopes:

- `AuthorBondOnly`
- `AuthorBondThenVouchers`

The POC should implement current one-step resolver semantics for parity first, but keep the design shape compatible with A2:

- separate resolver role from config role;
- events structured so proposed/timelocked resolution can be added later;
- do not hard-code challenger-full slash as the long-term rule in docs.

### Refund Pools

`mapping(bytes32 refundPoolId => RefundPool)` and `mapping(bytes32 refundPoolId => mapping(bytes32 purchaseId => RefundClaim))`.

Preserve:

- dispute
- listing
- settlement revision
- total/remaining/claimed pool
- max refund per purchase
- challenger reward
- optional claim deadline

No refund vault address is needed; funds remain in the contract with internal reserved accounting.

### X402 Settlement Guards

Preserve both idempotency dimensions:

- `usedPaymentRefHash[paymentRefHash]`
- `usedSettlementTxHash[settlementTxHash]`

The contract cannot inspect historical facilitator transactions. If using stock x402 exact settlement to the contract address, the backend/settlement authority must attest to the payment after verifying amount, payer, destination, network, and payment ref off-chain. A stronger POC lane should test `purchaseWithAuthorization`, where the contract itself consumes USDC EIP-3009 authorization and records the purchase in one on-chain call.

## Atomic USDC-Sponsored Execution

Base can make AgentVouch feel USDC-native, but USDC does not pay Base gas at the protocol level. Every gasless UX path must name the native-gas actor:

- AgentVouch backend relayer
- x402 facilitator
- ERC-4337 paymaster/bundler
- third-party sponsored transaction provider
- permissionless keeper reimbursed in USDC

For user-initiated financial writes, prefer atomic contract execution over "pay server, then server writes state." The target purchase shape is:

1. Buyer signs a USDC authorization or smart-account intent.
2. Relayer/paymaster pays native Base gas.
3. AgentVouch contract pulls USDC, writes the purchase receipt, splits author/voucher accounting, records the consumed payment nonce, and pays any allowed USDC relayer reimbursement in the same transaction.
4. If the transaction reverts, there is no purchase and no USDC movement.

Every signed USDC payment or sponsored intent must bind to exact intent:

- chain id
- AgentVouch contract address
- buyer
- listing id
- listing revision
- price
- sponsor/relayer fee or maximum fee
- deadline
- nonce or payment id

Dispute opens can follow the same pattern with a challenger bond authorization. Resolver/governance actions and keeper cranks need a separate reimbursement policy because there may be no user-side payment to charge. Reward claims need a minimum claim threshold, batching, or protocol subsidy so low-value claims do not go negative after gas reimbursement.

## Payment Lanes To Compare

### Lane A: Smart Account / Paymaster Direct Purchase

Flow:

1. Buyer has Base USDC.
2. Buyer uses Coinbase Smart Wallet or other ERC-4337 compatible account.
3. Paymaster sponsors gas under an allowlisted AgentVouch contract/method policy.
4. `purchaseSkill(listingId)` pulls USDC from buyer by allowance or batched approval/transfer method.
5. Contract records purchase, author proceeds, and voucher reward index.

This is the cleanest "Coinbase customer, no ETH setup" lane, but requires allowance/session/paymaster policy work.

### Lane B: EIP-3009 Contract-Consumed Purchase

Flow:

1. Resource server returns an x402-like quote for Base USDC.
2. Buyer signs an EIP-3009 authorization.
3. Backend/paymaster submits `purchaseWithAuthorization(...)`.
4. Contract calls USDC `transferWithAuthorization` into itself, records the purchase atomically, and pays any bounded USDC relayer reimbursement.

This avoids trusting a backend to say a transfer happened, but may require a custom x402 settlement adapter rather than a stock facilitator.

### Lane C: Stock x402 Facilitator Settlement Plus Contract Attestation

Flow:

1. Buyer pays x402 exact Base USDC to the AgentVouch contract address.
2. Facilitator settles the USDC transfer.
3. Backend verifies the settlement off-chain and calls `settleX402Purchase(...)` as `SETTLEMENT_ROLE`.
4. Contract checks payment/ref idempotency, records purchase, and allocates internal accounting.

This is closest to the current Solana x402 bridge shape. It depends on settlement authority trust because EVM contracts cannot read previous transaction logs directly.

The POC should implement Lane A and one x402 lane. Lane B is preferred for trust minimization if it can fit the x402 tooling; Lane C is acceptable as a bridge-equivalent comparison if clearly labeled.

## Implementation Phases

### Phase 0: Refresh And Freeze Parity

1. Refresh branch from `main` so A3 pause behavior is present.
2. Re-read `programs/agentvouch/src/lib.rs`, `state/*.rs`, and `instructions/*.rs`.
3. Update this plan if instruction names or pause behavior changed.
4. Create a parity checklist from Solana tests:
   - `tests/agentvouch-usdc.ts`
   - `tests/agentvouch-usdc-bonds-vouches.ts`
   - `tests/agentvouch-usdc-marketplace.ts`
   - `tests/agentvouch-usdc-disputes.ts`
   - `tests/agentvouch-usdc-slashing.ts`

### Phase 1: EVM Workspace And Contract Skeleton

1. Add `contracts/base-poc/` Foundry workspace.
2. Add OpenZeppelin dependency via Foundry remappings.
3. Add `AgentVouchTypes.sol` and `AgentVouchMath.sol`.
4. Add `AgentVouchEvm.sol` with:
   - immutable USDC address;
   - role constants;
   - config storage;
   - pause;
   - basic events.
5. Add deployment script for Base Sepolia only.

### Phase 2: Profiles, Bonds, Vouches, Listings

Implement:

- `registerAgent`
- `depositAuthorBond`
- `withdrawAuthorBond`
- `vouch`
- `revokeVouch`
- `createSkillListing`
- `updateSkillListing`
- `removeSkillListing`
- `closeSkillListing` or mark-closed equivalent

Tests:

- profile registration and reputation score;
- free listing requires author bond floor;
- vouch stake updates both voucher and vouchee aggregates;
- revoked/slashed vouches stop backing;
- paused state blocks risky inflows according to A3 behavior;
- safe exits behave as A3 specifies after branch refresh.

### Phase 3: Purchases, Rewards, Proceeds

Implement:

- `purchaseSkill`
- `withdrawAuthorProceeds`
- `claimVoucherRevenue`
- purchase receipt storage/events
- reward index math

Tests:

- no-vouch purchase routes 100% to author proceeds;
- backed purchase routes 60/40 by config;
- voucher reward index accrues exactly;
- multiple vouchers claim pro rata;
- duplicate purchase for same buyer/listing/revision fails;
- settlement lock blocks purchase/withdrawal;
- rounding leaves no insolvency or underflow.

### Phase 4: X402 And Gasless Lanes

Implement:

- `purchaseWithAuthorization` for EIP-3009 if feasible.
- `settleX402Purchase` attestation lane if stock facilitator compatibility is needed.
- `paymentRefHash` and `settlementTxHash` guards.
- TypeScript helper in `packages/agentvouch-evm` for quote/receipt shapes.

Tests:

- valid EIP-3009 authorization records purchase and transfers USDC;
- expired/reused authorization fails;
- mismatched amount/listing/buyer fails;
- duplicate `paymentRefHash` fails;
- duplicate `settlementTxHash` fails;
- settlement authority cannot create purchase without matching expected internal accounting assumptions.

### Phase 4.5: Interim Decision Gate

Before building disputes, slashing, refunds, or the app spike, stop and write a short interim memo (`docs/BASE_POC_INTERIM.md`) scoring the Decision Rubric dimensions that Phases 0-4 already answer: buyer gas-free UX, settlement trust, per-action cost, operator custody burden, and Phases 0-4 accounting parity. Disputes/slashing/refunds are not needed to score these.

Gate:

- **Trending no-go** (gas-free UX fails, only an unbounded Lane C works, cost over ceiling, or custody burden worse than Solana + Kora): stop here. Write the Phase 7 report from interim evidence, recommend keeping Solana canonical, and do not build Phases 5-6.
- **Trending go, or genuinely undecided on grounds that dispute/refund parity would resolve**: continue to Phase 5.

Rationale: Phases 5-6 are migration-grade parity work (the same business arithmetic re-expressed in Solidity) and rarely move the keep-vs-migrate decision, which turns on UX, settlement trust, cost, and custody. Gating here avoids sinking that effort into a port that may never ship while Solana stays canonical.

### Phase 5: Disputes, Slashing, Refunds

Implement current Solana parity:

- `openAuthorDispute`
- `resolveAuthorDispute`
- `slashDisputeVouches`
- `createRefundPool`
- `claimPurchaseRefund`

Tests:

- free listing dispute uses `AuthorBondOnly`;
- paid listing dispute snapshots purchase/listing/backing data;
- dispute locks listing update/removal/purchase/withdrawal where current Solana logic does;
- upheld dispute slashes author bond first;
- paid dispute with linked vouches enters `SlashingVouchers`;
- paged voucher slashing updates vouch status, profile aggregate, settlement slashed bucket, and final dispute status;
- refund pool drains eligible amounts and pays buyer;
- dismissed dispute follows current treasury/challenger behavior;
- current known A2 gaps are documented as future changes rather than hidden.

### Phase 6: Read Adapter And App Spike

Implement only enough app/API support to inspect the POC:

- `packages/agentvouch-evm` exports ABI, addresses, chain constants, and typed helpers.
- `web/lib/chains.ts` already has Base; add Base Sepolia if needed as `eip155:84532`.
- Add feature flag, for example `AGENTVOUCH_BASE_POC_ENABLED=false`.
- Add read-only API/helpers to fetch Base listing/profile/purchase state.
- Add CLI inspection support only if it does not disturb Solana default commands.

Do not switch marketplace defaults to Base in the POC.

### Phase 7: Decision Report

Write `docs/BASE_POC_REPORT.md` after implementation, scoring every Decision Rubric dimension with measured evidence, with:

- contract address and chain, if deployed;
- test command outputs;
- gas report for each flow;
- paymaster/smart-account integration notes;
- x402 lane verdict;
- parity gaps;
- security concerns;
- recommendation: keep Solana canonical, Base x402 lane, Base v2, or no migration.

## Accounting Invariants

Every Foundry test/invariant should protect these:

- Contract USDC balance equals internal liabilities plus treasury/reserve amounts, within any explicitly documented pending-settlement delta.
- Author proceeds cannot include voucher slash buckets.
- Voucher reward claims cannot exceed author-wide unclaimed voucher revenue.
- Slashed or revoked vouches do not earn future rewards.
- Purchase receipt is unique per buyer/listing/revision.
- Payment-ref and settlement-tx guards are one-use.
- Dispute locks prevent listing/settlement rotation escape.
- Refund claims are one-use per purchase.
- Paused state blocks new risk-increasing flows and preserves agreed safe exits.

## Threat Model

- **Paymaster drain:** CDP/paymaster policy must allow only AgentVouch POC contract and method selectors, with per-user and global spend caps.
- **Relayer overcharge/liveness:** Sponsored flows can censor, fail to submit, underprice gas, or overcharge. Reimbursement must be bounded by signed intent and/or contract policy, and relayers must not be able to collect a fee when the protocol action fails.
- **Settlement authority abuse:** If using Lane C, settlement authority can create receipts after off-chain verification. Keep this role separate, monitored, and bounded to POC.
- **Reentrancy:** USDC-moving methods use `nonReentrant`, checks-effects-interactions, and internal accounting before transfers where safe.
- **Rounding grief:** micro-USDC math and reward index rounding must be tested with tiny prices and many vouchers.
- **Storage/gas grief:** listing positions and dispute slash sets remain capped or paged.
- **Centralized resolver:** Current parity still has centralized dispute resolution. A2 governs the long-term fix; this POC should not claim decentralized dispute governance unless it implements A2.
- **x402 mismatch:** x402 exact payment to an address does not automatically update AgentVouch state. The POC must make the state update path explicit.

## Verification

Local checks once implemented:

```bash
forge fmt --check
forge test --root contracts/base-poc
forge test --root contracts/base-poc --gas-report
npm run test --workspace @agentvouch/evm
npm run build --workspace @agentvouch/evm
npm run build
git diff --check
```

If the POC touches Solana-generated clients or Anchor code, also run:

```bash
NO_DNA=1 anchor build
npm run generate:client
NO_DNA=1 anchor test
```

Expected POC-only path should not touch Anchor code.

## Rollout

1. Local Foundry only.
2. Base Sepolia deploy with test USDC/mocked USDC.
3. Optional Base Sepolia smart-account/paymaster smoke.
4. Optional x402 testnet facilitator smoke.
5. Interim decision gate (Phase 4.5): score the rubric on Phases 0-4 evidence; stop here if trending no-go.
6. Disputes/slashing/refunds and app spike only if the gate says continue.
7. Decision report.

Do not deploy to Base Mainnet without a separate production plan.

## Rollback

- POC contracts are isolated and should not be referenced by production app defaults.
- Disable `AGENTVOUCH_BASE_POC_ENABLED`.
- Remove Base POC addresses from env/docs if a test deployment is abandoned.
- Do not alter Solana program IDs, DB links, or marketplace defaults as part of this POC.

## Blockers And Open Questions

- Which x402 lane is the target for proof: contract-consumed EIP-3009 authorization, stock facilitator plus settlement authority, or both?
- Should the POC implement current dispute resolution exactly, or jump straight to the A2 governance spec for Base? Recommendation: current parity first, A2 as a second pass.
- Should `link_vouch_to_listing` remain in the POC even though docs describe it as legacy/devnet cleanup? Recommendation: implement only if needed for A1 voucher-slash-set parity.
- Does Base POC use live Base Sepolia USDC or a local mock with an EIP-3009-compatible interface? Recommendation: local mock first, then Base Sepolia USDC if available and tooling supports it.
- Does the web app need write flows for the POC? Recommendation: no; read-only inspection and API state mapping first.
