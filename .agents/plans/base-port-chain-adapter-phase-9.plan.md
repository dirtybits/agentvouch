---
name: base-port-chain-adapter-phase-9
overview: "Prove the Base Sepolia default end-to-end, then scope and build the minimal EVM trust layer and security gates required before any Base mainnet cutover."
todos:
  - id: preflight-base-e2e-env
    content: Verify Base Sepolia contract, CDP paymaster/bundler, relayer, USDC, funded passkey wallet, and agent EOA x402 envs before running live smokes.
    status: pending
  - id: smoke-human-base-flow
    content: Run Base passkey register/list/buy/raw-download with gas sponsored by CDP paymaster and record tx hashes plus ETH/USDC deltas.
    status: pending
  - id: smoke-agent-x402-flow
    content: Run Base EIP-3009/x402 agent payment through settle/verify/raw download and record authorization, settlement tx, receipt, and entitlement evidence.
    status: pending
  - id: smoke-solana-regression
    content: If Solana remains selectable after Phase 8, run a targeted Solana direct-purchase/raw-download regression and note sponsored-checkout status separately.
    status: pending
  - id: scope-base-v1-trust-layer
    content: Specify the Base v1 contract/web delta for minimal trust: vouch/revoke, author bond, founder-resolved disputes/reports, trust reads/snapshots, and mainnet-safe ownership.
    status: pending
  - id: implement-and-audit-base-v1
    content: Implement the approved v1 trust/payment contract delta and web trust surfaces, then complete forge/web tests and an external security review before any 8b mainnet default.
    status: pending
isProject: false
---

# Phase 9 - Base E2E And Minimal Trust V1

## Goal

After Phase 8a makes Base Sepolia the default, prove the default path actually works end-to-end and
close the strategic gap Claude flagged on 2026-07-02: Base has the cleaner payment rail, but the
defensible AgentVouch moat is stake-backed trust. Phase 9 therefore has two gates:

1. Base Sepolia E2E proof: human passkey purchase, agent x402 purchase, raw download, and targeted
   Solana regression while Solana remains selectable.
2. Base v1 trust/mainnet readiness: minimal trust layer plus ownership/security review before any
   Phase 8b Base mainnet cutover.

## Context

- Phase 5 shipped Base ChainWallet writes and EIP-3009/x402 settlement.
- Phase 6 shipped chain-qualified persistence and raw-access separation.
- Phase 7 shipped chain-aware address/explorer/API boundaries.
- Phase 8a should make Base Sepolia the default, behind rollback.
- Current Base contract is `contracts/base-poc/src/AgentVouchEvm.sol`, explicitly labeled POC:
  `AgentVouchEvm (Base POC)` / `base-poc-v0` in review context. It is not mainnet-ready.

## Scope

In scope:

- Live Base Sepolia default-path verification.
- Human flow:
  - Coinbase Smart Wallet passkey connect/restore/disconnect.
  - `registerAgent`.
  - paid skill list.
  - buyer purchase with expected-price guard.
  - raw download with chain-qualified entitlement.
  - proof user ETH delta is zero or limited to the expected sponsored/user-paid policy.
- Agent flow:
  - x402 supported metadata advertises Base Sepolia.
  - EIP-3009 authorization.
  - server settlement.
  - receipt/entitlement persistence.
  - raw download redemption.
- Targeted Solana regression if Solana remains selectable.
- Base v1 trust-layer scope and implementation plan:
  - vouch/revoke and author bond as visible trust inputs.
  - founder/admin-resolved author reports/disputes as the minimum dispute surface.
  - trust snapshot or live-read path for Base authors in marketplace/detail pages.
  - ownership/key policy and security review gate.

Out of scope:

- Base mainnet default flip. That is still Phase 8b and remains blocked until this plan's v1/security
  gates pass.
- Full Solana-equivalent voucher slashing machinery unless explicitly re-approved. MVP bias is
  founder-resolved disputes/reports first.
- Removing Solana.
- Multi-EVM support beyond Base Sepolia/mainnet planning.

## Part A - Base Sepolia E2E Proof

### Preflight

Verify these before running live smokes:

- `BASE_SEPOLIA_RPC_URL` / `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` points at a reliable archive-capable
  Base Sepolia endpoint.
- `BASE_AGENTVOUCH_CONTRACT_ADDRESS` points at the expected F-1-fixed/POC contract.
- `BASE_USDC_ADDRESS` / native USDC config matches Base Sepolia USDC.
- CDP paymaster/bundler endpoint is present for UserOps.
- Relayer/x402 settlement env is present and has permission to submit settlement txs.
- A passkey buyer and author can be funded with Base Sepolia USDC.
- An agent EOA exists for x402 EIP-3009 signing. Smart-account/EIP-1271 agents are out of scope for
  the current Lane B code.

Record the exact env names, not secret values, in the plan closeout.

### Human Flow

Use a fresh browser profile/localStorage if possible:

1. Connect Base passkey wallet.
2. Register author if needed.
3. Publish/list a paid skill on Base Sepolia through Phase 8's default paid-publish path.
4. Confirm DB row:
   - `chain_context = eip155:84532`
   - `author_pubkey` is EVM address
   - `evm_listing_id` populated
   - `evm_contract_address` populated/lowercased
   - `evm_tx_hash` populated
5. Connect/switch to a buyer wallet.
6. Purchase the skill.
7. Confirm:
   - tx hash / userOp hash
   - expected price matched live listing before approval
   - user ETH delta is zero for CDP-sponsored flow
   - USDC delta matches price and split behavior
   - receipt and entitlement rows have chain-qualified buyer fields
8. Download raw content with the buyer and prove author/non-buyer access is still blocked.

### Agent x402 Flow

Run the x402 Lane B path:

1. Fetch supported payment metadata and verify Base Sepolia is advertised.
2. Build EIP-3009 authorization for the agent EOA.
3. Settle through `/api/x402/settle` or the current harness.
4. Verify:
   - settlement tx hash
   - payment ref/nonce uniqueness
   - receipt row
   - entitlement row
   - raw download succeeds for the x402 buyer
5. Attempt duplicate settlement and confirm idempotency / duplicate guard.

### Solana Regression

If Solana remains selectable in Phase 8:

- Run one direct Solana paid purchase and raw download.
- Confirm Solana Explorer links still point at devnet.
- Sponsored/Kora checkout prompt remains a separate follow-up unless Solana is re-promoted.

## Part B - Minimal Base Trust Layer

## Why This Is In Phase 9

Phase 8a can be Sepolia-only and reversible, but mainnet cannot launch as only a paid skill
marketplace. AgentVouch's defensible product is stake-backed trust: vouches, author backing,
reports/disputes, and visible stake-at-risk. Base rows currently render with incomplete trust and no
cached marketplace trust path. This must be closed before 8b.

## Contract Scope

Start from `contracts/base-poc/src/AgentVouchEvm.sol`, but do not ship the POC contract to mainnet as
is. Decide whether to create `AgentVouchEvmV1.sol` or rename the POC once it is productionized. The
v1 spec should include:

- Preserve:
  - `registerAgent`
  - `createSkillListing`
  - `purchaseSkill`
  - `receiveWithAuthorization` x402 settlement
  - `depositAuthorBond`
  - `withdrawAuthorBond`
  - `vouch`
  - `revokeVouch`
  - pause
- Add or finalize:
  - explicit protocol version getter/event (not `base-poc-v0`)
  - founder/admin-resolved author report/dispute object
  - `openReport`/`openDispute` with bond/fee policy
  - `resolveReport`/`resolveDispute` with `upheld` / `dismissed`
  - profile counters for open/upheld/dismissed reports
  - minimal author-bond penalty on upheld reports
  - event set sufficient for indexers and web snapshots
- Defer unless explicitly approved:
  - full voucher slashing parity
  - refund-pool machinery beyond existing purchase/refund guarantees
  - protocol fee extraction
  - upgradeable proxy complexity

## Ownership / Security Policy

Before mainnet:

- Replace EOA admin with multisig or a documented custody policy.
- Document roles:
  - DEFAULT_ADMIN_ROLE
  - CONFIG_ROLE
  - RESOLVER_ROLE
  - TREASURY_ROLE
  - SETTLEMENT_ROLE
  - PAUSE_ROLE
- Decide immutable fresh deploy vs upgradeable. Recommendation: fresh non-upgradeable v1 unless a
  proxy is required by a concrete ops need.
- Run internal security review and one external security pass.
- Produce a deployment/runbook update before 8b.

## Web Scope

- Base trust reads:
  - Extend `web/lib/baseAuthorTrust.ts` as needed for v1 report/dispute fields.
  - Add Base marketplace trust snapshots or live hydrate path so Base authors do not stay trust-null
    on `/skills`.
  - Keep chain-qualified trust: no Solana trust attached to EVM authors.
- Base vouch/report UI:
  - Author page can become chain-aware for EVM authors if the v1 contract supports it.
  - Skill/detail pages should show Base stake-at-risk and report history honestly.
- Activity/dashboard:
  - Include Base trust/vouch/report activity where useful.
  - Keep Solana PDA dashboards separate or clearly labelled.

## Files To Change

Likely contract files:

- `contracts/base-poc/src/AgentVouchEvm.sol`
- `contracts/base-poc/src/libraries/AgentVouchTypes.sol`
- `contracts/base-poc/src/interfaces/*` if new interfaces are needed
- `contracts/base-poc/test/*.t.sol`
- `contracts/base-poc/script/Deploy.s.sol`
- `contracts/base-poc/harness/src/abi.ts`
- `contracts/base-poc/ui/src/abi.ts`

Likely web files:

- `web/lib/adapters/agentVouchEvmAbi.ts`
- `web/lib/baseAuthorTrust.ts`
- `web/lib/marketplaceBrowse.ts`
- `web/lib/skillDetailSnapshot.ts`
- `web/components/SkillPreviewCard.tsx`
- `web/app/skills/[id]/SkillDetailClient.tsx`
- `web/app/author/[pubkey]/page.tsx`
- `web/lib/agentDiscovery.ts`
- `web/__tests__/lib/*`

Docs/runbooks:

- `.agents/plans/base-port-chain-adapter.plan.md`
- `docs/MAINNET_READINESS.md`
- `docs/DEVNET_STATE.md` or a Base-specific deployment state doc if created
- `web/public/skill.md` after product semantics change

## Verification

Contract:

```bash
forge test --root contracts/base-poc
```

Web:

```bash
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm test --workspace @agentvouch/web
npm exec --workspace @agentvouch/web next -- build --webpack
```

Live E2E evidence to capture:

- Base author register/list tx or userOp.
- Base buyer purchase tx/userOp.
- USDC balance deltas for author, voucher pool, buyer, and contract.
- ETH gas delta for user wallet.
- Raw download success with buyer.
- Raw download rejection with non-buyer.
- x402 authorization payload hash/ref.
- x402 settlement tx.
- Receipt and entitlement DB rows with chain-qualified buyer fields.
- Solana regression tx/raw-download proof if Solana remains selectable.

Security/mainnet gate evidence:

- Contract diff reviewed.
- Role/custody policy documented.
- External security pass complete or explicitly accepted by the human.
- Mainnet deploy runbook drafted.
- No `eip155:8453` default before this evidence exists.

## Rollout

- Phase 9 may need multiple PRs:
  - 9a: E2E smoke harness and evidence on Base Sepolia default.
  - 9b: v1 contract/trust-layer implementation.
  - 9c: security/runbook/mainnet-readiness closeout.
- Keep 8b blocked until all 9b/9c gates pass.
- Do not force-push or rewrite Phase 8 history; open new branches per implementation slice.

## Rollback

- E2E smoke failures do not require rollback unless Phase 8 default causes user-facing breakage; use
  Phase 8's env rollback to Solana if needed.
- If v1 contract changes fail review, leave the POC contract in Sepolia-only mode and do not deploy
  mainnet.
- If Base trust web surfaces regress Solana trust, revert the web trust PR and keep chain-qualified
  storage untouched.

## Blockers And Open Questions

- Do we want founder-resolved reports to slash only author bond at MVP, or also voucher stake? Current
  recommendation: author-bond penalty first; full voucher slashing later.
- Is the Base v1 contract a fresh non-upgradeable deploy or a proxy? Current recommendation: fresh
  non-upgradeable v1 unless ops requirements force upgradeability.
- What is the mainnet admin custody target: multisig, hardware-wallet EOA plus timelock, or another
  policy? This must be decided before 8b.
- Should Base trust snapshots be cached in `author_trust_snapshots` or served live with short TTL?
  Marketplace scalability probably needs snapshots, but live reads are acceptable for early Sepolia
  smoke.
