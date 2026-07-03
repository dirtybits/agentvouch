---
name: seo-agent-reputation-system
overview: "Lean into the accidental page-1 ranking for the query 'agent reputation system' by claiming the exact phrase, expanding the topic cluster, upgrading structured data, and keeping the agent-facing discovery layer (llms.txt/skill.md) in sync — SEO for both people and agents."
todos:
  - id: move1-pillar-page
    content: "DONE 2026-07-03: created web/app/agent-reputation-system/page.tsx (top-level). Exact-match title 'Agent Reputation System', H1 'Agent reputation system', extractable definition first paragraph, @graph JSON-LD with TechArticle + FAQPage (4 Q&As), cross-links to /docs/what-is-an-agent-reputation-oracle, /docs/how-agentvouch-works, /docs/skill-md-security, /docs/verify-ai-agents, /skills. Mirrors the oracle page pattern (buildMetadata + inline ld+json). Prettier-formatted; not in the tsc error set."
    status: completed
  - id: move1-home-keyword
    content: "DONE 2026-07-03: SITE_TAGLINE in web/lib/site.ts → 'Agent Reputation System for AI Agent Skills' (drives the title template + OG); SITE_DESCRIPTION opening → 'on-chain agent reputation system and skills marketplace'. web/app/page.tsx hero paragraph now leads with an inline text link 'agent reputation system' → /agent-reputation-system (homepage→pillar link equity). Left H1='AgentVouch' and the TypewriterText H2 as brand per the H1 open question."
    status: completed
  - id: move1-sitemap
    content: "DONE 2026-07-03: added /agent-reputation-system to staticPages in web/app/sitemap.ts (priority 0.9, monthly, above /docs) and 'Allow: /agent-reputation-system' in web/app/robots.txt/route.ts."
    status: completed
  - id: move4-seed-phrase
    content: "DONE 2026-07-03: seeded the phrase into public/llms.txt (kept 'trust layer' + 'skills marketplace' + 'discover skills' so seo-discovery.test.ts stays green — this is a required invariant, see line 113), public/llms-full.txt (intro + Core URLs pillar link), public/skill.md (frontmatter description). Program id / USDC mint / legacy-id invariants untouched. seo-discovery.test.ts = 14/14 green."
    status: completed
  - id: move4-dynamic-llms
    content: "DONE 2026-07-03: llms.txt is now a dynamic route (web/app/llms.txt/route.ts → web/lib/llms.ts buildLlmsTxt()); Primary docs list is generated from CONTENT_PAGES so new docs auto-appear (verified: now lists all 9 docs + pillar, incl. the 4 cluster pages that were missing). Static web/public/llms.txt deleted so the route wins. Generator is dependency-light (own BASE_URL, imports only CONTENT_PAGES) to stay unit-testable. seo-discovery.test.ts reworked: llms.txt block now calls buildLlmsTxt() (15/15 green, incl. a new CONTENT_PAGES-advertised assertion). SCOPE NOTE: llms-full.txt intentionally left static — it points at the /docs hub and does not enumerate individual docs, so it does not drift; converting it would add no value."
    status: completed
  - id: move2-topic-cluster
    content: "DONE 2026-07-03. Batch 1: /docs/glossary (DefinedTermSet + BreadcrumbList, 9 terms) and /docs/ai-agent-reputation-score (TechArticle + FAQPage + BreadcrumbList). Batch 2: /docs/agent-reputation-system-vs-oracle and /docs/do-you-need-an-agent-reputation-system (both TechArticle + FAQPage + BreadcrumbList via buildDocJsonLd); /docs/verify-ai-agents expanded with a pillar link + schema. All 4 new pages registered in lib/contentPages.ts (→ sitemap + generated llms.txt), carded on the /docs hub, and link back to /agent-reputation-system. Chain-agnostic per the wording decision below. All render 200 with correct schema."
    status: completed
  - id: move3-structured-data
    content: "DONE 2026-07-03: added a shared web/lib/seo.ts helper buildDocJsonLd() (BreadcrumbList + TechArticle + optional FAQPage). Applied to all 5 original CONTENT_PAGES docs (trusted-agent-skills, oracle, how-agentvouch-works, skill-md-security, verify-ai-agents); how-agentvouch-works + verify-ai-agents also got FAQPage. DefinedTermSet already on the glossary. Homepage SoftwareApplication node got featureList + offers(price 0), plus a new FAQPage node. All verified live via rendered @type counts."
    status: completed
  - id: verify-seo
    content: "DONE 2026-07-03: seo-discovery.test.ts 14/14 green; prettier --check green on all changed .ts/.tsx; new page absent from the tsc error set. LIVE RENDER CONFIRMED (Next 16.1.6 dev): after installing the missing 'ai' dep into node_modules only (--no-save --no-package-lock, so no tracked-file changes), GET /agent-reputation-system → 200 with <title>Agent Reputation System | AgentVouch</title>, <h1>Agent reputation system</h1>, canonical + og:title set, and both TechArticle and FAQPage(4 Q&A) JSON-LD emitting; GET / → 200 with the new title + inline pillar link; /sitemap.xml and /robots.txt both include the pillar URL. Owner/CI-side remainders (pre-existing, unrelated to these edits): 'ai' must be added to package-lock.json and @solana/kit generated TS2305 errors resolved for a clean full `next build`/`npm run typecheck`; Google Rich Results Test is an external owner step."
    status: completed
isProject: false
---

# SEO: Own "Agent Reputation System" (People + Agents)

## Goal

Convert an accidental ~position-5 Google ranking for the query **"agent reputation system"**
(4 impressions, 0 clicks over the 6 months ending 2026-07-03) into real, clickable page-1
traffic, and reinforce the phrase across the agent-facing discovery layer so LLM answer engines
cite AgentVouch. The technical SEO foundation is already strong; the bottleneck is **content
volume and exact-phrase targeting**, not infrastructure.

## Context (verified 2026-07-03)

Google Search Console for agentvouch.xyz (6-month window) shows the site ranking for
"agent reputation system" (avg position ~5.2) despite the phrase appearing **nowhere as a
deliberate target**. Current language is "reputation *oracle*", "trust *layer*",
"reputation-backed". Google is bridging *oracle → system* semantically.

Existing SEO/discovery surface (all verified present):

- Metadata: `web/lib/seo.ts` (`buildDefaultMetadata`, `buildMetadata`), `web/lib/site.ts`
  (`SITE_NAME`, `SITE_TAGLINE = "On-Chain Trust Layer for AI Agent Skills"`, `SITE_DESCRIPTION`,
  `getCanonicalUrl`).
- Sitemap: `web/app/sitemap.ts` (static + `CONTENT_PAGES` docs + blog + DB skills + authors).
- Robots: `web/app/robots.txt/route.ts` (Content-Signal `search=yes, ai-input=yes, ai-train=yes`;
  Allows `/llms.txt`, `/llms-full.txt`, `/skill.md`, `/openapi.json`, `/.well-known/`).
- JSON-LD today: `web/app/page.tsx` (Organization / WebSite / SoftwareApplication `@graph`),
  `web/app/docs/what-is-an-agent-reputation-oracle/page.tsx` (FAQPage),
  `web/app/blog/[slug]/page.tsx` (Article).
- Content: 5 docs in `web/lib/contentPages.ts`, 3 blog posts in `web/content/blog/`.
- Agent discovery: `web/app/.well-known/agent-card.json/route.ts` (A2A), `api-catalog`,
  `agent-skills/index.json`; static `web/public/llms.txt`, `llms-full.txt`, `skill.md`,
  `openapi.json`, `.well-known/agentvouch.json`; `Link` headers in `web/next.config.mjs`.
- Analytics: GA4 (`G-EKFE31B4TJ`) + Vercel Analytics in `web/app/layout.tsx`.

Guardrail test: `web/__tests__/public/seo-discovery.test.ts` reads the static `public/` files and
asserts the current program id (`AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg`), devnet USDC mint,
and **absence** of the legacy program id fragment `ELmVnLSN`. Any edit to `public/llms*.txt`,
`skill.md`, or `.well-known/agentvouch.json` must keep these invariants green.

## Design decision — chain wording (2026-07-03)

AgentVouch is mid-migration Solana → Base and currently runs on **both** (see the standing
`base-canonical-chain` note; Stripe fiat buyer/seller is also landing via PR #9). Policy for all
new SEO/content copy:

- **Human-facing prose uses "on-chain," not "Solana."** No search volume is lost — nobody searches
  chain-qualified "agent reputation system Solana"; the head term is chain-agnostic. "on Solana" is
  already inaccurate (dual-chain) and "on-chain" survives the Base flip with no rework.
- Prefer **"on-chain"** over "decentralized" (more precise, matches brand voice).
- **Keep chain names in the machine/operational layer** — `skill.md` `chain_context`, `.well-known`
  CAIP-2 IDs, program IDs, API. Agents need to know where to transact, and `seo-discovery.test.ts`
  locks the Solana devnet CAIP-2 context. Do not blanket-replace "Solana" there.
- **Payment wording stays rail-agnostic** now that Stripe adds fiat — describe the reputation/trust
  layer as on-chain, but don't imply buying/selling is exclusively crypto/USDC.
- Effort: apply to new content for free; neutralize newly introduced "on Solana" prose; a full sweep
  of legacy docs/homepage "Solana" copy is deferred as optional cleanup (not worth the time now).

## Scope

- **In scope:** exact-phrase targeting (pillar page + homepage title/H2), sitemap/robots wiring,
  seeding the phrase into the agent corpus, topic-cluster content, structured-data upgrades, and
  (as a scoped follow-on) making `llms.txt` dynamic.
- **Out of scope:** off-page/backlinks and outreach (not code); redesigning the homepage hero;
  changing brand naming away from "oracle"/"trust layer" (both coexist with "reputation system");
  paid-skill flow, chain, or protocol code.

## Files To Change

- `web/app/agent-reputation-system/page.tsx`: **new** pillar page (Move 1).
- `web/lib/site.ts`: `SITE_TAGLINE` (and optionally `SITE_DESCRIPTION`) to carry the phrase (Move 1).
- `web/app/page.tsx`: hero H2/`TypewriterText` + supporting copy to include the phrase (Move 1).
- `web/app/sitemap.ts`: add the pillar URL to `staticPages` (Move 1).
- `web/app/robots.txt/route.ts`: `Allow: /agent-reputation-system` (Move 1).
- `web/public/llms.txt`, `web/public/llms-full.txt`, `web/public/skill.md`: seed the phrase (Move 4a).
- `web/app/llms.txt/route.ts`, `web/app/llms-full.txt/route.ts`: **new** dynamic routes (Move 4b, follow-on).
- `web/__tests__/public/seo-discovery.test.ts`: rework to test generators if Move 4b lands (follow-on).
- `web/lib/contentPages.ts` + new page dirs under `web/app/docs/…` or top-level: cluster (Move 2).
- Per-doc `page.tsx` files under `web/app/docs/…`: TechArticle/BreadcrumbList schema (Move 3).

## Implementation Steps

### Move 1 — Claim the exact phrase (highest leverage, do first)

1. **Pillar page** `web/app/agent-reputation-system/page.tsx`. Top-level (not under `/docs`) for a
   money keyword. Mirror the oracle page pattern:
   - `export const metadata = buildMetadata({ title: "Agent Reputation System", description: "…",
     path: "/agent-reputation-system", keywords: ["agent reputation system", "ai agent reputation",
     "agent trust score", "agent reputation oracle"] })`.
   - `<h1>` = "Agent Reputation System"; first paragraph is an extractable definition:
     *"An agent reputation system gives one AI agent a machine-readable trust record for another —
     stake, peer vouches, and dispute history — before work, payment, or access is delegated.
     AgentVouch is an on-chain agent reputation system on Solana."*
   - Inline `FAQPage` + `TechArticle` JSON-LD (schema.org). Reuse the oracle page's FAQ shape.
   - Body H2s covering: what it is, why agents need it, how AgentVouch implements it (stake/vouches/
     disputes/slashing), how to query it (`/api/agents/{pubkey}/trust`), "system vs oracle".
   - Cross-link to `/docs/what-is-an-agent-reputation-oracle`, `/docs/how-agentvouch-works`,
     `/docs/verify-ai-agents`, `/skills`.
2. **Homepage keyword** — in `web/lib/site.ts`, change `SITE_TAGLINE` to lead with the phrase, e.g.
   `"Agent Reputation System for AI Agents"` (feeds the `%s | AgentVouch` title template and OG).
   In `web/app/page.tsx`, add the phrase to the hero: keep `<h1>AgentVouch</h1>` but make the H2 /
   `TypewriterText` and the supporting `<p>` say "agent reputation system" at least once. (Note: the
   H1 is currently just the brand word — the strongest on-page signal. If design allows, an H1 like
   "AgentVouch — Agent Reputation System" is stronger; if not, the H2 must carry it.)
3. **Sitemap + robots** — add `{ url: getCanonicalUrl("/agent-reputation-system"), priority: 0.9,
   changeFrequency: "monthly" }` to `staticPages` in `web/app/sitemap.ts`; add
   `"Allow: /agent-reputation-system",` to `web/app/robots.txt/route.ts`.

### Move 4a — Seed the phrase into the agent corpus (do now, low risk)

4. In `web/public/llms.txt` and `web/public/llms-full.txt`, change the opening line from
   "on-chain trust layer and skills marketplace" to include "**agent reputation system**" and add
   the pillar URL to the docs list. In `web/public/skill.md`, add one definitional sentence.
   **Do not** touch the program id, USDC mint, or reintroduce `ELmVnLSN` — keep
   `seo-discovery.test.ts` green.

### Move 4b — Dynamic llms.txt (FOLLOW-ON, test-coupled)

5. Create `web/app/llms.txt/route.ts` and `web/app/llms-full.txt/route.ts` mirroring
   `web/app/robots.txt/route.ts` (`export const dynamic = "force-static"`, `text/plain`). Generate
   the doc list from `CONTENT_PAGES` + the pillar + a small top-skills query (guard with try/catch
   like `sitemap.ts`). **Delete** the static `public/llms.txt` + `public/llms-full.txt` (a static
   `public/` file wins over an app route at the same path). Extract the body into an exported pure
   function and repoint `seo-discovery.test.ts` at that function instead of `fs.readFileSync`.

### Move 2 — Topic cluster (FOLLOW-ON content)

6. Add cluster pages, each linking back to the pillar: a glossary (agent, vouch, stake, slashing,
   dispute) with `DefinedTermSet`; "AI agent reputation score"; "agent reputation system vs oracle";
   "do you need a reputation system for AI agents". Register in `web/lib/contentPages.ts` (for
   `/docs/*`) or as top-level routes, and ensure they land in the sitemap. Expand the thin
   `/docs/verify-ai-agents` page.

### Move 3 — Structured-data upgrades (FOLLOW-ON)

7. Add `TechArticle` + `BreadcrumbList` JSON-LD to each `CONTENT_PAGES` doc page; `FAQPage` to the
   homepage and `/docs/how-agentvouch-works`; `DefinedTerm`/`DefinedTermSet` to the glossary; and
   `featureList` + `offers` (price 0) to the homepage `SoftwareApplication` node in
   `web/app/page.tsx`.

## Verification

> **Status 2026-07-03 (Move 1 + 4a) — VERIFIED LIVE:** `seo-discovery.test.ts` 14/14 green (Node 25);
> `prettier --check` green on all changed `.ts/.tsx`; the new pillar page does not appear in the
> `tsc --noEmit` error set. The worktree was missing the declared `ai` dep (`web/package.json:36`),
> which made `next dev` fail the whole webpack build (`Module not found: 'ai'` via
> `lib/marketplaceBrowse.ts → app/page.tsx`); installed it into `node_modules` only
> (`--no-save --no-package-lock --ignore-scripts`, no tracked-file changes) and then confirmed:
> `GET /agent-reputation-system` → 200 with `<title>Agent Reputation System | AgentVouch</title>`,
> `<h1>Agent reputation system</h1>`, canonical + og:title set, and both `TechArticle` and
> `FAQPage` JSON-LD emitting; `GET /` → 200 with the new title and the inline pillar link;
> `/sitemap.xml` + `/robots.txt` include the pillar URL. **Owner/CI remainders (pre-existing,
> unrelated to these edits):** add `ai` to `package-lock.json` and resolve the `@solana/kit` TS2305
> errors in `generated/**` for a clean full `next build`/`npm run typecheck`; run Google Rich
> Results Test on the pillar URL after deploy.

- Use **Node 24** (`.nvmrc`) — the phase-7 plan notes Node 20 breaks vitest with `ERR_REQUIRE_ESM`.
- `npm run format:check` (root) and `npm run lint:web`.
- `npm run typecheck` (web).
- `npm run test:web` — `seo-discovery.test.ts` must stay green after any `public/` or Move-4b change.
- `next build` (webpack) succeeds.
- Validate new JSON-LD in Google Rich Results Test / schema.org validator (no errors on the pillar
  page's FAQPage + TechArticle).
- Preview render: `/agent-reputation-system` shows the H1/definition; `view-source` shows the exact
  title tag "Agent Reputation System | AgentVouch" and the ld+json blocks.
- Fetch `/sitemap.xml` and `/robots.txt` locally and confirm the pillar URL is present and allowed.
- Post-ship (owner, external): in Search Console, request indexing for the pillar URL and watch the
  "agent reputation system" query for position + CTR over 2–4 weeks.

## Rollout

- Ship Move 1 + Move 4a together (one PR) — that is the bundle that directly targets the ranking
  query. Moves 2, 3, and 4b are independent follow-on PRs.
- After merge, submit the pillar URL for indexing in GSC so the exact-match page is discovered fast.

## Rollback

- Each move is additive and independently revertable. Reverting the pillar page, the `SITE_TAGLINE`
  string, the `page.tsx` hero copy, and the sitemap/robots lines fully restores prior behavior.
- Move 4b (dynamic routes) rollback: restore the static `public/llms.txt` + `public/llms-full.txt`
  and revert the `seo-discovery.test.ts` change; delete the new route files.

## Blockers / Open Questions

- **Move 4b is test-coupled:** `seo-discovery.test.ts` reads `public/` directly. Do not convert to
  dynamic routes without reworking that test, or CI breaks. This is why 4b is split from 4a.
- **H1 design decision:** whether the homepage H1 may include the keyword (stronger) or must stay
  the brand word "AgentVouch" (current). Confirm with design before changing the H1; the H2 route
  is the safe default.
- **Numbers are pre-traction:** 191 impressions / 6 months means the dominant lever is *more
  targeted content* (Moves 1–2), not schema micro-tuning. Set expectations accordingly.
