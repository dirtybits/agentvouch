---
name: base-poc-spike-v3
overview: "Build a minimal browser UI that walks register -> list -> purchase on the deployed Base gas-free contract, as sponsored ERC-4337 UserOps via a Coinbase Smart Wallet + CDP paymaster, so the gas-free UX can be SEEN (user signs, pays no gas). Decision instrument / demo only; isolated from the Solana web app; Solana stays canonical."
todos:
  - id: pick-ui-home
    content: Decide UI home — isolated app under contracts/base-poc/ui (recommended) vs a feature-flagged Base route inside web/ (heavier, risks entangling the pure-Solana stack)
    status: pending
  - id: pick-wallet-model
    content: Decide wallet/account model — Coinbase Smart Wallet passkey (best UX fidelity) vs in-browser generated-key smart account a la the harness (fastest demo). Phantom/MetaMask EOAs are NOT gas-free in 4337, so they are out for the gas-free claim
    status: pending
  - id: scaffold
    content: Scaffold the isolated UI; wire viem publicClient (baseSepolia) + bundler/paymaster client (CDP_RPC_URL) + a smart account; load AGENTVOUCH_ADDRESS + USDC from env
    status: pending
  - id: build-flow
    content: Build the three flows as sponsored UserOps mirroring harness/src/gasless-demo.ts — register, createSkillListing, approve+purchaseSkill — each showing the userOp hash, "gas paid by paymaster / you paid 0", and a Basescan link
    status: pending
  - id: funding-ux
    content: Show the smart-account address + ETH/USDC balances and a fund-with-test-USDC helper (Circle faucet); gate actions on sufficient USDC
    status: pending
  - id: verify-localhost
    content: Run on localhost, walk register -> list -> purchase end-to-end, confirm the user's ETH delta is 0, and capture screenshots/receipts for the report
    status: pending
isProject: false
---

# Base POC Spike v3 — Gas-Free UI Demo

## Goal

Make the gas-free UX **visible in a browser**: a user clicks Register / List / Purchase,
signs, and pays **no gas** (a paymaster sponsors every UserOp). v2 proved this headlessly
(Foundry proof + a TS harness + a live Base Sepolia run); v3 is the thin UI on top so it
can be demoed and felt, not just asserted.

Scope is exactly the v2 flow — register an agent, list a skill, purchase a skill (plus
optionally a voucher to show the rev-split). No new protocol surface. **Disputes/slashing
stay out of scope; Solana stays canonical.**

## What already exists (do not rebuild)

- **Deployed contract (Base Sepolia):** `AgentVouchEvm` at
  `0x5D90BB39aCaF0DF7462F552D430dc1ff1f24913E`, config initialized, against Circle USDC
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. (Redeploy with
  `contracts/base-poc/script/Deploy.s.sol` if needed.)
- **The exact call sequence + economics + `listingId` computation:**
  `contracts/base-poc/harness/src/gasless-demo.ts` — the UI should mirror it 1:1
  (same ABI, same `keccak256(abi.encode(author, skillIdHash))`, bond/stake/price in 6-dp
  USDC, 60/40 author/voucher split).
- **ABI fragments:** `contracts/base-poc/harness/src/abi.ts`.
- **Paymaster allowlist (functions + selectors):**
  `contracts/base-poc/harness/README.md` ("Paymaster allowlist").
- **CDP config:** single Paymaster & Bundler endpoint in `contracts/base-poc/harness/.env`
  (`CDP_RPC_URL`). Paymaster must be enabled on Base Sepolia.
- **Headless proof:** `contracts/base-poc/test/gasless/AgentVouchEvm.Gasless4337.t.sol`
  (forge 66/66) and `docs/BASE_POC_GASFREE_REPORT.md` (live numbers).

## Decide these two things first (they shape everything)

1. **UI home.** Recommend an **isolated app** (e.g. `contracts/base-poc/ui`, a tiny
   Next.js or Vite + viem app) — it keeps the Base POC away from the Solana workspace, per
   the repo rule that the POC "must never pull in or disturb the Solana workspaces."
   **Do NOT** bolt EVM/wagmi/viem onto `web/`: that app is pure `@solana/*`
   (`web/lib/chains.ts` only has a Base *label* string, no EVM wiring) and entangling it is
   risk with no demo upside.
2. **Wallet/account model.** The gas-free claim requires a **smart account**, not an EOA:
   - **Coinbase Smart Wallet (passkey)** — best fidelity ("this is what a user sees");
     connect via Coinbase Wallet SDK, drive with viem `account-abstraction`.
   - **In-browser generated-key smart account** (what the harness does:
     `toCoinbaseSmartAccount({ owners: [localKey] })`, key in localStorage) — fastest path
     to a working demo, no external wallet install.
   - **Phantom / MetaMask are out for gas-free:** their EOAs pay their own gas under 4337.
     (Phantom supports Base EVM now, but as an EOA — still pays gas.) Fine only as a
     non-gasless comparison.

## Build outline

1. Scaffold the isolated app + env (`CDP_RPC_URL`, `AGENTVOUCH_ADDRESS`, `USDC_ADDRESS` —
   reuse the harness `.env` values).
2. Connect/create the smart account; render its address + ETH (stays 0) and USDC balances.
3. Three buttons/forms, each a sponsored `sendUserOperation` mirroring the harness:
   - **Register:** `registerAgent(metadataUri)`.
   - **List:** `createSkillListing(skillIdHash, uri, name, description, priceUsdcMicros)`.
   - **Purchase:** batch `approve(av, price)` + `purchaseSkill(listingId)`.
   Show each userOp hash, `actualGasCost` ("paid by paymaster"), "you paid: 0", and a
   `sepolia.basescan.org` link.
4. Funding helper: print the smart-account address + a Circle-faucet link; block actions
   until USDC >= the amount the step spends.
5. (Optional) a second "voucher" account to show the rev-split visually, and read-back of
   listing/purchase/profile state.
6. Verify on localhost; capture screenshots for `docs/BASE_POC_GASFREE_REPORT.md`.

## Gotchas (learned in v2 — don't relearn)

- Root `.gitignore` has `.env*`, which silently swallows any `.env.example`. Add a
  `!.env.example` negation in the app's local `.gitignore` to keep the template tracked.
- The repo `test` CI job runs `prettier --check` over **all** `*.ts` at default print
  width (80). Committed source must be prettier-clean or CI fails (vendored `lib/` and
  `node_modules` are fine — CI doesn't install them). Consider adding the POC UI dir to
  `.prettierignore` if you want it formatted on its own terms.
- Smart accounts hold **zero ETH** by design — fund only USDC. The demo funds exactly the
  amount each step spends; add a buffer for real use.
- CDP paymaster must be toggled to **Base Sepolia** and enabled; empty allowlist =
  sponsor-all (testnet only). Lock down to the documented function allowlist for anything
  beyond a throwaway demo.
- `getUserOpHash`/account address are chain-specific; keep everything on Base Sepolia
  (`eip155:84532`).

## Out of scope

Disputes/slashing/refunds, the A2 governance redesign, switching any marketplace default
to Base, production wallet onboarding. Solana remains canonical.
