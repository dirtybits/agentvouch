---
name: jasmine-ai-provider
overview: "Connect AgentVouch summaries and advisory security scans to Jasmine while preserving structured output, cache identity, and an explicit Gemini rollback."
todos:
  - id: inspect-connections
    content: Verify both Gemini call sites and Jasmine discovery, routing, and authentication
    status: completed
  - id: connect-provider
    content: Add server-side Jasmine selection, bounded generation, configuration docs, and behavioral tests
    status: completed
  - id: verify-local
    content: Run the full web gate and a bounded live Jasmine summary and scan smoke
    status: in_progress
  - id: connect-hosted
    content: Configure authenticated HTTPS access from Vercel and verify a preview before production activation
    status: in_progress
isProject: false
---

# Connect AgentVouch summaries and scans to Jasmine

## Goal

Use Jasmine for both current Gemini features: skill summaries and advisory security scans. Preserve the existing prompts, Zod response schemas, `review|avoid` verdicts, durable scan budgets, and model-qualified caches.

## Scope

- In: server-side provider selection, authenticated OpenAI-compatible Chat Completions, time/output/input bounds, configuration documentation, regression tests, and a small live smoke without database writes.
- Out: changing model weights, restarting Jasmine services, public browser-chat authentication, wallet/chain/DB schema changes, broad rescan/backfill, and automatic fallback to Gemini after a Jasmine error.

## Verified on 2026-11-04

- `web/lib/ai/gateway.ts` selects Gemini for `web/lib/ai/summarize.ts` and `web/lib/ai/scan.ts`. Scan queries elsewhere use the same string model identity.
- Jasmine discovery through the existing local tunnel succeeds at `http://127.0.0.1:18085/v1`; `/v1/models` advertises `huihui-qwen3-8-27b-ud-q4-k-xl`. Live `/props` reports 131,072 context tokens and one model slot; older local launcher/catalog files still say 65,536.
- The browser beta at `jasmine.andysustic.com` does not expose native inference routes. Vercel needs a dedicated authenticated server-to-server route. The localhost tunnel cannot serve a hosted Vercel function.
- Existing requests use `chat_template_kwargs.enable_thinking=false`. The gateway forwards structured-output fields unchanged; actual schema compatibility remains to be tested.

## Files and implementation

- `web/lib/ai/gateway.ts`: retain stable string model identifiers for caches; add explicit `AI_PROVIDER=jasmine|gateway` selection. Keep gateway as the unset default until hosted access and evaluation are ready.
- `web/lib/ai/provider.ts`: construct a Jasmine Chat Completions model lazily using `@ai-sdk/openai-compatible`, private environment values, optional bearer or paired Cloudflare Access service credentials, no redirects, no inference retries, and a bounded timeout. Disable thinking for Huihui structured output.
- `web/lib/ai/{scan,summarize}.ts`: use shared provider options, preserve schemas/prompts, and bound Jasmine input/output to fit its context and single-slot capacity.
- `web/__tests__/lib/`: verify provider routing, headers/body, cache identities, structured-output failures, truncation, and absence of gateway fallback.
- `web/scripts/jasmine-ai-smoke.ts`: use the real summary/scan functions on synthetic clean and malicious fixtures, sequentially, without writing DB state.
- `docs/JASMINE_AI.md`: exact local/hosted configuration, missing infrastructure, verification, and rollback.
- `web/package.json` and root `package-lock.json`: pin the compatible provider major to AI SDK 6; avoid an unrelated SDK upgrade.

## Verification

Use Node 24. Run targeted AI tests, then `npm run format:check`, workspace lint, typecheck, Vitest, and `npm exec --workspace @agentvouch/web -- next build --webpack`.

Before the live smoke, check Jasmine health, maintenance, and available slots. Run the synthetic fixtures sequentially with thinking off and bounded timeout/output; record JSON validity, verdicts, and elapsed times. A handful of fixtures proves compatibility only, not scanner quality. The existing skill-scan evaluation corpus remains a hosted rollout requirement.

## Rollout

Local development uses `AI_PROVIDER=jasmine`, `JASMINE_BASE_URL=http://127.0.0.1:18085/v1`, and the verified model alias. Hosted environments require HTTPS and a server-side credential. Prepare a preview and verify inference, schema validation, response latency, and conservative behavior on errors before switching production. Never expose the raw loopback gateway publicly.

## Rollback

Set `AI_PROVIDER=gateway` and redeploy. Existing Gemini identifiers and cached results remain intact. Jasmine failures must not silently send content to another provider.

## Blockers

- Hosted inference URL and machine credentials are not configured or verified. The user selected a dedicated Cloudflare-protected API on 2026-11-04.
- Production scanner quality, Vercel-to-Jasmine reachability, and hosted latency are unverified.

## 2026-11-04 decision checkpoint

The user asked for an explanation of connection options before proceeding. Only investigation, the plan, and dependency preparation have been completed. Signed commit `f8b8f94e` adds the AI SDK 6-compatible provider and lockfile; `npm ci` and its CLI build passed. No provider code, environment setting, inference request, hosted route, or deployment has changed. Web tests/build and structured-output inference have not run. Continue implementation after the user selects the connection approach.

## 2026-11-04 protected API authorized

The user selected option 1, the protected API, and asked whether the browser chat should move to `jasmine.agentvouch.xyz`. Current DNS shows `agentvouch.xyz` is at Namecheap and `andysustic.com` is already on Cloudflare. Proceed with the originally proposed `jasmine-api.andysustic.com` to avoid expanding scope into a whole-zone DNS migration. The chat hostname question is advice, not authorization to migrate its Access/Turnstile/origin settings. Necessary isolated inference service and tunnel configuration are now in scope; do not restart models or disturb the existing chat route.

Provider code is implemented. Format, workspace lint/typecheck, and all 1,413 web tests across 155 files passed. The live idle-slot preflight passed. One real summary (2.4 s) and three scans (3.6–6.7 s) returned valid JSON. Both malicious fixtures returned `avoid`; the benign fixture returned low-risk `review` with a speculative finding (noisy-clean). Webpack build and the 25-case corpus evaluation remain underway. No hosted configuration or production traffic has changed.
