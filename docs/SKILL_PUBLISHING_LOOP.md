# Skill Publishing Loop

A recurring job that publishes authored "learned" skills from this repo to the
public skills repo (`dirtybits/agent-skills`) and ensures every published skill
carries an MIT `LICENSE`.

## What it does

- **Source of truth:** authored skill directories staged under
  [`published-skills/`](../published-skills) (each is a directory containing a
  top-level `SKILL.md`).
- **Filter:** only skills classified `authored` in
  [`published-skills/local-skill-classification.json`](../published-skills/local-skill-classification.json)
  are published. `mirrored-upstream`, `private-local`, and unclassified skills
  are skipped so we never republish work that needs provenance/license review or
  is local-only.
- **MIT licensing:** every published skill gets an MIT `LICENSE` in its
  directory. If the source skill already ships a `LICENSE`, that file is synced
  as-is; otherwise an MIT license is synthesized (copyright holder defaults to
  `dirtybits`).
- **Target layout:** skills land at `<agent-skills>/skills/<name>/`, matching the
  discovery convention used elsewhere in this repo.

The engine is [`scripts/publish-learned-skills.mjs`](../scripts/publish-learned-skills.mjs)
(dependency-free Node, dry-run by default).

## Run it manually

Clone the target repo next to this one (it is gitignored at `/agent-skills/`):

```bash
git clone https://github.com/dirtybits/agent-skills.git ./agent-skills
```

Preview, then apply:

```bash
# Dry-run: print the plan, write nothing
node scripts/publish-learned-skills.mjs --agent-skills ./agent-skills

# Apply: sync authored skills + ensure MIT licenses
node scripts/publish-learned-skills.mjs --agent-skills ./agent-skills --apply
```

Publish from your local canonical skills root instead of the staged copies:

```bash
node scripts/publish-learned-skills.mjs \
  --skills-root ~/.agents/skills \
  --agent-skills ./agent-skills --apply
```

Just stamp MIT onto every skill already in the target repo (no copying):

```bash
node scripts/publish-learned-skills.mjs \
  --agent-skills ./agent-skills --license-only --apply
```

Useful flags: `--include a,b`, `--exclude a,b`, `--holder "<name>"`,
`--year 2026`, `--exit-code` (exit 2 when there are pending changes — handy in
CI), `--help`.

## Run it on a schedule (recommended)

[`.github/workflows/publish-learned-skills.yml`](../.github/workflows/publish-learned-skills.yml)
runs the job daily (07:13 UTC) and on manual `workflow_dispatch`. It checks out
`dirtybits/agent-skills`, runs the script in `--apply` mode, and opens/updates a
PR on the target repo.

**One-time setup:** add a repository secret named `AGENT_SKILLS_TOKEN` — a
fine-grained PAT (or classic token) with **contents: write** and
**pull-requests: write** on `dirtybits/agent-skills`. Without the secret the
workflow runs a dry-run and skips the PR (it will not fail).

`workflow_dispatch` inputs: `target_repo`, `apply` (default true), and
`license_only` (default false) for a one-off MIT-licensing pass.

## Why a workflow and not `/loop`

`/loop` and the in-session `CronCreate` scheduler only fire while a Claude Code
session/REPL is alive. On Claude Code on the web the container is ephemeral, so
those are fine for a one-off "do this now / a few more times this session" run
but are **not** a durable daily schedule. For a real once-a-day job use the
GitHub Actions cron above (or a Claude Code on the web scheduled trigger that
invokes the script). To kick it by hand from a session:

```text
/loop 1d node scripts/publish-learned-skills.mjs --agent-skills ./agent-skills --apply
```

## Adding a new skill to the loop

1. Stage the skill directory under `published-skills/<name>/` (must contain
   `SKILL.md`).
2. Add an entry for it in `published-skills/local-skill-classification.json`
   with `"classification": "authored"`.
3. The next scheduled run (or a manual `--apply`) publishes it with an MIT
   license.
