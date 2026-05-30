---
name: free-listings-unverified-tier
overview: "Open publishing to a free, no-crypto 'unverified' tier to drive adoption. Decouple publishing from wallet/bond/on-chain; map publisher auth modality to trust tier; defend against spam with rate limits + the AI scan rather than a wallet wall."
todos:
  - id: design-author-identity-model
    content: Schema for non-wallet authors (author_kind, external id/handle, nullable author_pubkey) + a derived verification tier (unverified | registered | bonded). Migration via initializeDatabase pattern.
    status: pending
  - id: github-oauth-publish
    content: Add GitHub OAuth publish path for human web devs → unverified-attributed (shows @handle). No wallet/bond/on-chain required.
    status: pending
  - id: decouple-publish-from-wallet
    content: Make POST /api/skills accept (a) wallet signature [existing → registered], (b) OAuth session [→ unverified], or (c) API token [→ owner tier]. Drop the implicit bond/on-chain requirement for free listings.
    status: pending
  - id: claim-later-flow
    content: Let an OAuth-published (unverified) author link a wallet later to upgrade their skills to registered. Verify session + wallet sig → set author_pubkey on owned skills.
    status: pending
  - id: anti-spam
    content: Rate-limit publishing per identity + IP; auto-run the AI security scan on publish; keep unverified ranked below verified in default sort.
    status: pending
  - id: api-tokens-agents
    content: (Fast-follow) human-provisioned API tokens so non-wallet agents/CI can publish programmatically, attributed to the owner.
    status: pending
  - id: verify-free-listings
    content: E2E tests/preview for each publish modality + correct tier rendering (unverified card, attributed handle, registered upgrade), spam guards, and scan-on-publish.
    status: pending
isProject: false
---

# Plan — Free Listings & the Unverified Tier

## Goal

Open publishing to a **free, no-crypto "unverified" tier** to attract supply and usage. The whole funnel has been dying at "register a wallet → deposit a bond → create an on-chain listing." This deletes that wall: anyone can list a skill for free as **Unverified**; trust (registered → bonded) is a layer earned on top, not a gate to enter. This is the **most-adoption / least-friction** north star applied where it bites, and the trust-signal-first wedge.

## Strategic framing

- Every registry that won (npm, PyPI, app stores) let anyone publish free; trust was layered on top.
- AgentVouch's job for unverified skills is not to vouch for them — it's to **label them honestly and attach an automated safety read** (the Phase-2 AI scan). That's strictly better than GitHub/ClawHub, where there is no signal at all.
- Pairs with `trust-signal-summaries` (shipped) and `trust-signal-open-world` (the AI scan) — unverified skills are exactly the ones that need the scan.

## Trust ladder (already reflected in the card UI)

| Tier | How you get there | Card treatment |
|---|---|---|
| **Unverified** | Free publish, no crypto (GitHub OAuth or API token) | Neutral "Unverified" sigil dot; attributed `@handle` if OAuth |
| **Registered** | Wallet identity (AgentProfile) | Can receive vouches; reputation/trust line shown |
| **Bonded / Paid** | Author bond + on-chain listing | Can charge; disputes + (future) slashing apply |

## Publish modality → tier (do NOT force agents through OAuth)

OAuth is an interactive human flow — forcing it per-publish breaks programmatic/agent publishing and contradicts the agent-native thesis.

| Publisher | Auth | Tier |
|---|---|---|
| Human via web UI | **GitHub OAuth** (near-zero friction, sybil-costly, claimable) | Unverified (attributed) |
| Crypto-native agent (has a keypair) | **Wallet signature — already built** | Registered directly |
| Non-wallet agent / CI (human-operated) | **API token** the human provisions once (after OAuth) | Inherits owner tier |
| Pure-anonymous | — | Disallowed |

The crypto-native agent already has a frictionless path (sign with its keypair → registered). OAuth is just the convenient door for *humans*. "Force the user to OAuth" is acceptable only as a **one-time** credential provisioning step, never per-publish.

## What already exists (so this is mostly an un-gating job)

- `source: "repo"` skills are **already off-chain Postgres records** with no bond and no on-chain listing; they already render "Unverified" when the author is unregistered.
- The card UI already has the neutral Unverified tier (`AgentSigil` + verdict dot) and falls back gracefully with no trust profile.
- The wallet publish path already exists and elevates crypto authors/agents to registered.
- **The remaining change is removing the wallet *requirement* for free publishing and adding a lightweight human identity (OAuth).**

## Anti-spam (the real defense — NOT the login modality)

A Solana keypair is free to mint, so wallet-signing is as sybil-cheap as anonymous; GitHub OAuth only gates humans. So the firehose defense is:

1. **Rate limits** per identity + per IP on publish.
2. **Auto-run the AI security scan** on every unverified skill so junk/malware is *labeled*, not silently hosted.
3. **Unverified ranked below verified** in the default "Most Trusted" sort (already the case).
4. *(On-thesis, later)* a tiny **x402 micro-fee to publish beyond a free quota** — the agent-native sybil price, which also funds the scan.

## MVP scope

- Keep the wallet publish path (crypto agents + humans → registered). Zero new work.
- Add **GitHub OAuth publish** (human web devs → unverified, attributed). The new piece.
- Decouple publish from bond/on-chain for free listings; default to Unverified.
- Anti-spam = rate limits + scan + ranking now.
- API tokens + x402 publish-fee = fast-follow, not v1.

## Files to change (anticipated)

- `web/lib/db.ts`: author-identity columns (author_kind, author_handle/external_id, nullable author_pubkey) + tier derivation; migration.
- `web/app/api/skills/route.ts`: accept wallet sig OR OAuth session OR API token; drop bond/on-chain requirement for free; set tier; run scan-on-publish (best-effort `after()`).
- Auth: GitHub OAuth (NextAuth or Vercel-native); session plumbing.
- `web/components/SkillPreviewCard.tsx` + author surfaces: show attributed `@handle` for OAuth unverified authors.
- Claim-later endpoint: link wallet to OAuth-published skills.
- Rate-limit middleware on publish.

## Open decisions

1. Publish gate for unverified humans: **GitHub OAuth** (chosen) vs email vs anonymous (rejected: firehose).
2. Author-identity storage shape: extend `skills`/`author_pubkey` to a publisher-identity model vs a separate `publishers` table with optional linked wallet.
3. When to add the x402 publish-fee (sybil price) — launch with free quota + rate limits, add fee if spam appears.
4. Attribution display for unverified: show `@github_handle`, a generated handle, or just "Unverified".

## Out of scope / shelved

- **Voucher slashing + adjudication redesign** — paused (see below; tracked in `docs/MAINNET_READINESS.md` P0.1/P0.2). These are verified/bonded-tier + mainnet concerns, not on the adoption path.

---

## Shelved: voucher slashing (paused 2026-05-30)

Reprioritized in favor of this adoption wedge. State at pause:

- **Landed (committed source-only):** the `revoke_vouch` open-dispute lock (`programs/agentvouch/src/instructions/revoke_vouch.rs`) — blocks a voucher from pulling stake while the backed author has an open dispute. It will not affect devnet until the program is rebuilt and redeployed.
- **Designed, not built:** the `resolve_author_dispute` slash loop. Decisions captured: slash = `slash_percentage` (partial, residual stays staked); slashed funds **deposited into the author proceeds vault** so they ride the existing `create_refund_pool` split (challenger_reward_bps capped → challenger, remainder → buyer pool) — no new config/vault, no change to `create_refund_pool`. Iterate backing vouchers via `remaining_accounts` (vouch, vault) pairs; ~24/tx cap for v1.
- **Why shelved:** slashing only applies to the bonded/paid tier (the small opt-in top of the ladder), is mainnet-gated, and is the least-reversible work in the project. It's the moat, not the wedge — build it once there's a verified tier worth protecting.
