---
name: base-poc-spike-v3
overview: "Minimal browser UI that walks register -> list (paid) -> buy on the deployed Base Sepolia gas-free contract, as sponsored ERC-4337/7702 UserOps so the gas-free UX can be SEEN (user signs, pays 0 gas). Two roles (author + buyer) behind one viem SmartAccount interface, with three account types: local generated key (dev fallback), Coinbase Smart Wallet passkey (demo hero), and MetaMask EOA + EIP-7702 (most authentic, spike-gated). Isolated from the Solana web app; Solana stays canonical. Decision instrument / demo only."
todos:
  - id: pick-ui-home
    content: "RESOLVED -> isolated Vite + React + viem app at contracts/base-poc/ui. web/ stays pure-Solana (web/lib/chains.ts has only a Base *label*, no EVM wiring); do NOT bolt viem/wagmi onto it."
    status: completed
  - id: pick-wallet-model
    content: "RESOLVED -> all three account types behind one viem SmartAccount interface: (1) local generated key = dev/fallback, (2) Coinbase Smart Wallet passkey = demo hero, (3) MetaMask EOA + EIP-7702 = most authentic, gated on the 7702 spike. Phantom is OUT (no AA/7702 support). Two roles: author + buyer."
    status: completed
  - id: scaffold
    content: "Scaffold the isolated Vite app; wire viem publicClient (baseSepolia) + bundler/paymaster client (CDP_RPC_URL); load AGENTVOUCH_ADDRESS + USDC_ADDRESS from env (reuse harness .env values)."
    status: completed
  - id: shared-flow
    content: "Build the 3-call flow ONCE against a viem SmartAccount, mirroring the harness: registerAgent(uri); createSkillListing(skillHash, uri, name, desc, priceUsdcMicros>0); approve(av, price)+purchaseSkill(listingId) batched. Reuse the harness listingId calc. Bond + vouch are DROPPED (verified droppable for paid listings — see Decisions)."
    status: completed
  - id: account-localkey
    content: "Account type 1 (build first): local generated key -> toCoinbaseSmartAccount, key in localStorage. Always-works foundation/fallback."
    status: completed
  - id: account-passkey
    content: "Account type 2 (hero): WebAuthn passkey via viem createWebAuthnCredential -> toCoinbaseSmartAccount with a WebAuthn owner. No extension. ~Same code as type 1, owner differs."
    status: pending
  - id: account-switcher-funding
    content: "Two roles (author + buyer), each its own smart account; account switcher in the UI. Funding panel per account: address + ETH (stays 0) + USDC balances, Circle-faucet link, and a baked-in pre-funded throwaway option so demos don't start with a faucet detour. Gate each action on sufficient USDC."
    status: completed
  - id: spike-7702-metamask
    content: "Spike (~1-2h): confirm a dapp can request a MetaMask EIP-7702 authorization signature AND drive OUR CDP bundler+paymaster on Base Sepolia (vs MetaMask forcing its own Smart Accounts toolkit). If clean, add the MetaMask/7702 connector. If not, document and keep passkey+local as the demo."
    status: pending
  - id: verify-localhost
    content: "Run on localhost; walk register -> list -> buy end-to-end for each working account type; confirm each user's ETH delta is 0; capture screenshots/receipts for docs/BASE_POC_GASFREE_REPORT.md."
    status: in_progress
isProject: false
---

# Base POC Spike v3 — Gas-Free UI Demo

## Goal

Make the gas-free UX **visible in a browser**: a user clicks Register / List / Buy,
signs, and pays **no gas** (a paymaster sponsors every UserOp). v2 proved this headlessly
(Foundry proof + a TS harness + a live Base Sepolia run); v3 is the thin UI on top so it
can be demoed and felt, not just asserted.

Scope is exactly the core marketplace journey — **register an agent, list a paid skill,
buy that skill** — split across **two roles (author + buyer)** so the purchase has a real
counterparty. No new protocol surface. **Bond, vouch, disputes/slashing stay out of scope;
Solana stays canonical.**

## What already exists (do not rebuild)

- **Deployed contract (Base Sepolia):** `AgentVouchEvm` at
  `0x5D90BB39aCaF0DF7462F552D430dc1ff1f24913E`, config initialized, against Circle USDC
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. (Redeploy with
  `contracts/base-poc/script/Deploy.s.sol` if needed.)
- **The exact call sequence + economics + `listingId` computation:**
  `contracts/base-poc/harness/src/gasless-demo.ts` — the UI should mirror its calls
  (same ABI, same `keccak256(abi.encode(author, skillIdHash))`, price in 6-dp USDC).
- **ABI fragments:** `contracts/base-poc/harness/src/abi.ts`.
- **Paymaster allowlist (functions + selectors):**
  `contracts/base-poc/harness/README.md` ("Paymaster allowlist").
- **CDP config:** single Paymaster & Bundler endpoint in `contracts/base-poc/harness/.env`
  (`CDP_RPC_URL`). Paymaster must be enabled on Base Sepolia.
- **Headless proof:** `contracts/base-poc/test/gasless/AgentVouchEvm.Gasless4337.t.sol`
  (forge 66/66) and `docs/BASE_POC_GASFREE_REPORT.md` (live numbers).

## Decisions (locked)

### 1. UI home — isolated Vite + React + viem app at `contracts/base-poc/ui`

Keeps the Base POC away from the Solana workspace, per the repo rule that the POC "must
never pull in or disturb the Solana workspaces." `web/` is pure `@solana/*`
(`web/lib/chains.ts:8` has only a Base *label* string, no EVM wiring) — do NOT bolt
EVM/wagmi/viem onto it. Vite (not Next) because this is a client-only app talking to a
bundler/paymaster: no SSR, no hydration edge cases around wallet/passkey.

### 2. Flow — 3 calls, not the harness's 6 (bond + vouch verified droppable)

The harness runs register -> bond -> vouch -> list -> purchase -> claim -> withdraw to
demo the full rev-split. The user-facing journey needs only three calls, and the contract
confirms the other steps are safe to omit **for a paid listing**:

- **Paid listings need no bond.** The bond floor only gates *free* listings
  (`AgentVouchEvm.sol:274-282`). A listing with `priceUsdcMicros > 0` (>= the min paid
  price) lists with no prior `depositAuthorBond`.
- **Purchase needs no vouch.** With no active vouch stake, the author simply takes 100% of
  the price (`AgentVouchEvm.sol:415-427`). `vouch` / `claimVoucherRevenue` are demo-only.
- **Self-purchase is allowed** (only `DuplicatePurchase` is blocked — `AgentVouchEvm.sol:411`),
  but we use two accounts anyway so "buying" has a real, non-confusing counterparty.

So: **`registerAgent(uri)` -> `createSkillListing(skillHash, uri, name, desc, price)` ->
`approve(av, price)` + `purchaseSkill(listingId)`** (last two batched in one UserOp).
(Voucher rev-split is an easy later add-on if we want to show the 60/40 split visually.)

### 3. Wallet/account model — all three, behind one viem `SmartAccount` interface

The three calls are identical across account types; only account creation/connect differs,
so a `SmartAccount` abstraction lets one set of buttons serve all three.

- **(1) Local generated key -> Coinbase Smart Account** (key in localStorage). Dev/fallback.
  Exactly the harness. Build first so there's always a working demo.
- **(2) Coinbase Smart Wallet passkey** — WebAuthn owner via viem `createWebAuthnCredential`,
  same `toCoinbaseSmartAccount`. No browser extension. ~20 lines different from (1). Demo hero.
- **(3) MetaMask EOA + EIP-7702** — most authentic ("my real wallet, $0 gas"). Spike-gated
  (see `spike-7702-metamask`). The only path with real integration risk.
- **Phantom is OUT** — it has no account-abstraction / 7702 support, so its EOA can't be
  sponsored. (Could connect as a plain gas-paying EOA only as a non-gasless comparison.)

#### Wallet / gas-free facts (verified 2026-06, supersedes the old "EOAs always pay gas" claim)

Pre-Pectra it was true that an EOA pays its own gas under 4337. EIP-7702 (Pectra, May 2025)
changed that: an EOA can delegate to a 4337-compatible implementation and be sponsored.

- **Base Sepolia has 7702 live** (OP-Stack Isthmus hardfork, Sepolia 2025-04-17) and
  supports both 4337 and 7702 gas-sponsored transactions.
- **The CDP paymaster we already use sponsors 7702-upgraded EOAs** (Base + Base Sepolia
  only — which is all we need).
- **MetaMask supports 7702** (ERC-4337-compatible, works with viem). **Phantom does not.**
- Open question the spike answers: can our dapp request the 7702 authorization signature and
  drive *our* CDP bundler, or does MetaMask steer into its own Smart Accounts toolkit?

Sources: Optimism Isthmus upgrade notice; CDP Paymaster docs (gas-sponsorship overview);
MetaMask 7702 quickstart; Phantom on Walletbeat (no AA); viem/Pimlico 7702 demo.

## Build outline

1. **Scaffold** the isolated Vite app + env (`CDP_RPC_URL`, `AGENTVOUCH_ADDRESS`,
   `USDC_ADDRESS` — reuse the harness `.env` values).
2. **Shared flow** (`shared-flow`): the 3 calls against a viem `SmartAccount`, mirroring the
   harness (ABI, listingId calc, 6-dp USDC). Each step shows the userOp hash,
   `actualGasCost` ("paid by paymaster"), "you paid: 0", and a `sepolia.basescan.org` link.
3. **Account type (1)** local key, then **(2)** passkey — same flow, different owner.
4. **Two-role switcher + funding panel**: author + buyer, each its own smart account; show
   address + ETH (stays 0) + USDC; Circle-faucet link + a baked-in pre-funded throwaway
   option; gate actions until USDC >= the step's spend.
5. **7702 spike** -> add the MetaMask connector if the signing path is clean.
6. **Verify** on localhost; capture screenshots for `docs/BASE_POC_GASFREE_REPORT.md`.

## Gotchas (learned in v2 — don't relearn)

- Root `.gitignore` has `.env*`, which silently swallows any `.env.example`. Add a
  `!.env.example` negation in the app's local `.gitignore` to keep the template tracked.
- The repo `test` CI job runs `prettier --check` over **all** `*.ts` at default print
  width (80). Committed source must be prettier-clean or CI fails (vendored `lib/` and
  `node_modules` are fine — CI doesn't install them). Consider adding the POC UI dir to
  `.prettierignore` if you want it formatted on its own terms.
- Smart accounts hold **zero ETH** by design — fund only USDC. Fund a little above each
  step's spend for a buffer.
- "Gas-free" != "money-free": the buyer still needs testnet USDC, so the only friction left
  is the Circle faucet. Bake a pre-funded throwaway account into `.env` for smooth demos.
- CDP paymaster must be toggled to **Base Sepolia** and enabled; empty allowlist =
  sponsor-all (testnet only). Lock down to the documented function allowlist for anything
  beyond a throwaway demo.
- `getUserOpHash`/account address are chain-specific; keep everything on Base Sepolia
  (`eip155:84532`).
- 7702-specific: the EOA's delegation (and thus sponsorship) is chain-scoped; confirm the
  authorization targets Base Sepolia and a 4337-compatible implementation.

## Out of scope

Bond/vouch flows, voucher rev-split (easy later add-on), disputes/slashing/refunds, the A2
governance redesign, switching any marketplace default to Base, production wallet
onboarding. Solana remains canonical.
