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

## Files

| File | Purpose |
|------|---------|
| `kora.toml` | Validation allowlist + Margin pricing |
| `signers.toml` | Single in-memory sponsor signer (`KORA_PRIVATE_KEY`) |
| `estimate-fee.cjs` | Fee-quote probe (`@solana/web3.js`) |
| `create-account-test.cjs` | `estimateTransactionFee` probe for a sponsor-funded CreateAccount (shows estimate does *not* enforce the policy) |
| `sign-create-account-test.cjs` | `signTransaction` rent-gate proof — REJECTED when `allow_create_account=false`, passes the gate when `true` |
| `.agent-keys/kora/signer.json` | Sponsor keypair (gitignored, NOT in repo) |

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

## Next step if pursuing Kora

The rent question (finding #4) is closed — Kora can sponsor the CPI'd `CreateAccount` once
`allow_create_account = true`, and the only remaining gate is the buyer-reimbursement
payment, which is the intended mechanism. The remaining work to reach full bespoke-sponsor
parity is plumbing, not an open risk:

- Build the full `purchase_skill` round-trip with the buyer-reimbursement USDC transfer
  (`estimateTransactionFee` → add SPL transfer of `fee_in_token` to the sponsor →
  `signTransaction`) to land a clean `SIGNED` end to end. Needs a funded buyer keypair +
  devnet-USDC ATAs (the spike has only the sponsor signer today).
- Then evaluate signer custody (Turnkey/Vault/Privy) and live Jupiter pricing — the actual
  upgrades over the hand-rolled service.

Per the ship-minimal bias this is documented hardening, **not a launch blocker**: the
bespoke sponsor ships launch.
