export const meta = {
  name: 'review-ai-security-scan',
  description: 'Adversarial multi-dimension review of the AI security-scan commit (18b0cc6)',
  phases: [
    { title: 'Find', detail: 'one adversarial reviewer per risk dimension, each trying to break it' },
    { title: 'Verify', detail: 'independent skeptic refutes each finding before it survives' },
  ],
}

const COMMIT = '18b0cc6'
const BRANCH = 'feat/ai-security-scan'

const PREAMBLE = [
  `You are reviewing git commit ${COMMIT} on branch ${BRANCH} of the AgentVouch repo (web/ is a Next.js 16 app). This commit implements an AI security-scan feature.`,
  ``,
  `GATHER YOUR OWN EVIDENCE FIRST. Use: "git show ${COMMIT} -- <path>" to see the diff, Read to see full files in context, Grep to trace callers/definitions. Do not trust any summary — read the actual code.`,
  ``,
  `Feature context & the design contract this must satisfy:`,
  `- A scan evaluates a skill's WHOLE file tree (SKILL.md + scripts/ + references/), feeding attacker-controlled file contents to an AI model.`,
  `- TWO HARD INVARIANTS: (1) the scan may only LOWER trust, never grant "allow" — only staked vouches earn allow; (2) scan output must be visibly distinct from staked trust ("advisory/automated", never styled like a stake).`,
  `- POST /api/check is a PUBLIC, walletless endpoint that invokes a PAID model on caller-supplied content. It must not be drainable. Launch gate = rate limit + spend cap/circuit breaker + max content size + cheap pre-filter. Caching does NOT protect it (unique-content floods bypass the cache).`,
  `- Cache is content-addressed by tree_hash, keyed (tree_hash, rubric_version, model), in a skill_scans table.`,
  `- Fusion lattice: avoid < review < unknown < allow; recommended_action = worst(staked, scan); allow only when staked===allow AND scan is not review/avoid.`,
  ``,
  `Key files: web/app/api/check/route.ts (443, new), web/lib/ai/scan.ts (279, new), web/lib/securityScan.ts (89, new), web/lib/db.ts (+19 migration), web/lib/skillStorage.ts (+39), web/app/api/skills/route.ts (+74), web/app/api/skills/[id]/versions/route.ts (+2), web/app/api/skills/[id]/route.ts (+43), web/app/api/skills/hydrate/route.ts (+28), UI: web/components/SkillPreviewCard.tsx, web/components/SkillFileTree.tsx, web/app/skills/[id]/page.tsx, tests under web/__tests__/.`,
  ``,
  `Be ADVERSARIAL: don't confirm a control "exists" — try to construct an input or sequence that DEFEATS it. Report only real, evidence-backed issues; cite file + line/function + a concrete repro/exploit. No speculative or style-only findings unless they affect correctness/security. If the dimension is solid, say so in notes and return an empty findings array.`,
].join('\n')

const DIMENSIONS = [
  { key: 'invariant-leak', focus: 'INVARIANT INTEGRITY. Trace every code path in /api/check and scan.ts where a scan result influences the returned recommended_action. Can scan output EVER produce "allow" (directly, or by the fusion treating "unknown"/missing scan as permissive)? Check the lattice/worst() implementation for off-by-one or default-to-allow bugs. Verify the zod schema for the scan genuinely forbids "allow" (enum), and that a malformed/empty model response cannot be coerced into allow. Also verify invariant #2: is the scan verdict rendered visibly distinct from staked trust in SkillPreviewCard.tsx and skills/[id]/page.tsx?' },
  { key: 'budget-dos', focus: 'BUDGET / DoS. /api/check invokes a paid model on caller content. Try to drain it: (a) unique-content flood that bypasses the tree_hash cache — is there a per-IP + global rate limit that actually fires before the model call? (b) the spend cap / circuit breaker — does it degrade to staked/cached-only when tripped, and is the counter incremented BEFORE the model call (not after, which a flood would race)? (c) max content size — is MAX_SKILL_TREE_BYTES enforced before scanning, and can a caller send a huge files array that sums past it? (d) the heuristic pre-filter (hasScanEscalationSignal / recordHeuristicReviewScan) — can low-signal content still force a model call, or can malicious content evade the pre-filter and get a cheap "review" without scanning? Confirm rate-limit state is durable on serverless (in-memory per-instance vs shared).' },
  { key: 'prompt-injection', focus: 'PROMPT INJECTION / SCAN EVASION. The scan feeds untrusted multi-file content (esp. scripts/) to the model. Read scan.ts prompt construction. (a) Is each file in a clearly-delimited untrusted channel, or can file contents break out of the delimiter and inject instructions (e.g. a file containing the closing delimiter string)? (b) Can a skill instruct the model to self-certify safe / return low risk? (c) TRUNCATION: if the tree exceeds the model-input budget, is truncated=true set and does it avoid reporting clean on an unscanned remainder? Can an attacker push malicious code past the truncation boundary so it is never scanned but the verdict looks clean? (d) Are binary/non-text files skipped safely?' },
  { key: 'cache-idempotency', focus: 'CACHE CORRECTNESS & IDEMPOTENCY. Read ensureSkillScan/getCachedSkillScan in scan.ts and the skill_scans table in db.ts. (a) Is the cache key exactly (tree_hash, rubric_version, model)? Does bumping rubric_version or model force a re-scan rather than serve stale? (b) Concurrent publish-scan + /api/check on the same tree_hash — is the INSERT idempotent (ON CONFLICT) and free of races / unique-violation crashes? (c) Does computeTreeHash for caller-submitted content/files match the publish-path tree_hash byte-for-byte? (d) Could a cache entry from one skill be served for a different skill sharing content — and is that correct (content-addressed) or a leak?' },
  { key: 'fusion-and-inputs', focus: 'INPUT HANDLING & TRUST FUSION. Read request parsing in /api/check (author/skill, tree_hash/hash, content/files). (a) Input validation: body fields typed unknown — can a malformed files array or content crash the handler or bypass size checks? (b) Does the fusion correctly NOT reuse getRecommendedAction closed-world !isRegistered->avoid rule for open-world content inputs? (c) Does it handle "tree_hash given but not found and no content" as unknown (not allow/error)? (d) Chain-only/IPFS skills out of scope — handled? (e) SSRF: is url= input actually disabled at launch?' },
  { key: 'migration-regression', focus: 'DB MIGRATION & REGRESSION. (a) db.ts additions: is skill_scans created additively (IF NOT EXISTS), correct column types, PK/index on tree_hash, no destructive ALTER, inside initializeDatabase following the existing pattern? (b) skillStorage.ts changes (getFilesForVersion, prepareSkillTree, SkillFileWithBytes) — do they regress existing getFileForVersion/buildArchiveForVersion or the tar hardening? (c) The +74 in skills/route.ts, +43 in [id]/route.ts, +28 in hydrate — regress the existing publish/auth/gating flow? Did security_scan get added to responses without leaking anything or breaking consumers? (d) Is scan-on-publish wired as best-effort after() that never blocks or fails publish?' },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'nit'] },
          file: { type: 'string' },
          location: { type: 'string' },
          detail: { type: 'string' },
          exploit_or_repro: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
        required: ['title', 'severity', 'file', 'detail', 'exploit_or_repro'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['dimension', 'findings', 'notes'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    real: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    corrected_severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'nit', 'not-a-bug'] },
    reasoning: { type: 'string' },
  },
  required: ['real', 'confidence', 'corrected_severity', 'reasoning'],
}

function verifyPrompt(f, dim) {
  return [
    `You are an adversarial verifier on the AgentVouch repo (commit ${COMMIT}, branch ${BRANCH}). A reviewer claims the following issue in the AI security-scan feature. Your job is to REFUTE it.`,
    `Gather your own evidence: "git show ${COMMIT} -- ${f.file}", Read the full file, Grep for callers. Default to real=false unless the code clearly confirms the issue. Check: does the cited code actually do what the claim says? Is there a guard elsewhere that already prevents it? Is the exploit actually reachable?`,
    ``,
    `CLAIM:`,
    `Title: ${f.title}`,
    `Severity: ${f.severity}`,
    `File: ${f.file}`,
    `Location: ${f.location || 'n/a'}`,
    `Detail: ${f.detail}`,
    `Claimed exploit/repro: ${f.exploit_or_repro}`,
    ``,
    `Return your verdict: is this a real, reachable issue? Correct the severity if the reviewer over/under-stated it.`,
  ].join('\n')
}

const results = await pipeline(
  DIMENSIONS,
  (d) => agent(PREAMBLE + '\n\n=== YOUR DIMENSION: ' + d.key + ' ===\n' + d.focus, {
    label: 'find:' + d.key,
    phase: 'Find',
    schema: FINDINGS_SCHEMA,
  }),
  (review, d) => {
    if (!review || !review.findings || review.findings.length === 0) {
      return { dimension: d.key, verified: [] }
    }
    return parallel(
      review.findings.map((f) => () =>
        agent(verifyPrompt(f, d.key), {
          label: 'verify:' + d.key + ':' + f.title.slice(0, 24),
          phase: 'Verify',
          schema: VERDICT_SCHEMA,
        }).then((v) => ({ ...f, dimension: d.key, verdict: v }))
      )
    ).then((arr) => ({ dimension: d.key, verified: arr.filter(Boolean) }))
  }
)

const allFindings = results.filter(Boolean).flatMap((r) => r.verified || [])
const confirmed = allFindings.filter((f) => f.verdict && f.verdict.real && f.verdict.corrected_severity !== 'not-a-bug')
const dismissed = allFindings.filter((f) => !f.verdict || !f.verdict.real || f.verdict.corrected_severity === 'not-a-bug')

const order = { blocker: 0, high: 1, medium: 2, low: 3, nit: 4 }
confirmed.sort((a, b) => (order[a.verdict.corrected_severity] || 9) - (order[b.verdict.corrected_severity] || 9))

return {
  commit: COMMIT,
  confirmed: confirmed.map((f) => ({
    dimension: f.dimension,
    title: f.title,
    severity: f.verdict.corrected_severity,
    confidence: f.verdict.confidence,
    file: f.file,
    location: f.location,
    detail: f.detail,
    exploit_or_repro: f.exploit_or_repro,
    suggested_fix: f.suggested_fix,
    verifier_reasoning: f.verdict.reasoning,
  })),
  dismissed: dismissed.map((f) => ({
    dimension: f.dimension,
    title: f.title,
    claimed_severity: f.severity,
    file: f.file,
    why_dismissed: f.verdict ? f.verdict.reasoning : 'no verdict',
  })),
}
