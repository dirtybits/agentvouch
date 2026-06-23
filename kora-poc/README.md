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
  [devnet USDC `4zMMC9…`], `price_source: "Mock"`, `fee_payer_policy.system.allow_create_account: false`.
- `getSupportedTokens` → `[4zMMC9…]` (USDC only).
- `getPayerSigner` → `89CGD862…` (signer == payment address).
- `getBlockhash` → live devnet blockhash.
- `estimateTransactionFee` (minimal ComputeBudget tx) →
  `fee_in_lamports: 5775` (5250 base × 1.10 margin), `fee_in_token: 57750` micro-USDC
  (0.0578 USDC at the Mock 0.0001 SOL/USDC rate). Signer funded via devnet tx
  `26hWPGuJPobpekgL7SSnkKRQ4FUzWaK551JSYRCgp8v5v1yQNxTaNDGtsLKXWQNWyX3c8YdMKJY3zLW1DzZAhRGo`.

## Files

| File | Purpose |
|------|---------|
| `kora.toml` | Validation allowlist + Margin pricing |
| `signers.toml` | Single in-memory sponsor signer (`KORA_PRIVATE_KEY`) |
| `estimate-fee.cjs` | Fee-quote probe (`@solana/web3.js`) |
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

kora --config contracts/kora-poc/kora.toml --rpc-url https://api.devnet.solana.com \
  rpc start --signers-config contracts/kora-poc/signers.toml -p 8080 &

node contracts/kora-poc/estimate-fee.cjs   # -> USDC fee quote
```

## Findings for AgentVouch

1. **Dynamic pricing is solved.** The Margin model returns `base_fee × (1 + margin)` and
   converts to the fee token. Set `price_source = "Jupiter"` for live SOL/USDC on mainnet
   (Jupiter prices mainnet mints, so this devnet spike uses `Mock`).
2. **Kora simulates during estimate**, so the sponsor must hold SOL even to *quote*, not
   only to broadcast.
3. **Anti-drain by default.** With `fee_payer_policy` omitted, the sponsor can never be the
   source of a transfer/burn/close/assign.
4. **Rent — the crux, partially open.** `getConfig` shows `system.allow_create_account =
   false`. AgentVouch `purchase_skill` creates the Purchase PDA via Anchor `init`, i.e. a
   **CPI'd** `System::CreateAccount`, not a top-level instruction. Kora validates only the
   **top-level** message instructions, so the CPI'd rent is not seen by the policy and the
   sponsor (as fee payer) funds it. **Reasoned-compatible, but not yet tested with a real
   `purchase_skill` tx** — that is the next verification.
5. `max_allowed_lamports` caps total outflow (1 SOL here), far above the purchase receipt
   rent (~0.0021 SOL) + fee.

## Next step if pursuing Kora

Build a real devnet `purchase_skill` transaction (sponsor as fee payer + `rent_payer`,
buyer partial-signs, USDC setup-fee transfer), then call `estimateTransactionFee` and
`signTransaction` to confirm Kora co-signs **and** the CPI'd rent is sponsored. That proves
parity with the existing bespoke sponsor — at which point Kora's validation policy, signer
custody options (Turnkey/Vault/Privy), and live Jupiter pricing become the upgrade over the
hand-rolled service.
