# AgentVouch &lt;&gt; Kora local spike

**Result: proven on devnet (2026-06-23).** A local Kora node stands up as an
AgentVouch-scoped, USDC-denominated fee-payer relayer and quotes fees dynamically.
This is an evaluation artifact, not production wiring.

## What it proves

- Kora runs locally against devnet with an **AgentVouch-only program allowlist**.
- **USDC is the sole accepted fee token**; the sponsor signer is the fee payer.
- **Margin pricing** produces a live USDC quote — the replacement for the static
  `AGENTVOUCH_SPONSOR_SOL_USDC_MICRO_PRICE` env the sponsored-checkout handoff flagged.
- The **anti-drain `fee_payer_policy`** (every `allow_*` = false) is on by default.
- **Fully gasless for the user, proven end-to-end on devnet** — a zero-SOL wallet
  transacted, paying only USDC, while Kora sponsored gas **and** rent (see below).

## Evidence (live RPC against the running node)

- `getConfig` → `fee_payers: [89CGD862…]`, `allowed_programs` = [AgentVouch `AGNtBj…`,
  System, SPL Token, ATA, ComputeBudget], `allowed_tokens`/`allowed_spl_paid_tokens` =
  [devnet USDC `4zMMC9…`], `price_source: "Mock"`, `fee_payer_policy.system.allow_create_account: true`
  (the one `allow_*` deliberately enabled — see finding #4; every other policy bit stays false).
- `getSupportedTokens` → `[4zMMC9…]` (USDC only).
- `getPayerSigner` → `89CGD862…` (signer == payment address).
- `getBlockhash` → live devnet blockhash.
- `estimateTransactionFee` (minimal ComputeBudget tx) →
  `fee_in_lamports: 5775` (5250 base × 1.10 margin), `fee_in_token: 57750` micro-USDC
  (0.0578 USDC at the Mock 0.0001 SOL/USDC rate). Signer funded via devnet tx
  `26hWPGuJPobpekgL7SSnkKRQ4FUzWaK551JSYRCgp8v5v1yQNxTaNDGtsLKXWQNWyX3c8YdMKJY3zLW1DzZAhRGo`.
- **Rent gate, proven both directions** (`sign-create-account-test.cjs`, a sponsor-funded
  `System::CreateAccount` partial-signed so only the fee-payer signature is missing):
  - `allow_create_account = false` → `signTransaction` **REJECTED**:
    `"Fee payer cannot be used for 'System Create Account'"`.
  - `allow_create_account = true` → CreateAccount gate **passes**; the tx advances to the
    *next* validation and stops at `"Insufficient token payment. Required 991023 lamports"`
    (expected — the probe tx carries no buyer-reimbursement transfer).
  - `estimateTransactionFee` does **not** enforce `fee_payer_policy` (it priced the same tx
    at 9.91 USDC); only `signTransaction` runs `validate_transaction`.
- **Fully-gasless-for-the-user round trip, submitted to devnet** (`gasless-user-roundtrip.cjs`):
  a freshly generated buyer with **0 SOL / 20 USDC** signs one tx — fee payer = sponsor,
  rent payer = sponsor (a new account's 890,880-lamport rent), plus a `transfer_checked`
  reimbursing the sponsor in USDC. `estimateTransactionFee` → `signTransaction` → submitted:
  - tx [`32qjUv…KFQvK`](https://explorer.solana.com/tx/32qjUv38fmfFtcjDKf1rx959jHDHwD1q1NwwnePaW3jHBv1hQw5zM6p22TSAQJsvJoHakSginQpamtLhYc6KFQvK?cluster=devnet)
    landed. Buyer **SOL delta = 0** (paid no gas, no rent); **USDC delta = −10.16** (the
    reimbursement); the new account's rent was paid by the sponsor.
  - The 10.16 USDC fee is a **Mock-pricing artifact** (devnet Mock rate prices ~0.001 SOL of
    rent at ~10 USDC). Live `price_source = "Jupiter"` on mainnet yields a realistic cent-scale
    fee. Verify the *mechanism* here, not the magnitude.
- **Gasless `register_agent` round trip, submitted to devnet** (`gasless-register-agent.cjs`,
  against the redeployed program): the same zero-SOL wallet — as the `authority` being
  registered — signs `register_agent` with `rent_payer = sponsor`, plus a USDC reimbursement.
  - tx [`ZP73fg…JMUteV`](https://explorer.solana.com/tx/ZP73fgdvGxxa3uweubNpk7uWQ4ATgeUmpCAac3D2XkbenDSkCfjaCzJ8nDc7JDFish5KcLfdBG7yZjbh6JMUteV?cluster=devnet)
    landed. Authority **SOL delta = 0**; the `agent_profile` PDA was created (owned by the
    program, **3,605,280 lamports rent paid by the sponsor**); USDC delta = −40.56 (Mock-priced
    reimbursement). Confirms the program redeploy made first-time registration gasless.

## Files

| File | Purpose |
|------|---------|
| `kora.toml` | Validation allowlist + Margin pricing |
| `signers.toml` | Single in-memory sponsor signer (`KORA_PRIVATE_KEY`) |
| `estimate-fee.cjs` | Fee-quote probe (`@solana/web3.js`) |
| `create-account-test.cjs` | `estimateTransactionFee` probe for a sponsor-funded CreateAccount (shows estimate does *not* enforce the policy) |
| `sign-create-account-test.cjs` | `signTransaction` rent-gate proof — REJECTED when `allow_create_account=false`, passes the gate when `true` |
| `gasless-user-roundtrip.cjs` | Full gasless-for-user round trip: zero-SOL buyer, sponsor pays gas+rent, buyer reimburses in USDC, submitted to devnet |
| `gasless-register-agent.cjs` | Gasless `register_agent` against the redeployed program: zero-SOL authority, sponsor pays the profile-PDA rent, user reimburses in USDC |
| `.agent-keys/kora/signer.json` | Sponsor keypair (gitignored, NOT in repo) |
| `.agent-keys/kora/buyer.json` | Zero-SOL test buyer holding only devnet USDC (gitignored) |

## Run

```bash
# Base58 of the 64-byte keypair -> KORA_PRIVATE_KEY (memory signer reads this).
export KORA_PRIVATE_KEY="$(python3 - <<'PY'
import json
ab='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
d=bytes(json.load(open('.agent-keys/kora/signer.json'))); n=int.from_bytes(d,'big'); o=''
while n>0: n,r=divmod(n,58); o=ab[r]+o
p=0
for b in d:
    if b==0: p+=1
    else: break
print('1'*p+o)
PY
)"

kora --config kora-poc/kora.toml --rpc-url https://api.devnet.solana.com \
  rpc start --signers-config kora-poc/signers.toml -p 8080 &

node kora-poc/estimate-fee.cjs   # -> USDC fee quote
```

## Findings for AgentVouch

1. **Dynamic pricing is solved.** The Margin model returns `base_fee × (1 + margin)` and
   converts to the fee token. Set `price_source = "Jupiter"` for live SOL/USDC on mainnet
   (Jupiter prices mainnet mints, so this devnet spike uses `Mock`).
2. **Kora simulates during estimate**, so the sponsor must hold SOL even to *quote*, not
   only to broadcast.
3. **Anti-drain by default.** With `fee_payer_policy` omitted, the sponsor can never be the
   source of a transfer/burn/close/assign.
4. **Rent — the crux, now CLOSED (overturns the earlier reasoning).** An earlier draft
   assumed Kora inspects only **top-level** message instructions, so an Anchor `init`'s
   **CPI'd** `System::CreateAccount` would slip past the policy. **Source and empirical test
   prove the opposite.** `validate_transaction` (kora-lib 2.0.5
   `src/validator/transaction_validator.rs:97`) runs over `transaction_resolved.all_instructions`,
   which is built from simulation and **includes inner/CPI instructions**, and
   `validate_fee_payer_usage` gates every `System::CreateAccount { payer == fee_payer }` on
   `allow_create_account`. So with the default `false`, `purchase_skill` (Purchase PDA + ATAs
   created with the sponsor as rent payer) is **rejected at sign time**. Setting
   `[validation.fee_payer_policy.system] allow_create_account = true` unblocks exactly that
   one action while keeping the sponsor un-drainable on transfer/burn/close/assign. Proven in
   both directions (see Evidence). **Config gotcha:** `SystemInstructionPolicy`'s bool fields
   carry no per-field `#[serde(default)]`, so once the `[…system]` table is present you must
   spell out **all four** (`allow_transfer`, `allow_assign`, `allow_create_account`,
   `allow_allocate`) or the config fails to parse with `missing field allow_transfer`.
5. `max_allowed_lamports` caps total outflow (1 SOL here), far above the purchase receipt
   rent (~0.0021 SOL) + fee.
6. **Both `register_agent` and `purchase_skill` are now gasless-ready (`register_agent` fixed +
   redeployed 2026-06-23).** `purchase_skill` always exposed two distinct signers — `buyer` and
   `rent_payer` — so the sponsor pays gas + rent while the buyer only authorizes USDC transfers.
   `register_agent` originally hard-coded `payer = authority` (the user), so a new profile forced
   the user to pay rent in SOL. It now takes a separate `rent_payer: Signer` and uses
   `payer = rent_payer` (mirrors `purchase_skill`); `authority` still signs as identity but pays
   no rent. Redeployed to devnet (program ID unchanged; see `docs/DEPLOY.md` change log) and
   **proven gasless end to end** — see the register_agent round trip in Evidence.

## Status & next steps

**Done and proven on devnet:** dynamic USDC pricing (finding #1), rent-via-CPI sponsorship
(finding #4), fully-gasless-for-user `purchase_skill`-shaped round trip, and gasless
`register_agent` (finding #6 — program fixed + redeployed). The `register_agent` rent_payer
seam is in `main` program code and the deploy is logged in `docs/DEPLOY.md`.

Remaining work, in priority order:

1. **`purchase_skill` against real marketplace state.** The round trips above prove the
   fee-payer/rent-payer/USDC-reimbursement mechanism with the canonical devnet USDC mint; the
   only delta to a real purchase is the full account set (config, listing, settlement, proceeds
   + reward vaults) and a buyer funded with that USDC. No new risk — same pattern, more accounts.
2. **Wire the UI** to route `register_agent` / `purchase_skill` through Kora's estimate→sign
   flow (`web/lib/sponsoredPurchase.ts` is the template; pass the sponsor as `rent_payer`). Deferred.
3. **Mainnet hardening (BLOCKERS before mainnet, documented in `kora.toml`):** flip
   `price_source = "Jupiter"` with the mainnet USDC mint (the Mock rate over-prices ~100×, which
   is why the devnet fees above read ~10–40 USDC instead of cents), and move the sponsor key off
   the local file to a managed signer (Turnkey / Vault / Privy).

Per the ship-minimal bias this is documented hardening, **not a launch blocker**: the bespoke
sponsor ships launch. But the gasless direction is now de-risked end to end.
