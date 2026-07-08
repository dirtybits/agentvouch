# AgentVouch Production Runbook

This runbook covers the deployed `agentvouch` web app and the USDC-native `v0.2.0` devnet protocol.
The near-term mainnet track is Base, but Base remains gated by the Phase 9/10 plans until the
v1 contract, custody, live smokes, and security review are complete.

## Production Shape

- Public app: `https://agentvouch.xyz`
- Vercel project: `agentvouch`
- Current Vercel root directory: `web/`
- Program ID: `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg`
- Cluster: Solana devnet
- Chain context: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`
- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

## Environment Matrix

Set preview and production deliberately. Do not assume local `.env.local`, Vercel preview, and Vercel production point at the same Neon branch or RPC.

| Variable                                  | Required    | Purpose                                                                                                                     |
| ----------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                            | yes         | Pooled Neon connection for runtime queries                                                                                  |
| `DATABASE_URL_UNPOOLED`                   | yes         | Direct Neon connection for migrations/bootstrap                                                                             |
| `SOLANA_RPC_URL`                          | yes         | Server-side Solana reads and verification                                                                                   |
| `NEXT_PUBLIC_SOLANA_RPC_URL`              | yes         | Browser wallet/RPC hooks until all reads are server-mediated                                                                |
| `SOLANA_CHAIN_CONTEXT`                    | yes         | Server-side CAIP-2 chain label                                                                                              |
| `NEXT_PUBLIC_SOLANA_CHAIN_CONTEXT`        | yes         | Browser-visible CAIP-2 chain label                                                                                          |
| `NEXT_PUBLIC_APP_URL`                     | recommended | Canonical public URL for generated links                                                                                    |
| `USDC_MINT_ADDRESS`                       | recommended | Explicit USDC mint override; defaults by configured chain                                                                   |
| `FACILITATOR_URL`                         | bridge-only | x402 facilitator base URL; defaults to `https://x402.org/facilitator`                                                       |
| `FACILITATOR_AUTH_HEADER`                 | bridge-only | Optional `Authorization` header value for facilitators that require it                                                      |
| `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED` | bridge-only | Enables protocol-listed x402 bridge purchases when set to `true`; keep unset/false unless the full bridge smoke is approved |

Keep `SOLANA_RPC_URL` and `NEXT_PUBLIC_SOLANA_RPC_URL` on the same cluster. A mismatch can make wallet flows look like protocol bugs.

Base Sepolia / Base mainnet variables are intentionally separate from the Solana runtime. For any
environment where Base writes are enabled, record these names and confirm server/client values agree:

| Variable                                       | Required             | Purpose                                                                                                             |
| ---------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT` | yes for Base default | `base-sepolia` for the testnet default; `solana` for rollback. `eip155:8453` is blocked until Phase 10.             |
| `BASE_SEPOLIA_RPC_URL`                         | Base Sepolia         | Server-side Base Sepolia reads and settlement verification                                                          |
| `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL`             | Base Sepolia         | Browser-visible Base Sepolia RPC                                                                                    |
| `NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS`          | Base Sepolia         | AgentVouchEvm contract address used by web reads/writes                                                             |
| `NEXT_PUBLIC_BASE_USDC_ADDRESS`                | Base Sepolia         | Base Sepolia native USDC address                                                                                    |
| `CDP_RPC_URL`                                  | sponsored writes     | Coinbase Developer Platform paymaster/bundler endpoint used by the base-poc harness and passkey smart-account flows |
| `BASE_X402_RELAYER_PRIVATE_KEY`                | Base x402            | Dedicated low-privilege settlement/relayer EOA; never use the deployer/admin key                                    |

Do not print secret values in PR comments or smoke logs. Record only variable names, chain context,
contract addresses, public wallet addresses, and transaction/userOp hashes.

## Deployment Checklist

1. Confirm the intended Neon branch/database for preview or production.
2. Confirm Solana env vars point at devnet and the active program/config.
3. Confirm `web/agentvouch.json` and `web/generated/agentvouch/` match `target/idl/agentvouch.json` after any Anchor change.
4. If the config account predates M13, run `npm run migrate:config -- --apply` with the config authority after deploy.
5. Run the web build locally:

```bash
npm run build --workspace @agentvouch/web
```

6. Deploy or promote through Vercel.
7. Smoke the deployed URL before announcing the cutover.

## Smoke Checks

Read-only checks:

```bash
curl -s https://agentvouch.xyz/api/skills | jq '.skills[:3]'
curl -s https://agentvouch.xyz/api/x402/supported | jq
curl -s https://agentvouch.xyz/skill.md | head
```

App checks:

- `/`
- `/skills`
- `/skills/{repo-skill-id}`
- `/author/{pubkey}`
- `/docs#paid-skill-download`

Protocol checks after program or client changes:

- Register an author.
- Deposit USDC author bond.
- Create USDC vouch.
- Publish a USDC listing.
- Purchase with `purchase_skill`.
- Confirm author proceeds land in the listing settlement vault.
- Withdraw author proceeds with `withdraw_author_proceeds`.
- Verify purchase entitlement.
- Download raw skill with `X-AgentVouch-Auth`.
- Claim voucher rewards.
- Open and resolve a small devnet dispute after explicit approval.
- For an upheld paid dispute, create a small refund pool and claim one buyer refund.

Use dry runs and simulations first. Live devnet write smoke remains approval-gated:

```bash
npm run smoke:devnet-usdc
```

Only after approval:

```bash
npm run smoke:devnet-usdc -- --apply
```

## Authorities

Record the authority pubkeys for each environment before production changes:

- upgrade authority
- config authority
- treasury authority
- x402 settlement authority
- pause authority

## Base V1 Candidate Operations

The Base contract surface under `contracts/base-poc` is now a **Base v1 candidate**, not a mainnet
release. It includes `PROTOCOL_VERSION = "base-v1-candidate"`, USDC purchase/x402 flows,
author bonds, vouch/revoke, and founder/admin-resolved author reports.

Use `docs/BASE_DEPLOY.md` for Base Sepolia v1-candidate deploys, env pointer updates, selector
verification, and the fresh-state report smoke. `docs/DEPLOY.md` is Solana-only.

Before any Base mainnet deployment:

1. Use a fresh non-upgradeable deployment unless a concrete operational need justifies a proxy.
2. Put every privileged role behind documented custody, preferably a multisig:
   `DEFAULT_ADMIN_ROLE`, `CONFIG_ROLE`, `RESOLVER_ROLE`, `TREASURY_ROLE`, `SETTLEMENT_ROLE`, and
   `PAUSE_ROLE`.
3. Keep the x402 relayer as a dedicated low-privilege funded EOA. It must not be the deployer,
   default admin, resolver, treasury, or pause key.
4. Record role holders, threshold/signers, emergency rotation, and revocation procedure in the
   deployment state doc before promotion.
5. Run `forge test --root contracts/base-poc` in CI and locally for every contract change.
6. Run internal review plus an external security pass over every USDC-moving path before Phase 10:
   `purchaseSkill`, `purchaseWithAuthorization`, `settleX402Purchase`, `depositAuthorBond`,
   `withdrawAuthorBond`, `vouch`, `revokeVouch`, `claimVoucherRevenue`, `withdrawAuthorProceeds`,
   `openReport`, and `resolveReport`.

Base Sepolia smoke evidence to capture before treating Phase 9 as closed:

- Base passkey author register/list userOp or tx hash.
- Base passkey buyer purchase userOp or tx hash.
- Buyer ETH delta showing sponsored gas policy worked as intended.
- Buyer, author, voucher pool, and contract USDC deltas.
- Receipt and entitlement rows with `buyer_chain_context` / `buyer_address`.
- Raw download success for the buyer and rejection for a non-buyer.
- Base EIP-3009/x402 authorization hash/ref, settlement tx, duplicate-settlement guard, and raw
  download proof.
- One Solana direct-purchase/raw-download regression while Solana remains selectable.

## Emergency Pause

The deployed devnet program includes `set_paused(paused: bool)`, gated by `config.pause_authority`. Treat it as a narrow emergency brake: it stops new protocol exposure while leaving buyer and voucher claim paths open where funds are already allocated.

Use pause for suspected protocol bugs, compromised authorities, bad IDL/client deploys, x402 settlement issues, accounting incidents, or any live flow where continued purchases/vouches/listings could widen the blast radius.

Blocked while paused:

- create or update a skill listing
- initialize a listing settlement
- deposit or withdraw author bond
- create a vouch or link a vouch to a listing
- direct `purchase_skill`
- protocol `settle_x402_purchase`
- open a new author dispute
- withdraw author proceeds

Allowed while paused, subject to normal account/status checks:

- unpause through `set_paused(false)`
- register an agent profile
- revoke a vouch
- claim voucher revenue
- claim a purchase refund from an existing refund pool
- resolve/settle already-open dispute cleanup paths
- unlink/remove/close listing paths that retire exposure

Pause procedure:

1. Verify the decoded `ReputationConfig` and current `pause_authority`.
2. Use the configured pause authority to submit `set_paused(true)`.
3. Confirm `config.paused == true`.
4. Smoke one blocked path, such as purchase or vouch creation, and one allowed claim path, such as voucher revenue claim or purchase refund.
5. Record the transaction signature, reason, owner, and user-communication threshold.
6. Unpause only after root cause is understood, client/IDL surfaces match the deployed program, and a normal flow smoke passes.

When pause behavior changes, update `docs/DEVNET_STATE.md`, `web/public/skill.md`, and public docs only after the active program, synced IDL/client, and smoke results all agree.

## x402 Bridge Operations

The protocol-listed x402 bridge path is feature-flagged by `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED`. Keep it disabled unless the release owner explicitly approves a bridge smoke that covers wallet auth, x402 requirement generation, facilitator verify/settle, vault credit verification, `settle_x402_purchase`, entitlement recording, and raw download.

Before enabling the bridge in preview or production:

1. Confirm `FACILITATOR_URL`, optional `FACILITATOR_AUTH_HEADER`, `USDC_MINT_ADDRESS`, Solana RPC, chain context, and the active `ReputationConfig.x402_settlement_vault` all point at the same environment.
2. Confirm the facilitator advertises the configured Solana exact network and fee payer through `/supported`.
3. Confirm the settlement destination is the stock-compatible x402 settlement vault ATA recorded in `docs/DEVNET_STATE.md`.
4. Run the bridge POC/smoke in preview, then repeat against the promoted deployment before announcing support.
5. Reconcile x402 facilitator signatures, `X402SettlementReceipt` PDAs, `Purchase` PDAs, and `usdc_purchase_entitlements` rows for the smoke purchase.

Rollback: unset `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED` or set it to `false`, redeploy/promote, and confirm protocol-listed paid skills fall back to `payment_flow: direct-purchase-skill`.

## Settlement And Refund Incidents

- Stuck author withdrawal: confirm the listing settlement is not `locked_by_dispute`, the author proceeds vault holds USDC, and `author_proceeds_lock_seconds` has elapsed.
- Missing purchase entitlement: verify the revision-scoped `Purchase` PDA, `listing_revision`, `settlement_pda`, and `author_proceeds_vault` recorded in `usdc_purchase_entitlements`.
- Refund claim failure: confirm the purchase belongs to the refund pool revision, the refund claim PDA does not already exist, the claim window is still valid, and the refund vault has remaining USDC.
- Unclaimed refund funds are not treasury revenue in M13. Do not sweep them without an explicit governance/runbook update.

For the current devnet deployment, verify authority state with `solana program show` and the decoded `ReputationConfig` before assuming a local keypair is authorized.

## Rollback

Database rollback:

- Follow `docs/DATABASE_CUTOVER.md`.
- Restore Vercel `DATABASE_URL` and `DATABASE_URL_UNPOOLED` together.

Web rollback:

- Promote the last known-good Vercel deployment or revert the app commit and redeploy.
- Confirm public docs, `skill.md`, and API metadata still match the active program/config.

Program rollback:

- Follow `docs/program-upgrades-and-redploys.md`.
- Treat program rollback and web rollback as one coordinated action when IDL/client behavior changed.

## References

- `docs/DEPLOY.md`
- `docs/BASE_DEPLOY.md`
- `docs/DATABASE_CUTOVER.md`
- `docs/program-upgrades-and-redploys.md`
- `docs/MAINNET_READINESS.md`
