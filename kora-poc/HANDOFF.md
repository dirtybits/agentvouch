# Kora spike — session handoff

**Status (2026-06-23): rent question CLOSED, gasless proven on devnet, shipped to PR #57.**
Branch `feat/kora-spike-v1`. Deep log: memory `kora-local-spike.md`; run details: `README.md`.

## Done

- `kora-poc/` runs a local Kora node (kora-cli 2.0.5) as an AgentVouch-scoped USDC fee-payer
  relayer on devnet: program/token allowlist, USDC fee token, fixed `0.20 USDC` devnet UI
  pricing, anti-drain `fee_payer_policy`.
- **Rent question closed.** Kora validates *resolved* instructions (outer + CPI inner, via
  simulation) at `signTransaction`. Anchor's CPI'd `CreateAccount` (Purchase-PDA / ATA rent with
  the sponsor as rent_payer) is therefore gated by `fee_payer_policy.system.allow_create_account`:
  - default `false` → `signTransaction` rejects: *"Fee payer cannot be used for 'System Create Account'"*
  - `true` → signs. Proven both directions in `sign-create-account-test.cjs`.
  - The gate fires at **signTransaction**, NOT `estimateTransactionFee` (estimate only prices the
    rent outflow × margin).
- **Fully-gasless-for-user proven on devnet** (`gasless-user-roundtrip.cjs`, tx `32qjUv…`): a
  zero-SOL, USDC-only buyer signed one tx; Kora = fee payer + rent payer; buyer reimbursed the
  sponsor's USDC ATA via `transfer_checked`.
- **`register_agent` made gasless-ready**: added a separate `rent_payer` Signer (mirrors
  `purchase_skill`), in-place redeploy to devnet (program id unchanged `AGNtBj…`), callers +
  generated client updated. Proven (`gasless-register-agent.cjs`, tx `ZP73fg…`).

## Gotchas (so the next session doesn't re-hit them)

- `kora.toml`: once you open `[validation.fee_payer_policy.system]` you MUST list **all** its bool
  fields (`allow_transfer`/`allow_assign`/`allow_create_account`/`allow_allocate`) — they have no
  per-field serde default (only the `nonce` sub-table defaults). Omit the whole section for the
  safe all-false default.
- Memory signer key = **base58 of the 64-byte keypair** in the `KORA_PRIVATE_KEY` env.
- **Jupiter pricing can't run on devnet** (mainnet mints only) → devnet stays `Mock`, but the
  current config uses Kora fixed pricing so the UI sees `0.20 USDC` instead of Mock-inflated fees.
  `kora.toml` carries a mainnet block for flipping back to Jupiter + margin pricing.
- After any program edit: `npm run generate:client` (committed `web/agentvouch.json` drifted once).
- Spike signer: `.agent-keys/kora/signer.json` (gitignored), funded 0.1 devnet SOL from `~/.config/solana/id.json`.
- **Phantom warning noise is expected in the current UI spike.** The Kora flow sends Phantom a
  transaction where the Kora fee/rent payer is present but unsigned; the server validates the
  buyer-signed transaction, asks Kora to add the sponsor signature on submit, simulates, then
  broadcasts. Phantom may warn about unsafe simulation or insufficient SOL while inspecting this
  partially signed message. This is acceptable for local spike testing if transactions land, but
  should be cleaned up before an external demo or RC: call Kora during prepare so the transaction
  shown to Phantom is already sponsor-pre-signed, accept that shape in submit validation, skip the
  duplicate Kora signing call, and refresh blockhashes when wallet signing itself expires.

## Next / open

- **Mainnet hardening (BLOCKER before mainnet):** move the sponsor signer off a local file →
  Turnkey/Vault/Privy; validate Jupiter + margin pricing on mainnet; add `api_key`/`hmac` auth +
  rate limits; tighten `max_allowed_lamports` to just above real purchase rent + fee.
- **Open decision:** bespoke sponsor (ships launch) vs Kora (dynamic pricing + policy + custody) vs
  Openfort (managed Kora). Kora is NOT a launch blocker.
- **Vercel:** scope the sponsored-checkout env vars correctly — preview-all-branches vs production;
  use per-environment values for the secret / fee-destination / price. Do NOT push the devnet sponsor
  secret to production.
