# AgentVouch — Agent Operating Manual

This file is the operating manual for any model working in this repo. `CLAUDE.md` redirects here; write learned rules here, not there. It is organized so a less experienced model can act at a senior level: orientation first, then conventions, then the named mistakes this codebase has already produced (each with the rule that prevents it), then checkable quality bars per deliverable, then exact escalation rules for uncertainty.

**How to use it:** read §0–§2 every session. Consult §3 (mistakes) before touching anything chain-tagged, DB, wallet, or money-moving. Check your work against §5 before calling anything done. When unsure, apply §6 literally instead of guessing.

## 0. Orientation (read first, 60 seconds)

- **Product:** AgentVouch is a USDC-stake-backed reputation system + marketplace for agent skills. The durable asset is verified, staked, accountable trust data (vouches, author bonds, disputes, slash records); the marketplace is the proving ground. Positioning: reputation oracle first, storefront second (`docs/ROADMAP.md`).
- **Chain posture (as of 2026-07-08):** Base Sepolia (`eip155:84532`) is the **default** new-user writable path (Phase 8a, PR #74), behind a single rollback env (`NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana`, then redeploy). Solana devnet stays fully selectable with its complete trust layer (slashing A1, pause A3 live). The original Base fallback contract is the `base-poc-v0` spike (`0x6Fd9…D854`); Phase 9 live smokes now use a Base Sepolia v1 candidate (`0x5992…B7d1`, `PROTOCOL_VERSION=base-v1-candidate`) for report/vouch paths, but Phase 9 is still open until the A1 voucher-slashing port, custody policy, and security reviews land. Phase 10 (Base mainnet, `eip155:8453`) is a **BLOCKED gate plan** — any code that enables `eip155:8453` before the `docs/MAINNET_READINESS.md` Base Mainnet Gate Table passes is a stop-the-line bug.
- **Repo map:** `web/` Next.js app (App Router, deploys from `web/` on the Vercel project named `agentvouch`); `programs/agentvouch/` Solana Anchor program; `contracts/base-poc/` Foundry EVM contract + harness/ui; `packages/agentvouch-cli` + `packages/agentvouch-protocol` npm workspaces; `.agents/plans/` implementation plans; `evals/skill-scan/` offline eval harness; `docs/` decision + ops docs.
- **Sources of truth** (trust these over prose in handoff messages):
  - Building next / strategy / sequencing: `docs/ROADMAP.md`.
  - Can we launch / gate status / audit findings: `docs/MAINNET_READINESS.md` Base Mainnet Gate Table.
  - What a gate means: the gate plan file (`.agents/plans/base-a1-voucher-slashing-port.plan.md`, `.agents/plans/a1-voucher-slashing.plan.md`, `.agents/plans/a2-*.plan.md`, `.agents/plans/a3-emergency-pause.plan.md`); A4/A5 live as readiness-table rows until they get dedicated plans.
  - What happened in phase N: `.agents/plans/base-port-chain-adapter*.plan.md` frontmatter todos + dated notes; completed Phase 1–8 sections are historical and should not be edited except corrections.
  - Which PR/branch carried a change: `gh pr view` plus the umbrella ledger.
  - Live Solana devnet state (program ID, deploy txs, smoke fixtures): `docs/DEVNET_STATE.md`.
  - Chain seam interfaces: `web/lib/adapters/types.ts`.
  - Agent-facing product contract: `web/public/skill.md` (canonical served file; keep in sync after protocol/product changes; do not create a duplicate root `SKILL.md`).

## 1. Session start checklist

1. **Confirm which worktree/branch you are in**: `git worktree list` + `git rev-parse --show-toplevel`. Multiple agents (Codex, Cursor, Claude) run in separate worktrees under `.codex/`, `.cursor/`, `.claude/worktrees/`; a branch can be checked out in only one worktree at a time. macOS is case-insensitive — never infer the checkout from `~/repos` vs `~/Repos` path casing.
2. **Node version**: `.nvmrc` says 24, but the agent shell may pin Node 20 ahead of nvm. Run `export PATH="$HOME/.nvm/versions/node/v24.1.0/bin:$PATH"` in each Bash call or vitest dies with `ERR_REQUIRE_ESM`.
3. **Dependencies**: fresh worktrees lack gitignored `node_modules` and `web/.env.local`; `scripts/worktree-setup.sh` primes them (APFS reflink + env copy; a SessionStart hook may auto-run it). Use root `npm ci` (not `npm install`) as the canonical install — `npm install` in the CLI workspace loses rolldown bindings. If a build fails with missing modules (e.g. `Cannot find module 'ai'`), fix worktree dependency resolution (symlink from the primary checkout at `/Users/andysustic/Repos/agentvouch`) and clear stale `web/.next` — do not add duplicate deps or change app code.
4. **GitHub identity**: `gh auth status` — the active account must be `dirtybits`. Session resume can silently flip it to a secondary managed (EMU) account that cannot create PRs here; fix with `gh auth switch --user dirtybits`. Keep the repo-local Git author on the verified `dirtybits` identity even when other logins exist on the machine.
5. **Branching**: one phase/feature = one PR off current `main` (`feat/<topic>` or `feat/base-port-phase-<N>`). Per-agent branches (`claude/…`, `cursor/…`, `codex/…`) are scratch that rebase/reset onto the shared feature branch.
6. **If resuming plan work**: read the plan frontmatter todos AND the dated sequencing notes (dated notes override frontmatter order when they say so). Set the todo `in_progress` when you start.

## 2. Conventions

### Planning and execution

- Start non-trivial work with a plan (`.agents/plans/*.plan.md`, per the plan-writing skill); when the user provides a plan, follow it as written — don't edit it unless asked, don't recreate existing todos. Mark todos `in_progress`/`completed` as you go, `completed` only when the **Done when** passes (verification, not compile). Append dated notes at the point of divergence; a plan that lies is worse than no plan.
- Use subagents liberally for focused research, exploration, and parallel analysis. Think through the solution before making code changes.
- Favor root-cause fixes and minimal-impact changes over temporary patches.

### Build, test, and CI

- Full local gate for any substantive web change: `npm run format:check`, workspace lint, typecheck, vitest, and `npm exec --workspace @agentvouch/web -- next build --webpack` (webpack explicitly — bundler-parity gate). For docs-only changes, explicitly note the build was skipped.
- **CI's `test` job runs format/lint/typecheck/vitest but NOT `next build` — Vercel is the real web build/typecheck gate.** A green `test` job does not mean the app builds.
- `forge test` runs in a separate CI `contracts` job — keep it green if contracts change. Local worktrees may lack `contracts/base-poc/lib`; vendor deps or rely on CI. `contracts/base-poc/ui` is `.prettierignore`d; `web/` is not — keep `web/` prettier-clean.
- `npm` is the only package manager; no conflicting lockfiles. Commit dependency changes (`package.json` + root `package-lock.json`) explicitly and immediately — the SessionStart `npm ci` reinstalls from the committed lockfile and silently wipes an uncommitted `npm install`.
- Anchor loop: after any instruction/account interface change, `NO_DNA=1 anchor build` to refresh `target/idl` + `target/types`; if the web client depends on the IDL, copy `target/idl/agentvouch.json` → `web/agentvouch.json` and `npm run generate:client`. Deploys follow `docs/DEPLOY.md`'s proven `NO_DNA=1 anchor deploy --program-name agentvouch --program-keypair target/deploy/agentvouch-keypair.json ...` flow — never raw `solana program deploy`. Debugging `Fallback functions are not supported`: compare local IDLs against `anchor idl fetch`; if still stale, `anchor clean && anchor build` and diff `target/deploy/agentvouch.so` against `solana program dump` of the live program before redeploying.
- Generated Solana clients: web imports go through the curated entrypoints maintained by `web/scripts/generate-client.ts`; never hand-edit Codama output or let unused generated helpers (e.g. `programs/agentvouch.ts`) enter the web typecheck surface.

### Git and commits

- Try normal **signed** commits using the repo's configured signing settings (1Password). If signing fails in a headless shell, report the exact error and hand the human the amend command (`git commit --amend -S --no-edit`, then `git push --force-with-lease` if pushed) — never silently default to unsigned.
- No commit-message trailers like `Made-with: Cursor` unless explicitly requested.
- Before concluding work is "lost": `git branch -a --contains <sha>` / `git log --all --oneline --graph`. Uncommitted changes in another worktree are invisible from yours (not loss), and auto-commit tooling (`gcai`) may have captured them on another branch. Switching a worktree's branch reverts tracked edits to the target branch; untracked files survive but belong to no branch until added — commit early.

### Terminology, copy, and docs

- `Report` = end-user issue action; `Dispute` = protocol/admin object; `Vouch` = external endorsement only; self-stake is `AuthorBond`/`SelfStake`, never "self-vouch". Voucher-side outcomes get plain labels (e.g. "Backing Record"), not protocol jargon.
- CAIP-2 is the canonical stored chain label format; `solana`, `solana:mainnet`, `solana:mainnet-beta` are legacy aliases only; preserve non-CAIP upstream labels separately.
- Claims in outbound copy (decks, CFPs, social, README, `docs/VISION.md`) stay tightly aligned to the implemented system: defensible wording, `WIP` labels for unfinished pieces, substance/numbers/agent-incentives over buzzwords; vouch copy emphasizes upside and revenue share over loss framing; top-level docs lead with the on-chain trust/reputation-oracle story, not just marketplace mechanics. Responses to the user: direct, concise, no marketing language.
- Keep `/skills` + `/api/skills/*` as canonical skill routes (`Marketplace` is the user-facing label; `/marketplace` is a legacy redirect). Trust signals stay prominent on discovery/detail surfaces; recent purchase activity stays visible as social proof. Author pages live at `/author/[pubkey]`; author identifiers link there; on skill detail, when the connected wallet is the author, suppress buyer purchase/unlock CTAs and point to listing management. Free-skill disputes cap slashing at AuthorBond; paid listings use AuthorBond first then linked vouchers — never imply free skills have zero exposure or that voucher slashing applies to every dispute.
- After major code or protocol changes, re-check `web/public/skill.md` against live behavior. `https://agentvouch.xyz` is the canonical public base URL; `curl -s https://agentvouch.xyz/skill.md` is the standard agent onboarding one-liner.

### Product/protocol facts you must not contradict

- Active Solana devnet program: USDC-native `v0.2.0` at `AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg` (M13 escrow + M14 cutover applied); `docs/DEVNET_STATE.md` is the live-state record. The old `AgnTDF…` ID survives only as `TRACK_B_PREVIOUS_DEVNET_PROGRAM_ID` in `web/scripts/db-cutover.ts` — never treat it as active.
- Economics: USDC micro-units everywhere. Floors: 0.01 USDC paid-listing minimum, 1.00 USDC minimum vouch, 1.00 USDC author bond for free listings only (paid listings permissionless), 0.50 USDC dispute bond. Direct `purchase_skill` splits 60% author proceeds / 40% listing reward vault when external vouch stake exists; 100% to author when not. Withdrawals via `withdraw_author_proceeds`; upheld disputes convert escrow into bounded refund pools (`create_refund_pool` + `claim_purchase_refund`).
- Voucher slashing (A1) is live on devnet: upheld paid disputes park in `SlashingVouchers`; permissionless `slash_dispute_vouches` settles positions in pages of ≤4; slashed funds ring-fenced in `ListingSettlement.slashed_deposit_usdc_micros` (refund-pool-only, excluded from author withdrawals and challenger-reward base); `SkillListing.locked_by_dispute` freezes link/unlink, revision bumps, and new-settlement init mid-dispute; slashed vouches are dead positions with residual reclaimable via `revoke_vouch` after close.
- Repo-backed skills: browse URL + API `/{id}` use the DB UUID; the author-chosen `skill_id` slug is the per-author identifier for publish payloads, on-chain PDAs, and CLI output. Paid raw content: `GET /api/skills/{id}/raw` with `X-AgentVouch-Auth` carrying a short-lived Ed25519 signature over `buildDownloadRawMessage` (or `Listing: x402-usdc-direct`). Pubkey-only `?buyer=` and unsigned `X-Payment-Proof` are never accepted. Receipts append-only in `usdc_purchase_receipts`; current access in `usdc_purchase_entitlements`. Browser USDC x402 uses split-signature sponsored flow gated by `walletSupportsBrowserX402(wallet)` (Wallet Standard feature inspection — never hard-coded per-provider routing). Phantom embedded wallets DO support `signTransaction` (runtime-confirmed 2026-05-12) but must `solana.switchNetwork("solana:devnet")` after connect; every `signTransaction` goes through server-side simulation first. The CLI (`packages/agentvouch-cli`) wraps the same HTTP + on-chain contract — never invent a separate protocol; `agentvouch skill link-listing <repo-skill-id> --price-usdc <amount>` repairs DB-published skills missing on-chain linkage.
- `AgentProfile.registeredAt` can be corrupt on legacy-migrated accounts (1969/1970 dates); normalize through `web/lib/registeredAt.ts` at fetch boundaries; corrupted on-chain values are not reconstructible without indexer/tx-history repair.
- Skill-scan eval harness (`evals/skill-scan/`, stdlib-only Python, outside npm workspaces): `python3 harness.py --provider mock --judge mock` smokes keyless; production-rubric run is `--provider gateway --prompt scanner_prompt.prod.txt --grading advisory` with `AI_GATEWAY_API_KEY`. Production scanner (`web/lib/ai/scan.ts`, `SCAN_MODEL` = `google/gemini-2.5-flash-lite` via Vercel AI Gateway) returns only `review|avoid` — never allow/safe. North-star metric is unsafe recall; every production miss becomes a dataset case (holdout first); `scanner_prompt.prod.txt` syncs with `scan.ts` by hand.
- The landing hero uses the Moltbook-style Human/Agent toggle; deeper flows at `/dashboard` and `/docs`.

## 3. Named mistakes and the rule that prevents each

These are mistakes a capable-but-unfamiliar model **will** make here. Most encode a shipped bug or review finding; violating the rule reintroduces it.

### Chain/multichain (the highest-risk area)

1. **The mainnet-enable slip.** Enabling `eip155:8453` anywhere before the `docs/MAINNET_READINESS.md` Base Mainnet Gate Table passes. → _Rule: stop-the-line; `getAdapter()` rejecting mainnet is intentional. See §6._
2. **The checksummed-storage bug.** Persisting display-formatted EVM addresses. → _Rule: storage/lookup is **lowercase** (Phase 6 partial unique indexes depend on it); checksum is display-only. Use `web/lib/chainAddress.ts` — `normalizeChainAddressForStorage` at API/DB boundaries, `formatChainAddressForDisplay` at render. Never add a generic ambiguous `normalizeChainAddress`._
3. **The Solana-fallback leak.** A request declares `buyerChainContext=eip155:*`, the value fails EVM validation, and code "helpfully" falls through to Solana handling. → _Rule: an explicit chain context is EXCLUSIVE at API boundaries — invalid means reject/no-status (`wantsEvmBuyer` pattern in `/api/skills` + `/api/skills/hydrate`; the phase-7 boundary test rejects the fallback shape)._
4. **The premature-default bug (PR #74 P1).** Choosing a chain-dependent column default before the row's chain is resolved (`currency_mint` defaulted to the Solana mint, making Base paid publishes unlinkable). → _Rule: resolve the chain first, then pick defaults; Base paid rows default `currency_mint` to `null` (verification stamps native USDC)._
5. **The SSR/hydration env mismatch (PR #74 P2).** Reading server-only env in a render-affecting default (`serverValue || clientValue`), so SSR and hydration disagree (#418). → _Rule: render-affecting defaults read only `NEXT_PUBLIC`-prefixed env (`getDefaultChainContext` deliberately ignores server vars). A server-only knob gets a separately-named non-render helper._
6. **Scattered `0x` heuristics.** Sprinkling `startsWith("0x")` checks. → _Rule: `isEvmShapedAddress` in `chainAddress.ts` is the single home; the "sound only while all non-Solana chains are 0x-EVM" caveat lives on the helper._
7. **Synthesized Base trust.** Letting Base rows render `Trusted`, or joining Solana trust to EVM authors. → _Rule: `author_trust_snapshots` are Solana-context only; EVM authors are filtered out (`trustSnapshots.ts`); trust joins are scoped by the row's `chain_context`; Base rows render `Review` until Phase 9's real Base trust lands._
8. **"Fixing" Sepolia pins ad hoc.** ~13 Base modules are intentionally Sepolia-pinned by constant until Phase 10's configured-Base-chain parameterization sweep (inventory in the phase-10 plan). → _Rule: don't parameterize individual pins outside that sweep._
9. **Repointing cache-bypass money reads.** Moving `getOnChainUsdcPrice(addr, { useCache: false })` call sites (raw access, sponsored purchase, x402 bridge) onto `ChainAdapter.fetchSkillListing`, which has no cache knob — silently reintroducing stale-price verification. → _Rule: guarded by test; expand the adapter interface first if you need to move them._
10. **Cross-seam imports.** Base files importing `browserX402.ts`, `x402ProtocolBridge.ts`, `@solana/kit`, `@/lib/onchain`, `@/lib/agentvouchUsdc`, or `solanaWrites`. → _Rule: those are SOLANA/SVM-ONLY seams, enforced by `web/__tests__/lib/phase2-circleback.test.ts` — extend its marker/file lists when adding Solana-only modules or Base-facing files; never delete family-guard tests._
11. **Forking the Solana write stack.** → _Rule: `web/lib/solanaWrites.ts` is the single Solana write implementation (legacy hooks and the Solana `ChainWallet` facade both call it — they were once ~160-line drifted duplicates). UI writes go through `useWritableChainWallet()`; the header provider (`WalletContextProvider`) must never import the Solana write stack. `ChainAdapter` = server-safe reads; `ChainWallet` = client-only writes (`web/lib/adapters/types.ts`)._
12. **Entitlement PK "cleanup".** Swapping the legacy `(skill_db_id, buyer_pubkey)` entitlement PK because it looks chain-naive. → _Rule: Solana base58 and lowercased `0x` hex are disjoint namespaces — that argument (not the D3 receipt guard) is why the legacy PK survives until a second EVM chain exists. Re-derive it before adding any chain whose addresses could collide._
13. **Wallet SDKs in server bundles.** → _Rule: wallet SDKs, WebAuthn, `localStorage`, viem account-abstraction stay in client-only modules behind dynamic imports; `web/lib/adapters/base.ts` stays server-safe read-only. Settlement endpoints (`/api/x402/*`, `/api/transactions/sponsored/*`) stay Route Handlers, never Server Actions._
14. **Base Sepolia log-scan naivety.** → _Rule: `base-sepolia-rpc.publicnode.com` rejects historical `eth_getLogs` without an archive token; `https://sepolia.base.org` works for recent recovery only in ≤1,999-block chunks. Etherscan V2 with `chainid=84532` is paid-tier. Public `sepolia.base.org` also lags read-after-write — use publicnode for reads and compute balance deltas at explicit block numbers. The x402 Lane B agent must be a plain EOA (ECDSA), not a smart account._

### Database (Neon Postgres)

15. **Request-time DDL that can throw.** Putting anything that can fail on live data (duplicate scans, unique-index creation, `DROP CONSTRAINT`, PK swaps) in the runtime schema initializers (`web/lib/db.ts`, `web/lib/usdcPurchases.ts`). A throw there takes down every route touching the table. → _Rule: initializers hold additive, race-tolerant DDL only (`IF NOT EXISTS`, idempotent backfills). Anything risky is a guarded one-shot script under `web/scripts/` (pattern: `phase6-chain-identity-migration.ts` — read-only `preflight`, `migrate` gated on `EXPECTED_DATABASE_HOST` matching the `DATABASE_URL` host), rehearsed on a disposable Neon branch copied from production before touching live._
16. **Wrong Neon project.** Two Neon projects exist: live `agentvouch-postgres` (Vercel-managed, project `calm-meadow-36819154`) vs legacy `agent-reputation-oracle`. The stale integration causes branch-limit deploy failures. → _Rule: verify `neonctl` context and `DATABASE_URL` host before any DB operation; local and production may point at different branches — check `web/.env.local` vs Vercel env before treating a data mismatch as a code regression._
17. **Receipts are append-only.** → _Rule: `usdc_purchase_receipts` keyed by unique `payment_tx_signature`, never updated in place; entitlements keep the legacy PK plus the additive chain-qualified unique index._

### Server-signed / sponsored / relayer flows (a miss here drains real funds)

18. **The sponsor-drain collapse.** Allowing `buyer == sponsor`: the signer slots collapse and the server's `partialSign` fully signs with no user signature — attacker drains the sponsor into their own listing. → _Rule: `assertBuyerIsNotSponsor` in both prepare and submit paths (unit-tested in `sponsoredPurchase.test.ts`); replicate the guard in any new server-cosigned flow._
19. **Blind signing.** Signing client-supplied transactions/instructions, or re-signing on submit. → _Rule: `prepare` builds the tx from on-chain state and is the only place the sponsor signs; `submit` relays without adding the sponsor signature; `verifySignatures()` binds the message. Re-validate everything on submit anyway (every account meta pubkey/isSigner/isWritable + instruction data vs freshly-derived expected, fee cap, buyer balance)._
20. **Uncapped sponsor exposure.** → _Rule: anything the sponsor fronts is reimbursed and capped (`AGENTVOUCH_SPONSOR_MAX_FEE_USDC_MICROS`); the static `AGENTVOUCH_SPONSOR_SOL_USDC_MICRO_PRICE` must be kept current or moved to a live quote before broad enablement. Endpoints are unauthenticated + flag-gated only (`AGENTVOUCH_SPONSORED_CHECKOUT_ENABLED` server, `NEXT_PUBLIC_AGENTVOUCH_SPONSORED_CHECKOUT_ENABLED` client); `web/lib/rateLimit.ts` is per-instance best-effort — add an edge rate limit before enabling broadly in production._
21. **Account-layout drift.** Adding/removing a `purchase_skill` account without sweeping every caller. → _Rule: it's a breaking change across `programs/agentvouch/src/instructions/purchase_skill.rs`, `web/generated/agentvouch/`, `web/agentvouch.json`, `packages/agentvouch-cli/src/idl/agentvouch.ts` + `src/lib/solana.ts`, both `web/hooks/use{Marketplace,Reputation}Oracle.ts`, `scripts/devnet-usdc-smoke.mjs`, `tests/helpers/agentvouchUsdc.ts`, AND the hand-built instruction in `sponsoredPurchase.ts` (hard-coded 16-account order + `PURCHASE_ACCOUNT_SPACE = 177`)._
22. **Base purchase from stale UI price.** → _Rule: `ChainWallet.purchaseSkill` takes `expectedPriceUsdcMicros`, re-reads the live EVM listing, fails closed on mismatch, and approves only the exact amount._
23. **Publisher auth message scope (fixed 2026-07-08):** mutating publisher routes must call `assertPublisherAuthMessageScope` (Action + optional Skill id) after signature verification on both Solana and EVM paths. Create uses `publish-skill` without Skill id; skill-targeted mutations include the DB UUID. CLI still signs Action+Timestamp-only for some `publish-skill` mutations — those routes set `allowLegacyWithoutSkillId: true` until the CLI is bumped; do not re-widen by dropping the scope check.

### Testing and verification

24. **Grep-tests for pure functions.** → _Rule: pure helpers get real behavioral tests (`chainAddress.test.ts`, `chains.test.ts` with real deployed addresses); source-text assertions are reserved for wiring/SQL invariants the vitest harness can't exercise._
25. **Overclaiming completion.** Marking a live-app refactor phase done on green tests. → _Rule: those phases close with a human browser wallet smoke (Phantom connect/list/purchase/download; Base passkey regression). If the smoke hasn't run, say so in the plan status._
26. **Rename stragglers.** Env-var and phase renames have twice left stale strings in runtime warnings, code comments, and test comments (`8b`→`10`, the default-chain env split). → _Rule: `rg` the old identifier repo-wide before committing any rename._
27. **Trusting the green `test` job as "buildable".** → _Rule: CI has no `next build`; run the webpack build locally (§2) — Vercel is the real gate._

### Environment and local dev

28. **`https://localhost` smokes.** → _Rule: use `http://localhost:<port>` for local API smokes; TLS failures masquerade as app bugs._
29. **Second dev server fights the lock.** A second `next dev` can't share `web/.next/dev/lock`. → _Rule: for alternate-env smokes that must not disturb the running session, rsync the worktree to `/private/tmp/agentvouch-rollback-smoke` (exclude `.git`, `node_modules`, `web/.next`), symlink node_modules from the primary checkout, run on another port (e.g. `NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT=solana npm run dev --workspace @agentvouch/web -- --port 3002`)._
30. **Client/server RPC env confusion.** → _Rule: server-side Solana reads use `SOLANA_RPC_URL`; browser/wallet code needs `NEXT_PUBLIC_SOLANA_RPC_URL` (Next.js hides non-`NEXT_PUBLIC`-prefixed vars from the client). Keep both set to the same endpoint until public reads are fully server-mediated; don't delete either name prematurely._
31. **The phantom port-8899 validator.** `anchor test` reports port 8899 in use. → _Rule: `lsof -nP -i :8899` first; kill a visible stale validator, but if no listener exists it's a managed-sandbox false positive — rerun with appropriate escalation._
32. **Misdiagnosing Phantom "insufficient SOL".** → _Rule: simulate the exact transaction and map the failing `account_index` back to compiled account metas before assuming the buyer lacks funds — low-price purchases fail when the recipient author wallet is empty and the 60% payout is below rent-minimum for a 0-byte system account._

### UI/React

33. **RPC spam from unmemoized effects.** → _Rule: memoize hook return objects and effect dependencies for async warnings/data-refresh effects, or they retrigger every render (RPC spam, flashing banners). Keep `/skills` on `useMarketplaceOracle`, not the full `useReputationOracle` graph (bundle size)._
34. **Breaking rendered output during "behavior-preserving" refactors.** → _Rule: address-shortening lengths differ per site by design (6/4 dominant, 4/4 wallet button, 12/6 identity panel, 8/8 tx sigs); when unifying, decide per-site and never silently change rendered output. Keep Connect Wallet, theme toggle, and primary nav text actions at consistent height/proportions; format SOL/fee/token displays with enough precision where small values matter._

### Devnet clean breaks

35. **Layering migrations on stale PDAs.** → _Rule: for devnet breaking changes prefer a fresh Program ID + DB cleanup. Grind vanity keys (`solana-keygen grind --starts-with agnt:1 --ignore-case`), then update EVERY Program ID surface: `lib.rs` declare_id, `Anchor.toml`, `web/agentvouch.json`, `web/generated/agentvouch/`, `packages/agentvouch-protocol/src/index.{ts,js,d.ts}`, smoke scripts, docs, tests, `web/public/skill.md`, `.well-known/agentvouch.json`. Deploy with `~/dev-keypair.json` as authority unless told otherwise, initialize config/vaults, then reset stale Neon state (old `on_chain_address`/`on_chain_program_id` links, stale receipts/entitlements, `agent_profile_pda` bindings; for greenfield, delete skills not linked to the current program)._

## 4. Quality bar per deliverable (checkable criteria, not adjectives)

### Code change / PR

- [ ] Full local gate green: `npm run format:check` && lint && typecheck && vitest && `npm exec --workspace @agentvouch/web -- next build --webpack` (Node 24 PATH exported).
- [ ] `forge test` green if `contracts/` touched; `NO_DNA=1 anchor build` + IDL/client sync if the Anchor interface changed.
- [ ] New pure helpers have behavioral tests; new seam/wiring invariants extend the family-guard tests.
- [ ] No new imports across the seams in §3.10–11; no hard-coded hex colors (use `globals.css` tokens); both light and dark themes verified for UI changes.
- [ ] Renames swept repo-wide with `rg` (code, comments, warn strings, test names).
- [ ] Dependency changes committed with the root lockfile in the same commit.
- [ ] Commit signed (or the exact signing failure reported with the amend command).
- [ ] PR is one phase/feature; description states what was verified and what was explicitly NOT verified.

### Plan file (`.plan.md`)

- [ ] Frontmatter: `name`, `overview`, `todos` (stable ids, concrete content, honest statuses), `isProject`.
- [ ] Body has Goal, Scope (in AND out), exact files, verification commands, rollout/rollback when operationally risky.
- [ ] Design decisions and verified claims are dated; open questions/blockers are listed, not hidden.
- [ ] On execution: statuses updated as work happens (not batch at end); divergences get dated notes at the point of divergence.

### Live-flow verification (what "verified" means here)

- [ ] Concrete evidence recorded: tx hashes/userOp hashes, USDC + ETH/SOL balance deltas (at explicit block numbers on Base), DB rows with chain-qualified fields, raw-download success for buyer AND rejection for non-buyer.
- [ ] Duplicate/idempotency attempts made where relevant (x402 settlement, receipt guard).
- [ ] Solana regression run when a change could affect the dormant path; sponsored/Kora prompt coverage tracked separately.
- [ ] Env names (not values) recorded in the plan closeout.

### DB migration

- [ ] Risky DDL is in a guarded `web/scripts/` one-shot with read-only `preflight` and `EXPECTED_DATABASE_HOST`-gated `migrate` — never in runtime initializers.
- [ ] Rehearsed end-to-end on a disposable Neon branch copied from the intended production project; rehearsal output captured.
- [ ] Post-run verification query (e.g. `pg_indexes`) + production API smoke recorded.
- [ ] Target project confirmed as `agentvouch-postgres` (not the legacy project).

### Deploy (Solana program)

- [ ] `docs/DEPLOY.md` flow used; deployed binary SHA-256 matched local; on-chain IDL fetched and semantically matched local/web IDLs; slot + deploy tx recorded in `docs/DEVNET_STATE.md`.
- [ ] Post-deploy smoke run (relevant `npm run smoke:*` or targeted instruction smoke).

### Docs / copy

- [ ] Every claim maps to shipped behavior or is labeled `WIP`; numbers/economics match §2 facts.
- [ ] `web/public/skill.md` re-checked if product/API/on-chain behavior changed.
- [ ] Roadmap/readiness/state docs updated in the right doc (strategy → ROADMAP, gates → MAINNET_READINESS, live state → DEVNET_STATE) — no duplication across them.

## 5. Escalation rules — what to do when uncertain

### Never do without explicit human approval (stop-the-line)

- Enable `eip155:8453` (Base mainnet) anywhere, or weaken the Phase 8a mainnet rejection.
- Any mainnet deploy, real-funds transaction, or custody/authority change on any chain.
- Destructive operations on the live Neon project (drops, PK swaps, deletes outside a rehearsed guarded script).
- Deleting Solana code paths or the dormant adapter (the port decision is "dormant, not deleted").
- Force-pushing or rewriting history on shared/phase branches.
- Publishing outbound content (deploys to production aside — those follow the normal PR/Vercel flow).
- Enabling flag-gated money flows broadly (sponsored checkout, x402 bridge) — these inherit readiness gates (rate limits, custody, monitoring).

### Ask first (blocking question to the human)

- Expanding the `ChainAdapter`/`ChainWallet` interface (call sites are guarded by tests for a reason).
- Any non-additive schema change, or a new unique constraint on live data.
- Changing economic parameters, floors, split percentages, or trust semantics.
- Editing a plan file the human authored beyond status updates and dated divergence notes.
- Adding a dependency or changing the build toolchain.
- Anything where the fix requires choosing between two invariants in this file.

### Proceed, but record (dated note in the plan / PR description)

- Implementation details within an in-progress phase plan's stated scope.
- Adding tests, extending family-guard lists, doc syncs that follow §4.
- Divergence from plan detail when evidence contradicts it — do the right thing and append the dated note at that phase; never silently diverge, never let the plan lie.

### Decision heuristics

- **Plan vs prose conflict:** the plan frontmatter todos + dated notes + `gh pr view` win over handoff prose and over your memory of "what was decided".
- **Doc vs code conflict:** code + tests win; flag the stale doc and fix it in the same PR if cheap.
- **Signal looks like a known failure:** verify the specific cause before acting (e.g. port 8899, "insufficient SOL", "lost" work — §3.31, §3.32, §1.1).
- **Can't verify (no wallet, no browser, no env):** ship what you can verify, state exactly what remains unverified in the plan/PR. An honest "smoke not run" beats a false "done".
- **Uncertain whether something is in scope:** it isn't. This repo ships minimal (see `docs/ROADMAP.md` MVP bias); defer with a note rather than gold-plate.

## 6. Design language ("Coral Terminal", web)

The skill detail page (`web/app/skills/[id]/SkillDetailClient.tsx`) is the reference implementation — match it when building or restyling any web surface. Aesthetic: editorial-meets-terminal — serif display + monospace UI chrome, warm coral (lobster) and cool sea accents on a themed surface. Restrained, trust-first, decluttered. **Light is the default theme** (`next-themes` `defaultTheme="light"`); both themes must hold. Prefer tight, intentional UI with compact spacing over bloated SaaS layouts.

- **Color — never hard-code hex; use the `globals.css` tokens.** Surface `var(--background)` / `var(--foreground)`. Primary accent / CTAs / brand / tags: `--lobster-accent` (coral, `#d95a2b` light, `#f28a61` dark; strong `#fd522e`) plus `--lobster-accent-soft` / `--lobster-accent-border`. Secondary accent / section markers / links: `--sea-accent` (+ `-strong` / `-soft` / `-border`). Status: amber = review, emerald = pass/trusted, red/ember = avoid/fail (Tailwind colors with `dark:` variants). Dominant neutral surface with sharp coral accents — not evenly distributed color.
- **Typography — classes in `globals.css`.** `font-display` (Crimson Text, serif) for page titles and big headings; `font-article` (Crimson Pro, serif) for long-form prose; `font-heading` (Inconsolata, mono) as the UI base — labels, nav, metadata, buttons, code, stats (the load-bearing terminal motif). Rule: serif (**unbolded**, weight ~400/500) for the _named_ things — page titles, section titles, nav destinations, skill-card titles, inline links; mono for the data layer — eyebrow labels, metadata, stats, code, small uppercase chrome. Inconsolata UI labels/buttons stay normal weight. Small eyebrow labels: `text-[11px] font-normal uppercase tracking-[0.14em] text-gray-400` (mono) with a small sea/coral marker icon.
- **Surfaces & components.** Compact cards: `rounded-sm border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900` with hover lift (`-translate-y-0.5` + coral border + soft coral shadow). Large detail panels: `rounded-lg` + `bg-white/70 dark:bg-gray-900/50`. Small controls/inputs/code `rounded-sm`; pills `rounded-full`. Tags/chips: coral-soft pill (`rounded-full border border-[var(--lobster-accent-border)] bg-[var(--lobster-accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--lobster-accent)]`). Buttons: `lib/buttonStyles.ts` — `navButtonPrimaryInlineClass` (ember/coral solid), `navButtonSecondaryInlineClass` (outline); primary CTAs full-width inside action cards. Verdict/status pill: bordered color-coded box + big `font-display` word + mono uppercase label. Stat-row: grid of big `font-display` numbers over tiny mono uppercase labels. "Decide" layouts: scrollable main column + sticky right rail. `components/InfoTip.tsx` for terse "why" copy. Skill cards (`components/SkillPreviewCard.tsx`, shared by homepage + `/skills`): author byline cluster top-left + verdict chip top-right, serif title, serif description, signals/tags row, bottom-anchored stats row.
- **Principles.** Declutter prose — humans shouldn't face walls of text, and agents read the API/docs/CLI, not the page: cut redundant copy, move "why" into `InfoTip`, collapse secondary detail into `<details>`. Trust-first hierarchy: what it is → who's behind it → can I trust it → what's inside → how to get it. Token-driven and themed. Restraint over decoration: no gimmicky glow gradients, purposeful motion only.

## 7. Presentation / deck assets

The pitch walkthrough deck lives at `pitch/AgentVouch_walkthrough.pptx` (canonical, Coral Terminal hybrid) with a light sibling regenerated by `themes/recolor_to_paper.py`. Reusable theme specs (Coral Terminal / Paper / Midnight) and the `pptxgenjs` generator live in `themes/`; the deck family uses coral `#F28A61`, Arial Black display, and Inconsolata mono (web display uses Crimson serif instead — the mono motif is what's shared). Deck architecture-slide facts (14 account structs / 23 instructions at last count) need refresh in Milestone 15 before treating the deck as current.
