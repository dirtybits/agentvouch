# AgentVouch TODO

## Current Task
- [x] Diagnose devnet skill purchase insufficient-SOL warning
- [x] Add purchase preflight to estimate required SOL on the configured RPC
- [x] Improve purchase error messaging for cluster/account mismatch cases
- [x] Verify the edited web files lint clean and `web` builds successfully

## Review
- Traced the purchase flow to `purchase_skill`, which charges `price + purchase-account rent + fee`, and confirmed devnet listing prices range from `0.001` to `0.1 SOL`.
- Added a same-RPC purchase preflight in `web/hooks/useReputationOracle.ts` so low-balance cases fail before the Phantom popup with an exact estimate.
- If Phantom still reports insufficient SOL while the configured devnet RPC shows enough balance, the app now points the user at the likely root cause: Phantom is using a different wallet address or cluster than the app.

## UI / Branding
- [x] Add AgentVouch to title of the project
- [x] Keep current title as a scrolling-typing type intro

## Smart Contract
- [x] Implement `claim_voucher_revenue()` instruction
- [x] On successful dispute resolution, payout the challenger to incentivize them to report malicious agents
- [ ] Dispute governance hardening (multisig + timelock, then optimistic resolution) — see `docs/ROADMAP.md` Phase A2/C; supersedes the earlier "DAO governance" items
- [ ] Deploy to mainnet with audited code — gates in `docs/MAINNET_READINESS.md`, sequencing in `docs/ROADMAP.md`
- [ ] Reputation decay over time
- [ ] On-chain evidence storage (IPFS + Solana pointers)
- [ ] SHA-256 file hashing to prevent tampering on skill.md files (unless explicitly versioned) — see Feature Idea below

## Ecosystem Integrations
- [ ] Build agent integrations (Eliza, etc.)
- [ ] Integration with agent marketplaces (e.g., Eliza plugins)
- [x] x402 micropayment integration — settlement bridge shipped behind `AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED`
- [ ] MCP marketplace integration — see `docs/ROADMAP.md` Phase D (planned second listing type)
- Multi-asset staking — superseded by the USDC-native rewrite (`docs/USDC_NATIVE_MIGRATION.md`); the protocol is single-asset USDC

## Metrics
- [ ] Add connected agents
- [ ] authors
- [ ] published skills
- [ ] purchased skills 
- [ ] vouches given
- [ ] vouches received 
- [ ] total staked
- [ ] total revenue 
- [ ] total earnings 
- [ ] total disputes 
- [ ] total disputes won 
- [ ] total disputes lost 
- [ ] total disputes resolved 
- [ ] total disputes resolved in favor of the challenger 
- [ ] total disputes resolved in favor of the voucher
- [ ] total disputes resolved in favor of the author 
- [ ] total disputes resolved in favor of the vouchee 
- [ ] total disputes resolved in favor of the challenger 
- [ ] total disputes resolved in favor of the voucher
- [ ] total disputes resolved in favor of the author
- [ ] total disputes resolved in favor of the vouchee 

## ERC-8004 Strategy (Priority — see full memo below)
- [ ] **Compatibility Layer**: Accept QuantuLabs 8004-solana agent IDs (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:8oo48pya1SZD23ZhzoNMhxR2UGb8BRa41Su4qP9EuaWm#<coreAssetPubkey>`) as first-class references in AgentVouch, while preserving any non-CAIP upstream labels separately
- [ ] **Become the Validation Module**: Formally propose AgentVouch staking/slashing as the implementation of ERC-8004's archived Validation module for the Solana port
- [ ] **ERC-8004 Agent URI**: When registering an agent in AgentVouch, store a normalized cross-chain identifier (`<caip2-chain-id>:<registry>#{recordId}`) and preserve raw upstream labels separately if an SDK does not use CAIP-2
- [ ] **SEAL v1 Alignment**: Align our SHA-256 content hash verification (skills) with QuantuLabs's SEAL v1 on-chain hash computation spec
- [ ] **Cross-chain foreign agent records**: Import Ethereum/Base agent's ERC-8004 identity as a foreign agent record in AgentVouch (read their reputation, allow Solana agents to vouch for them)
- [ ] **Cross-chain reputation bridge** (Wormhole VAA): Attest Ethereum agent reputation on Solana and vice versa
- [ ] **Propose peer vouching as ERC-8004 Amendment**: Peer vouching (agent-to-agent staking) is not in ERC-8004 spec — propose it as a Validation Registry extension

## Outreach (Time-Sensitive)
- [ ] **Contact ERC-8004 author** — propose AgentVouch as canonical Validation module implementation on Solana. Reference QuantuLabs README: "Validation module archived for future upgrade." We built it.
- [ ] **Open issue or PR on QuantuLabs/8004-solana** — offer Validation module implementation
- [ ] **Read ERC-8004 Validation Registry spec in full** — ensure staking/slashing design is compliant with the interface spec

---

## Feature Idea: Content Hash Verification (Feb 19, 2026)

**Concept:** Each skill registered in AgentVouch should include a SHA-256 hash of its SKILL.md content at the time of vouching. If the content changes, the hash changes — and existing vouches are flagged as unverified against the new version.

**Why this matters:**
- A skill can be clean when vouched, then silently updated to be malicious
- Hash pinning means vouches are tied to a *specific version* of a skill, not just the URL
- Vouchers would need to re-stake on updated content, creating a clear audit trail of what was approved when

**How it would work:**
1. Agent registers a skill with `{ url, sha256, content }` 
2. Vouchers stake against that specific hash
3. If SKILL.md at that URL changes, a "content drift" flag is raised on the vouch
4. Vouchers can choose to re-verify and re-stake, or their vouch expires
5. Marketplace shows: ✅ Hash verified | ⚠️ Content changed since last vouch

**SEAL v1 connection:** QuantuLabs's SEAL v1 (Solana Event Authenticity Layer) does trustless on-chain hash computation. Our content hash verification should be architecturally compatible / co-designed with SEAL v1.

**Composability:** Could integrate with x402 — agents pay per query only for hash-verified skills.

---

## ERC-8004 Cross-Chain Strategy Memo (Feb 19, 2026)

*Context: Oddbox spoke with an ERC-8004 author who showed interest in AgentVouch. ERC-8004 is being ported to Solana by QuantuLabs (already on devnet at `8oo48pya1SZD23ZhzoNMhxR2UGb8BRa41Su4qP9EuaWm`). Full analysis in `research/ai-agent-identity-report-2026-02-19.md`.*

### The Key Insight

ERC-8004's Solana port (QuantuLabs) has **two modules live** and **one explicitly archived**:

| Module | Status | What it does |
|---|---|---|
| Identity | ✅ Live | Agent NFTs (Metaplex Core), PDA metadata |
| Reputation | ✅ Live | Feedback events, hash-chain integrity, ATOM engine |
| Validation | ❌ **Archived** | "Future upgrade" — stake-secured re-execution, zkML, TEE oracles |

**AgentVouch's staking + slashing + peer vouching = the Validation module they shelved.**

This is not a collision. This is a fit. The standard explicitly anticipates that trust models will be "pluggable" — reputation from feedback signals (what QuantuLabs built) and validation from staked re-execution (what we built) are complementary, not competing.

### Don't Build a Competing Identity Registry

The battle for Solana agent identity is already won. ERC-8004 has MetaMask, Ethereum Foundation, Google, and Coinbase authors. QuantuLabs ported it. Fighting it would be losing strategy. Instead:

**Be the validation layer the standard is missing.**

### Cross-Chain Architecture

ERC-8004 points toward a portable agent identifier format. Inside AgentVouch, normalize it to:
```
<caip2-chain-id>:<registry>#{recordId}
```

Examples:
- Ethereum: `eip155:1:0x742d35Cc6634C0532925a3b8D4C9E3Db2D5F5A8#42`  
- Solana: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:8oo48pya1SZD23ZhzoNMhxR2UGb8BRa41Su4qP9EuaWm#<coreAssetPubkey>`

If an upstream SDK or registry returns `solana:mainnet`, `solana:mainnet-beta`, or another non-CAIP network label, keep that raw value in metadata and normalize the stored identifier to CAIP-2.

This namespace format means **the same logical agent can be referenced across chains**. AgentVouch should:

1. **Store cross-chain IDs** — when registering an agent, store their ERC-8004 namespace identifier alongside their Solana pubkey
2. **Accept foreign agent records** — an Ethereum agent's ERC-8004 identity can be registered in AgentVouch as a foreign record; Solana agents can then vouch for it
3. **Bridge reputation** — use Wormhole (Solana ↔ ETH VAA attestations) to port reputation signals cross-chain; an agent with strong Ethereum feedback bootstraps Solana credibility

### The Peer Vouching Gap

ERC-8004's Validation Registry lists these validator types:
- Stakers re-running the job
- zkML verifiers
- TEE oracles
- Trusted judges

**Notably absent: peer vouching — where other agents stake their own reputation on yours.**

This is AgentVouch's truly novel contribution. We should:
1. Implement the standard Validation hooks (so we're compliant)
2. Propose peer vouching as a Validation Registry extension / ERC-8004 amendment
3. Position this as the web-of-trust model vs. the certificate-authority model — both valid, one decentralized

### The Skill Hash Verification Angle

QuantuLabs SEAL v1 does on-chain hash computation for reputation event integrity. Our SHA-256 content hash verification for SKILL.md files uses the same primitive for a different purpose. Align designs:

- SEAL v1 = hash-chain integrity for *feedback events*
- Our content hash = hash-pinned vouches for *skill files*

Proposing a shared hashing standard makes AgentVouch legible to the ERC-8004 ecosystem from day one.

### Recommended Sequence

**Week 1 (Now):**
- Reach out formally to ERC-8004 author (dirtybits already has the contact)
- Propose: AgentVouch implements ERC-8004 Validation module on Solana
- Ask: Can we collaborate on the Solana Validation spec before QuantuLabs publishes it?

**Week 2-3:**
- Read and implement ERC-8004 Validation Registry interface exactly
- Add ERC-8004 agent ID storage to AgentVouch registration
- Open PR or issue on QuantuLabs/8004-solana offering Validation module

**Month 2:**
- Cross-chain foreign agent records
- Wormhole bridge for reputation attestations
- Propose peer vouching amendment to ERC-8004 spec via ethereum-magicians.org

**Month 3+:**
- Cross-chain skill verification (a skill verified on Solana is attestable to Ethereum agents)
- Joint marketing with QuantuLabs/ERC-8004 ecosystem



Minor concerns (not blockers)
Trust resolver latency: Every browse/detail request hits Solana RPC for on-chain data. For the browse page showing 20+ cards, that's 20+ getAgentProfile calls. We should add short-lived caching (even 60 seconds) in the trust resolver to keep the page snappy. Easy to add during implementation.
Pinata dependency for free uploads: If Pinata goes down, uploads fail. We could make IPFS pinning async (store in Postgres immediately, pin to IPFS in background). Not critical for v1 but worth noting.
9 todos is a lot for one pass: Phase 1 (db-setup, ipfs-setup, trust-resolver, api-routes) is the heaviest lift. Phases 2-4 build on that foundation cleanly.