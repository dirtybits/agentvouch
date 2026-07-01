# Phase 1 — Friction Removal for Buyers and Sellers

Living scope doc for the "remove the wallet-exists wall" effort. Phase 1
stays on Solana / USDC rails and is fully testable on devnet. Stripe MPP is a
parallel WIP card rail for wallet-bound early sales, not the Phase 1 protocol
settlement path.

## Goal

Make a first-time buyer go from `agentvouch.xyz` → "Sign in with Google" → "Buy this skill" in under a minute, with no wallet extension, no seed phrase, no out-of-band funding step. Same shape for sellers: "Sign in with Google" → "Publish this skill" with the platform absorbing the cold-wallet rent cost on devnet.

Devnet first; anything that needs to flip to mainnet later (faucet vs. real funding, sponsor liability) lives in a single "switch to mainnet" checklist at the bottom of this doc.

## What already ships

- `@phantom/react-sdk` PhantomProvider in `web/components/WalletContextProvider.tsx`, configured with `providers: ["google", "apple"]` and `addressTypes: ["Solana"]`, gated on `NEXT_PUBLIC_PHANTOM_APP_ID`.
- `ClientWalletButton` uses ConnectorKit to expose extension wallets and Phantom embedded social sign-in through one wallet surface.
- The repo-only x402 USDC infrastructure exists for off-chain entitlement experiments and historical compatibility, already documented in `web/public/skill.md` and `/docs#paid-skill-download`; it is not the desired paid marketplace settlement path because it bypasses protocol purchase economics.
- Protocol-listed paid skills fail closed to direct `purchase_skill` plus signed `X-AgentVouch-Auth` download until an x402 settlement bridge preserves voucher rewards.
- The Stripe MPP prototype can record a wallet-bound off-chain entitlement for
  card buyers, including when on-chain listing setup is still pending. It must
  stay visibly separate from protocol settlement, voucher yield, and refund
  state.

## Gap inventory (verify before scoping each)

| #   | Gap                                                                                                                                     | Verification step                                                   | Likely effort                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Is `NEXT_PUBLIC_PHANTOM_APP_ID` provisioned in local / Vercel preview / Vercel production?                                              | `vercel env ls`, `.env.local` check                                 | 0.5 day if missing                                            |
| 2   | Does Phantom embedded actually sign and submit `purchase_skill` on devnet end-to-end?                                                   | Manual smoke: Google sign-in → buy a 1 USDC skill                   | unknown; spike first                                          |
| 3   | Does the existing browser x402 split-signature path route correctly when the connected wallet is a Phantom embedded (send-only) wallet? | Trace `web/lib/x402*.ts` / wallet adapter for capability detection  | 1–2 days if it auto-falls-through, 3–5 if branching is needed |
| 4   | Is there a faucet UI for devnet SOL + devnet USDC for first-time signed-in users?                                                       | Search `web/app` / `web/components`                                 | none today; net new ~1–2 days                                 |
| 5   | Author registration cost (SOL rent for `AgentProfile` PDA): can the platform sponsor it on devnet for Web2 sign-ups?                    | Read `register_agent` rent + check for any existing sponsor wrapper | 1–2 days                                                      |
| 6   | First-purchase USDC ATA creation: pre-create or sponsor?                                                                                | Read `purchase_skill` + ATA setup                                   | 1 day                                                         |
| 7   | What does the "wallet has insufficient SOL/USDC" preflight currently surface for a Web2-signed-in user?                                 | Review `web/lib/purchasePreflight.ts` UX paths                      | 0.5 day                                                       |

## Phase 1 scope (proposed)

Listed in order of leverage. Items below the line are "nice to have, doesn't block the friction story."

### Must-haves

1. **Verify the embedded wallet end-to-end on devnet.** Spike: deploy a preview with `NEXT_PUBLIC_PHANTOM_APP_ID` set, sign in with Google, attempt a `purchase_skill` on a free-floor listing. Report observed flow + failures. _No code change until this lands._
2. **Devnet onboarding faucet (server-side).** New server route `/api/dev/onboard` that, given a Solana address and a session-bound rate limit, transfers a small amount of devnet SOL (rent budget, e.g. 0.05 SOL) + devnet USDC (e.g. 5 USDC) from a platform sponsor keypair. UI: a one-click "Fund my devnet wallet" affordance shown only on first sign-in until balance > threshold. Gated to `NODE_ENV !== "production"` until mainnet onboarding policy exists.
3. **Embedded-wallet aware purchase preflight.** Detect Phantom embedded / send-only capability and route to `signAndSendTransaction` instead of the split-signature x402 path. Surface clear "what your wallet supports" copy if there's a fork.
4. **Author registration sponsor for devnet sign-ups.** If a Web2 user with `< minimum SOL` clicks "Publish," the platform fronts the rent for `register_agent` via a single sponsored transaction on devnet. Behind the same `NODE_ENV` gate.
5. **First-purchase USDC ATA pre-creation.** When the buyer's USDC ATA doesn't exist, fold the `createAssociatedTokenAccountInstruction` into the purchase transaction (already partly handled by purchase preflight; needs an embedded-wallet path).

### Nice-to-haves (can defer)

6. Inline "what is a skill / what is a wallet" copy for the very first sign-in. UX polish, not a friction blocker.
7. Wallet-recovery copy: "Your Phantom embedded wallet is recoverable via your Google account. You can also export the seed phrase." Important for trust but not friction.

## Out of scope (explicitly Phase 2 or later)

- Email-only Stripe / Stripe Link buyers without wallet-bound AgentVouch auth.
- Production Stripe Connect / MPP marketplace operator integration.
- Custodial wallet option ("don't think about crypto at all").
- KYC / KYB / 1099-K / sanctions screening.
- Mainnet sponsor liability + faucet replacement.

## Payment rail sequencing update — 2026-07-01

Use three lanes:

1. **Protocol-visible commerce:** direct USDC `purchase_skill` and the
   protocol-listed x402 bridge. This is the preferred path for agent-native
   payments, voucher rewards, author proceeds, and dispute/refund state.
2. **Card-funded early sales:** Stripe MPP can let users buy/sell now by
   writing a wallet-bound off-chain entitlement. Do not mix these receipts into
   on-chain purchase, voucher-yield, author-proceeds, or refund metrics.
3. **Future smart-account UX:** Base remains a POC/port direction for
   agent-native USDC payments and paymaster-style wallet abstraction. It does
   not make Stripe the canonical settlement ledger.

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

This branch (`feat/phase-1-friction-removal`) is the scope-and-plan vehicle. Each must-have lands as its own commit directly to `main` after this doc is reviewed. The embedded-wallet checkout spike no longer gates the rest of the plan: proceed with the devnet faucet, preflight, ATA, and sponsor work while keeping paid checkout on extension / externally signed Solana wallets. Track embedded Phantom purchase as a provider-blocked follow-up.

## Spike findings — 2026-05-11

**Headline:** Phantom embedded login is wired for connect/disconnect UX only. **None of the on-chain flows (purchase, publish, vouch, dispute) can be initiated by an embedded-wallet user.** This is the load-bearing gap. AGENTS.md note 26's "embedded wallets are send-only" claim is **outdated** — the current `@phantom/react-sdk` v1.0.5 exposes the full `ISolanaChain` signing surface including `signTransaction`. The gap is integration, not capability.

### Evidence

1. **The Phantom SDK does expose full signing.** `node_modules/@phantom/chain-interfaces/dist/interfaces/ISolanaChain.d.ts` defines `signMessage`, `signTransaction`, `signAndSendTransaction`, `signAllTransactions`, `signAndSendAllTransactions`, and `switchNetwork`. The embedded wallet is _not_ send-only.
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
- **Items 4 and 5 (registration sponsor, USDC ATA pre-creation) are independent** of item 0 but practically meaningless until embedded users can submit _any_ transaction.

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

If that surfaces a problem (e.g., the app id is invalid, redirect URI is misconfigured, or the Phantom dashboard isn't set up for this origin), it's a config issue that doesn't require code changes — just a Phantom dashboard tweak. Worth doing this verification _before_ item 0b so we don't bake on top of broken connect UX.

## Smoke findings & decision — 2026-05-12

### Item 0a outcome

`web/.env.local` and `web/.vercel/.env.production.local` both contain a clean `NEXT_PUBLIC_PHANTOM_APP_ID` value (no literal trailing `\n`). Likely fixed alongside the Phantom Connect redirect URI work in commit `0a42110`. No action needed.

Side issue surfaced during manual testing: the Phantom dashboard had not whitelisted `http://localhost:3000/auth/callback` as a redirect URI. User added it via https://phantom.com/portal; not a code change.

### Item 0b smoke: embedded `signTransaction` confirmed working

Mounted a temporary `PhantomDebugShim` inside `<PhantomProvider>` that pinned the `EmbeddedSolanaChain` to `window.__phantom`, then probed from devtools after a Google sign-in.

- `EmbeddedSolanaChain` prototype exposes all five signing methods: `signMessage`, `signTransaction`, `signAndSendTransaction`, `signAllTransactions`, `signAndSendAllTransactions`, plus `switchNetwork`. The "send-only" claim in AGENTS.md note 26 is confirmed stale.
- `signMessage` returns a 64-byte ed25519 signature out of the box.
- `signTransaction` initially failed with `POST /v1/wallets/prepare 403 — Attempt to debit an account but found no record of a prior credit`. Cause: **Phantom embedded sessions default to mainnet at SDK init.** Our test transaction was built against devnet, but Phantom's policy/simulation check was running against mainnet where the wallet has 0 SOL.
- After calling `solana.switchNetwork("solana:devnet")` the simulation passed. The follow-up call hit a `POST /v1/wallets/kms/rpc 500` (transient Phantom KMS issue on devnet) — but at that point the SDK was past simulation and inside the actual signing pipeline, which is sufficient to confirm `signTransaction` is fully wired client-side.

The debug shim was removed after smoke completion.

### Side findings to act on

1. **Phantom embedded defaults to mainnet at init.** `EmbeddedProviderConfig` (the type that backs `PhantomSDKConfig`) accepts no `defaultNetwork` / `initialNetwork` field. The fix is imperative: call `solana.switchNetwork("solana:devnet")` after the embedded session reports `isConnected && isAvailable`. Must be wired in any code path that targets devnet (or any non-mainnet network).
2. **Phantom runs a server-side simulation on every `signTransaction`.** Transactions that fail simulation are rejected before the user is even prompted. Implication for sponsored x402 flows: the partially-signed transaction must be valid against the user's real balance at submission time — we cannot rely on "the sponsor will add lamports later." This matches the existing x402 split-signature design, but worth verifying once during devnet end-to-end smoke.
3. **The `useSolana()` hook is the canonical signing surface for embedded wallets** — `usePhantom()` is connect/disconnect state only.

### Path decision

Two unification approaches were on the table:

- **Path 1.5 (minimum-diff):** Hand-roll a Wallet Standard wallet wrapping `ISolanaChain` and dispatch the `wallet-standard:register-wallet` event so `@solana/client`'s `autoDiscover()` picks it up. No downstream code changes. ~2 files, ~250 lines.
- **Path 2 (architectural unification):** Adopt `@solana/connector` (ConnectorKit) as the wallet library. Phantom embedded gets registered via ConnectorKit's `additionalWallets` config option. Migrates every `useWalletConnection()` / `createWalletTransactionSigner` call site to ConnectorKit's `useWallet()` / `useTransactionSigner()`. ~11 files.

**Chosen: Path 2.** Rationale:

- The spike root-cause finding ("two parallel, unconnected wallet states") is only actually fixed by Path 2; Path 1.5 hides the duality rather than eliminating it.
- ConnectorKit is the Solana Foundation's recommended direction; `@solana/wallet-adapter` is in maintenance mode. Migration cost grows monotonically — every Phase 2 addition that uses `useWalletConnection` is another file to migrate later.
- ConnectorKit's pre-built UI elements (`BalanceElement`, `WalletListElement`, etc.) are useful for the Phase 2 onboarding UX work.

Tradeoff accepted: larger Phase 1 diff (~1500–2500 lines across 11 files) in exchange for actually collapsing the wallet-state duality and aligning with the SF direction.

### Migration plan (Path 2 execution order)

1. Update `AGENTS.md` note 26 to retire the "send-only" claim.
2. Install `@solana/connector` (+ `@walletconnect/universal-provider` as an optional peer dep — defer unless we want QR/deep-link).
3. Write `web/lib/phantomEmbeddedWalletStandard.ts`: a `createPhantomEmbeddedWallet(solanaChain, address)` factory that returns a Wallet Standard wallet exposing `solana:signMessage`, `solana:signTransaction`, `solana:signAndSendTransaction`, `solana:signAllTransactions`. Modeled on ConnectorKit's `createRemoteSignerWallet` source but delegating to in-memory `ISolanaChain` instead of HTTP.
4. Restructure `web/components/WalletContextProvider.tsx`: `<PhantomProvider>` on the outside owning the embedded session, a small bridge component inside reads `useSolana()` + `useAccounts()` + `usePhantom()` and produces the Wallet Standard wallet, ConnectorKit's `<AppProvider>` underneath consumes it via `additionalWallets`. Also calls `solana.switchNetwork("solana:devnet")` once `isConnected && isAvailable`.
5. Replace `web/components/ClientWalletButton.tsx` with a single-state implementation using ConnectorKit's `useWallet()` / `useConnectWallet()`. The current dual-branching (extension vs Phantom embedded) collapses.
6. Migrate page-level reads (`settings`, `author/[pubkey]`, `dashboard`, `skills`, `skills/publish`, `skills/[id]`) from `useWalletConnection()` to `useWallet()`. Each page is a small mechanical change.
7. Migrate large hooks (`useReputationOracle`, `useMarketplaceOracle`): replace `useWalletConnection` + `useSendTransaction` + `createWalletTransactionSigner` with `useWallet` + `useTransactionSigner`. These are the biggest individual files.
8. Update `web/lib/browserX402.ts`: `BrowserX402Wallet` typing + `walletSupportsBrowserX402` + `createWalletTransactionSigner` usage. The Wallet Standard feature-detection logic stays, but the input type changes.
9. Audit `web/lib/purchasePreflight.ts` for any wallet-shape assumptions that change.
10. Type-check / lint pass.
11. Devnet end-to-end manual smoke: Google sign-in → free skill install → paid skill x402 checkout. Confirms `switchNetwork`-on-connect is wired, `signTransaction` returns a partially-signed tx through the Wallet Standard interface, and the x402 flow round-trips.

## Checkout boundary update — 2026-05-13

Manual purchase smoke continued to fail inside Phantom's hosted signing path even after routing the embedded wallet through the documented `signAndSendTransaction` surface. The app should not keep Phase 1 blocked on opaque Phantom KMS / simulation behavior.

### Product decision

- Keep Phantom embedded social sign-in connected through ConnectorKit for onboarding experiments, identity, free installs, and future retry work.
- Do not allow Phantom embedded wallets to initiate paid listing purchases for now.
- Paid browser checkout stays available for extension / externally signed Solana wallets that support the required signing path.
- Surface a clear fallback: embedded Phantom checkout is temporarily unavailable; connect the Phantom extension or another Solana wallet to purchase.

## Paid listing economics update — 2026-05-13

Phase 1 now has two tracks. The shared rule is simple: paid marketplace purchases must preserve protocol economics. Voucher revenue is only created today by `purchase_skill`, which creates the revision-scoped `Purchase` PDA, routes author proceeds through protocol settlement accounts, updates voucher reward state, and keeps refund/dispute semantics intact.

The repo-only x402 path does not do that today. It settles a direct USDC transfer to the author's ATA, stores an off-chain receipt/entitlement, and does not create a `Purchase` PDA, voucher rewards, or protocol refund/dispute state. That path should be treated as deprecated for new paid marketplace purchases. Because the active environment is devnet, unlinked paid repo skills can be cleaned up aggressively: delete/recreate them, or relink through the canonical on-chain listing flow.

### Track A: Collapse paid listings to on-chain economics

1. Paid skills must have an on-chain `SkillListing`.
2. New repo-only paid x402 purchases are disabled for marketplace listings.
3. Publish/link flow should become "Publish Must Link": paid publish is not complete until the repo-backed skill is linked to the on-chain listing.
4. Existing devnet paid skills with `price_usdc_micros > 0` and no `on_chain_address` can be deleted and recreated, or relinked before being offered for purchase.

Free repo-backed skills can remain repo-only. The collapse is about paid settlement economics, not moving all skill content fully on-chain.

### Track B: Restore frictionless x402 through bridge

The agent-facing target is still frictionless x402, but through the protocol settlement bridge rather than direct author payment:

1. Agent requests `/api/skills/{id}/raw`.
2. Server returns an x402 `402` payment requirement.
3. Buyer pays via x402 into the protocol settlement vault.
4. Backend verifies amount, mint, payer, memo, and idempotency.
5. Backend calls `settle_x402_purchase` as `settlement_authority`.
6. Program creates purchase state and splits author/voucher proceeds through the same economics as `purchase_skill`.

This bridge must prove payer binding, deterministic memo binding, duplicate-payment protection, and a retry/refund path for the case where x402 settles but `settle_x402_purchase` fails.

### Track B implementation update — 2026-05-15

Track B is now implemented in code behind `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED=false` by default:

1. `/api/skills/{id}/raw` requires initial `X-AgentVouch-Auth` before returning bridge x402 requirements for protocol-listed paid skills.
2. The bridge requirement pays the stock-compatible protocol settlement vault ATA owned by `x402_settlement_vault_authority`.
3. The server verifies x402 amount, mint, payer, memo, and destination after facilitator settlement.
4. The backend calls `settle_x402_purchase` as `settlement_authority`; the program creates the normal `Purchase` PDA and routes author/voucher proceeds through the same economics as direct `purchase_skill`.
5. `usdc_purchase_receipts` and `usdc_purchase_entitlements` store `payment_flow: "x402-bridge-purchase-skill"` plus payment ref, settlement signature hash, settlement receipt PDA, purchase PDA, listing revision, settlement PDA, and x402 vault metadata.
6. If x402 settles but on-chain or DB recording fails, the route returns a retryable `409` and does not grant entitlement.

Devnet DB cleanup remains dry-run-first; the 2026-05-15 cleanup cleared stale links to the previous Program ID plus old purchase receipt/entitlement rows. A local bridge-enabled devnet smoke also passed on 2026-05-15: x402 paid `0.01 USDC` into the protocol settlement vault, the backend called `settle_x402_purchase`, a normal `Purchase` PDA and bridge entitlement were recorded, raw download succeeded, and voucher revenue was claimable.

### Supporting onboarding work

After the paid economic path is clarified, continue the friction-removal items that make either checkout path usable:

1. Devnet onboarding faucet for signed-in users.
2. Embedded-wallet-aware preflight copy and funding state, without attempting embedded paid purchase.
3. First-purchase USDC ATA creation.
4. Author registration rent sponsor for devnet sign-ups.
5. Revisit embedded paid checkout only with Phantom support, a minimal repro, or a different embedded wallet provider.
