# Jasmine summaries and advisory scans

AgentVouch can call Jasmine's OpenAI-compatible Chat Completions API for both
skill summaries and security scans. Set `AI_PROVIDER=jasmine` explicitly. An
unset selector retains the existing Gemini gateway until the hosted connection
is verified. `AI_PROVIDER=gateway` is the explicit rollback setting.

## Server configuration

These variables belong only in the server environment, never in `NEXT_PUBLIC_*`
variables or browser code.

| Variable                          | Purpose                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `AI_PROVIDER`                     | `jasmine` or `gateway`; default `gateway` during rollout         |
| `JASMINE_BASE_URL`                | HTTPS inference base ending in `/v1`                             |
| `JASMINE_MODEL`                   | Served alias; default `huihui-qwen3-8-27b-ud-q4-k-xl`            |
| `JASMINE_CF_ACCESS_CLIENT_ID`     | Dedicated Cloudflare Access service token ID                     |
| `JASMINE_CF_ACCESS_CLIENT_SECRET` | Matching service token secret                                    |
| `JASMINE_API_KEY`                 | Optional bearer credential for an alternative protected endpoint |
| `JASMINE_TIMEOUT_MS`              | Per-generation deadline, 1,000–120,000 ms; default 45,000        |
| `AI_SCAN_MAX_INPUT_BYTES`         | Existing scan input setting; Jasmine has a 32 KiB ceiling        |

Hosted Jasmine requires a service credential and HTTPS. Local development may
use the existing `http://127.0.0.1:18085/v1` SSH tunnel without a model API key.
Vercel deployments reject loopback URLs. Both Cloudflare credential fields must
be supplied together. `AI_SCAN_MODEL` continues to configure the gateway rollback
and does not override Jasmine's model identity.

Jasmine requests disable thinking and retries, reject redirects, and limit output
to 512 tokens for summaries or 4,096 tokens for scans. Files above the scan input
ceiling are marked truncated. The existing prompts, response schemas, scan
budgets, and `review|avoid` contract remain in force. Schema/transport failures
propagate to the existing unavailable-scan behavior; they never produce an allow
verdict or automatically fall back to Gemini.

At publish time, Jasmine runs the advisory scan first and then the summary.
Each pass remains best-effort. This avoids the two requests competing for the
single inference permit. The gateway rollback retains parallel generation.

## Cache behavior

Jasmine results use `jasmine/<served-model-id>` in the existing model cache keys.
Previous Gemini rows remain intact and are not presented as Jasmine-generated
results. Changing providers can therefore require new generations within the
existing scan budget. No database schema migration or bulk rescan is required.

## Hosted access

The endpoint being provisioned is `https://jasmine-api.andysustic.com/v1`. This is separate
from the browser chat at `jasmine.andysustic.com`, whose routes do not expose
native inference. Cloudflare Access must require a service token restricted to
the inference application. A dedicated tunnel and restricted proxy must forward
only the required inference route to Jasmine's existing gateway. Keep the model,
telemetry, owner controls, and browser chat private boundaries intact.

Verified 2026-11-04: `andysustic.com` uses Cloudflare DNS, while `agentvouch.xyz`
uses Namecheap DNS. Moving chat or inference to an AgentVouch hostname would
require separate DNS work, plus Access/origin/Turnstile changes for browser chat.
The inference setup does not migrate the chat hostname.

The dedicated Cloudflare service token is stored as a Vercel Secret for Production
and the `codex/feat/jasmine-ai-provider` Preview branch. Its expiry is 2027-11-04;
renew it in the protected environment before that date. Production provider
activation is a separate rollout step after authenticated preview verification.

## Verification and rollout

From `web/`, after confirming gateway health and an idle model slot:

```sh
AI_PROVIDER=jasmine \
JASMINE_BASE_URL=http://127.0.0.1:18085/v1 \
npx tsx --tsconfig tsconfig.json scripts/jasmine-ai-smoke.ts
```

The smoke sends one summary and three scans sequentially using synthetic clean,
secret-exfiltration, and reviewer-injection fixtures. It writes no database rows.
This proves API/schema compatibility for those examples, not broad scanner
quality. Run the existing skill-scan evaluation corpus before production use.

### Corpus evaluation

After the same health/idle-slot preflight, run the production scanner directly on
the existing 25-case corpus. Calls are sequential and write no database rows.
From `web/`:

```sh
AI_PROVIDER=jasmine \
JASMINE_BASE_URL=http://127.0.0.1:18085/v1 \
npx tsx --tsconfig tsconfig.json scripts/jasmine-ai-eval.ts \
  --split dev --out /private/tmp/jasmine-ai-dev.json
```

Use `--split holdout` with a different output file for the nine holdout cases.
Omit `--split` to run all 25 cases. `--out` must be absolute and must not already
exist. The report persists complete case outputs/errors and aggregate counts and
latencies after each case; interrupted runs retain `completed: false`.

Only `avoid` counts as strong detection of an unsafe case. An unsafe `review` is
an explicit undercall, even when it includes findings. Benign cases are counted
as `avoid`, noisy `review`, or clean `review` (low risk, zero findings, and no
truncation). Errors are separate, and the report gives unsafe avoid rates both
with and without errors in the denominator. Each case runs once with the current
production prompt/schema; this is a bounded corpus evaluation, not a general
model-safety claim. Exit status is nonzero for errors, unsafe undercalls, or
benign `avoid` results; inspect the report even when every request returns JSON.

Run the full Node 24 web gate. Then verify the hosted endpoint rejects anonymous
and wrong-token requests and all unlisted routes. Verify a valid structured
completion and cancellation/deadline behavior. Configure the new variables on a
Vercel preview and check the deployed scan flow before production activation.

Verified 2026-11-04: format, lint, typecheck, all 1,418 web tests and the webpack
build passed. The unchanged scanner ran once across all 25 cases: 25 valid
outputs, 14/14 unsafe `avoid`, 0/11 benign `avoid`, and no errors. Nine benign
cases still produced speculative review findings. The nine-case holdout alone
had 5/5 unsafe `avoid`, no benign `avoid`, and a 10.04 s maximum latency.
These small single-trial results support the integration check, not a general
claim of scanner reliability.

Vercel must include files outside its `web/` root directory so the workspace
lockfile is available. `web/vercel.json` installs from the repository root with
`npm ci`, matching local verification. A cold deployment with the previous
isolated `npm install` fetched an incompatible Solana dependency; warmed build
caches had hidden this configuration issue.

Rollback by setting `AI_PROVIDER=gateway` and redeploying. Revoke the dedicated
service token and stop only the new API tunnel/proxy if removing hosted access.
Do not alter the existing browser tunnel or model services.
