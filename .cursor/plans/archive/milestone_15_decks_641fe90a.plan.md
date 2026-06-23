---
name: Milestone 15 Decks
overview: Update the canonical AgentVouch walkthrough deck and regenerated paper variant so the pitch narrative matches the current USDC-native protocol, Milestone 13 escrow/refund plan, and Milestone 14 SEO/LLM docs ordering.
todos:
  - id: extract-deck-text
    content: Extract and audit canonical deck slide text for stale SOL/v0.1/milestone claims.
    status: completed
  - id: patch-canonical-deck
    content: Patch the canonical PPTX copy and architecture facts while preserving layout/theme.
    status: completed
  - id: regenerate-paper-deck
    content: Regenerate the paper PPTX from the updated canonical deck.
    status: completed
  - id: verify-decks
    content: Run deck text searches and file checks to prove the updated decks are aligned.
    status: completed
isProject: false
---

# Milestone 15 Pitch Deck Update

## Scope
- Update the canonical deck at [pitch/AgentVouch_walkthrough.pptx](file:///Users/andysustic/Repos/agent-reputation-oracle/pitch/AgentVouch_walkthrough.pptx).
- Regenerate the paper deck at [pitch/AgentVouch_walkthrough.paper.pptx](file:///Users/andysustic/Repos/agent-reputation-oracle/pitch/AgentVouch_walkthrough.paper.pptx) via [themes/recolor_to_paper.py](file:///Users/andysustic/Repos/agent-reputation-oracle/themes/recolor_to_paper.py).
- Do not change protocol code. Deck claims stay aligned to shipped behavior; unshipped escrow/refund/mainnet/governance claims are labeled `WIP` or future milestone.

## Approach
- Extract slide text from the canonical PPTX as OOXML so we can audit stale content before editing.
- Patch stale deck copy in-place through a small one-off Python script or direct OOXML edits, preserving the existing layout/theme as much as possible.
- Refresh architecture facts from current sources:
  - Program ID: `AgNtCcWfeMYUzHxvGdZP5BJszQhx6NJGB4pQ7AN6XVWz`
  - Program path: [programs/agentvouch](file:///Users/andysustic/Repos/agent-reputation-oracle/programs/agentvouch)
  - Current model: 16 instructions, 9 Anchor account structs
  - USDC-native trust capital: author bonds, vouches, disputes, purchases, rewards
  - Current paid purchase path: `purchase_skill` with 60/40 author/voucher split
  - Milestone 13: escrowed proceeds and purchaser refunds remain planned, not shipped
  - Milestone 14: SEO and LLM-facing docs
  - Milestone 15: deck and public narrative alignment
- Update deck README only if its stale architecture count or milestone wording would mislead reviewers.

## Verification
- Re-extract slide text and run targeted searches for stale terms:
  - old program ID `ELmVnLSN`
  - `0.001 SOL`
  - SOL-denominated vouch/listing/purchase claims outside fee/rent context
  - stale account/instruction counts
  - Milestone 14 deck references
- Regenerate the paper deck with:
  - `python3 themes/recolor_to_paper.py`
- Verify both PPTX files exist and are non-empty.
- If possible, inspect the patched slide text from both decks to confirm the content matches.

## Notes
- I will not edit the plan file attached in chat.
- I will keep deck copy factual and concise, avoiding mainnet, escrow, refund, or governance claims that are not implemented yet.