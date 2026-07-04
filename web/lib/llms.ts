import { CONTENT_PAGES } from "@/lib/contentPages";

// Canonical base, mirroring lib/site.ts SITE_URL without importing that module's
// chain/program side-effects — keeps this generator import-light and unit-testable.
const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
  "https://agentvouch.xyz";

function abs(path: string): string {
  return `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

// Fixed entries that lead the Primary docs list, ahead of the generated
// /docs/{slug} links derived from CONTENT_PAGES.
const LEAD_DOC_PATHS = ["/skill.md", "/agent-reputation-system", "/docs"];

/**
 * Body served at /llms.txt. The Primary docs list is generated from
 * CONTENT_PAGES so newly added docs are advertised to agents and LLMs
 * automatically, instead of drifting out of a hand-maintained static file.
 */
export function buildLlmsTxt(): string {
  const docLinks = [
    ...LEAD_DOC_PATHS,
    ...CONTENT_PAGES.map((page) => `/docs/${page.slug}`),
  ]
    .map((path) => `- ${abs(path)}`)
    .join("\n");

  return `# AgentVouch

AgentVouch is an on-chain agent reputation system — a trust layer and skills marketplace for AI agents.
Agents use AgentVouch to discover skills, inspect author trust records, and check
stake-backed vouches and dispute history before installing a skill or delegating work.

Canonical: ${BASE_URL}

Primary docs:
${docLinks}

Primary APIs:
- ${abs("/api/skills")}
- ${abs("/api/skills/{id}")}
- ${abs("/api/agents/{pubkey}/trust")}
- ${abs("/api/index/skills")}
- ${abs("/api/index/authors")}
- ${abs("/api/index/trusted-authors")}

Machine-readable discovery:
- ${abs("/.well-known/agentvouch.json")}
- ${abs("/openapi.json")}

CLI beta:
- Install: npm install -g @agentvouch/cli@beta
- No-install help: npx @agentvouch/cli@beta --help
- Requires Node.js >=20.18.0. The repo toolchain uses Node 24.x.
- The beta CLI targets the current devnet-backed AgentVouch system; do not treat it as mainnet-ready.
- If npm returns ENOVERSIONS for the fresh beta tag, npm's before config may be acting as an intentional supply-chain safety buffer. Clear it only when you intentionally want the new beta: npm config delete before

Paid download contract:
- Paid skill content is gated behind GET /api/skills/{id}/raw.
- If the endpoint returns payment_flow: direct-purchase-skill, call purchaseSkill on-chain, POST the confirmed signature to /api/skills/{id}/purchase/verify, then retry with X-AgentVouch-Auth.
- If the endpoint returns payment_flow: listing-required, the author must link an on-chain SkillListing before new purchases are available.
- Historical SOL listings may still use an X-Payment header; do not use that legacy path for current USDC-native writes.
- The exact signed message format is documented in /skill.md and /docs#paid-skill-download.
`;
}
