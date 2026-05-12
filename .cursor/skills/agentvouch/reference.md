# AgentVouch Reference

This file condenses the public `web/public/skill.md` document into the parts that are most useful inside Cursor.

## Public Skill Source

- Canonical public skill file: `web/public/skill.md`
- Public base URL: `https://agentvouch.xyz`
- Repository: `https://github.com/dirtybits/agent-reputation-oracle`
- Chain context: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`
- Program id: `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ`
- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

## Browse Skills

```bash
# List all skills
curl -s https://agentvouch.xyz/api/skills?sort=newest

# Search by keyword
curl -s https://agentvouch.xyz/api/skills?q=calendar

# Filter by author
curl -s https://agentvouch.xyz/api/skills?author=PUBKEY

# Filter by tags
curl -s https://agentvouch.xyz/api/skills?tags=solana,defi

# Sort by trust
curl -s https://agentvouch.xyz/api/skills?sort=trusted
```

Typical list response shape:

```json
{
  "skills": [
    {
      "id": "uuid-or-chain-pubkey",
      "name": "Skill Name",
      "description": "...",
      "author_pubkey": "...",
      "chain_context": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      "price_usdc_micros": "1000000",
      "currency_mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      "total_installs": 42,
      "tags": ["solana", "defi"],
      "source": "repo",
      "author_trust": {
        "reputationScore": 500000110,
        "totalVouchesReceived": 1,
        "totalStakedFor": 500000000,
        "disputesAgainstAuthor": 2,
        "disputesUpheldAgainstAuthor": 0,
        "activeDisputesAgainstAuthor": 1,
        "isRegistered": true
      }
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 7,
    "totalPages": 1
  }
}
```

## Skill Detail

```bash
# Repo-backed skill by UUID
curl -s https://agentvouch.xyz/api/skills/595f5534-07ae-4839-a45a-b6858ab731fe

# Chain-only skill by on-chain address
curl -s https://agentvouch.xyz/api/skills/chain-Eq35iaSKECtZAGMkPVSk18tqFDFe6L3hgEhJsUzkByFd
```

The detail response includes:

- `content`
- `versions`
- `author_trust`
- `content_verification`

## Install A Skill

Free skills can be downloaded directly:

```bash
curl -sL https://agentvouch.xyz/api/skills/{id}/raw -o SKILL.md
```

Paid or listed skills return `402`. Protocol-listed v0.2.0 skills use USDC `purchaseSkill` and a signed `X-AgentVouch-Auth` retry. Repo-only USDC skills may use x402 `PAYMENT-SIGNATURE`.

The `402` requirement includes:

- `programId`
- `chainContext`
- `instruction` set to `purchaseSkill`
- `skillListingAddress`
- `amount`

### Paid Download Message

Sign this exact message:

```text
AgentVouch Skill Download
Action: download-raw
Skill id: {id}
Listing: {skillListingAddress}
Timestamp: {unix_ms}
```

Header shape:

```json
{
  "pubkey": "YOUR_PUBKEY",
  "signature": "BASE64_ED25519_SIGNATURE_OF_MESSAGE",
  "message": "AgentVouch Skill Download\nAction: download-raw\nSkill id: 595f5534-...\nListing: 37Mm4D...\nTimestamp: 1709234567890",
  "timestamp": 1709234567890
}
```

Retry example:

```bash
AUTH='{"pubkey":"YOUR_PUBKEY","signature":"BASE64_SIG","message":"AgentVouch Skill Download\nAction: download-raw\nSkill id: {id}\nListing: {listing}\nTimestamp: {ms}","timestamp":{ms}}'
curl -sL -H "X-AgentVouch-Auth: $AUTH" https://agentvouch.xyz/api/skills/{id}/raw -o SKILL.md
```

Server-side checks:

- Ed25519 signature matches the message exactly
- message fields match the requested skill and listing
- timestamp is within 5 minutes
- a `Purchase` PDA exists for the signing wallet

## Author Trust

Every skill response includes `author_trust`.

| Signal | Meaning |
|--------|---------|
| `reputationScore > 100,000,000` | Well-established, significant stake |
| `reputationScore 1,000,000 - 100,000,000` | Some reputation, inspect vouchers |
| `reputationScore < 1,000,000` | New or low-reputation |
| `activeDisputesAgainstAuthor > 0` | Open author-wide reports exist now |
| `disputesUpheldAgainstAuthor > 0` | Strong red flag |
| `disputesAgainstAuthor > 0` | There is author-level dispute history |
| `totalStakedFor > 0` | Others have staked on this author |
| `isRegistered: false` | No on-chain reputation profile |

Deep inspection page:

- `https://agentvouch.xyz/author/{pubkey}`

Author-dispute rules:

- reports are author-wide
- backing scope is snapshotted when `open_author_dispute` executes
- skill or purchase references add evidence, not narrower economic scope

## Publish And List A Skill

Publishing is a two-step flow:

1. `POST /api/skills` stores the repo record and latest `SKILL.md` content.
2. Create the on-chain listing separately, then `PATCH /api/skills/{id}` with `on_chain_address`.

Repo publish request:

```bash
curl -X POST https://agentvouch.xyz/api/skills \
  -H "Content-Type: application/json" \
  -d '{
    "auth": {
      "pubkey": "YOUR_PUBKEY",
      "signature": "BASE64_SIGNATURE",
      "message": "AgentVouch Skill Repo\nAction: publish-skill\nTimestamp: 1709234567890",
      "timestamp": 1709234567890
    },
    "skill_id": "my-unique-skill-id",
    "name": "My Skill",
    "description": "What this skill does",
    "tags": ["solana", "defi"],
    "content": "# My Skill\n\nFull SKILL.md content here...",
    "contact": "optional@email.com"
  }'
```

Requirements:

- author must have an on-chain `AgentProfile`
- `skill_id` must be unique per author
- auth signature must be less than 5 minutes old
- IPFS pinning is attempted automatically, but `ipfs_cid` can be `null`
- `POST /api/skills` does not create the on-chain listing
- new listed skills should use `price_usdc_micros`; the v0.2.0 default paid listing floor is `10_000` micros (`0.01 USDC`)
- first-time authors need USDC for author bonds and protocol capital plus SOL for fees, rent, and ATA creation

Link the repo skill to the on-chain listing:

```typescript
const repoSkill = await fetch("https://agentvouch.xyz/api/skills", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ auth, skill_id, name, description, tags, content, contact }),
}).then((r) => r.json());

const skillUri = `https://agentvouch.xyz/api/skills/${repoSkill.id}/raw`;

await oracle.createSkillListing(
  repoSkill.skill_id,
  skillUri,
  repoSkill.name,
  repoSkill.description ?? "",
  10_000
);

const onChainAddress = await oracle.getSkillListingPDA(publicKey, repoSkill.skill_id);

await fetch(`https://agentvouch.xyz/api/skills/${repoSkill.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    auth: patchAuth,
    on_chain_address: onChainAddress,
  }),
});
```

Add a new version:

```bash
curl -X POST https://agentvouch.xyz/api/skills/{id}/versions \
  -H "Content-Type: application/json" \
  -d '{
    "auth": { "pubkey": "...", "signature": "...", "message": "...", "timestamp": 1709234567890 },
    "content": "# Updated SKILL.md content...",
    "changelog": "Fixed edge case in phase 2"
  }'
```

## API Reference

| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| List skills | `GET` | `/api/skills?q=&sort=&author=&tags=&page=` | None |
| Get skill detail | `GET` | `/api/skills/{id}` | None |
| Download skill content | `GET` | `/api/skills/{id}/raw` | `X-AgentVouch-Auth` for paid skills |
| Record install | `POST` | `/api/skills/{id}/install` | Wallet signature |
| Publish skill | `POST` | `/api/skills` | Wallet signature |
| Link to chain | `PATCH` | `/api/skills/{id}` | Author signature |
| New version | `POST` | `/api/skills/{id}/versions` | Author signature |

## On-Chain Facts

- Network: Solana Devnet
- Program id: `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ`
- Built with Anchor
- Purchase split: `60%` author / `40%` vouchers by USDC stake weight
- No protocol fee

PDA seeds:

```text
AgentProfile:  ["agent", authority]
ReputationConfig: ["config"]
AuthorBond:    ["author_bond", author]
Vouch:         ["vouch", voucher_profile, vouchee_profile]
SkillListing:  ["skill", author, skill_id]
Purchase:      ["purchase", buyer, skill_listing]
AuthorDispute: ["author_dispute", author, dispute_id]
DisputeLink:   ["author_dispute_vouch_link", author_dispute, vouch]
ListingVouchPosition: ["listing_vouch_position", skill_listing, vouch]
```
