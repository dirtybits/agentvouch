# Base Sepolia Safe Transaction Runbook

## Scope

This is a preparation and review checklist. It does not authorize Safe
deployment, owner changes, contract deployment, role changes, signing,
execution, or broadcasting. Base mainnet is out of scope.

Use the public
[ownership manifest](./SAFE_TESTNET_OWNERSHIP_MANIFEST.md) as the approved source
for network, Safe, owner, threshold, proposer, executor, and authority data.

## 1. Snapshot The Safe

Record these values from Base Sepolia immediately before building the
transaction:

- chain ID: `84532`;
- Safe address and deployed bytecode;
- Safe version;
- current owners and threshold;
- current Safe nonce;
- execution gas payer and its ETH balance;
- target contract address and deployed bytecode.

Stop if any value differs from the approved ownership manifest.

## 2. Build And Decode The Transaction

Record the complete Safe transaction fields:

- target (`to`);
- ETH value;
- calldata and decoded function arguments;
- operation type;
- Safe transaction gas, base gas, gas price, gas token, and refund receiver;
- Safe nonce.

Confirm the decoded call produces exactly one approved state transition. Do not
sign opaque calldata or accept an inferred chain, Safe address, target, or nonce.

## 3. Simulate From The Safe Context

Simulate the exact transaction against current Base Sepolia state using the Safe
as the caller. Record the tool, timestamp, block number, result, decoded events,
and expected post-state. A successful call from an owner EOA is not a substitute
for simulation from the Safe.

Stop on any unexpected call, delegate call, token movement, role change, event,
or state delta.

## 4. Calculate And Review The Safe Transaction Hash

Calculate the Safe transaction hash from the exact Safe address, chain ID,
nonce, target, value, calldata, operation, gas fields, gas token, and refund
receiver. Record the hash in the approval ticket or ceremony log.

Every owner must independently compare the displayed or decoded transaction to
the recorded hash inputs before signing.

## 5. Collect Owner Signatures

- Collect signatures only from owners listed as approved in the manifest.
- Require the configured threshold; never substitute an unapproved signer.
- Confirm no single production operator controls enough credentials to reach
  threshold.
- Do not expose private keys, passwords, mnemonics, or keystore contents while
  coordinating signatures.
- If the Safe nonce or any transaction field changes, discard the signatures,
  recalculate the hash, and repeat review.

## 6. Execute Through The Safe

After separate broadcast approval, submit the threshold-signed transaction
through the Safe contract using the recorded execution gas payer. Record:

- Safe transaction hash;
- execution transaction hash;
- sender and nonce of the execution transaction;
- block number;
- receipt status and emitted events;
- gas used.

Never represent an owner EOA transaction as a Safe transaction.

## 7. Verify Post-State

At the mined block, verify the intended event and every affected contract read.
For an authority handoff, confirm that:

1. the Safe holds every intended final role;
2. the temporary deployer holds none of those roles;
3. the contract remains paused until a separately approved activation;
4. owner set, threshold, and Safe nonce match the expected post-state.

Record independent RPC verification before declaring the transaction complete.

## Transaction Record

```text
Review date:
Reviewer:
Network / chain ID:
Block used for simulation:
Safe address / version:
Owners / threshold:
Safe nonce:
Target / value:
Decoded calldata:
Operation and gas fields:
Simulation artifact:
Safe transaction hash:
Signing owners:
Execution gas payer:
Execution transaction hash:
Mined block / receipt status:
Expected events:
Verified post-state:
Deployer authority removed:
Separate activation required:
```
