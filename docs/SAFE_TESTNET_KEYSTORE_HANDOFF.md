# Safe Testnet Keystore Handoff

## Scope

This document supports testnet preparation only. It does not approve a Safe
owner set, custody policy, deployment, role change, transaction, Base mainnet,
or use of real funds.

A Safe is a smart contract and has no private key or Foundry keystore. Foundry
keystores belong to individual Safe owners, proposers, executors, or temporary
deployers. Do not attempt to send a transaction "from the Safe" using a private
key. Safe transactions must collect the configured owner threshold and execute
through the Safe contract.

AgentVouch's proposed 2-of-3 Safe layout remains unapproved. Historical wallet
addresses and unrelated ParaFi CCV keystores are not approved AgentVouch
custody and must not be reused.

## Reference Provenance

This package adapts two operator-machine references:

- `/Users/andysustic/Repos/calypso-infra/scripts/chainlink/create_ccv_test_accounts.sh`
  demonstrates the testnet keystore lifecycle.
- `/Users/andysustic/Repos/calypso-infra/docs/chainlink/chainlink_ccv_key_custody.md`
  defines the exportable-test-key versus non-exportable-production boundary.

They are references only. Do not reuse either file unchanged, and do not reuse
their account names, 1Password items, passwords, keystores, or addresses. This
AgentVouch package has no runtime dependency on the Calypso repository.

## Required Human Inputs

Record these before creating accounts:

- Project and environment, explicitly including `testnet`.
- Network name and chain ID.
- Existing Safe address, or an explicit statement that deployment is pending.
- Safe version if known.
- Proposed owner roles and threshold.
- Which owners use hardware wallets and which, if any, require exportable
  Foundry keystores.
- Dedicated transaction proposer or gas-paying executor, if applicable.
- Temporary deployer, if applicable.
- Named approver for the final owner set and authority handoff.

Do not infer owner approval from possession of a keystore. Creating an address
does not authorize adding it to a Safe or granting it a contract role.

## Create Or Verify Test Accounts

The helper creates only the accounts passed with `--account`. Each account gets
its own generated 1Password password, encrypted Foundry keystore, and encrypted
keystore attachment in the selected vault.

```bash
cd "$(git rev-parse --show-toplevel)"

./scripts/safe/create_safe_test_accounts.sh \
  --vault pt_bastion_vault \
  --project-tag agentvouch \
  --account agentvouch-safe-test-owner-1 \
    "AgentVouch Safe Test Owner 1" owner \
  --account agentvouch-safe-test-executor \
    "AgentVouch Safe Test Executor" executor
```

The helper:

- refuses to overwrite an existing keystore;
- stops if a keystore and 1Password password do not match;
- stops rather than replacing a missing or mismatched backup on an existing
  1Password item;
- sets the keystore directory to mode `0700` and keystores to `0600`;
- derives and prints only public addresses;
- uploads the encrypted keystore to its matching 1Password item;
- downloads and compares the backup byte-for-byte;
- never deploys a Safe, changes owners, signs a Safe transaction, or
  broadcasts.

Storing a password and encrypted keystore in the same 1Password item is a
testnet convenience, not an approved production custody model.

## Read A Password Without The Clipboard

Use the wrapper for `cast` or `forge` commands that accept `--password-file`:

```bash
./scripts/safe/run_foundry_with_op_password.sh \
  --password-ref \
    'op://pt_bastion_vault/AgentVouch Safe Test Owner 1/password' \
  -- cast wallet address \
    --keystore \
      "$HOME/.foundry/keystores/agentvouch-safe-test-owner-1" \
    --password-file '{password_file}'
```

The wrapper reads the password with `op read -n` into a temporary `0600` file,
replaces the single literal `{password_file}` argument with that path, and
removes the file on exit. It does not copy the password to the clipboard or
export it as an environment variable. The explicit placeholder works for
commands such as `forge create` where option placement relative to variadic
constructor arguments matters.

The wrapper can run signing or broadcast commands, so its existence is not
transaction approval. Review and simulate the full command separately before
using it with `cast send` or `forge ... --broadcast`.

## Public Local Configuration

Put public configuration and secret references in a git-ignored file such as
`.env.safe.local`. The repository already ignores `.env*.local`.

```text
SAFE_CHAIN_ID=84532
SAFE_ADDRESS=
SAFE_THRESHOLD=
SAFE_OWNER_1_ADDRESS=
SAFE_EXECUTOR_ADDRESS=
RPC_URL=op://<vault>/<item>/<field>
```

Do not put resolved authenticated RPC URLs, passwords, private keys, mnemonics,
or keystore JSON in an environment file. Use `op run --env-file` when a command
needs to resolve secret references.

Complete the public
[ownership manifest](./SAFE_TESTNET_OWNERSHIP_MANIFEST.md) before requesting
account creation or Safe deployment approval. Use the separate
[transaction runbook](./SAFE_TESTNET_TRANSACTION_RUNBOOK.md) for every proposed
Safe action.

## Safe Transaction Gate

Before proposing or signing a Safe transaction, record and independently
review:

1. Network and chain ID.
2. Safe address, version, threshold, current owners, and Safe nonce.
3. Target contract, ETH value, decoded calldata, and expected state change.
4. Simulation result from the exact Safe context.
5. Safe transaction hash.
6. Required signer set and confirmation that no one operator controls the
   threshold.
7. Execution transaction hash and post-transaction state.

For a deployment authority handoff, deploy in the intended paused state,
transfer each final role to the approved Safe, verify the grants onchain, remove
temporary deployer authority, and only then consider activation. The broadcaster
must not silently retain final administrative roles.

## Production Boundary

Do not use these exportable test keystores as production Safe owners. Production
custody should prefer independently controlled hardware wallets or an approved
non-exportable signing system. Operators must not have access to enough owner
credentials to satisfy the Safe threshold.

Before production, document owner replacement, loss recovery, threshold
changes, emergency actions, transaction review, monitoring, and periodic
recovery drills. Base mainnet remains blocked by `docs/MAINNET_READINESS.md`
until its custody and readiness gates are explicitly approved.

## Agent Handoff Template

```text
Goal: prepare testnet-only Foundry accounts for an approved Safe workflow.

Network / chain ID:
Existing Safe address or deployment status:
Safe version:
Proposed owners:
Threshold:
Expected Safe nonce:
Hardware-wallet owners:
Foundry-keystore roles explicitly approved for creation:
Executor / gas payer:
Temporary deployer:
Final human approver:

Use scripts/safe/create_safe_test_accounts.sh as the account helper and
scripts/safe/run_foundry_with_op_password.sh for password-file handling.
Do not reuse unrelated keystores. Do not treat generated addresses as approved
owners. Do not deploy, change Safe ownership, grant roles, sign, or broadcast
without the separate transaction approval and review checkpoint.
```
