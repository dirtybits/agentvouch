# AgentVouch Deploy And IDL Runbook

This runbook covers the USDC-native `agentvouch` v0.2.0 program.

## Active Devnet Program

- Program ID: `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg`
- Program name: `agentvouch`
- Canonical keypair path: `target/deploy/agentvouch-keypair.json`
- Executable artifact: `target/deploy/agentvouch.so`
- IDL artifact: `target/idl/agentvouch.json`
- Checked-in web IDL: `web/agentvouch.json`
- Generated web client: `web/generated/agentvouch/`
- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Devnet chain context: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`

## Preflight

Run from the repo root:

```bash
cd <REPO_ROOT>
```

Set the deployment environment explicitly. `Anchor.toml` defaults to localnet, so do not rely on implicit provider config.

```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=/path/to/deploy-authority.json
```

Verify the wallet and program keypair:

```bash
solana-keygen pubkey "$ANCHOR_WALLET"
solana-keygen verify AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg \
  target/deploy/agentvouch-keypair.json
solana balance --url "$ANCHOR_PROVIDER_URL" -k "$ANCHOR_WALLET"
```

Verify source files agree on the program ID:

```bash
rg "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg" \
  Anchor.toml programs/agentvouch/src/lib.rs packages/agentvouch-protocol/src/index.ts web/agentvouch.json
```

## Build

Build the program:

```bash
NO_DNA=1 anchor build
```

If deployed behavior looks stale, force a clean rebuild:

```bash
NO_DNA=1 anchor clean
NO_DNA=1 anchor build
```

After every successful Anchor build, sync the web IDL and generated client:

```bash
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
```

Do not deploy if `target/idl/agentvouch.json` is missing or the generated web client is stale.

## Deploy

Use the explicit program keypair:

```bash
NO_DNA=1 anchor deploy \
  --program-name agentvouch \
  --program-keypair target/deploy/agentvouch-keypair.json \
  --provider.cluster devnet \
  --provider.wallet "$ANCHOR_WALLET"
```

Check the deployed program:

```bash
solana program show --url "$ANCHOR_PROVIDER_URL" \
  AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg
```

Verify the executable binary, not just metadata:

```bash
solana program dump --url "$ANCHOR_PROVIDER_URL" \
  AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg \
  /tmp/agentvouch_devnet.so

shasum -a 256 target/deploy/agentvouch.so /tmp/agentvouch_devnet.so
```

The hashes should match.

## Bootstrap Program State

Deploying the executable does not initialize PDA state. A fresh program ID needs `initialize_config` once before registration-dependent flows such as skill listing, vouching, purchases, or author bonds.

`initialize_config` creates:

- the singleton `ReputationConfig` PDA from seed `["config"]`
- the protocol treasury USDC vault
- the x402 settlement USDC vault

Dry-run config initialization first:

```bash
export AGENTVOUCH_RPC_URL=https://api.devnet.solana.com
export AGENTVOUCH_WALLET=~/dev-keypair.json
export SOLANA_CHAIN_CONTEXT=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
export USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU

NO_DNA=1 anchor run init-agentvouch-config
```

If the printed program ID, authorities, PDAs, and simulation result are correct, submit it:

```bash
INIT_AGENTVOUCH_CONFIG_APPLY=1 NO_DNA=1 anchor run init-agentvouch-config
```

The script is idempotent. If `config` already exists, it prints the current config and exits without sending a transaction.

If this step is skipped, instructions that read `config` fail even though the program account exists:

```text
AnchorError caused by account: config.
Error Code: AccountNotInitialized.
Error Number: 3012.
Error Message: The program expected this account to be already initialized.
```

## Anchor IDL

The checked-in web app uses `web/agentvouch.json` and `web/generated/agentvouch/`. The on-chain IDL account is still useful for explorers and Anchor-aware tooling.

Fetch the on-chain IDL:

```bash
anchor idl fetch AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg \
  --provider.cluster devnet
```

Upgrade the IDL if needed:

```bash
anchor idl upgrade \
  AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg \
  -f target/idl/agentvouch.json \
  --provider.cluster devnet \
  --provider.wallet "$ANCHOR_WALLET"
```

Initialize the IDL only if the program has never had one:

```bash
anchor idl init \
  AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg \
  -f target/idl/agentvouch.json \
  --provider.cluster devnet \
  --provider.wallet "$ANCHOR_WALLET"
```

## Post-Deploy Smoke

After deploy and config bootstrap:

1. Confirm the app and generated client target `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg`.
2. Register a fresh test agent.
3. Deposit author bond with USDC.
4. Create a vouch with USDC.
5. Publish a paid listing with `price_usdc_micros`.
6. Simulate or execute `purchase_skill`.
7. Verify raw download entitlement through the API.

## Web And Vercel Alignment

After any program, IDL, generated-client, or env change:

1. Sync `target/idl/agentvouch.json` to `web/agentvouch.json`.
2. Run `npm run generate:client`.
3. Confirm Vercel preview and production env vars match the intended Neon branch and Solana devnet RPC:
   - `DATABASE_URL`
   - `DATABASE_URL_UNPOOLED`
   - `SOLANA_RPC_URL`
   - `NEXT_PUBLIC_SOLANA_RPC_URL`
   - `SOLANA_CHAIN_CONTEXT`
   - `NEXT_PUBLIC_SOLANA_CHAIN_CONTEXT`
4. Run `npm run build --workspace @agentvouch/web`.
5. Redeploy or promote in the `agentvouch` Vercel project.
6. Follow `docs/PRODUCTION_RUNBOOK.md` for deployed smoke checks and rollback.

## Common Failure Modes

### `DeclaredProgramIdMismatch`

Usually means `declare_id!(...)`, `Anchor.toml`, or `target/deploy/agentvouch-keypair.json` do not agree. Verify before deploying:

```bash
solana-keygen verify AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg \
  target/deploy/agentvouch-keypair.json
```

### `Fallback functions are not supported`

This usually means the web client or on-chain IDL does not match the deployed executable.

Check:

```bash
anchor idl fetch AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg \
  --provider.cluster devnet

shasum -a 256 target/deploy/agentvouch.so /tmp/agentvouch_devnet.so
```

Then rebuild, redeploy, sync `web/agentvouch.json`, regenerate the client, and rebuild the web app.

## Legacy v0.1 Notes

Older runbooks and historical deploys used a different v0.1 program name and program ID. Treat those as archived references. New v0.2.0 deploys and docs should use `agentvouch`, `AgNt...`, USDC-native instructions, and `web/agentvouch.json`.