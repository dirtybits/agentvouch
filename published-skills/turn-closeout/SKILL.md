---
name: turn-closeout
description: End substantial Codex turns with a concise outcome, concrete verification status, numbered recommended next steps, and an explicit prompt asking whether to proceed with one of those options. Use when wrapping up implementation work, debugging, research, planning, reviews, publishing flows, or other non-trivial tasks where the user may want Codex to continue with recommended follow-up actions.
---

# Turn Closeout

Use this skill to make final responses feel complete but still alive with momentum. The closeout should tell the user what happened, how it was verified, and what Codex recommends doing next.

## Closeout Workflow

1. Lead with the actual outcome in plain language.
2. Include concrete proof when available: tests run, commands passed, links, IDs, artifacts, logs, or behavioral checks.
3. Mention skipped or failed verification directly when it matters.
4. Recommend only useful next steps that naturally follow from the work. Prefer 1-3 options; use more only when the user has a real branching decision.
5. End with an explicit offer to continue: "Would you like me to proceed with 1, 2, or 3?"

## Numbered Options

Make options short and action-shaped:

```text
Recommended next steps:
1. Run the production build.
2. Open a quick browser verification pass.
3. Commit and publish the branch.

Would you like me to proceed with 1, 2, or 3?
```

For one clear follow-up, use a single option:

```text
Recommended next step:
1. Run the targeted regression test now.

Would you like me to proceed with 1?
```

## Skip Conditions

Skip the numbered closeout when:

- The user asked a tiny factual question.
- The final answer is already a direct command output or short status update.
- The user explicitly asked not to continue or not to suggest follow-ups.
- There is no meaningful next action.

## Style

Keep the closeout concise. Do not bury the result under process notes. Do not invent verification. Do not recommend generic chores unless they are genuinely relevant to the user's goal.
