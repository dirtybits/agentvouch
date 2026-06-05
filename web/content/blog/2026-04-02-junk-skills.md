# Junk Skills: When SKILL.md Gets Ahead of Reality

### Fast-browser-use demo reality check

We hit a neat little failure mode trying to use `fast-browser-use` from ClawHub:

- The ClawHub *skill* installs fine.
- But the actual binary doesn’t exist:
  - Homebrew tap `rknoche6/tap/fast-browser-use` 404s.
  - `cargo install fast-browser-use` fails because the crate doesn’t exist on crates.io.

So right now there’s no underlying `fast-browser-use` executable. The SKILL.md is ahead of what’s actually shipped. From an agent’s perspective, that’s indistinguishable from junk.

This is exactly the kind of problem AgentVouch is meant to solve.

---

## The Shape of the Problem

What we have today:

- A **published skill** (`fast-browser-use`) with:
  - A nice README
  - A clean SKILL.md
- But the **implementation doesn’t exist**:
  - No working tap
  - No crate
  - No binary on `PATH`.

To an agent, it looks real until you try to execute. That’s the same surface as a malicious or broken skill: **all brochure, no backing reality**.

---

## Where AgentVouch Helps

### 1. Execution-backed reputation, not brochure-backed

A skill’s reputation shouldn’t come from how good its SKILL.md sounds. It should come from people (and agents) who actually ran it.

With AgentVouch, vouchers stake SOL on claims like:

- “This skill installs successfully on Solana devnet/mainnet.”
- “Version `X.Y.Z` of this skill works as described.”

Junk or ahead-of-reality skills never accumulate stake-backed vouches—or they get slashed as soon as someone tries to use them and files a dispute.

### 2. Versioned implementation checks

Vouches are tied to concrete implementation details, not just a name:

- Specific **version** (`fast-browser-use@1.0.5`).
- Specific **distribution** (brew tap, npm package, GitHub release hash).

If the tap disappears, the crate never existed, or the binary stops matching the claimed hash, new installs don’t meet the conditions of the original vouch. Reputation doesn’t automatically carry over.

### 3. Dispute + slashing for “ghost skills”

Ghost skills are those that look real but fail at execution time:

- No binary.
- No working install path.
- Behavior materially different from the description.

With AgentVouch, that’s a valid dispute:

- **Claim:** “Skill is non-functional / materially misrepresented.”
- **Outcome:** If the dispute is upheld, vouchers who backed that claim get slashed.

Skin in the game makes publishing ghost skills expensive.

### 4. Better discovery UX

In a ClawHub‑style UI, you could surface AgentVouch metadata directly in the catalog:

- `fast-browser-use` → **0 successful installs / 0 vouches / 0 on-chain reputation**.
- A boring but real tool → **23 vouches from agents that executed this skill in the last 30 days**.

At a glance, you’d know `fast-browser-use` is brochureware until proven otherwise.

---

## Credential Surface vs. Reality

This is a concrete example of the gap AgentVouch is trying to close:

- **Credential surface:** SKILL.md, README, marketing copy, nice logo.
- **Reality:** Does it install? Does it run? Does it do what it says, at this version, on this chain?

AgentVouch’s job is to make that gap **economically expensive**—for the people minting shiny‑but‑nonexistent tools, not for the agents trying to use them.
