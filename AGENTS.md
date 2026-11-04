# AgentVouch — working instructions

AgentVouch provides USDC-backed reputation for agent skills, with a marketplace
that uses those trust records. `CLAUDE.md` redirects to `AGENTS.md`.

## Keep work proportional to the task

- Confirm the checkout and branch before changes. Preserve unrelated edits and
  running services. Use `git worktree list` when checkout ownership is unclear.
- For routine local operations, inspect what is needed, execute, and verify the
  result. Do not create a plan, check GitHub login, or run unrelated tests.
- For multi-step implementation, use an existing plan or create a concise
  `.agents/plans/*.plan.md`. Read its todos and dated notes when resuming.
- Reuse observations from this chat unless the state may have changed. Read only
  the relevant reference sections. Delegate only when independent work warrants it.
- Use Simplified Technical English where appropriate. State the action and result
  plainly. End with the outcome and evidence; suggest follow-ups only when useful.

## Preserve these safeguards

Base mainnet (`eip155:8453`) must remain disabled until the Base Mainnet Gate Table
in [MAINNET_READINESS.md](docs/MAINNET_READINESS.md) passes and the user explicitly
authorizes enablement. A passing test or a written proposal is not launch approval.

Use authorization already given in the chat. If it is missing, obtain approval
before any of these actions:

- Mainnet deployment, real-funds transaction, or custody/authority change.
- Broadly enabling flag-gated money flows, including sponsored checkout or x402.
- Destructive live database work; non-additive schema changes; new unique
  constraints on live data. Approval does not replace migration safeguards.
- Changing economic parameters, minimum amounts, revenue splits, or trust meaning.
- Expanding `ChainAdapter` or `ChainWallet`; removing Solana paths or its adapter.
- Adding dependencies, changing the build toolchain, or rewriting shared history.
- Editing a user-authored plan beyond status updates and dated divergence notes.
- Publishing outbound content. Production web deploys follow the authorized
  PR/Vercel workflow; these instructions grant no deployment permission.

If a proposed fix conflicts with another invariant, stop and resolve the conflict.
Do not guess at authorization or expand scope to unrelated improvements.

## Read details when the task needs them

The [companion reference](docs/AGENT_REFERENCE.md) retains the detailed rules.
Before editing a subsystem or making claims about its behavior, read its listed
sections. If a change spans topics, read each relevant section.

| Task | Required reference sections and owning sources |
| --- | --- |
| Chain, contracts, ABI, adapters, or deployment | Companion: chain rules, signing and payments, recorded protocol facts, contract build steps, live verification, and devnet breaking changes when applicable. Read [CHAIN_CAPABILITY_MAP.md](docs/CHAIN_CAPABILITY_MAP.md), [MAINNET_READINESS.md](docs/MAINNET_READINESS.md), and the applicable phase plan. |
| Database, identity, or purchase records | Companion: database rules and migration checks; also chain rules for chain-qualified data and signing rules for purchase/auth changes. |
| Wallets, authentication, sponsored flows, or payments | Companion: signing and payments, chain rules, recorded protocol facts, and live verification. |
| UI or frontend behavior | Companion: UI rules and design language; product/copy rules for wording or trust displays. |
| Product claims, economics, or onboarding docs | Companion: product/copy rules and recorded protocol facts. Read [ROADMAP.md](docs/ROADMAP.md) for strategy; [DEVNET_STATE.md](docs/DEVNET_STATE.md) for live Solana evidence. |
| Skill packages, tree hashes, manifests, or download checks | Read [SKILL_TREE_HASH.md](docs/SKILL_TREE_HASH.md) and companion: skill package integrity. |
| Skill scanning or evaluations | Companion: recorded protocol facts and testing rules. Preserve the scanner's `review\|avoid` verdict limit; detection tests do not establish resistance to behavioral injection. |
| Build failures, local startup problems, Git, or plans | Read the matching companion section only when needed. |
| Presentations | Companion: presentation assets; verify historical counts before reuse. |

Current code and tests establish source behavior. Deployment evidence establishes
live behavior. Plans and dated decisions establish intended scope. If they disagree,
report the conflict and correct stale documentation when in scope. Memory is a
route to evidence, not proof of current state.

## Local development

For Node/npm commands, load the version in `.nvmrc` (currently Node 24):

```sh
. "$HOME/.nvm/nvm.sh" --no-use && { nvm use --silent || nvm install; }
```

1. Check whether this checkout already has a server and whether the intended port
   is free. Use `http://localhost:<port>` or `http://127.0.0.1:<port>`.
2. If setup is missing, inspect `scripts/worktree-setup.sh`. Use root `npm ci`
   for installation. Never install through a `node_modules` symlink that would
   change another checkout. Reused dependencies can be stale.
3. Copy missing local environment files only from the intended checkout; do not
   overwrite existing configuration or print secrets. Never run two dev servers
   against the same `web/.next` directory.
4. Start with `npm run dev --workspace @agentvouch/web`, then verify the page loads.
   If startup exposes a missing dependency, repair the install before changing code.

## Verify the changed behavior

| Change | Required verification |
| --- | --- |
| Routine local operation | Check the requested result, such as the rendered page and HTTP response. |
| Documentation only | Check accuracy, links, and preserved identifiers/statuses. Report that the app build was skipped. |
| Substantive web change | `npm run format:check`, workspace lint, typecheck, Vitest, and `npm exec --workspace @agentvouch/web -- next build --webpack`. CI's test job does not include this build. |
| EVM contract change | Run `forge test` in `contracts/base-poc/`, plus affected integration checks. |
| Solana instruction/account interface | Run `NO_DNA=1 anchor build`; synchronize IDL and generated clients as the companion specifies. |
| Chain/protocol/adapter/readiness work | Run `npm run verify:chain-map`. Re-run the recorded live selector check before changing a deployed-status claim. |

Test pure helpers through behavior. Keep cross-chain boundary tests. Sweep old
identifiers with `rg` after renames. For UI changes, verify both themes and use
`globals.css` tokens. For other code, run checks suited to the affected workspace.

Tests do not prove a live wallet or payment flow works. Record the required browser,
transaction, balance, and access-control evidence before closing those milestones.
State skipped or failed checks. Keep plan statuses honest.

## Git and project records

- Before GitHub operations, confirm `gh auth status` uses `dirtybits`; switch with
  `gh auth switch --user dirtybits` if needed. Keep the verified Git author identity.
- Use one feature/phase per PR from current `main`. Follow the configured branch
  prefix and give the branch a descriptive work name. Include dependency manifests
  and the root lockfile together when committing an authorized dependency change.
- Use signed commits. If signing fails, report the exact error and provide
  `git commit --amend -S --no-edit`; do not silently make an unsigned commit.
  Do not add attribution trailers unless requested.
- Keep strategy in `docs/ROADMAP.md`, gates in `docs/MAINNET_READINESS.md`, and live
  Solana evidence in `docs/DEVNET_STATE.md`. Preserve history and approval records.
- After major product, API, or protocol changes, check `web/public/skill.md` against
  behavior. It is the canonical agent contract; do not add a root `SKILL.md`.

Detailed technical rules belong in the matching companion section. Add a root rule
only when every task needs it or it protects a critical boundary.
