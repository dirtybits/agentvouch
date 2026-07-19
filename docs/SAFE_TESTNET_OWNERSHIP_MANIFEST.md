# Base Sepolia Safe Ownership Manifest

## Status

- Environment: testnet only
- Network: Base Sepolia
- Chain ID: `84532`
- Chain context: `eip155:84532`
- Approval status: **unapproved draft**
- Existing Safe address: not supplied; deployment pending
- Safe version: pending selection
- Proposed threshold: 2-of-3, unapproved
- Expected Safe nonce: pending Safe address and live-state verification

This file contains public custody metadata only. Do not add private keys,
mnemonics, passwords, resolved secret values, or keystore JSON.

## Proposed Owners

No owner address is approved yet. Complete every field and obtain explicit
human approval before creating or deploying the Safe.

| Slot | Public address | Signing system | Independent controller | Recovery verified | Approved |
| --- | --- | --- | --- | --- | --- |
| Owner 1 | pending | hardware wallet preferred | pending | no | no |
| Owner 2 | pending | hardware wallet or testnet Foundry keystore | pending | no | no |
| Owner 3 | pending | hardware wallet or testnet Foundry keystore | pending | no | no |

An operator must not control enough production owner credentials to satisfy the
threshold. Exportable Foundry owners are testnet-only unless production custody
receives separate explicit approval.

## Proposer And Executor

| Responsibility | Public address | Signing system | Gas source | Approved |
| --- | --- | --- | --- | --- |
| Transaction proposer | pending | pending | none required | no |
| Execution gas payer | pending | dedicated testnet account preferred | Base Sepolia ETH | no |
| Temporary deployer | pending | dedicated testnet Foundry keystore | Base Sepolia ETH | no |

The proposer or executor is not automatically a Safe owner. The temporary
deployer must not retain final administrative authority.

## Authority Handoff

Complete one row for every privileged contract role before deployment.

| Contract and address | Role or authority | Temporary holder | Final Safe | Verification read | Status |
| --- | --- | --- | --- | --- | --- |
| pending | pending | pending | pending | pending | not started |

Required transition:

1. Deploy with the dedicated deployer in the intended paused state.
2. Initialize only the reviewed configuration.
3. Grant or transfer each final authority to the approved Safe.
4. Verify every Safe-held authority onchain.
5. Revoke every temporary deployer authority and verify removal.
6. Treat activation or unpause as a separate reviewed Safe transaction.

## Approval Record

- Final owner-set approver: pending
- Custody risk acceptance: pending
- Manifest review date: pending
- Safe deployment approval: not granted
- Contract deployment approval: not granted
- Transaction or broadcast approval: not granted

Creating an account or recording its address does not change any approval above.
