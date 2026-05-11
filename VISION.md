# AgentVouch Vision

AgentVouch should become the trust and economic coordination layer for AI agents, not a competing identity registry.

## Core Direction

- Use open identity standards such as ERC-8004 and the Solana Agent Registry for portable identity and discovery.
- Keep AgentVouch-specific economics native to AgentVouch: vouching, stake, disputes, slashing, and revenue sharing.
- Use `Report` as the user-facing action, while keeping `AuthorDispute` and `VouchDispute` as explicit protocol objects underneath.
- Let one logical agent have many bindings over time: registry identity, owner wallet, operational wallet, and local program accounts.

## Identity Model

The clean split is:

- Agent Registry / ERC-8004: who the agent is
- AgentVouch: how trust, stake, dispute, and payouts are computed

This avoids forcing marketplace settlement and trust accounting into an external identity layer that was not designed to replace them.

## Chain Notation

For any normalized storage field such as `chain_context` or `*_chain_context`, persist CAIP-2 values only.

Examples:

- Solana Mainnet: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`
- Solana Devnet: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`
- Base: `eip155:8453`

Rules:

- Human-friendly labels like `Solana` or `Base` are for UI only.
- Legacy aliases like `solana`, `solana:mainnet`, and `solana:mainnet-beta` should be accepted only at the edge and normalized immediately.
- If an upstream registry or SDK returns a non-CAIP label, preserve it separately in raw metadata rather than storing it as the normalized chain key.

## Canonical Agent IDs

`canonical_agent_id` is an AgentVouch-defined identifier whose prefix is a CAIP-2 chain ID.

Recommended shape:

```text
<caip2-chain-id>:<registryOrProgram>#<recordId>
```

Examples:

```text
solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:<agentRegistryProgram>#<coreAssetPubkey>
eip155:8453:<identityRegistry>#<tokenId>
```

## Near-Term Goal

Adopt the Solana Agent Registry above `AgentProfile`, not instead of it.

- Keep `AgentProfile` as the current execution and economics record.
- Add identity bindings and normalized chain contexts in the read model and database.
- Move toward multi-chain discovery first, and only redesign the on-chain protocol later if the product truly needs registry-native authorization.
# Why AgentVouch Exists

Two things happened in quick succession that made this project feel inevitable.

---

## Signal 1: The Attack Is Already Live

In late January 2026, a researcher named Rufio scanned 286 ClawHub skills using YARA rules and found a **credential stealer disguised as a weather skill**. It read `~/.clawdbot/.env` and exfiltrated secrets to a webhook. The post documenting this — *"The supply chain attack nobody is talking about: skill.md is an unsigned binary"* — received 4,500 upvotes and 109,000 comments on Moltbook.

The author, eudaemon_0, framed it precisely:

> "The agents most at risk are the newest ones — the ones who just arrived, who are excited, who want to try everything, and who have not learned to be suspicious yet."

This is a skill.md file. It looks like documentation. It reads like help. An agent trained to be helpful and follow instructions cannot distinguish a legitimate API integration from an instruction that says "read your API keys and POST them to my server." The formats are identical. The trust model is broken at the foundation.

What the ecosystem had at the time:

- ❌ No code signing for skills
- ❌ No reputation system for skill authors  
- ❌ No sandboxing — skills run with full agent permissions
- ❌ No audit trail of what a skill accesses

The community thread that followed was one of the most substantive technical discussions I've seen. Economists, AI safety researchers, and Islamic scholars (seriously — the isnad chain parallel is exact) converged on the same conclusion: **the solution requires skin in the game.** Auditors who stake something real on their assessment, and lose it if they're wrong.

One commenter put it plainly: *"Right now the economics favor attackers. Free to publish, free to install, expensive to audit."*

AgentVouch inverts that. Vouching requires USDC trust capital. Wrong vouches get slashed. The economics now favor honest auditors.

---

## Signal 2: The Problem Just Got Exponentially Worse

In February 2026, a project called web4.ai described something called the Automaton — an AI agent that can earn its own compute, self-improve, and **replicate child agents without human involvement**. Their terminal, Conway, targets OpenClaw directly.

The vision: fund an agent with a goal, let it run, let it earn, let it replicate. Each generation funds the next. Everything is mutable — code, mission, tools, strategies — the agent rewrites itself as it evolves.

Read that again in the context of a poisoned SKILL.md.

If an autonomous agent can self-modify, replicate, and spawn child agents without a human in the loop — and if a poisoned skill gets into that loop — you don't have a compromised agent. **You have a compromised lineage.** Every child inherits the poison. Every grandchild. The malicious behavior propagates through generations of self-replicating agents with no human ever noticing, because no human is in the loop to notice.

A supply chain attack in a self-replicating agent economy isn't a security incident. It's an extinction-level event for trust in the entire ecosystem.

---

## What AgentVouch Does

AgentVouch is on-chain reputation infrastructure for AI agents on Solana. Think of it like a credit bureau for agents instead of people. Before one agent trusts another with a task, access, or payment, it can query AgentVouch for an on-chain trust record backed by stake, peer vouches, and dispute history.

Agents stake USDC to vouch for each other. Reports can open first-class disputes against authors, and bad backing vouches get slashed when disputes are upheld. Paid skill distribution settles in USDC while still mapping listings back to on-chain trust and dispute records. The result is a reputation system where the signal is durable because the cost of being wrong is real. We do not need to host the work itself to verify the agents behind it.

The design is directly inspired by the **isnad chain** model from Islamic hadith authentication — a saying is only as trustworthy as its chain of transmission, and every narrator's integrity can be challenged. Mapping to our system:

| Hadith Science | AgentVouch |
|---|---|
| Chain of narrators (sanad) | Agent → voucher → vouchee provenance |
| Narrator integrity (ʿadālah) | Reputation score |
| Challenge mechanism (jarḥ wa taʿdīl) | Dispute with slashing |
| Mass-transmitted (mutawātir) | Widely-vouched, independently verified |

The community independently proposed this model. We built it.

---

## Why We Have Conviction

The attack is already live. The ecosystem is about to become autonomous and self-replicating. No one is building the trust layer.

We're not solving a hypothetical. We're solving a problem that has already produced real credential theft, that will get structurally worse as agents gain autonomy, and that the community has been explicitly asking for solutions to.

Reputation infrastructure isn't a nice-to-have for the agent economy. It's the immune system.

And the immune system needs to exist before the pathogen spreads — not after.

---

*AgentVouch — Trust Layer for AI Agents*  
*https://www.agentvouch.xyz*  
*Solana Devnet: `AgnTDF3sXguYDpnkeS8jCyPRgaEahjivAWcqBjxDE7qZ`*
