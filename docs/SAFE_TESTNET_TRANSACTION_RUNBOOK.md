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
- Safe address, deployed proxy bytecode, and proxy runtime bytecode hash;
- Safe version;
- singleton/master-copy address and runtime bytecode hash, verified against the
  approved canonical Safe release;
- current owners and threshold;
- current Safe nonce;
- the complete enabled-module set, read page-by-page from the initial sentinel
  until the terminal sentinel is reached, recording every cursor;
- guard, fallback handler, and module guard configuration;
- execution gas payer and its ETH balance;
- target contract address and deployed bytecode.

Record the read method, RPC, block number, and result for every control-plane
value. Stop if module pagination is incomplete, an unexpected module, guard,
module guard, or fallback handler is present, or any value differs from the
approved ownership manifest.

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

## 3. Simulate The Exact Safe Execution

Use an `execTransaction`-aware simulator, such as Safe{Wallet} Transaction
Builder simulation or a Tenderly simulation of the exact `Safe.execTransaction`
call. Simulate every Step 2 field against current Base Sepolia state, including
the Safe nonce, operation, signatures or documented prevalidated-signature
substitute, guard/module context, Safe transaction gas, base gas, gas price, gas
token, and refund receiver. Record the tool, timestamp, block number, complete
`execTransaction` calldata, result, decoded internal calls and events, gas/refund
effects, and expected post-state.

A target-contract `eth_call` with only `from` set to the Safe, or a successful
call from an owner EOA, does not exercise the Safe execution path and is not an
acceptable simulation.

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

Treat a successful mined receipt as provisional. At the mined block, verify the
intended event and every affected contract read. Then wait until the execution
block is at or below Base Sepolia's RPC `finalized` head. If the selected RPC
cannot report a `finalized` head, stop and use one that can.

After that checkpoint, use an independent RPC to confirm its `finalized` head
also contains the execution block, re-read the receipt and exact execution-block
hash, confirm the block hash still matches the mined record, and repeat every
affected state and Safe control-plane read. For an authority handoff, confirm
that:

1. the Safe holds every intended final role;
2. the temporary deployer holds none of those roles;
3. the contract remains paused until a separately approved activation;
4. owner set, threshold, and Safe nonce match the expected post-state.

Do not declare the transaction complete or begin any dependent authority
handoff, deployment, or activation step until the post-finality block-hash and
state checks pass. Record both RPC providers by public identifier without
recording authenticated URLs or credentials.

## Transaction Record

```text
Review date:
Reviewer:
Network / chain ID:
Block used for simulation:
Safe address / version:
Safe proxy bytecode hash / singleton:
Owners / threshold:
Modules / guard / module guard / fallback handler:
Safe nonce:
Target / value:
Decoded calldata:
Operation and gas fields:
execTransaction-aware simulator / artifact:
Exact execTransaction calldata:
Safe transaction hash:
Signing owners:
Execution gas payer:
Execution transaction hash:
Mined block number / block hash / receipt status:
Finalized head / checkpoint time:
Independent RPC finalized head:
Independent RPC block-hash recheck:
Expected events:
Verified post-finality state:
Deployer authority removed:
Separate activation required:
```
