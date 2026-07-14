# Base Sepolia A1 Deployment State

This is the deployment-qualified evidence record for the proposed `base-v1-a1` paid-purchase report
release. Unknown or unexecuted fields remain `PENDING`; do not copy evidence from the pre-A1
deployment.

## Release identity

| Field | Value |
| --- | --- |
| Candidate commit | `PENDING` |
| Chain | Base Sepolia (`eip155:84532`) |
| Protocol version | `base-v1-a1` |
| Compiler/link profile | Solidity `0.8.28`; optimizer 200; `via_ir=true`; Cancun; no CBOR metadata |
| Native USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| PaidPurchaseSettlement address | `PENDING` |
| PaidPurchaseSettlement runtime hash | `PENDING` |
| AgentVouchEvm address | `PENDING` |
| AgentVouchEvm runtime hash | `PENDING` |
| Facade runtime size | 23,487 bytes |
| Library runtime size | 5,939 bytes |
| Deployment transaction/block | `PENDING` |
| Explorer verification | `PENDING` |

## Approved configuration and authorities

| Field | Value |
| --- | --- |
| Slash percentage | `PENDING HUMAN APPROVAL` |
| Restitution recipient | `PENDING HUMAN APPROVAL` |
| Final default admin and custody | `PENDING HUMAN APPROVAL` |
| Config authority and custody | `PENDING HUMAN APPROVAL` |
| Resolver and recovery owner | `PENDING HUMAN APPROVAL` |
| Settlement authority and custody | `PENDING HUMAN APPROVAL` |
| Pause authority and custody | `PENDING HUMAN APPROVAL` |
| Fallback cranker | `PENDING HUMAN APPROVAL` |
| Monitor owner / incident commander | `PENDING HUMAN APPROVAL` |
| Exposure policy | `PENDING HUMAN APPROVAL` |
| External review or testnet risk acceptance | `PENDING HUMAN APPROVAL` |

Locked values: 5 USDC report bond, 7-day filing window, 3-day review window, 7-day funded-credit
claim window, 60/40 purchase split, zero protocol fee, and zero reporter/keeper rewards.

## Gate decisions

| Gate | State | Approval/evidence |
| --- | --- | --- |
| A: pre-broadcast candidate | **NO-GO** | Local gates passed; candidate commit/review, approved inputs, external review/risk acceptance, and human GO remain pending |
| B1: deploy uninitialized | **NO-GO** | Explicit public-network approval required |
| B2: configure and remain paused | **NO-GO** | Separate explicit approval required |
| C: isolated lifecycle smoke | **NO-GO** | Separate explicit approval required |
| D: preview/shared Sepolia activation | **NO-GO** | Separate explicit approval required |
| Base mainnet | **BLOCKED** | Outside this release and runbook |

## Live evidence

- Deployment: `PENDING`
- Paused staging and role handoff: `PENDING`
- Isolated lifecycle smoke: `PENDING`
- Reconciliation and repause: `PENDING`
- Preview activation and rollback exercise: `PENDING`
- Shared Sepolia promotion: `PENDING`

## Local pre-broadcast evidence — 2026-07-13

- `forge test`: 121 passed.
- Web Vitest: 679 passed across 103 files.
- Facade runtime: 23,487 bytes; EIP-170 headroom 1,089 bytes; project soft-limit headroom 13 bytes.
- PaidPurchaseSettlement runtime: 5,939 bytes.
- Format, lint, web typecheck, chain-capability map, isolated Base UI build, harness typecheck, and
  production webpack build passed.
- The final disposable-Anvil rehearsal verified exact linked-library/facade code hashes, paused
  staging and complete role handoff, paginated slashing, 15 USDC buyer credit, 5 USDC reserve credit,
  2 USDC voucher residual, and terminal liveness while paused; it emitted `LOCAL_A1_REHEARSAL_OK` and
  `LOCAL_A1_DRIVER_OK`.
- Read-only operations tooling and deployment-qualified report recovery are implemented. The
  public-network smoke executor remains human-gated and incomplete.

The currently selected web deployment remains the historical pre-A1 `base-v1-candidate` until an
approved activation changes that pointer. A repository merge or testnet deployment alone is not an
activation claim.
