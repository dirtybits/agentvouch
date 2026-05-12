# Phase 1 — Friction Removal for Buyers and Sellers

Living scope doc for the "remove the wallet-exists wall" effort. Phase 2 (Stripe + custodial fiat) is out of scope here; this phase stays on Solana / USDC rails and is fully testable on devnet.

## Goal

Make a first-time buyer go from `agentvouch.xyz` → "Sign in with Google" → "Buy this skill" in under a minute, with no wallet extension, no seed phrase, no out-of-band funding step. Same shape for sellers: "Sign in with Google" → "Publish this skill" with the platform absorbing the cold-wallet rent cost on devnet.

Devnet first; anything that needs to flip to mainnet later (faucet vs. real funding, sponsor liability) lives in a single "switch to mainnet" checklist at the bottom of this doc.

## What already ships

- `@phantom/react-sdk` PhantomProvider in `web/components/WalletContextProvider.tsx`, configured with `providers: ["google", "apple"]` and `addressTypes: ["Solana"]`, gated on `NEXT_PUBLIC_PHANTOM_APP_ID`.
- `ClientWalletButton` shows a "Sign in with" social section (Phantom embedded `<ConnectButton />`) when Phantom is configured, in parallel with extension wallets via `@solana/react-hooks` `autoDiscover()`.
- x402 USDC flow for repo-backed paid skills (browser + agent paths) — already documented in `web/public/skill.md` and `/docs#paid-skill-download`.
- AGENTS.md note 26 has guidance: Phantom embedded / send-only wallets must use direct `signAndSendTransaction` checkout rather than the split-signature sponsored x402 flow.

## Gap inventory (verify before scoping each)

| # | Gap | Verification step | Likely effort |
|---|-----|-------------------|---------------|
| 1 | Is `NEXT_PUBLIC_PHANTOM_APP_ID` provisioned in local / Vercel preview / Vercel production? | `vercel env ls`, `.env.local` check | 0.5 day if missing |
| 2 | Does Phantom embedded actually sign and submit `purchase_skill` on devnet end-to-end? | Manual smoke: Google sign-in → buy a 1 USDC skill | unknown; spike first |
| 3 | Does the existing browser x402 split-signature path route correctly when the connected wallet is a Phantom embedded (send-only) wallet? | Trace `web/lib/x402*.ts` / wallet adapter for capability detection | 1–2 days if it auto-falls-through, 3–5 if branching is needed |
| 4 | Is there a faucet UI for devnet SOL + devnet USDC for first-time signed-in users? | Search `web/app` / `web/components` | none today; net new ~1–2 days |
| 5 | Author registration cost (SOL rent for `AgentProfile` PDA): can the platform sponsor it on devnet for Web2 sign-ups? | Read `register_agent` rent + check for any existing sponsor wrapper | 1–2 days |
| 6 | First-purchase USDC ATA creation: pre-create or sponsor? | Read `purchase_skill` + ATA setup | 1 day |
| 7 | What does the "wallet has insufficient SOL/USDC" preflight currently surface for a Web2-signed-in user? | Review `web/lib/purchasePreflight.ts` UX paths | 0.5 day |

## Phase 1 scope (proposed)

Listed in order of leverage. Items below the line are "nice to have, doesn't block the friction story."

### Must-haves

1. **Verify the embedded wallet end-to-end on devnet.** Spike: deploy a preview with `NEXT_PUBLIC_PHANTOM_APP_ID` set, sign in with Google, attempt a `purchase_skill` on a free-floor listing. Report observed flow + failures. *No code change until this lands.*
2. **Devnet onboarding faucet (server-side).** New server route `/api/dev/onboard` that, given a Solana address and a session-bound rate limit, transfers a small amount of devnet SOL (rent budget, e.g. 0.05 SOL) + devnet USDC (e.g. 5 USDC) from a platform sponsor keypair. UI: a one-click "Fund my devnet wallet" affordance shown only on first sign-in until balance > threshold. Gated to `NODE_ENV !== "production"` until mainnet onboarding policy exists.
3. **Embedded-wallet aware purchase preflight.** Detect Phantom embedded / send-only capability and route to `signAndSendTransaction` instead of the split-signature x402 path. Surface clear "what your wallet supports" copy if there's a fork.
4. **Author registration sponsor for devnet sign-ups.** If a Web2 user with `< minimum SOL` clicks "Publish," the platform fronts the rent for `register_agent` via a single sponsored transaction on devnet. Behind the same `NODE_ENV` gate.
5. **First-purchase USDC ATA pre-creation.** When the buyer's USDC ATA doesn't exist, fold the `createAssociatedTokenAccountInstruction` into the purchase transaction (already partly handled by purchase preflight; needs an embedded-wallet path).

### Nice-to-haves (can defer)

6. Inline "what is a skill / what is a wallet" copy for the very first sign-in. UX polish, not a friction blocker.
7. Wallet-recovery copy: "Your Phantom embedded wallet is recoverable via your Google account. You can also export the seed phrase." Important for trust but not friction.

## Out of scope (explicitly Phase 2 or later)

- Stripe + Stripe Link credit-card buyers.
- Stripe Connect / MPP marketplace operator integration.
- Custodial wallet option ("don't think about crypto at all").
- KYC / KYB / 1099-K / sanctions screening.
- Mainnet sponsor liability + faucet replacement.

## Testability

- **Devnet USDC**: existing devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Sponsor keypair can transfer from a pre-funded balance, or the route can call Circle's devnet USDC faucet on behalf of the user.
- **Devnet SOL**: `requestAirdrop` is rate-limited and unreliable. The sponsor keypair pre-funded from `solana airdrop` is more reliable for our purposes.
- **Paper USD / Stripe test mode**: not used in Phase 1. Phase 2 will use Stripe test mode keys for end-to-end credit-card simulation.

## Rough sizing

If the embedded wallet end-to-end spike (item 1) goes cleanly, the rest of the must-haves are ~5–7 working days for one engineer. If item 3 (x402 capability detection) is messy, add 3–5 days. Net: **1.5–2 weeks** for a single engineer to land the full friction-removal must-haves.

## Switch-to-mainnet checklist (Phase 1+)

When/if these mechanisms move to mainnet:

- Replace devnet faucet with either (a) a real onramp (Phase 2) or (b) a "bring your own funded wallet" wall on mainnet.
- Author registration sponsor liability: on mainnet, paying for a stranger's PDA rent is a sybil-attack vector. Either gate by reputation / external identity, or make the seller pay their own rent.
- Embedded wallet recovery flow + ToS update so users know what custody Phantom holds.
- Sanctions screening on sponsor-routed transactions (lightweight; on devnet not needed).

## Open decisions

- **Sponsor keypair management.** Single hot keypair on the API server vs. dedicated funding bot. For devnet, hot keypair behind env var is fine. Track for mainnet.
- **Rate limiting on `/api/dev/onboard`.** Per-IP, per-Phantom-account, or per-Solana-address? Recommend per-Solana-address with a daily cap, since IP is trivially bypassed.
- **Detection of "embedded vs. extension" wallet.** Phantom SDK exposes this via the `usePhantom()` hook (`isConnected` + embedded-specific account types); confirm during the spike.

## Tracking

This branch (`feat/phase-1-friction-removal`) is the scope-and-plan vehicle. Each must-have lands as its own commit directly to `main` after this doc is reviewed. The spike (item 1) gates the rest of the plan — do not start items 2–5 until the spike confirms the embedded path actually works end-to-end on devnet.

## Spike findings — 2026-05-11

**Headline:** Phantom embedded login is wired for connect/disconnect UX only. **None of the on-chain flows (purchase, publish, vouch, dispute) can be initiated by an embedded-wallet user.** This is the load-bearing gap. AGENTS.md note 26's "embedded wallets are send-only" claim is **outdated** — the current `@phantom/react-sdk` v1.0.5 exposes the full `ISolanaChain` signing surface including `signTransaction`. The gap is integration, not capability.

### Evidence

1. **The Phantom SDK does expose full signing.** `node_modules/@phantom/chain-interfaces/dist/interfaces/ISolanaChain.d.ts` defines `signMessage`, `signTransaction`, `signAndSendTransaction`, `signAllTransactions`, `signAndSendAllTransactions`, and `switchNetwork`. The embedded wallet is *not* send-only.
2. **Two parallel, unconnected wallet states.** `web/components/ClientWalletButton.tsx` branches on:
   - Extension wallet: `const { wallet, status } = useWalletConnection()` from `@solana/react-hooks` (Wallet Standard).
   - Phantom embedded: `const phantom = usePhantom()`, `useAccounts()`, `useDisconnect()` from `@phantom/react-sdk`.
   These two states never merge. The connect/disconnect UX handles both, but downstream consumers don't.
3. **All downstream consumers read only the Wallet Standard state.** `web/app/skills/[id]/page.tsx:264` does `const { wallet, status } = useWalletConnection()` and feeds `wallet` to `walletSupportsBrowserX402(wallet)` and `createWalletTransactionSigner(wallet)` from `@solana/client`. A user signed in via Phantom embedded leaves `useWalletConnection().wallet === null`, so the purchase button thinks no wallet is connected.
4. **`createWalletTransactionSigner` requires a Wallet Standard wallet.** The signer factory in `web/lib/browserX402.ts:69` expects the Wallet Standard shape. The Phantom embedded `ISolanaChain` is a different (richer) shape.

### Side findings

- **`NEXT_PUBLIC_PHANTOM_APP_ID` has a literal trailing `\n` in `web/.env.local`** (`NEXT_PUBLIC_PHANTOM_APP_ID="aa342c67-2cc8-45e9-a11d-ce80679db80d\n"`). Because the value is double-quoted, dotenv interprets `\n` as a real newline character and the SDK will see an app id with a trailing newline. Likely causes Phantom API rejection or silent failures. Trivial fix: drop the trailing `\n`. This may explain any "Phantom login doesn't work" anecdotal reports during dev.
- The Phantom SDK exposes `useSolana()` (line 103 of `@phantom/react-sdk/dist/index.d.ts`) which returns `{ solana: ISolanaChain, isAvailable: boolean }`. This is the canonical entry point for signing through the embedded wallet — none of the current code uses it.
- The Phantom embedded `signAndSendTransaction` accepts a `presignTransaction` callback for sponsored-fee flows (relevant for our devnet onboarding sponsor pattern).

### Implications for Phase 1 must-haves

This finding reshapes the must-have list materially:

- **New item 0 (gates everything else): unify the wallet abstraction.** Either (a) wrap Phantom embedded `ISolanaChain` in a Wallet Standard adapter so existing flows pick it up unchanged, or (b) introduce a project-wide signer abstraction (a `UnifiedWalletSigner` interface) and route both extension and embedded wallets through it. (a) is one well-bounded library to write or borrow; (b) is invasive but cleaner long-term. Recommend (a) for Phase 1 — minimum diff, no downstream churn.
- **Item 3 (x402 routing for embedded wallets) collapses into item 0.** Once the embedded wallet is visible to `useWalletConnection()`, the existing x402 split-signature path Just Works because `ISolanaChain.signTransaction` returns a partially signed tx, exactly what the sponsored x402 scheme needs.
- **Item 2 (devnet faucet) is unblocked** but cosmetically gated on item 0 — a faucet that funds a wallet the rest of the app can't see is not useful.
- **Items 4 and 5 (registration sponsor, USDC ATA pre-creation) are independent** of item 0 but practically meaningless until embedded users can submit *any* transaction.

### Recommended order, revised

1. **0a.** Fix the trailing `\n` in `NEXT_PUBLIC_PHANTOM_APP_ID` (5 min).
2. **0b.** Wallet abstraction unification: Wallet Standard adapter wrapping the Phantom `ISolanaChain`, registered into the `@solana/client` `walletConnectors` pipeline alongside `autoDiscover()`. Manual smoke: Google sign-in, then verify `useWalletConnection().wallet?.account.address` is populated and signs a no-op message. (2–4 days; this is the real spike work.)
3. **1 (was item 2): devnet faucet** for first-time signed-in users. (1–2 days.)
4. **2 (was item 3, now mostly free):** sanity-check that x402 + `purchase_skill` actually round-trips through the unified embedded wallet on devnet. (0.5 day if 0b is clean.)
5. **3 (was item 5): USDC ATA pre-creation** in purchase preflight when missing. (1 day.)
6. **4 (was item 4): author-registration rent sponsor** for fresh Web2 sign-ups on devnet. (1–2 days.)

Net effect on sizing: previous estimate of 1.5–2 weeks stands; the work just shifted from "verify and patch" to "actually wire the embedded wallet into the app surface." That's a clearer scope.

### What still requires manual verification

I can't actually sign in with Google myself. Once item 0a (env fix) lands, you should:

1. Run the local dev server with the fixed `NEXT_PUBLIC_PHANTOM_APP_ID`.
2. Open `http://localhost:3000`, click **Connect** → **Sign in with…** → choose Google.
3. Verify the embedded wallet UI returns a Solana address.
4. Open browser devtools console and confirm no Phantom SDK errors.

If that surfaces a problem (e.g., the app id is invalid, redirect URI is misconfigured, or the Phantom dashboard isn't set up for this origin), it's a config issue that doesn't require code changes — just a Phantom dashboard tweak. Worth doing this verification *before* item 0b so we don't bake on top of broken connect UX.
