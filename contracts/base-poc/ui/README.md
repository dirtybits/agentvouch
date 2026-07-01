# Gas-free UX demo UI (Base Sepolia)

A tiny browser app that makes the AgentVouch gas-free flow **visible**: a user clicks
**Register → List → Buy**, signs, and pays **zero gas** (a paymaster sponsors every
ERC-4337 UserOp). It's the UI companion to the headless `../harness` and the Foundry proof
in `../test/gasless`.

Isolated from the Solana `web/` app on purpose (different chain, different stack). This is a
decision instrument / demo only — Solana stays canonical.

## What it does

Three contract calls, mirroring the harness, across two roles:

1. **Register** — author calls `registerAgent` (free, no USDC).
2. **List** — author calls `createSkillListing` with a price (paid listings are free to post;
   no bond needed).
3. **Buy** — buyer calls `approve` + `purchaseSkill` batched in one UserOp.

Only the **buyer** needs test USDC; the author needs none.

## Account models

One `SmartAccount` interface, three ways to create it (the three calls are identical across
all of them):

- **Local key** — generated key in `localStorage`. No wallet install. Dev / fallback.
- **Passkey (Coinbase Smart Wallet)** — Face/Touch ID via WebAuthn, no extension. The real-flow demo.
- **MetaMask + EIP-7702** — your existing wallet, sponsored via 7702. *Pending the 7702 spike* (disabled).

Phantom is out — no account-abstraction / 7702 support, so its gas can't be sponsored.

## Run

```bash
npm install
cp .env.example .env.local
#   set VITE_CDP_RPC_URL (CDP Paymaster & Bundler URL, Base Sepolia)
#   optionally set VITE_AUTHOR_OWNER_PK / VITE_BUYER_OWNER_PK (pre-funded throwaway keys)
npm run dev          # http://localhost:5173
```

Reads (addresses, balances) work without a CDP URL; sending sponsored actions requires it.

To fund the buyer: copy the buyer smart-account address shown in the UI and request test
USDC at https://faucet.circle.com (Base Sepolia), then **↻ refresh balances**.

## Notes

- `VITE_*` vars are exposed to the browser by Vite — fine for a local testnet demo.
- The CDP paymaster policy must allow this contract + USDC `approve` (see
  `../harness/README.md` → "Paymaster allowlist").
- Defaults point at the deployed `AgentVouchEvm` + Circle USDC on Base Sepolia; override via
  env if you redeploy.
- `npm run typecheck` for types only; `npm run build` for a production bundle.
