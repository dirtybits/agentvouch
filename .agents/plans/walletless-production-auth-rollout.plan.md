---
name: walletless-production-auth-rollout
overview: "Prepare and activate production Clerk-backed buyer authentication without enabling buyer-card access, Stripe checkout, or Base mainnet."
todos:
  - id: verify-production-targets
    content: Verify the production Vercel project, live Neon database host/project, production Clerk instance, current deployment, and fail-closed feature-flag state without exposing secrets.
    status: completed
  - id: migrate-production-schema
    content: Run the guarded walletless-buyer preflight, migrate against the independently confirmed production database host, and rerun post-migration verification.
    status: completed
  - id: configure-production-clerk-webhook
    content: Configure the production Clerk user.deleted webhook and its production-only signing secret while every buyer-auth, buyer-card, and Stripe checkout flag remains off.
    status: completed
  - id: smoke-dormant-auth
    content: Redeploy if required and prove the production authentication infrastructure is configured but disabled, with card access and Stripe checkout still fail-closed.
    status: completed
  - id: enable-buyer-auth-only
    content: Enable only the server and public buyer-auth flags in production, redeploy, and keep buyer-card and Stripe checkout flags explicitly false.
    status: completed
  - id: smoke-production-auth
    content: Verify production Google and email sign-in, session status, account creation, logout, wallet-link readiness, Clerk deletion reconciliation, and continued payment-path disablement.
    status: completed
  - id: record-rollout-evidence
    content: Record non-secret deployment, database, webhook, smoke, monitoring, and rollback evidence; run repository validation appropriate to plan-only changes and prepare a signed commit.
    status: completed
isProject: false
---

# Walletless Production Authentication Rollout

## Goal

Activate production Google/email buyer authentication on AgentVouch while leaving account-scoped buyer-card access, Stripe Checkout, and Base mainnet disabled. Production identity records must use the live Vercel-managed Neon database and Clerk lifecycle deletions must reconcile idempotently.

## Scope

- In scope: the Vercel project `agentvouch`, its production deployment and environment variables, the live `agentvouch-postgres` Neon database, a production Clerk instance, the Clerk `user.deleted` webhook, additive walletless-buyer schema migration, and buyer-auth-only production smokes.
- Out of scope: `AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED=true`, `NEXT_PUBLIC_AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED=true`, `AGENTVOUCH_STRIPE_CHECKOUT_ENABLED=true`, `NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED=true`, live-mode Stripe configuration, card purchases, author payouts, Base protocol writes, and `eip155:8453`.

## Source Files

- `web/scripts/walletless-buyer-migration.ts`: guarded additive migration and post-migration schema verification.
- `web/app/api/auth/buyer/webhook/route.ts`: verified Clerk `user.deleted` reconciliation.
- `web/lib/buyerAuthConfig.ts`: independent buyer-auth and buyer-card activation boundaries.
- `web/app/api/auth/buyer/session/route.ts`: non-secret production status probe.
- `.agents/plans/walletless-buyer-base-card-access.plan.md`: preview rehearsal and lifecycle evidence.

## Rollout

1. Verify the Vercel org/project identifiers and production deployment alias. Inspect environment variable names/scopes only; never print secret values.
2. Independently derive the production `DATABASE_URL` hostname and confirm it belongs to the Vercel-managed `agentvouch-postgres` project, not the legacy Neon project.
3. Run the migration script's read-only `preflight`. Stop on any partial installation, duplicate group, target mismatch, or unexpected database identity.
4. Run `migrate` with `EXPECTED_DATABASE_HOST` set to the exact confirmed hostname. Rerun `preflight` and record the verified tables/constraints.
5. Configure a production Clerk instance with production API keys, AgentVouch's production domain, Google and email-code auth only, and a `user.deleted` webhook targeting `/api/auth/buyer/webhook`. Store the signing secret as production-only `CLERK_WEBHOOK_SIGNING_SECRET`.
6. With all feature flags false, redeploy and verify `/api/auth/buyer/session` reports configured but disabled; auth UI stays absent; buyer-card and Stripe checkout routes stay disabled.
7. Enable only `AGENTVOUCH_BUYER_AUTH_ENABLED=true` and `NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED=true`, then redeploy the same reviewed commit.
8. Smoke Google and email sign-in, session/account creation, logout, wallet-link readiness, and a disposable-user deletion webhook. Verify buyer-card access and Stripe checkout remain disabled throughout.

## Verification

- Database: migration preflight before and after DDL; exact host match; expected five tables and constraints; no duplicate identity, wallet, or grant groups.
- Dormant production: `/api/auth/buyer/session` returns `configured: true`, `enabled: false`; no Account/sign-in UI; Stripe checkout returns its disabled response; buyer-card flags are false.
- Auth-only production: `/api/auth/buyer/session` returns `configured: true`, `enabled: true`; anonymous session remains unauthenticated; Google/email users receive distinct opaque AgentVouch account UUIDs; logout clears the session.
- Lifecycle: a disposable production Clerk user is deleted; the verified webhook returns success; its AgentVouch account is soft-deleted and identity links are removed while financial/audit rows are retained.
- Safety: no production Stripe payment is attempted; no buyer-card grant is created; no Base mainnet path is enabled.

## Rollback

1. Set `AGENTVOUCH_BUYER_AUTH_ENABLED=false` and `NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED=false`, then redeploy.
2. Keep the Clerk webhook configured so deletion reconciliation continues for identities already created.
3. Leave the additive database tables in place; do not drop production data during rollback.
4. Buyer-card and Stripe checkout flags remain false before, during, and after rollback.

## Stop Conditions

- The production `DATABASE_URL` host cannot be independently matched to `agentvouch-postgres`.
- The production Clerk instance or production API keys are absent, or the configured instance is still a Clerk development instance.
- Preflight reports a partial schema, duplicates, or any unexpected existing table shape.
- Any card-access, Stripe checkout, sponsored-payment, or Base-mainnet flag is true in production.
- The production deployment cannot be rolled back or observed before activation.

## Dated Notes

- **2026-07-18:** The user authorized the production additive migration, Clerk lifecycle webhook, dormant smoke, and buyer-auth-only activation on branch `ops/walletless-production-auth-rollout`. Buyer-card access and Stripe Checkout must remain disabled until their separate operational blockers close.
- **2026-07-18:** Verified the production Vercel `agentvouch` project and owning team, the live Neon `agentvouch-postgres` project and expected production database host, and the Clerk production instance. Production initially had Clerk development keys and no buyer-auth, buyer-card, or Stripe checkout flags. Vercel Production was split onto the production Clerk keys while Preview/Development retained their development keys; all rollout flags remained off.
- **2026-07-18:** The guarded production preflight found all five walletless-buyer tables absent and no duplicate identity, wallet, or grant groups. `migrate` ran only with `EXPECTED_DATABASE_HOST` matching the exact confirmed production host. The migration and a separate post-run preflight verified `buyer_accounts`, `buyer_identity_links`, `buyer_wallet_links`, `buyer_wallet_link_challenges`, and `marketplace_access_grants` with their expected additive shapes and zero duplicate groups.
- **2026-07-18:** Created the Clerk production webhook for only `user.deleted` at `https://www.agentvouch.xyz/api/auth/buyer/webhook`, with description `AgentVouch production buyer account deletion reconciliation`, and stored its signing secret as the Sensitive, Production-only Vercel variable `CLERK_WEBHOOK_SIGNING_SECRET`. A temporary incorrect clipboard value was removed before any deployment used it.
- **2026-07-18:** Clerk accepted `agentvouch.xyz` as the production primary domain and issued the domain-bound publishable key; Vercel Production was updated to that key while Preview/Development remained on development keys. Clerk still reports DNS/SSL pending because the five required Namecheap CNAME records are absent. Buyer authentication must remain disabled until the DNS records resolve, Clerk provisions SSL, and production Google/email sign-in configuration is verified.
- **2026-07-18:** Confirmed the production buyer-auth, buyer-card, and Stripe checkout activation variables are absent and both sponsored-checkout variables resolve false. Deployed reviewed commit `be742296` as an immutable Vercel production candidate; the application build completed and the deployment reached `READY`. Clerk's `Clerk DNS Configuration` check failed, so Vercel did not promote the deployment to the custom production alias. This safety check was not bypassed.
- **2026-07-18:** Dormant smokes against the exact READY deployment passed: `/api/auth/buyer/session` returned HTTP 200 with `configured: true`, `enabled: false`, and `authenticated: false`; `/sign-in` returned HTTP 404; `/api/account/access-grants/smoke` returned HTTP 503 with `enabled: false`; and `POST /api/stripe/checkout` returned HTTP 501 with checkout disabled. Vercel reported no runtime error clusters for the smoke routes. Buyer-auth-only activation remains pending on Clerk DNS/SSL and production Google/email verification.
- **2026-07-18:** The operator added all five Clerk CNAMEs in Namecheap. Namecheap's authoritative nameserver and the Cloudflare and Google public resolvers returned the exact expected targets for `clerk`, `accounts`, `clkmail`, `clk._domainkey`, and `clk2._domainkey`. Clerk certificate provisioning was still pending immediately after propagation: both `clerk.agentvouch.xyz` and `accounts.agentvouch.xyz` resolved but failed the TLS handshake. Buyer-auth activation remains paused until both endpoints pass certificate validation.
- **2026-07-18:** A fresh immutable disabled deployment rebuilt successfully and reached `READY`, but Clerk's `Clerk DNS Configuration` integration check still failed and Vercel again withheld custom-domain promotion. Repeated TLS probes continued to fail while the CNAMEs remained correct and no CAA policy was present. No feature flags were enabled and the failed check was not bypassed; Clerk domain verification/certificate provisioning must be refreshed or completed before activation.
- **2026-07-18:** After Clerk reported all five DNS records verified, the production Frontend API and JWKS at `clerk.agentvouch.xyz` returned HTTP 200 with valid TLS. The Account Portal at `accounts.agentvouch.xyz` still failed its TLS handshake. Clerk's public `/v1/environment` confirmed a production instance with email-code verification enabled, but zero enabled social connections; Google is not configured in production. Password authentication is also still enabled/required, which does not match the planned Google-and-email-code-only posture. Buyer-auth activation remains paused until the Account Portal certificate is valid, Google has production custom OAuth credentials, and the password-method decision is resolved.
- **2026-07-20:** Re-verified Clerk from its public production configuration before activation: `clerk.agentvouch.xyz/v1/environment` returned HTTP 200 with valid TLS; `accounts.agentvouch.xyz/sign-in` presented valid TLS; identification strategies were exactly email address plus Google OAuth; first factors included email code and Google OAuth; Google was enabled, authenticatable, and selectable; and password authentication was off. Added only `AGENTVOUCH_BUYER_AUTH_ENABLED=true` and `NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED=true` to Vercel Production. Buyer-card and Stripe checkout activation variables were not added or changed.
- **2026-07-20:** The activated production deployment reached `READY` and was aliased to `agentvouch.xyz` and `www.agentvouch.xyz`. The deploy build compiled, passed TypeScript, and generated all 151 static pages. Anonymous smoke checks passed on the immutable deployment and canonical domain: buyer-session HTTP 200 reported `configured=true`, `enabled=true`, and `authenticated=false`; `/sign-in` returned HTTP 200; buyer-card access returned HTTP 503 with `enabled=false`; and Stripe checkout returned HTTP 501. The first smoke exposed a stale production sponsored-checkout flag, so both server and public sponsored-checkout flags were explicitly set to `false` and production was redeployed before closeout. The corrected sponsored prepare route returned HTTP 400 with `Sponsored checkout is not enabled`. Vercel reported no runtime error clusters for the rollout routes in the one-hour window. Human Google/email sign-in, logout, wallet-link readiness, and deletion-webhook reconciliation remain outstanding, so the production-auth smoke todo is still open.
- **2026-07-20:** The operator completed the production passwordless-email smoke and confirmed the verification code was delivered and accepted. The message came from `clerk-fulvous-school <notifications@agentvouch.xyz>` but Gmail placed it in spam as similar to messages previously classified as spam. Email-code authentication is therefore passed; sender branding and inbox placement remain a deliverability follow-up. Google sign-in, logout, wallet-link readiness, and deletion-webhook reconciliation remain outstanding, so the production-auth smoke todo stays open.
- **2026-07-20:** The operator completed the remaining production identity and wallet-link smokes: Google sign-in/logout passed, and the same private buyer account displayed linked Base Sepolia and Solana Devnet wallets. A provider-switching defect remains: when the active connected wallet is Solana, initiating Coinbase Smart Wallet linking can hang. The core signed-challenge linking path is proven, but the Coinbase-from-Solana transition needs a separate UI follow-up.
- **2026-07-20:** Production Clerk deletion reconciliation passed for a disposable production user. Vercel recorded `POST /api/auth/buyer/webhook` HTTP 200 at `19:44:03Z` on the activated deployment, with no webhook-route runtime error clusters. A read-only query against the confirmed live Neon `agentvouch-postgres` project on its primary branch found the corresponding disposable buyer account tombstoned as `deleted` at `19:44:04.814917Z`, with zero remaining identity links and zero effective active access. The disposable account had no wallet links or grants to retain. Production Google/email buyer authentication, logout, wallet-link readiness, lifecycle reconciliation, and payment-path disablement have now passed; the production-auth smoke todo is complete.
