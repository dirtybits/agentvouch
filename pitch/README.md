# Pitch / Walkthrough Decks

Rendered `.pptx` decks that describe the AgentVouch product and architecture. Kept in-repo so they co-version with the code they describe: when an Anchor instruction, account, or flow changes, update the deck in the same PR as the code change.

## Files

| File | Variant | Source-of-truth? |
|------|---------|------------------|
| `AgentVouch_walkthrough.pptx` | Coral Terminal (canonical hybrid — coral title + light content + dark code) | Yes — edit this one |
| `AgentVouch_walkthrough.paper.pptx` | Coral Paper (fully light, same content) | No — regenerate via `themes/recolor_to_paper.py` |
| `AgentVouch_walkthrough.no-notes.pptx` | Coral Terminal, speaker notes removed | No — regenerate via `themes/remove_speaker_notes.py` |

The Paper variant is produced by a color-substitution script, not hand-edited. If you change the canonical deck, regenerate Paper (and any future Midnight variant) so they stay in sync:

```bash
python3 themes/recolor_to_paper.py   # writes AgentVouch_walkthrough.paper.pptx
python3 themes/remove_speaker_notes.py # writes AgentVouch_walkthrough.no-notes.pptx
```

## Theme system

All three AgentVouch theme variants (Coral Terminal, Coral Paper, Coral Midnight) live in `../themes/`. See `themes/README.md` for the palette, typography, and signature motifs.

## Editing workflow

1. Open `AgentVouch_walkthrough.pptx` in PowerPoint, Keynote, or import to Google Slides.
2. Edit content. Keep numbers, instruction names, and account names tightly aligned with the current codebase (`programs/agentvouch/` and `target/idl/`).
3. Export as `.pptx`, replacing the canonical file in place.
4. Re-run the Paper recolor script if you want the light variant updated too.
5. Commit both files in the same PR as the code change that motivated the edit.

## Why in-repo and not Google Drive?

Co-versioning. The architecture appendix lists the current Anchor account structs and instructions — those facts come from the Anchor program. Keeping the deck next to the code means:

- One PR updates both
- `git blame` on a slide shows when architecture moved
- No "which Drive folder is current?" problem

Tradeoff: `git diff` on a `.pptx` is useless (binary). Rely on commit messages and visual review.

## When to reconsider

Move the deck out of the repo (to Drive or LFS) when any of:

- The repo crosses ~100 deck revisions and history bloat becomes noticeable
- A non-developer designer joins and needs to edit without a git workflow
- Deck assets grow large enough to dominate repo size

For hackathon / early-stage scope, in-repo is the right call.
