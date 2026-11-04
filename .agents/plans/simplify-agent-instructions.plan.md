---
name: simplify-agent-instructions
overview: "Prepare shorter AgentVouch instructions and a personal memory trim for review without activating either."
todos:
  - id: draft-instructions
    content: Draft the shorter root instructions and retain detailed safeguards in a companion reference.
    status: completed
  - id: draft-memory
    content: Propose a smaller automatic memory summary with retained historical lookup routes.
    status: completed
  - id: verify-drafts
    content: Check safeguard coverage, local links, size reductions, and unchanged active files.
    status: completed
isProject: false
---

# Draft simpler agent instructions

## Goal and scope
Prepare reviewable drafts. Do not replace active instructions, edit generated memory, delete history, change application code, or restart the running server.

## Files
- `AGENTS.draft.md`: proposed root instructions.
- `docs/AGENT_REFERENCE.draft.md`: detailed safeguards and topic-specific procedures.
- `/Users/andy/.codex/visualizations/2026/11/04/01a1a558-dfd3-78f1-ba79-bd50f556eacd/instruction-review/memory-trim-proposal.md`: private memory proposal, outside the repository.

## Verification
Compare all 35 named failure rules and approval boundaries with the source. Check Markdown links and report word counts. Confirm active AGENTS.md and memory files remain byte-for-byte unchanged. Skip application tests and builds because these are Markdown review drafts.

## Adoption and rollback
Adoption is a separate action after review. If approved, install the root and companion together and submit memory changes through an extension note; never edit generated memory files directly. These drafts can be removed without changing active behavior.

## Notes
- 2026-11-03: Read the current AGENTS.md, generated memory summary, and saved simplicity preference. Historical deployment and career claims are being organized, not revalidated.
- No blockers to drafting.

- 2026-11-03 verification: all 35 failure rules and every original stop/ask approval boundary retained; local links and 16 memory lookup routes valid; active AGENTS.md, generated memory summary, and saved preference note match their original SHA-256 values. Added explicit routing for scanner evaluations and devnet breaking changes. Application tests/build skipped because only review drafts were created.

## 2026-11-04: approved adoption

The user explicitly approved installing the shorter instructions and submitting the memory trim. This supersedes the original draft-only scope for adoption; the original review record above remains historical.

- Installed `AGENTS.md` and `docs/AGENT_REFERENCE.md` together and removed the superseded `.draft.md` files.
- Root instructions are 1,117 words versus 5,262 previously (79% shorter). Detailed safeguards remain in the companion, with task-specific reading rules in the root.
- Saved the consolidation request at `/Users/andy/.codex/memories/extensions/ad_hoc/notes/2026-11-04T08-09-59Z-shorten-automatic-summary.md`. This session uses `memories/`; the proposal's older `memories_v2/` history remains intact.
- The memory summary will change only when the memory system processes the note. No generated summary or historical record was edited.
- Adoption verification passed: all 35 named safeguards and both approval-boundary sections match the previous manual, apart from two updated section references. All seven active document links resolve, `git diff --check` passed, the saved note matches the prepared request, and both generated memory summaries are byte-for-byte unchanged. Application tests and build were not repeated for these Markdown changes; the separate homepage checks already passed.
