# AgentVouch Mainnet Readiness

`v0.2.0` is a USDC-native devnet release. It is not mainnet-ready until the items below are complete and reviewed.

## Current Assessment

AgentVouch is close to a mainnet release candidate, but should not be treated as mainnet-ready yet.

The core product shape is in place: the USDC-native protocol, marketplace publishing and purchase flows, author trust surfaces, voucher backing, dashboard revenue visibility, and agent-facing install path now fit together. The remaining work is mainly release hardening, not product discovery.

The next milestone should be framed as **Mainnet Release Candidate**, not final mainnet launch. The release candidate is ready only when the protocol, wallet UX, production config, docs, and operating runbooks can survive repeated end-to-end devnet smoke tests without manual interpretation.

## Release Candidate Gates

- Protocol safety review covers purchase, vouch, voucher reward, author bond, dispute, refund, close, claim, and withdraw paths.
- Devnet soak has repeated the full happy path with fresh wallets: register, publish, vouch, purchase, claim voucher revenue, withdraw author proceeds, report, resolve, and refund.
- Wallet UX is clear for locked wallets, simulation warnings, insufficient SOL, ATA creation, network mismatch, and rejected signatures.
- Mainnet configuration is frozen: program ID, USDC mint, economic floors, config authority, treasury authority, resolver authority, Vercel env, and Neon branch.
- Public docs match shipped behavior: `web/public/skill.md`, `/docs`, CLI help, paid download instructions, and publish/update flows.
- Production operations are documented: monitoring, authority handling, rollback, incident response, and user support for paid access failures.

## Required Decisions

- Final mainnet values for `author_proceeds_lock_seconds`, `refund_claim_window_seconds`, `challenger_reward_bps`, and `challenger_reward_cap_usdc_micros`.
- Whether upgrade authority remains active, moves behind a timelock, or is frozen after hardening.
- Which multisig or governance mechanism controls upgrade, config, treasury, and settlement authorities.
- Which monitoring and incident channels are authoritative.

## Authority Policy

Mainnet must not depend on a single hot wallet for:

- program upgrades
- config changes
- treasury movement
- x402 settlement authority
- dispute resolver authority
- pause or emergency controls, when implemented

Before mainnet:

1. Put critical authorities behind multisig or stronger governance.
2. Document signer set, threshold, rotation procedure, and emergency removal procedure.
3. Record authority pubkeys in the production runbook.
4. Test authority rotation on devnet.

## Treasury Policy

Document:

- treasury vault addresses
- withdrawal authority
- approval threshold
- accounting cadence
- public reporting expectations
- reserve and sweep rules for unclaimed refund funds

Treasury movement should be explainable from on-chain events and operator notes.

## Monitoring

Monitor at least:

- program upgrade authority changes
- config authority changes
- `ReputationConfig` changes
- protocol treasury vault balance
- x402 settlement vault balance
- listing reward vault balances
- purchase, vouch, author bond, dispute, and claim events
- indexing lag between Solana and API responses
- failed purchase verification or raw download authorization
- unexpected treasury or settlement movement

## Incident Response

Have playbooks for:

- bad config
- stuck settlement vault funds
- compromised authority
- failed indexer or stale API data
- erroneous dispute resolution
- bad IDL/client deploy
- Neon branch mismatch
- Solana RPC outage or cluster mismatch

Each playbook should include:

- detection signal
- severity
- owner
- immediate stop action
- rollback path
- public/user communication threshold
- postmortem requirements

## Security Review

Before mainnet, complete an external or senior internal review of:

- every USDC-moving instruction
- token account owner and mint constraints
- PDA vault ownership and authority seeds
- arithmetic overflow and underflow behavior
- active-dispute freezes and slashing paths
- voucher reward math
- x402 settlement memo binding and payment-ref uniqueness
- authority rotation and rollback paths

Review at least these user-facing protocol flows end to end:

- buyer pays for a listed skill and receives raw access
- author withdraws escrowed proceeds
- voucher claims author-wide reward revenue
- free-skill report uses author bond exposure
- paid-skill report uses author bond first, then linked vouchers where applicable
- upheld report creates a purchaser refund pool
- purchaser claims a refund during the claim window
- stale or closed listing behavior does not strand funds without a documented path

## Launch Checklist

- `NO_DNA=1 anchor build` passes.
- Full Anchor test suite passes.
- Web and CLI tests pass.
- `npm run build --workspace @agentvouch/web` passes.
- IDL and generated clients are synced.
- `web/public/skill.md`, docs, CLI, Vercel env, and public app all reference the same program/config.
- Production runbook has current authority pubkeys, env matrix, smoke checks, and rollback steps.
- SEO and LLM-facing docs are handled in Milestone 14; pitch deck alignment is handled in Milestone 15 after settlement behavior is reflected.

## Mainnet Go / No-Go

Mainnet launch should wait until every release candidate gate is green and the remaining risks are written down with explicit owners.

Go:

- full devnet smoke passes twice from clean state
- no unresolved high-severity protocol findings
- no known paid-access failure without a support path
- production env and authority pubkeys are verified by two people
- docs and agent-facing instructions match the deployed program

No-go:

- any USDC-moving instruction has unreviewed account constraints or arithmetic
- wallet simulation warnings are unexplained on expected flows
- Vercel, Neon, RPC, or program config points at mixed devnet/mainnet state
- paid download access depends on unsigned or pubkey-only proof
- authority custody is still a single hot wallet
