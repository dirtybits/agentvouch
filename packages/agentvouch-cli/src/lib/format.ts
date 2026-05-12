import type {
  AgentTrustResponse,
  AuthorListResponse,
  AuthorRecord,
  SkillListResponse,
  SkillRecord,
} from "./http.js";

function getTrustFields(skill: SkillRecord) {
  return {
    reputation:
      skill.author_trust_summary?.reputationScore ??
      skill.author_trust?.reputationScore ??
      0,
    isRegistered:
      skill.author_trust_summary?.isRegistered ??
      skill.author_trust?.isRegistered ??
      false,
    recommendedAction: skill.author_trust_summary?.recommended_action ?? null,
    activeDisputes:
      skill.author_trust_summary?.activeDisputesAgainstAuthor ??
      skill.author_trust?.activeDisputesAgainstAuthor ??
      0,
    upheldDisputes:
      skill.author_trust_summary?.disputesUpheldAgainstAuthor ??
      skill.author_trust?.disputesUpheldAgainstAuthor ??
      0,
  };
}

export function formatSkillSummary(skill: SkillRecord): string[] {
  const trust = getTrustFields(skill);
  const paymentFlow =
    skill.payment_flow ??
    (skill.price_usdc_micros
      ? skill.on_chain_address
        ? "direct-purchase-skill"
        : "x402-usdc"
      : "free");

  return [
    `${skill.name}`,
    `id: ${skill.id}`,
    `skill_id: ${skill.skill_id}`,
    `source: ${skill.source ?? "repo"}`,
    `author: ${skill.author_pubkey}`,
    `author_reputation: ${trust.reputation}`,
    `payment_flow: ${paymentFlow}`,
    `price_usdc_micros: ${skill.price_usdc_micros ?? "none"}`,
    `currency_mint: ${skill.currency_mint ?? "none"}`,
    `listing: ${skill.on_chain_address ?? "none"}`,
    `registered: ${trust.isRegistered ? "yes" : "no"}`,
    ...(trust.recommendedAction
      ? [`recommended_action: ${trust.recommendedAction}`]
      : []),
    `active_author_disputes: ${trust.activeDisputes}`,
    `upheld_author_disputes: ${trust.upheldDisputes}`,
  ];
}

export function formatSkillList(result: SkillListResponse): string[] {
  if (result.skills.length === 0) {
    return [
      "no skills found",
      `page: ${result.pagination.page}`,
      `page_size: ${result.pagination.pageSize}`,
      `total: ${result.pagination.total}`,
      `total_pages: ${result.pagination.totalPages}`,
    ];
  }

  const lines: string[] = [];

  for (const [index, skill] of result.skills.entries()) {
    lines.push(...formatSkillSummary(skill));
    if (index < result.skills.length - 1) {
      lines.push("");
    }
  }

  lines.push(
    "",
    `page: ${result.pagination.page}`,
    `page_size: ${result.pagination.pageSize}`,
    `total: ${result.pagination.total}`,
    `total_pages: ${result.pagination.totalPages}`
  );

  return lines;
}

function getAuthorName(author: AuthorRecord): string {
  return (
    author.author_identity?.displayName ??
    author.author_identity?.name ??
    author.canonical_agent_id ??
    author.pubkey
  );
}

function getAuthorReputation(author: AuthorRecord): number {
  return author.author_trust_summary?.reputationScore ?? 0;
}

export function formatAuthorSummary(author: AuthorRecord): string[] {
  return [
    getAuthorName(author),
    `author: ${author.pubkey}`,
    `author_reputation: ${getAuthorReputation(author)}`,
    `recommended_action: ${author.recommended_action ?? "unknown"}`,
    `skill_count: ${author.skill_count ?? author.trusted_skill_count ?? 0}`,
    ...(author.canonical_agent_id
      ? [`canonical_agent_id: ${author.canonical_agent_id}`]
      : []),
    ...(author.chain_context ? [`chain_context: ${author.chain_context}`] : []),
  ];
}

export function formatAuthorList(result: AuthorListResponse): string[] {
  if (result.authors.length === 0) {
    return ["no authors found", `total: ${result.total}`];
  }

  const lines: string[] = [];

  for (const [index, author] of result.authors.entries()) {
    lines.push(...formatAuthorSummary(author));
    if (index < result.authors.length - 1) {
      lines.push("");
    }
  }

  lines.push("", `total: ${result.total}`);

  return lines;
}

function getAgentName(trust: AgentTrustResponse): string {
  return (
    trust.author_identity?.displayName ??
    trust.author_identity?.name ??
    trust.trust.canonical_agent_id ??
    trust.pubkey
  );
}

export function formatAgentTrust(trust: AgentTrustResponse): string[] {
  const rawTrust = trust.author_trust;
  const disputeCount = trust.author_disputes?.length ?? 0;

  return [
    getAgentName(trust),
    `agent: ${trust.pubkey}`,
    `agent_reputation: ${trust.trust.reputationScore}`,
    `recommended_action: ${trust.trust.recommended_action}`,
    `registered: ${trust.trust.isRegistered ? "yes" : "no"}`,
    `canonical_agent_id: ${trust.trust.canonical_agent_id}`,
    `chain_context: ${trust.trust.chain_context}`,
    `total_vouches_received: ${trust.trust.totalVouchesReceived}`,
    `total_staked_for: ${trust.trust.totalStakedFor}`,
    `author_bond_usdc_micros: ${rawTrust?.authorBondLamports ?? 0}`,
    `total_stake_at_risk: ${rawTrust?.totalStakeAtRisk ?? 0}`,
    `active_author_disputes: ${trust.trust.activeDisputesAgainstAuthor}`,
    `upheld_author_disputes: ${trust.trust.disputesUpheldAgainstAuthor}`,
    `author_dispute_count: ${disputeCount}`,
  ];
}

export interface RegisterAgentResult {
  agentProfile: string;
  alreadyRegistered: boolean;
  tx?: string | null;
}

export function formatRegisterAgentResult(
  result: RegisterAgentResult
): string[] {
  return [
    `agent: ${result.agentProfile}`,
    `already_registered: ${result.alreadyRegistered ? "yes" : "no"}`,
    ...(result.tx ? [`tx: ${result.tx}`] : []),
  ];
}

export interface CreateVouchResult {
  vouch: string;
  alreadyExists: boolean;
  stakeUsdcMicros?: number;
  tx?: string | null;
}

export function formatCreateVouchResult(
  result: CreateVouchResult
): string[] {
  return [
    `vouch: ${result.vouch}`,
    `already_exists: ${result.alreadyExists ? "yes" : "no"}`,
    ...(result.stakeUsdcMicros
      ? [`stake_usdc_micros: ${result.stakeUsdcMicros}`]
      : []),
    ...(result.tx ? [`tx: ${result.tx}`] : []),
  ];
}
