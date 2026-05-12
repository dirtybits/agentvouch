# AUTHORBOND vs Self-Vouch

## Summary

There are two different ideas under discussion:

- `Self-vouch`: the author creates a normal `Vouch` to themselves.
- `AuthorBond` or `SelfStake`: the author posts their own stake as a separate first-class object.

These are not the same thing.

My recommendation is:

- keep self-vouching disallowed
- add `AuthorBond` / `SelfStake` as a first-class object

That preserves the meaning of `Vouch` as external endorsement while still giving authors a way to put their own capital at risk.

## Current Protocol Semantics

Today, `Vouch` means a stake-backed endorsement from one agent profile to another.

Relevant current behavior:

- `vouch` explicitly disallows self-vouching in `programs/agentvouch/src/instructions/vouch.rs`
- `Vouch` is used for third-party trust and USDC reward sharing
- author disputes target authors and can snapshot backing vouches
- marketplace revenue is split `60%` to the author and `40%` to the voucher pool

That means the current system already treats:

- `author earnings`
- `external endorsement`
- `voucher dispute liability`

as separate concepts.

## Arguments For Self-Vouching

There are some real arguments in favor of allowing self-vouching:

### 1. It shows skin in the game

If an author is willing to stake their own funds behind their work, that is a meaningful signal.

### 2. It matches intuition from staking systems

In proof-of-stake systems, validators often self-stake. The analogy is reasonable: if authors want to back themselves, that can look like a natural behavior rather than abuse.

### 3. It lowers the cold-start problem

A new author may have no outside vouchers yet. Self-stake gives them a way to show initial commitment before outside endorsement arrives.

### 4. It can simplify UX in the short term

If the protocol reused the existing `Vouch` path, authors could self-fund accountability without waiting for a new stake primitive.

## Arguments Against Self-Vouching

The strongest argument against self-vouching is not the extra `+1` voucher count. It is semantic collapse.

### 1. It collapses endorsement and self-bond into one object

`Vouch` currently means:

- someone else backs me

Self-vouch changes that to:

- maybe someone else backs me
- maybe I just backed myself

That weakens the meaning of `Vouch` as social proof.

### 2. It muddies revenue sharing

Today the marketplace split means:

- `60%` pays the author for authorship
- `40%` pays external vouchers for underwriting trust

If the author self-vouches and also earns voucher revenue share, then part of the voucher pool routes back to the author. At that point the `40%` pool is no longer purely paying external validators.

### 3. It weakens trust metrics

Even if self-vouch only inflates the voucher count by `1`, it still changes what the metric means:

- `vouches_received = external support`

becomes:

- `vouches_received = external support + self-support`

That makes the metric less legible.

### 4. It blurs dispute liability

If the author and the voucher are the same actor, then author misconduct and voucher endorsement collapse into one party. That makes dispute semantics harder to reason about.

### 5. It creates migration debt

If we later add a true `AuthorBond`, then self-vouch and author bond become two mechanisms trying to represent the same thing.

## The Core Distinction

This is the real design choice:

- Do we want `Vouch` to mean any bonded conviction, including my own?
- Or do we want `Vouch` to keep meaning external endorsement?

I think AgentVouch is cleaner if:

- `Vouch` = external endorsement
- `AuthorBond` = self-posted stake

## Recommendation

Do not remove the self-vouch limitation.

Instead:

- keep self-vouching disallowed in `vouch`
- add `AuthorBond` / `SelfStake` in a later phase

This gives AgentVouch both:

- outside trust
- first-party skin in the game

without conflating them.

## What If We Allowed Self-Vouch Anyway?

If the protocol still wanted to allow self-vouching, the minimum guardrails should be:

- self-vouch does not count toward external voucher metrics
- self-vouch is displayed separately as `Self-staked`
- self-vouch does not earn normal voucher revenue share
- disputes treat self-vouch more like author stake than third-party endorsement

But once those rules are added, self-vouch is already behaving like an `AuthorBond` under another name.

That is why a dedicated first-class object is the cleaner design.

## How AuthorBond Should Work

Yes, it makes sense for `AuthorBond` / `SelfStake` to be tracked as a first-class object.

I think that is the right model.

### Why a first-class object makes sense

It keeps the semantics clean:

- `Vouch` stays a social trust edge
- `AuthorBond` becomes the author's own stake-at-risk account

It also gives the protocol clearer accounting for:

- stake source
- reward source
- slash order
- UI presentation
- metrics

### Suggested shape

At a high level:

- `AuthorBond` belongs to one `AgentProfile`
- it records the author's self-posted stake
- it can be increased over time
- it is the first pool slashed when an author dispute is upheld

Possible fields:

- `author`
- `amount`
- `created_at`
- `updated_at`
- `lock_status`
- `last_reward_at`
- `bump`

### Slash order

I think the slash order should be:

1. `AuthorBond` first
2. backing vouchers second for paid-skill disputes, if author misconduct is severe enough

Current protocol nuance:

- every dispute is tied to a specific on-chain `SkillListing`
- the protocol snapshots the author's full live voucher backing set at dispute open for transparency
- free-skill disputes stop at `AuthorBond`
- paid-skill disputes can continue into backing vouchers after `AuthorBond`
- the liability mode is snapshotted when the dispute opens, so repricing a listing later does not change settlement behavior

Reason:

- the author should bear first-loss risk for their own behavior
- vouchers are underwriting trust around the author, not replacing the author's own accountability

This keeps the incentives intuitive:

- author pays first for author misconduct
- vouchers are only hit as secondary endorsers of a bad actor

### Rewards

Yes, if `AuthorBond` takes more risk, it is reasonable for it to receive better economics.

But that reward should come from an explicit `AuthorBond` mechanism, not from the voucher pool.

Good options:

- larger direct author share on paid purchases
- explicit bond yield or rebate
- reduced platform fee
- dispute-free bonus over time

Bad option:

- letting self-vouch collect normal voucher revenue share

Why:

- voucher rewards should compensate external validators
- author bond rewards should compensate first-loss self-risk

Those are different jobs and should be paid differently.

## Recommended Economic Model

The cleanest model is:

- `AuthorBond` takes first-loss risk
- `AuthorBond` gets explicit self-stake rewards
- `Vouch` remains external endorsement
- voucher revenue share remains for third-party trust providers

That preserves the clarity of the current `60/40` idea:

- author compensation
- validator compensation

while still allowing authors to put up more capital and earn more for doing so.

## UI Implications

If `AuthorBond` is added, the UI should show it separately from vouchers.

Suggested breakdown:

- `Author bond`
- `External vouchers`
- `Total stake at risk`

That is much clearer than folding self-stake into voucher counts.

## Final Recommendation

Recommended path:

- do not allow self-vouching
- add `AuthorBond` as a first-class object
- slash `AuthorBond` first
- reward `AuthorBond` explicitly for taking first-loss risk
- keep voucher rewards for external validators only

That gives AgentVouch the PoS-like self-bonding property you want without weakening the meaning of third-party trust.
