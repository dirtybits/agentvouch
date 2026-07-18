---
name: walletless-buyer-base-card-access
overview: Add Google/email buyer accounts and Base Sepolia-compatible Stripe access grants while keeping off-chain card access distinct from protocol purchases and keeping Base mainnet blocked.
todos:
  - id: finalize-identity-contract
    content: Choose the buyer authentication provider and freeze session, account-linking, recovery, and deletion semantics before adding dependencies or schema.
    status: completed
  - id: land-stripe-preview-dependency
    content: Land PR #109 and rebase this branch so checkout activation, reconciliation, and operator monitoring are inherited rather than duplicated.
    status: completed
  - id: rehearse-additive-account-schema
    content: Implement a guarded preflight/migrate script for buyer accounts, identity links, wallet links, and marketplace access grants; rehearse it on a disposable branch of the live Neon project.
    status: completed
  - id: implement-buyer-sessions
    content: Add provider-agnostic Google/email buyer sessions with CSRF, redirect, logout, expiry, and recovery tests.
    status: completed
  - id: implement-wallet-linking
    content: Let an authenticated buyer link Solana and Base addresses using chain-specific signed ownership challenges without synthesizing wallet addresses from email.
    status: completed
  - id: issue-card-access-grants
    content: Attach an opaque buyer account id to Stripe Checkout metadata and grant or revoke account-scoped marketplace access from verified webhook outcomes.
    status: completed
  - id: enforce-raw-access-grants
    content: Extend raw-download authorization to accept a valid buyer-session access grant while preserving wallet entitlements and Base protocol purchase verification.
    status: completed
  - id: separate-protocol-and-card-signals
    content: Keep card grants out of Base purchase ids, protocol receipts, author proceeds, voucher rewards, dispute records, and protocol activity metrics.
    status: completed
  - id: verify-walletless-base-sepolia
    content: Run the full web gate and browser/API smokes for Google, email, linked-wallet, refund, non-buyer rejection, and Base Sepolia protocol regressions.
    status: in_progress
  - id: limited-rollout
    content: Roll out behind separate account-auth and Base-card-access flags with documented monitoring and rollback; do not enable Base mainnet.
    status: in_progress
isProject: false
---

# Walletless Buyer Accounts and Base Card Access

## Goal

Let a buyer sign in with Google or email, pay by card, and later download the purchased skill without installing or connecting a browser wallet. Support the same off-chain marketplace access for Base Sepolia listings without claiming that the Stripe payment was a Base protocol purchase.

## Dependencies

- PR #109, `ops/stripe-test-listing`, must land first. This branch consumes its explicit checkout activation, webhook reconciliation, and read-only monitoring behavior.
- Clerk is the approved buyer-auth provider. `@clerk/nextjs` is committed behind separate server/public buyer-auth flags; the Vercel-managed development instance is provisioned for Google and email-code auth on this branch's isolated preview.
- Any production database migration must target the Vercel-managed `agentvouch-postgres` project, be rehearsed on a disposable Neon branch, and be gated by `EXPECTED_DATABASE_HOST`.

## Scope

### In scope

- First-party buyer accounts authenticated through Google and email.
- Optional linked Solana and Base wallet addresses proven with signed challenges.
- Account-scoped marketplace access grants created and revoked by verified Stripe webhook events.
- Walletless raw-download authorization using a secure server session.
- Base Sepolia card access that remains distinct from Base USDC/x402 protocol purchases.
- Backward compatibility for existing wallet-bound Stripe entitlements and on-chain purchase authorization.
- Separate feature flags, auditability, reconciliation, and rollback for buyer auth and Base card access.

### Out of scope

- Enabling `eip155:8453` or weakening the intentional Base mainnet rejection.
- Converting Stripe proceeds to USDC, writing a Base purchase receipt, or funding on-chain author/voucher economics.
- Replacing the legacy `usdc_purchase_entitlements` primary key.
- Treating an email address, OAuth subject, or buyer-account UUID as a wallet address.
- Changing protocol economics, custody, tax/KYC policy, or automated author payouts.
- Merging publisher GitHub OAuth and buyer identity without a separately reviewed account-linking policy.

## Identity Contract

The durable principal is an opaque AgentVouch buyer account UUID. Authentication identities and wallets are links owned by that account, not interchangeable primary keys.

Recommended additive records:

- `buyer_accounts`: account id, status, created/updated timestamps, and deletion state; no wallet-shaped primary key.
- `buyer_identity_links`: account id, provider, normalized provider subject, verified-email metadata where available, and uniqueness on `(provider, provider_subject)`.
- `buyer_wallet_links`: account id, CAIP-2 chain context, normalized address, verification timestamp, challenge nonce/version, and uniqueness on `(chain_context, normalized_address)`.
- `marketplace_access_grants`: account id, skill DB id, source, source payment reference, status, grant/revoke timestamps, and an additive uniqueness key that makes webhook replay idempotent.

Do not store raw OAuth tokens, raw Stripe webhook payloads, or customer email in access-grant records. Store the authentication provider's stable subject; email is an attribute and must not silently merge accounts when providers disagree.

## Authentication Decision Gate

Evaluate the provider against the repository's Next.js/Vercel runtime, Google OAuth, passwordless email, secure HttpOnly sessions, CSRF protection, account linking, recovery, export/deletion support, webhook/audit capabilities, pricing, and local/test ergonomics. The implementation seam must remain provider-agnostic:

- `getBuyerSession(request)` returns an account id and session assurance data.
- Route handlers never consume a provider SDK directly outside the auth adapter.
- A provider migration must not change access-grant ownership.

Existing GitHub OAuth is publisher/profile-specific and is not reused as the buyer account without an explicit merge design. Phantom embedded Google sign-in remains a useful fast-path for a no-extension Solana wallet experience, but it is still a wallet identity rather than chain-neutral email access.

### Approved provider decision (2026-07-17)

Use Clerk through `@clerk/nextjs`. Its current Next.js SDK directly supports Google OAuth, passwordless email verification codes, server-side session verification, configurable session lifetimes, account deletion, and signed user lifecycle webhooks. Descope remains the fallback if visual flow-builder control becomes more important than the smaller AgentVouch adapter surface; Auth0 is not preferred for this first consumer flow because passwordless and social identities are separate connection types and require more explicit account-linking machinery.

Freeze these buyer-auth semantics before implementation:

- Enable only Google and email verification code for the first release; do not add passwords, SMS, magic links, organizations, or publisher GitHub OAuth.
- Keep Clerk's default seven-day maximum session lifetime for preview and disable multi-session support. Require a fresh authentication step before wallet linking, identity changes, or account deletion.
- Create the opaque AgentVouch buyer account synchronously on the first verified server session and link it to the stable Clerk user id. Clerk webhooks reconcile lifecycle changes but are not required to finish sign-in.
- Allow Google and email-code identities to converge only when Clerk has verified the shared email. Different-email linking requires the already-authenticated user to add and verify the second email; AgentVouch never merges accounts by comparing email strings itself.
- Treat passwordless email-code sign-in as recovery. A changed or inaccessible email is not silently reassigned; recovery outside an already-linked verified identity is a support-reviewed operation.
- On deletion, revoke provider sessions and soft-delete the buyer account. Retain payment and access-grant audit rows under the opaque account id as required for refunds and financial records, but deny access while the account is deleted and remove provider/email attributes through the provider lifecycle handler.
- Verify Clerk sessions only inside `buyerSession.ts`; route handlers consume the provider-neutral account id. State-changing routes also enforce same-origin/CSRF checks and never trust client-supplied user ids.

## Stripe Fulfillment Contract

When an authenticated buyer starts Stripe Checkout, the server includes only the opaque buyer account id plus the existing skill/payment identifiers in signed Stripe metadata. The webhook—not the success redirect—creates access.

- `checkout.session.completed` or the supported asynchronous success event creates or reactivates the account-scoped grant after amount, currency, skill, and payment verification.
- Full refund or dispute-lost revokes the matching source grant idempotently.
- Partial refunds and unmatched revocations enter the reconciliation queue from PR #109.
- Existing wallet-bound metadata and entitlements remain supported during migration.
- A browser session alone never proves payment; every grant points to a verified Stripe payment reference.

## Base Access Contract

For a Base Sepolia listing, a valid account-scoped card grant authorizes the off-chain marketplace download only. It does not create or imply:

- a Base purchase id or transaction hash;
- protocol author proceeds, voucher rewards, or escrow state;
- a protocol dispute/refund object;
- a Base purchase event in chain-derived metrics.

`resolveSkillAccess` should check the account grant as an additional independent authorization path. Existing wallet signature plus chain-qualified entitlement checks and Base USDC/x402 behavior remain intact. Explicit Base chain context stays exclusive; invalid Base addresses must never fall through to Solana logic.

## Expected Implementation Files

- `web/lib/buyerSession.ts`: provider-neutral session interface and server-only adapter boundary.
- `web/lib/buyerAccounts.ts`: additive account, identity-link, wallet-link, and access-grant queries.
- `web/scripts/walletless-buyer-migration.ts`: read-only preflight and `EXPECTED_DATABASE_HOST`-gated additive migration.
- `web/app/api/auth/buyer/*`: Google/email callback, verification, logout, and account-recovery routes selected after the provider decision.
- `web/app/api/account/wallet-links/*`: signed Solana/Base challenge and link routes.
- `web/app/api/stripe/checkout/route.ts`: optional buyer-account metadata while preserving the wallet path.
- `web/app/api/stripe/webhook/route.ts`: idempotent account-grant fulfillment and revocation.
- `web/lib/skillRawAccess.ts`: buyer-session grant authorization alongside existing protocol and wallet entitlement paths.
- `web/app/api/skills/[id]/raw/route.ts`: pass the server buyer session into the access resolver.
- Focused API/lib tests plus browser coverage for session, linking, checkout, download, refund, and cross-chain rejection behavior.
- `docs/STRIPE_MPP_POLICY.md`, `docs/STRIPE_TEST_MODE_ROLLOUT.md`, `docs/CHAIN_CAPABILITY_MAP.md`, and `web/public/skill.md` only where shipped behavior changes.

## Verification

Use Node 24:

```bash
export PATH="$HOME/.nvm/versions/node/v24.1.0/bin:$PATH"
npm run format:check
npm run lint --workspace @agentvouch/web
npm run typecheck --workspace @agentvouch/web
npm run test --workspace @agentvouch/web
npm exec --workspace @agentvouch/web -- next build --webpack
npm run verify:chain-map
```

Required behavioral checks:

1. Google buyer signs in, completes a Stripe test payment, and downloads without a wallet.
2. Email buyer completes the same flow and can recover the account through the approved provider policy.
3. A different signed-in account and an anonymous request are rejected.
4. Full refund revokes access; replay is idempotent; partial refund enters reconciliation.
5. Linking a Solana or Base wallet requires a fresh chain-specific signature and cannot steal an already-linked address.
6. Existing wallet-bound Stripe access still works.
7. Existing Base Sepolia USDC/x402 purchase and non-buyer rejection still work.
8. The card purchase does not appear as a Base protocol receipt, purchase id, transaction, or protocol-economic event.
9. Explicit malformed `eip155:*` buyer identity is rejected and never falls through to Solana.
10. Base mainnet remains rejected and `npm run verify:chain-map` passes.

## Rollout

1. Land PR #109 with checkout disabled by default.
2. Approve the auth provider and migration design.
3. Rehearse additive schema changes on a disposable branch of `agentvouch-postgres`; capture preflight, migration, and post-run verification.
4. Deploy account auth behind an account-auth preview flag without enabling Base card checkout.
5. Run Google/email account and wallet-linking smokes.
6. Enable Base Sepolia card access for a test-mode allowlist and run payment/download/refund/reconciliation smokes.
7. Expand only after monitoring and recovery behavior are proven. Base mainnet remains separately blocked.

## Rollback

- Disable the Base-card-access flag first, then the buyer-auth signup flag; preserve existing sessions long enough for buyers to retrieve already granted content unless security requires immediate invalidation.
- Keep Stripe webhooks and reconciliation active while outstanding payments/refunds settle.
- Mark grants revoked rather than deleting payment history.
- Additive tables remain in place during rollback; destructive schema cleanup requires its own guarded plan.

## Open Blockers

- Interactive end-user Google redirect and email-code component smokes remain pending under `verify-walletless-base-sepolia`; the server session boundary and opaque first-login account creation are live-smoked on the isolated preview.
- Final production retention period and support process for deleted-account purchase recovery.
- Production author payout, tax/KYC, custody, and card-refund policy.
- Existing Base Sepolia protocol USDC/x402 and a separate-account live regression remain pending; Base mainnet remains blocked regardless of this plan's outcome.

## Dated Progress Notes

- **2026-07-17:** The limited walletless-card preview completed its first real Stripe test-mode purchase/download/refund loop on isolated Neon branch `br-empty-hat-afcrsu56`. Deployment `dpl_5DYs29GpGTGJRTfWxLuD5DNN9vso` (commit `8761d0c`) reached `READY` and the stable `agentvouch-walletless-preview.vercel.app` alias was moved to it after adding the feature-branch-only `AGENTVOUCH_PUBLIC_BASE_URL`. Checkout Session `cs_test_a1wK6Zwup8LzXSyvvf09nBBytdLL2P7OTN55vdspb6XbPsqo0VuheoQbyx` / PaymentIntent `pi_3TuP0pA2jEYsGvGP0GI4FRAs` created exactly one active Stripe access grant for opaque account `aaa91d03-8469-4d75-b511-6dac15451fcf` and Base Sepolia skill `efa82c9d-fcc1-47d6-8145-780bd9388783`. The signed-in browser rendered `Purchased`, downloaded without a Base wallet, and reported `Account download complete.` Refund `re_3TuP0pA2jEYsGvGP0CEpMX9k` then produced `charge.refunded` event `evt_3TuP0pA2jEYsGvGP0iucVFZv`, revoked the grant with `stripe-refund`, and restored `Pay by Card`. Both webhook outcomes required no review; wallet entitlements revoked remained zero, and the append-only protocol receipt count remained zero before and after refund. The post-refund read-only monitor reported checkout/config flags ready, no blockers, zero open reviews, and no alerts. The selected historical Base listing fails closed for an anonymous raw request with `500` (`unsupported Base contract`) rather than the supported-v1 fixture's tested `402`; live separate-account and current Base protocol regressions therefore remain open instead of being overstated. Production flags remain off and Base mainnet remains blocked.
- **2026-07-17:** Account-page live verification now shows the successfully linked Solana Devnet address, disables `Current wallet linked`, and disables `Phantom linked`, so repeated connect attempts no longer create or replay links. The chain-specific challenge, address-ownership conflict, and Base Sepolia signature paths remain covered by focused tests; the broader multi-provider browser matrix stays under `verify-walletless-base-sepolia`.

- **2026-07-17:** First live skill-page smoke on the card-enabled preview showed Clerk's development-browser handshake finishing after the initial account-access request. The header/account page was signed in, but the skill detail temporarily labeled checkout as wallet-scoped. The client now retries account access at 0.75s, 2s, and 5s after mount; the full local gate re-passed with 119 Vitest files / 762 tests, chain-map verification, and the webpack build before redeployment.
- **2026-07-17:** Account-scoped card access implementation is locally complete behind `AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED` plus `NEXT_PUBLIC_AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED`. Checkout prefers an authenticated opaque buyer account with same-origin enforcement, copies account/skill identifiers to Checkout Session and PaymentIntent metadata, and permits Base Sepolia only through a separate `marketplace_access_grants` row. Webhook completion never writes a protocol/wallet receipt for this flow; refund/dispute creates a revoked tombstone so replay cannot restore access. `resolveSkillAccess` accepts only an active grant owned by an active account, while anonymous and different-account requests continue to `402`. The existing wallet-bound Stripe path remains covered. Full local verification passed: format, lint, typecheck, 119 Vitest files / 762 tests, chain-map verification, and the webpack production build. The build logged expected sandbox DNS fallbacks plus the existing viem dynamic-dependency warning but completed successfully. Preview deployment and live card/download/refund smoke remain under `verify-walletless-base-sepolia`; Base mainnet remains blocked.
- **2026-07-17:** User approved implementing the linked-wallet state, account-scoped Stripe fulfillment/revocation, and signed-in raw-download path as one slice. Work remains preview-only behind separate buyer-auth/card-access flags; wallet-bound Stripe compatibility is preserved, Base Sepolia card access stays an off-chain marketplace grant, and Base mainnet remains blocked.
- **2026-07-17:** Manual account-page verification exposed two client regressions before wallet-linking could be called complete. Clerk `useReverification` decodes a returned `Response`, but the caller treated the decoded challenge object as another `Response` and called `.json()` (`e.json is not a function`). Separately, an explicit Phantom selection could race the automatic Base passkey restore and leave the default Base Sepolia session active. The wallet-linking todo was reopened for a decoded-payload fix, explicit connect-and-link account actions, stale Base-restore invalidation, regression coverage, and a repeat live signature smoke. Base mainnet remains blocked.
- **2026-07-17:** The local regression fix now decodes the challenge inside Clerk's enhanced fetcher, validates the returned payload before signing, exposes explicit account-page `Connect & link` actions for Phantom, Coinbase Smart Wallet, and MetaMask, and invalidates in-flight Base passkey restoration before Solana connection starts. Focused coverage passed (15 tests); the full gate passed with format, lint, typecheck, 118 Vitest files / 750 tests, chain-map verification, and the webpack production build. The build's static data fetches logged expected sandbox DNS fallbacks but completed successfully. Live Phantom/Base signature confirmation remains required before returning `implement-wallet-linking` to completed.

- **2026-07-16:** PR #109 merged as `2b088b23` after the exact head passed GitHub `test`, `contracts`, and Vercel checks. This branch was rebased onto that merge, so the Stripe activation, webhook reconciliation, monitoring, and refund-revocation implementation are inherited rather than duplicated.
- **2026-07-16:** Current official provider documentation was re-checked. Clerk is the provisional recommendation for Google plus passwordless email-code auth; dependency installation remains blocked on explicit human approval.
- **2026-07-17:** Clerk was approved and `@clerk/nextjs@7.5.16` was committed. A provider-neutral `buyerSession.ts` boundary, separately gated Clerk provider/proxy/sign-in controls, same-origin logout, opaque account resolver, and guarded `walletless-buyer-migration.ts` preflight/migrate script were added. The migration was not run against any database.
- **2026-07-17:** Dormant local smoke passed with all auth env absent: `/api/auth/buyer/session` returned `200` with `enabled=false`, `/sign-in` returned `404`, and logout returned `503`. Migration invalid-usage and missing-`EXPECTED_DATABASE_HOST` checks rejected before database access. Local gates passed: format, lint, typecheck, 732 Vitest tests, webpack production build, and chain-map verification. Live Clerk Google/email behavior and disposable-Neon rehearsal remain open.
- **2026-07-17:** Vercel preview `dpl_6wWa79CEe9pntBsbe7ocN2Xdh3z8` reached `READY` for signed head `0297cace`. With buyer-auth env still absent, the deployed session endpoint returned `200` with `configured=false, enabled=false`, `/sign-in` returned `404`, and the deployment emitted no error/fatal runtime logs during the verification window.
- **2026-07-17:** Exact evidence head `65fcd8c` deployed as preview `dpl_3FwAPhdPcpgsJRihxVRuHMKvNLtb` and reached `READY`. Its session endpoint again returned `200` with `configured=false, enabled=false, authenticated=false, accountId=null`, and `/sign-in` remained intentionally unavailable with `404` while Clerk was unprovisioned.
- **2026-07-17:** The guarded account-schema migration was rehearsed against disposable branch `br-billowing-pine-af5amekf` (`codex-walletless-buyers-20260717`) created from `main` (`br-quiet-base-afn4qzxf`) in the verified live Vercel-managed `agentvouch-postgres` project (`calm-meadow-36819154`), not the legacy project. Read-only preflight found all four tables absent and safe to add. `migrate` passed, an immediate second `migrate` proved idempotency, and final preflight plus catalog queries verified the expected primary keys, foreign keys, unique constraints, check constraints, and three supporting indexes. The new tables remained empty and the copied `skills` row count stayed `89`. No production preflight or migration was run; the disposable branch was deleted after evidence capture.
- **2026-07-17:** Installed the Vercel Marketplace Clerk resource `clerk-fulvous-school` (integration config `icfg_FjE12dej0sc2boNTF0FBk2yb`, Clerk app `app_3GeSJqpU5xwloLK3nVGFlTCVHSb`, development instance `ins_3GeSJoMqt9aVT3gd5VtK6exVv4q`). Vercel provisioned `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. The Clerk dashboard was configured for Google using shared credentials and passwordless email verification codes; password, phone, username, and passkey sign-in were disabled. Only preview branch `feat/walletless-base-card-access` received `AGENTVOUCH_BUYER_AUTH_ENABLED=true` and `NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED=true`; production has no buyer-auth flags and remains fail-closed.
- **2026-07-17:** Created expiring Neon child branch `br-empty-hat-afcrsu56` (`codex-walletless-auth-preview-20260717`, expiry `2026-07-20T00:00:00Z`) from live-project main and scoped its `DATABASE_URL` only to the feature-branch preview. The guarded migration and post-migration preflight passed there; production was not queried or migrated. Preview `dpl_ETokjp6RLhYVAYc2LBZcaMNJufMB` reached `READY`, and anonymous `/api/auth/buyer/session` returned `configured=true, enabled=true, authenticated=false` while `/sign-in` returned `200` with the Clerk client and sign-in component mounted.
- **2026-07-17:** The first synthetic authenticated request against `dpl_ETokjp6RLhYVAYc2LBZcaMNJufMB` exposed a PostgreSQL data-modifying-CTE visibility bug: the account and identity rows were inserted, but the same statement's final join could not see the new base-table row, so the route returned `500`. Commit `7eaf5c4` now carries status through `created_account`/`selected_account` CTE output and joins that returned row. A direct first-identity execution on temporary branch `br-empty-hat-afcrsu56` returned one active opaque account. Local verification passed: format, lint, typecheck, 732 Vitest tests, chain-map verification, and the webpack production build; the first sandboxed build attempt failed only because Google Fonts DNS was blocked, and the network-enabled rerun passed.
- **2026-07-17:** Exact fix head `7eaf5c41b3c85d087352ce1912e688e4a71b9a07` deployed as `dpl_8cbfNeptUmWyXsGZ4J5fNn2DEfqK` and reached `READY`. A fresh synthetic Clerk session's first request returned `200` with `authenticated=true` and opaque account `4e430869-1189-400d-98a6-1a7d19da00bb`; Neon showed exactly one matching active `clerk` identity link, and same-origin logout returned `success=true, revoked=true`. Runtime monitoring showed two `200` requests and no error/fatal logs. Both synthetic Clerk users were deleted after the smoke. `https://agentvouch-walletless-preview.vercel.app` points to this non-production evidence deployment; browser automation still rejected navigation to the new preview hostname before page load, so the interactive Google/email component flows remain explicitly unverified. Base mainnet was not enabled.
- **2026-07-17:** Wallet linking now uses a server-authored five-minute challenge bound to the opaque buyer account, current Clerk session, exact origin, CAIP-2 chain, normalized address, purpose, version, nonce, and expiry. Both challenge and verification require same-origin requests plus Clerk `strict` reverification. Solana uses Wallet Standard Ed25519 message signing; Base Sepolia uses the existing `personal_sign`/smart-account verifier so ERC-1271/6492 wallets remain supported. Atomic challenge consumption rejects replay and refuses a chain-qualified address already owned by another buyer account. Base mainnet remains rejected. The additive `buyer_wallet_link_challenges` table and active-challenge index were applied and catalog-verified only on disposable branch `br-empty-hat-afcrsu56`; the primary database was not changed. Local verification passed: format, lint, typecheck, 746 Vitest tests, chain-map verification, and webpack production build. Browser automation still returned `ERR_BLOCKED_BY_CLIENT` before loading every new Vercel preview hostname, so Google/email and live wallet-signature UI smokes remain tracked under `verify-walletless-base-sepolia` rather than being overstated.
- **2026-07-17:** The first manual Clerk development-browser handshake exposed `host_invalid` on the preview because `clerkMiddleware({ frontendApiProxy: { enabled: true } })` routed development keys through Clerk's production-only Frontend API proxy. Both the stable alias and exact deployment returned `400` through `/__clerk`, while the same handshake sent directly to `civil-chamois-30.clerk.accounts.dev` returned the expected `307`. The proxy option was removed so development previews use Clerk's direct Frontend API path, and a wiring regression test now forbids re-enabling it. Local verification passed: format, lint, typecheck, 747 Vitest tests, and the webpack production build. Production buyer auth remains disabled and Base mainnet remains blocked.
