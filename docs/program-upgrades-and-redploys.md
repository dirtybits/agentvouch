# Program Upgrade Runbook

This document is for same-program-ID upgrades only. For fresh v0.2.0 deployment, config bootstrap, IDL sync, and smoke testing, use [`docs/DEPLOY.md`](DEPLOY.md).

## Active v0.2.0 Program

- Program ID: `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ`
- Program name: `agentvouch`
- Cluster: devnet
- Program path: `programs/agentvouch/`
- IDL path: `target/idl/agentvouch.json`
- Web IDL path: `web/agentvouch.json`

Use this runbook only when:

- the program ID is unchanged
- PDA seeds are unchanged
- account sizes and serialized field order are unchanged
- you are upgrading logic in place without migrating existing PDAs

Do not use this runbook for fresh program IDs, account layout migrations, or SOL-to-USDC protocol rewrites.

## Environment

```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=/path/to/upgrade-authority.json
PROGRAM_ID=AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ
```

## Preflight

Verify the deployed target and upgrade authority:

```bash
solana program show --url "$ANCHOR_PROVIDER_URL" "$PROGRAM_ID"
solana-keygen pubkey "$ANCHOR_WALLET"
```

Confirm source files still point to the same program:

```bash
rg "$PROGRAM_ID" Anchor.toml programs/agentvouch/src/lib.rs web/agentvouch.json
```

Review the diff for unchanged account layouts:

```bash
git diff -- programs/agentvouch/src/state programs/agentvouch/src/instructions
```

Stop if any PDA seed, account size, field ordering, or `declare_id!` changed unexpectedly.

## Build

```bash
NO_DNA=1 anchor build
cargo check --manifest-path programs/agentvouch/Cargo.toml
```

Sync client artifacts after every successful build:

```bash
cp target/idl/agentvouch.json web/agentvouch.json
npm run generate:client
```

## Upgrade

Prefer an explicit same-ID deploy:

```bash
solana program deploy \
  target/deploy/agentvouch.so \
  --program-id "$PROGRAM_ID" \
  --upgrade-authority "$ANCHOR_WALLET" \
  -u "$ANCHOR_PROVIDER_URL"
```

Then verify metadata:

```bash
solana program show --url "$ANCHOR_PROVIDER_URL" "$PROGRAM_ID"
```

Verify the executable:

```bash
solana program dump --url "$ANCHOR_PROVIDER_URL" "$PROGRAM_ID" /tmp/agentvouch_devnet.so
shasum -a 256 target/deploy/agentvouch.so /tmp/agentvouch_devnet.so
```

Hashes should match.

## Validation Checklist

Every upgrade needs fresh proof:

- `ReputationConfig` decodes and contains the expected USDC mint.
- Existing `AgentProfile`, `AuthorBond`, `Vouch`, `SkillListing`, and `Purchase` accounts still decode.
- A registered author can create or update a `price_usdc_micros` listing.
- Below-floor paid listing prices fail with the expected custom error.
- A valid USDC vouch succeeds and updates profile aggregates.
- `purchase_skill` simulation or smoke transaction preserves the configured 60/40 split.
- The web build passes after IDL/client sync.
- Vercel preview or production env points at the intended Neon branch and Solana RPC.
- Public API smoke checks pass after redeploy.

## Stop Criteria

Stop before deploy if:

- `declare_id!` differs from `$PROGRAM_ID`
- the local program keypair does not match `$PROGRAM_ID`
- account size or field ordering changed without a migration plan
- the wallet is not the upgrade authority

Stop after deploy if:

- the program address changed
- the authority changed unexpectedly
- old PDAs fail to decode
- the web IDL or generated client no longer matches the built IDL
- smoke transactions fail or surface stale instruction errors

## Rollback

A rollback is another same-ID upgrade using the previous known-good binary and the same upgrade authority. Preserve:

- prior commit SHA
- prior deploy artifact or reproducible build input
- failing validation evidence
- post-rollback `solana program show` output

If the upgrade changed IDL, generated client behavior, or public app flow, roll back the web app in the same incident window:

1. Promote the last known-good Vercel deployment or redeploy the prior commit.
2. Restore matching env vars if the incident included a Neon/RPC/config cutover.
3. Confirm `web/agentvouch.json`, public docs, and `skill.md` match the active program.
4. Run the production smoke checks in `docs/PRODUCTION_RUNBOOK.md`.

## Legacy v0.1 Note

Older notes used the v0.1 program name, source path, and program ID. Those are same-ID upgrade references for archived v0.1 deployments and should not be used for v0.2.0 USDC-native deployments.