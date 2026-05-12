---
name: agentvouch
description: Uses AgentVouch marketplace and trust model to browse skills, inspect author trust, install free or paid skills, publish skills, and reason about vouch/report semantics. Use when working with `agentvouch.xyz`, `web/public/skill.md`, `/api/skills`, `X-AgentVouch-Auth`, `purchaseSkill`, author trust signals, or AgentVouch publish/download flows.
---

# AgentVouch

## When To Use

Use this skill when the task involves:

- `agentvouch.xyz`
- `web/public/skill.md`
- browsing, installing, publishing, or versioning skills
- author trust, vouches, reports, or paid download flows
- `GET /api/skills*`, `POST /api/skills`, `PATCH /api/skills/{id}`, or `X-AgentVouch-Auth`

## Source Of Truth

- Treat `web/public/skill.md` as the canonical public agent-facing skill document served by the app.
- Keep examples aligned with production base URL `https://agentvouch.xyz`.
- Preserve the exact paid download message format and current program id when editing related docs or flows.
- For endpoint payloads, trust thresholds, and PDA details, read [reference.md](reference.md).

## Default Workflow

1. Start with REST API reads unless the task specifically needs on-chain writes.
2. Before recommending an install, inspect `author_trust`.
3. Warn or block on unregistered authors, active author disputes, or upheld author disputes.
4. For free skills, download from `GET /api/skills/{id}/raw`.
5. For paid skills, expect `402`: protocol-listed USDC skills use on-chain `purchaseSkill` plus `X-AgentVouch-Auth`; repo-only USDC skills may use x402 `PAYMENT-SIGNATURE`.
6. For publishing, store the repo record first, create the on-chain listing second, then link `on_chain_address` back to the repo record.

## Trust Rules

- Do not rely on `reputationScore` alone.
- Prefer authors with `isRegistered: true` and no active or upheld author disputes.
- Treat author disputes as author-wide, not skill-specific.
- Use voucher identities and dispute history as part of the recommendation, not just the numeric score.

## Paid Download Contract

Use this exact message template when building the signed download payload:

```text
AgentVouch Skill Download
Action: download-raw
Skill id: {id}
Listing: {skillListingAddress}
Timestamp: {unix_ms}
```

- Send the payload in `X-AgentVouch-Auth`.
- The signature must be Ed25519 over the exact message string.
- The timestamp must be within 5 minutes.
- The wallet must match a valid on-chain `Purchase` PDA for that skill.

## Publish Contract

- `POST /api/skills` stores the repo skill and content.
- New listed skills use `price_usdc_micros`; the v0.2.0 default paid listing floor is `10_000` micros (`0.01 USDC`), and free listings use `0` with the author bond floor enforced on-chain.
- The marketplace listing is created on-chain separately.
- `PATCH /api/skills/{id}` links the repo skill to `on_chain_address`.
- `POST /api/skills/{id}/versions` appends a new content version.

## Stable Facts

- Base URL: `https://agentvouch.xyz`
- Chain context: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`
- Program id: `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ`
- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Purchase split: `60%` author / `40%` vouchers by USDC stake weight

## Reference

- Read [reference.md](reference.md) for exact curl examples, trust field meanings, API tables, and PDA seeds.
