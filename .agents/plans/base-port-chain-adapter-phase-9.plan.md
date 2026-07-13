---
name: base-port-chain-adapter-phase-9
overview: "Prove the Base Sepolia default end-to-end, then scope and build the minimal EVM trust layer and security gates required before any Base mainnet cutover."
todos:
  - id: preflight-base-e2e-env
    content: "COMPLETED 2026-07-06 (ops/base-port-phase-9-followup): Vercel preview/production env pull verified the configured DB, Base Sepolia RPC, CDP paymaster/bundler, public Phantom/Solana, and Solana sponsor variables by name only. Live Base write/x402 smokes remain blocked until a dedicated Base x402 relayer key (`BASE_X402_RELAYER_PRIVATE_KEY` or equivalent) and funded author/buyer/agent keys are available locally; no secret values were printed."
    status: completed
  - id: smoke-human-base-flow
    content: "COMPLETED 2026-07-07: Base human flow is proven against live Base Sepolia fixtures. Existing Base passkey buyer smoke passed for downloadable listing `efa82c9d-fcc1-47d6-8145-780bd9388783` (`base-smoke-test-v2`) with buyer `0x3fc722ba956f17b521087984F2c5c0BA47Df3c6B`, signed raw download, chain-qualified receipt/entitlement, and unsigned raw `402 Payment Required`. Follow-up MetaMask smoke used independent buyer `0xc00fca0034d6de438e991be7afce40a799fb533b`: Phase 3b seeded listing purchase tx `0xa12daf94b6c53c89475219f0042d8a5091b94354fe555d9a075a2194a447cdfa` proved Base receipt/entitlement but raw failed because that fixture has no `skill_versions`; downloadable `base-smoke-test-v2` purchase tx `0x9e6105cf39b92c09e6109deb78b492be2c46906de4d976c088d592c99ce50f3e` proved full purchase -> verify -> signed `GET /raw 200` -> `SKILL.md` download. DB rows are `buyer_chain_context=eip155:84532`, `amount_micros=1000000`, `payment_flow=direct-purchase-skill`, `protocol_version=base-poc-v0`; unsigned raw still returns Base x402 `402`. Fresh author register/list was not rerun; this item closes on the existing linked live fixtures plus independent buyer proof."
    status: completed
  - id: smoke-agent-x402-flow
    content: "COMPLETED 2026-07-07: `/api/x402/supported` and unauthenticated raw access for `efa82c9d-fcc1-47d6-8145-780bd9388783` advertise `eip155:84532`, payment flow `base-x402-purchase-skill`, Base Sepolia native USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, listing id `0x9987077f66345ab282f7698aa90b486787fe3043f880d9f18556bca5ec2fd89e`, contract `0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854`, EIP-3009 `receiveWithAuthorization`, revision `1`, and amount `1000000`. Live settlement used plain EOA agent `0xAf1c1553009E269Ed6860220bCa0D588016cd2DB` and dedicated relayer `0x10ED5FBf22359edfd52Ad066f76CF2fD8181d0d8` through `/api/x402/settle`. Settlement tx `0xfba67b3793f7c518694ae9d793264aaf7a3db84468538b7255b77e50b1078b1c` succeeded in block `43847771`; x402 payment ref `452776e254ab20a752ca126757d84308b3f24ad69983208acf0d7b139f980615`; EVM purchase id `0xcf7cbe3e55c964334cb3f010368423852c6f75733314a9d3eeba5b753b05687f`. Duplicate `/api/x402/settle` retry returned `200` with `existing: true`. DB receipt `ae965090-6d59-44e8-a7e0-50339053f746` and entitlement are chain-qualified (`buyer_chain_context=eip155:84532`, `amount_micros=1000000`, `payment_flow=base-x402-purchase-skill`, `protocol_version=base-poc-v0`). Balance deltas around the settlement block: agent USDC `5 -> 4`, agent ETH `0 -> 0`, relayer ETH `0.007 -> 0.006998384970588198`. Unsigned raw still returns Base x402 `402`; signed `X-AgentVouch-Auth` raw download for the x402 buyer returned `200` with `SKILL.md`."
    status: completed
  - id: smoke-solana-regression
    content: "COMPLETED 2026-07-07: Solana direct purchase/raw-download regression passed with non-author buyer `dmt4CBeNrF6iMV793zfJGiAAqVK9C9bifdL9cvqNTou` buying `Kora Paid Test Alpha` (`81977f9c-c6e4-40fc-bf8e-5b7f77468487`) from author `asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw`. On-chain listing `Ba7E2UuEVRWXdX2y8nrRjYiAHRH1s3yehwBZfj4bUVtJ`, revision `0`, price `1000000`; purchase tx `4wnwUwaUtAaDdJnLiHQjhTKo78APp5oE6kV16HcbvpNPsUDdWwuEvWPpTK5mci47BJ5JG44BXJEMP3DsKAmeHZJc` confirmed at slot `474702171`, purchase PDA `2Zyg6X3GJTfHrMTpGFNxyaYCy8LnxK98Bd4UbF2CK8H9`. Buyer USDC moved `56030000 -> 55030000`; author proceeds vault `600000 -> 1200000`; author reward vault `1700000 -> 2100000`. `/api/skills/{id}/purchase/verify` returned `200`; DB receipt `14bf89c5-d014-463b-be21-37823d5205cf` and entitlement are recorded with `payment_flow=direct-purchase-skill`, `chain_context=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, `protocol_version=v0.2.0`, `listing_revision=0`, settlement PDA `5LR4YmGSKKUsndwwZNzHKhQzecyBwQkdKaUShEtasKtk`. Unsigned raw stayed `402`; signed `X-AgentVouch-Auth` raw download returned `200` and `SKILL.md`. Sponsored/Kora checkout remains a separate follow-up unless Solana is re-promoted."
    status: completed
  - id: scope-base-v1-trust-layer
    content: "COMPLETED 2026-07-06 via PR #78: the MVP Base trust primitive was scoped and implemented as author reports/disputes — PROTOCOL_VERSION=base-v1-candidate, openReport/resolveReport under RESOLVER_ROLE, reporter USDC bond, forfeitReporterBond dismissal anti-griefing lever, upheld slash bounded to min(authorBond, reportBond), vouch/revoke + author bond preserved from the POC, and live Base trust reads for marketplace rows. Remaining ownership/custody, bounty-routing, snapshot-vs-live scale, UI, deploy/runbook, and audit work is tracked under implement-and-audit-base-v1 plus Phase 10 gates."
    status: completed
  - id: implement-and-audit-base-v1
    content: "IN PROGRESS 2026-07-08: implementation portion completed for the first 9b slice — reports primitive + live Base trust on /skills implemented and gated; Bugbot follow-ups fixed EVM identity retention, revision-scanned Base purchase repair, walletless EVM publish rejection, chain-context purchase verification, and signed Base listing PATCH. Follow-up branch synced Deploy.s.sol + ui/src/abi.ts, documented Base v1 candidate ops/security gates, added docs/BASE_DEPLOY.md, confirmed forge CI already exists, fixed Base detail API/page live trust, fixed Base paid-detail copy, and added the reviewed ChainWallet trust-write seam plus Base author-page vouch/report routing. Base Sepolia v1 deploy/env pointer/vouch/report smoke passed on the new contract. STILL OPEN before Phase 9 can close: remaining live Base trust-write smoke for self-stake/proceeds actions, ownership/custody sign-off, internal review, and external security review."
    status: in_progress
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
   Phase 10 Base mainnet cutover.

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

- Base mainnet default flip. That is still Phase 10 and remains blocked until this plan's v1/security
  gates pass.
- Full Solana-equivalent voucher slashing machinery unless explicitly re-approved. MVP bias is
  founder-resolved disputes/reports first.
- Removing Solana.
- Multi-EVM support beyond Base Sepolia/mainnet planning.

## Progress Notes

- 2026-07-06 (a2a-loop autonomous run, PR #78, branch `a2a/20260706-211053-898015`): shipped the
  first 9b slice — Base v1 author reports in `AgentVouchEvm.sol` (`base-v1-candidate` version
  constant, `openReport`/`resolveReport` + `getAuthorReport`, `ReportStatus`/`AuthorReport` types,
  9-test Reports forge suite) and live chain-split Base trust on `/skills`
  (`resolveLiveSkillTrust` resolves EVM authors via `resolveBaseAuthorTrust`; Base authors no
  longer render trust-null; no Solana trust attaches to EVM authors). The loop's own review-1
  caught a real mechanism gap — dismissed reports refunded the reporter's bond unconditionally,
  making author-bond/voucher-exit lock griefing free — fixed in round 2 with the resolver's
  `forfeitReporterBond` dismissal lever plus a balance-delta forge test. The run's sandbox was
  read-only for `.agents/`, so this ledger update lands from a write-capable session (verified
  against the diff, the a2a run.log, and an independent re-run of forge 75/75 + web 566/566).
- Follow-ups carried from the a2a reviews: wire `forge test --root contracts/base-poc` into CI
  before 9c closeout; decide reporter-bounty vs treasury routing for upheld slashes before
  mainnet; close the snapshot-vs-live Base trust question before Phase 10 traffic (live per-author
  RPC reads on `/skills` are plan-sanctioned for Sepolia only); Part A live smokes untouched.
- 2026-07-06 post-merge review of PR #78 (`a6e7727`): the plan ledger should treat the Base trust
  layer scoping item as complete. PR #78 did complete the MVP author-report shape, contract events,
  Base trust read path, and security hardening fixes for the slice. It did not complete Phase 9 as a
  whole: live Base E2E smokes, x402 evidence, Solana regression, report/vouch UI, deploy-script/ABI
  sync, forge CI, ownership/custody policy, runbook updates, and external security review remain
  open gates.
- 2026-07-06 follow-up branch `ops/base-port-phase-9-followup`: closed the static/ops gaps that did
  not need live secrets — `Deploy.s.sol` now initializes the Base v1 candidate config explicitly,
  the sample UI ABI mirrors the report/vouch/revenue/read methods, the production runbook records
  Base env/custody/security/smoke evidence requirements, and CI already contains
  `forge test -vv` for `contracts/base-poc`. Local read-only smoke evidence: `/api/skills/{id}` and
  the rendered Base skill page now resolve live Base trust + identity (`eip155:84532`) instead of
  null/Solana fallback, the Base raw endpoint returns a Base EIP-3009/x402 402 requirement, and the
  Solana raw endpoint still fails closed with a direct-purchase 402 requirement. Live writes remain
  blocked until the human wallet/funded-key/relayer setup is available, and external security review
  remains a required non-Codex gate. Verification on this branch: `npm run format:check`,
  `npm run lint --workspace @agentvouch/web`, `npm run typecheck --workspace @agentvouch/web`,
  web tests (90 files / 571 tests), Base contract tests (75/75), Base POC UI/harness typecheck, and
  `npm exec --workspace @agentvouch/web next -- build --webpack`.
- 2026-07-07 live-smoke follow-up on PR #79: refreshed stale local dependencies with root
  `npm ci` (no tracked file changes), started local web on `localhost:3001`, restored Chrome's
  Base passkey buyer wallet, and completed a signed raw download for the existing Base smoke skill
  `efa82c9d-fcc1-47d6-8145-780bd9388783`. DB evidence confirms the Base row, direct-purchase
  receipt, and entitlement are chain-qualified; Base Sepolia log recovery found purchase tx
  `0x1f6a3de5212bb0abfd3fc47fa7107380315a2930db9142a6e96cdfb68415a8fc`, purchase id
  `0x32a68a8fbbdf2afab9b2cc664cf076e36f1e65090e46893ca491b85f9bcb0df8`, price/author share
  `1000000`, voucher pool `0`, and buyer ETH delta `0` wei across block `43677980`. The unsigned raw
  endpoint still fails closed with Base x402 `402 Payment Required`. Agent x402 settlement remains
  blocked because no dedicated Base x402 relayer key is present in local env and the `awal` agent
  wallet is not authenticated.
- 2026-07-07 MetaMask live-smoke follow-up after PR #83 merge: merged `origin/main` into
  `ops/base-port-phase-9-followup`, discovered Chrome exposed Core Wallet's MetaMask-compatible
  provider before real MetaMask, and fixed provider selection to skip Core's `coreProvider` /
  `addProvider` shim. Targeted regression `web/__tests__/lib/baseInjectedWallet.test.ts` passed.
  MetaMask connected/restored on Base Sepolia as independent buyer
  `0xc00fca0034d6de438e991be7afce40a799fb533b`. RPC preflight at block `43845240`: ETH
  `0.016998280584441705`, USDC `149`. Purchase 1, Phase 3b fixture
  `cf0b7fa7-f111-4cca-8a0e-d45b127743bd`, tx
  `0xa12daf94b6c53c89475219f0042d8a5091b94354fe555d9a075a2194a447cdfa`, block `43845274`,
  receipt `5fd2b409-f908-4440-b7cf-729b3931593e`, entitlement buyer chain `eip155:84532`, amount
  `1000000`, purchase id `0x94ee3ca99f46ddf61861298ba054b1c492d8879a415eec2069b050aa37cc5063`;
  raw failed with `404` because the fixture has no `skill_versions` rows. Purchase 2, downloadable
  `base-smoke-test-v2` (`efa82c9d-fcc1-47d6-8145-780bd9388783`), tx
  `0x9e6105cf39b92c09e6109deb78b492be2c46906de4d976c088d592c99ce50f3e`, block `43845448`,
  receipt `38bd7f93-98b0-4389-8c29-0e3617faad98`, purchase id
  `0xe8f03b2723846b33a883c40ab591ef6ea3a936911e35442b1882c84d3d258e30`; browser reported
  `Base USDC purchase confirmed and verified. Downloaded SKILL.md.`, server logged signed
  `GET /api/skills/efa82c9d-fcc1-47d6-8145-780bd9388783/raw 200`, unsigned raw returned Base x402
  `402 Payment Required`, and `skill_download_events` recorded `event_kind=raw`,
  `auth_present=true`, `requested_path=SKILL.md`, wallet `0xc00f...533b`. Final RPC balance at
  block `43845496`: ETH unchanged at `0.016998280584441705`, USDC `147`. Observed purchase tx
  senders differed from buyer while contract events/DB buyer matched, so record this as MetaMask's
  delegated/smart-transaction execution shape rather than plain `tx.from === buyer` EOA evidence.
- 2026-07-07 `smoke-agent-x402-flow` preflight: rechecked local envs by name only. `web/.env.local`
  has Base Sepolia RPC and CDP paymaster/bundler RPC, but no dedicated
  `BASE_X402_RELAYER_PRIVATE_KEY` / `AGENTVOUCH_BASE_RELAYER_PRIVATE_KEY` and no funded
  `AGENT_PK`. `contracts/base-poc/harness/.env` has deployer/test-author env and contract address,
  but no agent key, CDP harness top-up env, or dedicated relayer. Coinbase's hosted x402
  facilitator and the x402.org test facilitator are standard `exact` payment facilitators, not a
  drop-in for the current AgentVouch route: stock settlement pays `payTo`, while AgentVouch must
  relay `purchaseWithAuthorization` to preserve the contract purchase event, DB receipt,
  entitlement, revision binding, and author/voucher economics. Keep this smoke open until a
  low-privilege relayer key and funded agent EOA are available, or until a separately-reviewed
  protocol change intentionally moves Base agent purchases to standard facilitator transfers plus
  an AgentVouch-specific entitlement/indexing design.
- 2026-07-07 `smoke-agent-x402-flow` live settlement closeout: generated/funded the required
  two-EOA shape locally (`AGENT_PK` agent buyer and `BASE_X402_RELAYER_PRIVATE_KEY` relayer),
  then drove the actual web route on `localhost:3000`. Preflight at Base Sepolia block `43847767`:
  skill `efa82c9d-fcc1-47d6-8145-780bd9388783`, listing
  `0x9987077f66345ab282f7698aa90b486787fe3043f880d9f18556bca5ec2fd89e`, revision `1`, amount
  `1000000`, nonce `0xc8a8e6acc8eda1601d4219ca7ac3134688d62dcec37453d0e24ebb4df7333726`.
  `/api/x402/settle` returned `200 complete` with settlement tx
  `0xfba67b3793f7c518694ae9d793264aaf7a3db84468538b7255b77e50b1078b1c`, payment ref
  `452776e254ab20a752ca126757d84308b3f24ad69983208acf0d7b139f980615`, payer
  `0xAf1c1553009E269Ed6860220bCa0D588016cd2DB`, and EVM purchase id
  `0xcf7cbe3e55c964334cb3f010368423852c6f75733314a9d3eeba5b753b05687f`. Duplicate retry with
  the same payload returned `200` / `existing: true`. On-chain receipt in block `43847771` was
  successful (`gasUsed=267425`); agent USDC delta `5 -> 4`, agent ETH delta `0 -> 0`, relayer ETH
  delta `0.007 -> 0.006998384970588198`. Neon receipt
  `ae965090-6d59-44e8-a7e0-50339053f746` and entitlement row are chain-qualified
  (`buyer_chain_context=eip155:84532`, lowercase buyer address, `payment_flow=base-x402-purchase-skill`,
  `protocol_version=base-poc-v0`, `listing_revision=1`). Unsigned raw access still returns Base
  x402 `402 Payment required`; signed `X-AgentVouch-Auth` for the x402 buyer returns `200`,
  `Content-Disposition: attachment; filename="SKILL.md"`, first bytes `# base smoke test v2`.
- 2026-07-07 `smoke-solana-regression` closeout: ran the dormant Solana path through an actual
  devnet direct purchase plus API verification/raw download. Buyer `dmt4CBeNrF6iMV793zfJGiAAqVK9C9bifdL9cvqNTou`
  (not the author) purchased `Kora Paid Test Alpha` (`81977f9c-c6e4-40fc-bf8e-5b7f77468487`) from
  author `asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw`. Listing
  `Ba7E2UuEVRWXdX2y8nrRjYiAHRH1s3yehwBZfj4bUVtJ`, revision `0`, price `1000000`; purchase tx
  `4wnwUwaUtAaDdJnLiHQjhTKo78APp5oE6kV16HcbvpNPsUDdWwuEvWPpTK5mci47BJ5JG44BXJEMP3DsKAmeHZJc`
  confirmed at slot `474702171`, purchase PDA `2Zyg6X3GJTfHrMTpGFNxyaYCy8LnxK98Bd4UbF2CK8H9`.
  Balance/vault deltas: buyer USDC `56030000 -> 55030000`, author proceeds vault
  `600000 -> 1200000`, author reward vault `1700000 -> 2100000` (60/40 split path still alive).
  The first API retry used a mistyped UUID (`...40ce...`) and correctly returned `404`; rerun with
  the actual DB id (`...40fc...`) returned `/api/skills/{id}/purchase/verify` `200`, recorded receipt
  `14bf89c5-d014-463b-be21-37823d5205cf`, and wrote the matching entitlement
  (`payment_flow=direct-purchase-skill`, `chain_context=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`,
  `protocol_version=v0.2.0`, `listing_revision=0`, settlement PDA
  `5LR4YmGSKKUsndwwZNzHKhQzecyBwQkdKaUShEtasKtk`). Unsigned raw stayed `402` direct-purchase
  required; signed `X-AgentVouch-Auth` returned `200` with `Content-Disposition:
  attachment; filename="SKILL.md"` and first bytes `# Kora Paid Test Skill Alpha`. Sponsored/Kora
  checkout was not exercised and remains separate unless Solana is re-promoted.
- 2026-07-07 `implement-and-audit-base-v1` web trust-write seam slice: extended
  `web/lib/adapters/types.ts` with Phase 9 trust-write methods (`depositAuthorBond`,
  `withdrawAuthorBond`, `vouchForAuthor`, `revokeVouch`, `openAuthorReport`,
  `claimVoucherRevenue`, `withdrawAuthorProceeds`), implemented the Coinbase Smart Wallet/Base
  passkey path in `web/lib/adapters/baseWallet.ts` with exact USDC approvals plus receipt/event
  validation, and kept MetaMask/Solana ChainWallet implementations explicit about unsupported
  author/trust writes for this slice. The author page now detects EVM author routes, fetches
  Base trust through `/api/author/{address}?chainContext=eip155:84532`, and routes Base vouch and
  report actions through `useWritableChainWallet()` instead of the Solana reputation hook; Solana
  author-page vouch/report paths remain unchanged. Verification: `npm run format:check`,
  `npm run lint --workspace @agentvouch/web`, `npm run typecheck --workspace @agentvouch/web`,
  targeted vitest for Base wallet/injected wallet/author page/phase-2 seam (4 files / 40 tests),
  full web vitest (91 files / 588 tests), and
  `npm exec --workspace @agentvouch/web next -- build --webpack`. The webpack build passed with
  the pre-existing viem/tempo dynamic-import warning and sandbox DNS fallbacks for Neon/Helius
  during static generation; no contract files changed, so `forge test --root contracts/base-poc`
  was not rerun in this slice. Live Base trust-write smoke and the non-Codex custody/security
  reviews remain open.
- 2026-07-07 live Base report retry: the target author `0x4124d5105aAFf0DaDADf1709eB999857166DC30C`
  is registered on the configured Base contract and has one live vouch/backing stake; the reporter
  passkey wallet `0x3B63a88B203183802f4c815e870b5D1fFa73C779` is registered, funded, and has exact
  `5` USDC allowance for the report bond. `getConfig()`, `getProfile()`, and the USDC
  `transferFrom(reporter, contract, 5000000)` simulation all succeed, but `openReport(address,string)`
  reverts immediately in a Foundry fork trace and the deployed bytecode at
  `0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854` does not contain selector `0x92e928f4`; `getAuthorReport`
  also reverts. Conclusion: the local Phase 9 source/ABI is ahead of the configured deployed Base
  Sepolia contract. The web wallet adapter now preflights deployed bytecode before author-report
  approval/call and fails closed with a clear "Base author reports are not deployed..." message.
  Browser verification on `localhost:3000` confirmed the clear deployment-gate message appears and
  no wallet approval is attempted. Base report live smoke remains open until a report-enabled Base
  v1 candidate is deployed and `NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS` points at it.
- 2026-07-08 Base v1 deploy prep: added `docs/BASE_DEPLOY.md` as the Base Sepolia counterpart to
  the Solana `docs/DEPLOY.md` runbook and linked it from `docs/PRODUCTION_RUNBOOK.md`. The runbook
  records the old configured contract's missing `openReport(address,string)` selector, the exact
  preflight/build/dry-run/broadcast/post-deploy/env-pointer/report-smoke commands, the fresh-state
  actor setup caveat, and paymaster allowlist failure mode. Local verification: `forge test --root
  contracts/base-poc -vv` passed 75/75; deploy dry-run against Base Sepolia simulated a fresh
  `AgentVouchEvm` address `0x5992dD52Ee2015f558D0A690777C55e27b05B7d1`, USDC
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, admin `0x191370b682924527c1A5fD6B484A4BC37460CA30`,
  `config initialized: true`, chain `84532`, and estimated required ETH `0.000067132626`.
  Codex did not broadcast the deploy transaction; the next gate is the human-run `--broadcast`,
  local `NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS` pointer update, paymaster allowlist check, and report
  smoke against the new contract.
- 2026-07-08 Base v1 deploy/env/vouch smoke: the human broadcast the Base Sepolia v1-candidate
  deploy. On-chain deployment succeeded at `0x5992dD52Ee2015f558D0A690777C55e27b05B7d1`; deploy tx
  `0xe4aa637c07b31e0e08f9db72d9a517b2b06c99195aa7d857541c7754f83a1b2a`, config tx
  `0x44e81e90adafa49f3d53650707a901f5728c7c314a881de1db1c9c618875ad60`, deploy/config blocks
  `43853948`/`43853949`. Read-only verification returned `PROTOCOL_VERSION="base-v1-candidate"`,
  `configInitialized=true`, `paused=false`, chain context `eip155:84532`, native Base Sepolia USDC,
  and deployed bytecode containing `openReport(address,string)` selector `0x92e928f4`. Local
  `web/.env.local` now points `NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS` at the v1 contract and
  `NEXT_PUBLIC_BASE_AGENTVOUCH_FROM_BLOCK=43853948`. Vercel envs were updated for Development and
  non-branch Preview only; Production was intentionally left on the previous implicit/default
  contract until the report smoke and fresh-vs-existing Base listing strategy are signed off. The
  first fresh-contract vouch attempt exposed a real Base passkey trust-write bug: the wallet called
  `vouch` before the fresh contract had a profile for the reporter, causing `NotRegistered()`. The
  Base passkey trust-write seam now calls `ensureBaseAgentRegistered` before author bond deposits,
  vouches, and author reports; targeted `__tests__/lib/baseWallet.test.ts` passed 13/13. Browser
  retry on `localhost:3000` with funded passkey reporter `0x3B63a88B203183802f4c815e870b5D1fFa73C779`
  succeeded: reporter registration tx `0x55f589fc30c7f53727160e429f58582f67f0d361e9ce3e920eea9da4b2eee1bc`
  at block `43854477`; vouch tx
  `0xc2d3ae156975d1ba400e0520f168ceba07ab88292027d582de9de9e4b0252a27` at block `43854480`, staking
  `1000000` USDC micros for target author `0x191370b682924527c1A5fD6B484A4BC37460CA30`. Readback:
  reporter profile registered with one vouch given; target author profile shows one vouch received
  and `1000000` backing. Still open at this point: report smoke against the v1 contract and the
  non-Codex ownership/security reviews.
- 2026-07-08 Base v1 report smoke closeout: local web was restarted on `localhost:3000` with
  `NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS=0x5992dD52Ee2015f558D0A690777C55e27b05B7d1`. Browser
  restored the funded Coinbase/passkey reporter `0x3B63a88B203183802f4c815e870b5D1fFa73C779`,
  rendered the target author `0x191370b682924527c1A5fD6B484A4BC37460CA30` with `1` vouch and
  `1 USDC` aggregate backing from the fresh v1 contract, and opened report `#1` with evidence URI
  `https://example.com/agentvouch-base-v1-report-smoke-20260708`. UI showed "Report #1 opened. The
  reporter bond is held until founder/admin resolution." On-chain event tx
  `0x790dec5edbf8934aa4e497d4191bc96750c46b1dbd0947d58047adf5ca0cd141` landed in block
  `43857874`. `getAuthorReport(1)` returns the expected reporter, author, evidence URI, status
  open, and `5000000` USDC micros report bond. Target author profile now shows one open report;
  reporter balance is `26000000` USDC micros and the contract holds `6000000` USDC micros
  (`1 USDC` vouch stake + `5 USDC` report bond). The public RPC refused a wider log query over
  2,000 blocks, so event lookup used a bounded latest-minus-1500 block range as documented in the
  Base deploy runbook.
- 2026-07-12 Base Sepolia backed x402 split smoke: the v1 candidate at
  `0x5992dD52Ee2015f558D0A690777C55e27b05B7d1` reported `6000` author-share bps, `4000`
  voucher-share bps, and zero protocol-fee bps. A fresh unlinked 1-USDC listing was created by
  the already-backed author, then the zero-ETH agent EOA signed a Lane-B EIP-3009
  `receiveWithAuthorization`; the dedicated relayer submitted
  `purchaseWithAuthorization`. Settlement tx
  `0x8d68f1db7ae596311487e493bca317fc9c4fbee1ea718f0a49be6eb7d5283bfa` in Base Sepolia block
  `44072208` transferred exactly `1_000_000` USDC micros from the agent and recorded purchase
  `0x0e6ad7f0de85878f7101ec9472d11ff3303393b16766739174bebed942fd1fc8` for listing
  `0x4949b04c41373363c3a3717584d370399771b93b8cdb8831e568a48848651b2b`. Independent receipt
  verification through `base-sepolia-rpc.publicnode.com` proved `600_000` micros in settlement
  author proceeds and `400_000` micros in the author-wide unclaimed voucher pool. The agent
  balance was `4 -> 3` test USDC and remained at zero ETH. `sepolia.base.org` lagged the just-mined
  block, so final evidence used the documented publicnode read endpoint. This proves the deployed
  v1 contract's backed Lane-B split, but not a DB/raw-download/API settlement because this
  ephemeral listing is intentionally unlinked; it also does not lift any Phase 10 Base-mainnet
  gate.
- 2026-07-12 Base Sepolia passkey vouch E2E (x402 worktree only): the repeatable
  `web/scripts/base-vouch-e2e-smoke.ts` preflighted the v1 candidate
  `0x5992dD52Ee2015f558D0A690777C55e27b05B7d1`, the registered author
  `0x191370b682924527c1A5fD6B484A4BC37460CA30`, and a separate funded Coinbase Smart Account
  `0xf49844Aa13d97263Cc96b4038161F05975974293`. Because that voucher was new, the smoke first
  followed the UI's `ensureBaseAgentRegistered` path with sponsored registration UserOp
  `0x52576a32f45b1623db78c0944fdc5c71a12464e55a51b0397d4b5cdb3d71312b`, then submitted the
  same exact-USDC-approval plus `vouch` UserOp used by the passkey UI:
  `0x63b34d3240b4e3c38dad85a80c0ad96a650d69e89a7cc7d21754c82e644a8c48`. Transaction
  `0x27d66de00f1be685a5170d2d8497bc0a1a0902446ba7ed315f70aa581855cf43` emitted the expected
  `Vouched` event and moved voucher USDC from `4 -> 3`, vouch stake from `0 -> 1`, and voucher ETH
  from `0 -> 0`. Browser verification on `localhost:3003/author/0x1913...CA30` rendered “Vouch for
  this Author” and the connected author backing as `2 USDC`. The UI write is passkey-only today:
  MetaMask/injected wallets deliberately reject Base vouching; this smoke does not make that path
  supported or lift any Base-mainnet gate.
- 2026-07-12 DB-linked Base v1 x402 E2E (x402 worktree only): the repeatable
  `web/scripts/base-x402-v1-e2e-smoke.ts` completed the local raw-content flow against Base Sepolia
  with `AGENTVOUCH_HARNESS_ENV` pointing at the existing local harness secrets. It created fixture
  `3224046a-d1cb-4831-a552-f5319c92bb10`, linked Base listing
  `0xe2f6498d0430bb00835fb6d304dfdfd16cc37add030bc1e56c9f7b9f9ae19481`, returned `402` for
  unsigned raw access, settled an exact `1 USDC` EIP-3009 payment in transaction
  `0x4acc49ca67b6d212533fb605b7a4a5d6145f522bc9dd637ac46b467dc54e0a7d` with purchase id
  `0x677939f9c7cfbc966c74ad8d8e9e9eb2e624a96783b29f7f28dccfac00deeedd`, accepted the duplicate
  payment retry idempotently, and accepted the buyer's signed re-download. The smoke then confirmed
  exactly one Base-qualified receipt and one entitlement with `payment_flow=base-x402-purchase-skill`,
  `protocol_version=base-v1-candidate`, and listing revision `1`.
- 2026-07-12 voucher-share claim E2E (x402 worktree only): new
  `web/scripts/base-voucher-claim-e2e-smoke.ts` first calculated `0.2 USDC` claimable for voucher
  `0xf49844Aa13d97263Cc96b4038161F05975974293` after the x402 sale, then submitted sponsored UserOp
  `0x186f14a66f0b8d7b133a04a84632589818751224d3ddcfb6a7a008ca5d25b8bc`. Transaction
  `0x9572a24d03c90a22ed89145eda64f6c4947b79dee63afa8e7c53c978eb59ff0e` emitted the matching
  `VoucherRevenueClaimed` event, increased voucher USDC from `3 -> 3.2`, cleared pending rewards,
  reduced the author's unclaimed voucher pool by the same amount, and left voucher ETH at `0 -> 0`.
  The Base author page now defaults and validates vouches at the contract's `1 USDC` minimum and
  tells connected injected-wallet users that Base vouching currently requires Coinbase Smart Wallet.
  These Sepolia checks do not lift any Base-mainnet gate.
- 2026-07-13 Base A1 merge handoff: PR #102 merged the clean-break `base-v1-a1` source into `main`.
  The live `0x5992…B7d1` deployment remains pre-A1; no contract pointer or paymaster policy changed.
  Paid-report client work, fresh linked paused deployment, lifecycle smoke, activation, and rollback
  are owned by `.agents/plans/base-paid-report-activation-sepolia.plan.md`. This merge does not close
  the remaining Phase 9 custody, external-review/human-acceptance, monitoring, or live-smoke gates.

## Part A - Base Sepolia E2E Proof

### Preflight

Verify these before running live smokes:

- `BASE_SEPOLIA_RPC_URL` / `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` points at a reliable archive-capable
  Base Sepolia endpoint.
- `NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS` (read as the `BASE_AGENTVOUCH_CONTRACT_ADDRESS` constant in
  `web/lib/adapters/baseConfig.ts`) points at the expected Base Sepolia contract for the smoke
  under test: the historical F-1-fixed/POC contract for purchase/x402 fixtures, or the v1 candidate
  for report/vouch trust-write smokes.
- `NEXT_PUBLIC_BASE_USDC_ADDRESS` (read as the `BASE_USDC_ADDRESS` constant, defaulting to the
  Base Sepolia USDC in `baseConstants.ts`) matches Base Sepolia native USDC.
- CDP paymaster/bundler endpoint is present for UserOps.
- Relayer/x402 settlement env is present and has permission to submit settlement txs.
- A passkey buyer and author can be funded with Base Sepolia USDC.
- An agent EOA exists for x402 EIP-3009 signing. Smart-account/EIP-1271 agents are out of scope for
  the current Lane B code.

Record the exact env names, not secret values, in the plan closeout.

### Human Flow

Use a fresh browser profile/localStorage if possible:

1. Connect Base passkey wallet.
2. Register author if needed, confirming the registration uses the Phase 8a non-empty Base author
   metadata URI, that duplicate `AlreadyRegistered()` registration attempts do not abort the
   ensure-registered publish step, and that any contract revert is decoded by the shared
   AgentVouchEvm custom-error ABI.
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
cached marketplace trust path. This must be closed before Phase 10.

## Contract Scope

Start from `contracts/base-poc/src/AgentVouchEvm.sol`, but do not ship the POC contract to mainnet as
is. Decide whether to create `AgentVouchEvmV1.sol` or rename the POC once it is productionized. The
v1 spec should include:

- Preserve:
  - `registerAgent`
  - `createSkillListing`
  - `purchaseSkill`
  - `settleX402Purchase` x402 settlement (consumes USDC `receiveWithAuthorization` internally)
  - `depositAuthorBond`
  - `withdrawAuthorBond`
  - `vouch`
  - `revokeVouch`
  - `setPaused(bool)` under `PAUSE_ROLE`
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
- Produce a deployment/runbook update before Phase 10.

## Web Scope

- Base trust reads:
  - Extend `web/lib/baseAuthorTrust.ts` as needed for v1 report/dispute fields.
  - Add Base marketplace trust snapshots or live hydrate path so Base authors do not stay trust-null
    on `/skills`.
  - Keep chain-qualified trust: no Solana trust attached to EVM authors.
- Base vouch/report UI:
  - Author page can become chain-aware for EVM authors if the v1 contract supports it.
  - Skill/detail pages should show Base stake-at-risk and report history honestly.
  - **Trust WRITES need a reviewed `ChainWallet` seam extension first (scoped 2026-07-07).** The
    seam (`web/lib/adapters/types.ts`) today exposes only marketplace actions
    (registerAgent/createSkillListing/purchaseSkill/buildX402Payment/signMessage), while the
    deployed contract already has `vouch`/`revokeVouch`, `depositAuthorBond`/`withdrawAuthorBond`
    (self-stake), `openReport`, `claimVoucherRevenue`, and `withdrawAuthorProceeds`. Add the
    trust-write methods to the seam, implement Coinbase Smart Wallet first (batched approve+call
    UserOps, same pattern as purchaseSkill), and route the Base vouch/report UI through the seam —
    do NOT hard-wire a third path the way today's dashboard/author vouch UI is wired directly to
    the Solana generated client. `resolveReport` stays founder-tooling (RESOLVER_ROLE), not a
    seam method. MetaMask implementations of these writes are optional parity via the PR #83 EOA
    send/receipt helpers, tracked separately in
    `.agents/plans/base-metamask-erc7702-wallet.plan.md` (author-writes-parity note).
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
- `docs/BASE_DEPLOY.md`
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
- Keep Phase 10 blocked until all 9b/9c gates pass.
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
  policy? This must be decided before Phase 10.
- Should Base trust snapshots be cached in `author_trust_snapshots` or served live with short TTL?
  Marketplace scalability probably needs snapshots, but live reads are acceptable for early Sepolia
  smoke.
