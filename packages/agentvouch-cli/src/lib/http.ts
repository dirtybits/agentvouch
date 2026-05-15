import type { AuthPayload, PaymentRequirement } from "@agentvouch/protocol";
import {
  decodePaymentResponseHeader,
  type PaymentRequired as X402PaymentRequired,
  type SettleResponse as X402SettleResponse,
} from "@x402/fetch";
import { CliError } from "./errors.js";

export interface SkillAuthorTrust {
  isRegistered?: boolean;
  reputationScore?: number;
  totalVouchesReceived?: number;
  totalStakedFor?: number;
  disputesAgainstAuthor?: number;
  disputesUpheldAgainstAuthor?: number;
  activeDisputesAgainstAuthor?: number;
  authorBondUsdcMicros?: number;
  totalStakeAtRisk?: number;
  registeredAt?: number;
}

export interface SkillAuthorTrustSummary {
  wallet_pubkey: string;
  canonical_agent_id: string;
  chain_context: string;
  schema_version: string;
  trust_updated_at: string;
  recommended_action: "allow" | "review" | "avoid";
  reputationScore: number;
  totalVouchesReceived: number;
  totalStakedFor: number;
  disputesAgainstAuthor: number;
  disputesUpheldAgainstAuthor: number;
  activeDisputesAgainstAuthor: number;
  registeredAt: number;
  isRegistered: boolean;
}

export interface SkillRecord {
  id: string;
  skill_id: string;
  author_pubkey: string;
  name: string;
  description: string | null;
  tags?: string[];
  current_version?: number;
  chain_context?: string | null;
  on_chain_address: string | null;
  price_lamports?: number | null;
  price_usdc_micros?: string | null;
  currency_mint?: string | null;
  payment_flow?:
    | "free"
    | "legacy-sol"
    | "listing-required"
    | "x402-usdc"
    | "x402-bridge-purchase-skill"
    | "direct-purchase-skill";
  total_installs: number;
  total_downloads?: number | null;
  total_revenue?: number | null;
  skill_uri?: string | null;
  source?: "repo" | "chain";
  content?: string | null;
  buyerHasPurchased?: boolean;
  created_at?: string;
  updated_at?: string;
  author_trust?: SkillAuthorTrust | null;
  author_trust_summary?: SkillAuthorTrustSummary | null;
  author_identity?: {
    name?: string | null;
  } | null;
}

export interface SkillUpdateCheckResponse {
  id: string;
  skill_slug: string;
  source: "repo";
  status: "up_to_date" | "update_available" | "unknown_installed_version";
  installed_version: number | null;
  latest_version: number;
  latest_updated_at: string;
  on_chain_address: string | null;
  price_lamports?: number | null;
  price_usdc_micros?: string | null;
  currency_mint?: string | null;
  payment_flow?:
    | "free"
    | "legacy-sol"
    | "listing-required"
    | "x402-usdc"
    | "x402-bridge-purchase-skill"
    | "direct-purchase-skill";
  requires_purchase: boolean;
  listing_changed: boolean;
}

export interface SkillListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SkillListResponse {
  skills: SkillRecord[];
  pagination: SkillListPagination;
}

export interface AuthorRecord {
  pubkey: string;
  canonical_agent_id: string | null;
  chain_context: string | null;
  recommended_action: "allow" | "review" | "avoid" | null;
  author_trust_summary: SkillAuthorTrustSummary | null;
  author_identity?: {
    name?: string | null;
    displayName?: string | null;
    canonicalAgentId?: string | null;
  } | null;
  skill_count?: number;
  trusted_skill_count?: number;
}

export interface AuthorListResponse {
  schema_version: string;
  generated_at: string;
  total: number;
  authors: AuthorRecord[];
}

export interface AgentTrustResponse {
  pubkey: string;
  trust: SkillAuthorTrustSummary;
  author_trust: SkillAuthorTrust | null;
  author_identity?: {
    name?: string | null;
    displayName?: string | null;
    canonicalAgentId?: string | null;
  } | null;
  author_disputes?: Array<Record<string, unknown>>;
}

export interface ListSkillsOptions {
  q?: string;
  sort?: "newest" | "trusted" | "installs" | "name";
  author?: string;
  tags?: string;
  page?: number;
}

export interface ListAuthorsOptions {
  trusted?: boolean;
}

export interface PublishedSkillRecord {
  id: string;
  skill_id: string;
  ipfs_cid: string | null;
}

export interface DownloadResponse {
  ok: boolean;
  status: number;
  content?: string;
  error?: string;
  requirement?: PaymentRequirement;
  directPurchaseRequired?: {
    amountMicros: string;
    currencyMint: string | null;
    skillListingAddress: string;
  };
  listingRequired?: {
    amountMicros: string;
    currencyMint: string | null;
    message: string | null;
  };
  x402PaymentRequired?: X402PaymentRequired;
  paymentResponse?: X402SettleResponse;
}

function getJsonContentType(response: Response): boolean {
  return (response.headers.get("content-type") || "").includes(
    "application/json"
  );
}

function parsePaymentRequirement(response: Response, body?: unknown) {
  const header = response.headers.get("x-payment");
  if (header) {
    try {
      return JSON.parse(header) as PaymentRequirement;
    } catch {
      return undefined;
    }
  }

  if (
    body &&
    typeof body === "object" &&
    "requirement" in body &&
    body.requirement
  ) {
    return body.requirement as PaymentRequirement;
  }

  return undefined;
}

function parseX402PaymentRequired(body?: unknown): X402PaymentRequired | undefined {
  if (
    body &&
    typeof body === "object" &&
    "x402Version" in body &&
    "accepts" in body &&
    Array.isArray((body as { accepts?: unknown[] }).accepts)
  ) {
    return body as X402PaymentRequired;
  }

  return undefined;
}

function parseDirectPurchaseRequired(body?: unknown):
  | {
      amountMicros: string;
      currencyMint: string | null;
      skillListingAddress: string;
    }
  | undefined {
  if (!body || typeof body !== "object") return undefined;
  const payload = body as {
    payment_flow?: unknown;
    amount_micros?: unknown;
    currency_mint?: unknown;
    on_chain_address?: unknown;
  };
  if (
    payload.payment_flow !== "direct-purchase-skill" ||
    typeof payload.amount_micros !== "string" ||
    typeof payload.on_chain_address !== "string"
  ) {
    return undefined;
  }
  return {
    amountMicros: payload.amount_micros,
    currencyMint:
      typeof payload.currency_mint === "string" ? payload.currency_mint : null,
    skillListingAddress: payload.on_chain_address,
  };
}

function parseListingRequired(body?: unknown):
  | {
      amountMicros: string;
      currencyMint: string | null;
      message: string | null;
    }
  | undefined {
  if (!body || typeof body !== "object") return undefined;
  const payload = body as {
    payment_flow?: unknown;
    amount_micros?: unknown;
    currency_mint?: unknown;
    message?: unknown;
  };
  if (
    payload.payment_flow !== "listing-required" ||
    typeof payload.amount_micros !== "string"
  ) {
    return undefined;
  }
  return {
    amountMicros: payload.amount_micros,
    currencyMint:
      typeof payload.currency_mint === "string" ? payload.currency_mint : null,
    message: typeof payload.message === "string" ? payload.message : null,
  };
}

export class AgentVouchApiClient {
  constructor(private readonly baseUrl: string) {}

  url(pathname: string): string {
    return `${this.baseUrl}${pathname}`;
  }

  async listSkills(
    options: ListSkillsOptions = {}
  ): Promise<SkillListResponse> {
    const searchParams = new URLSearchParams();

    if (options.q) {
      searchParams.set("q", options.q);
    }
    if (options.sort) {
      searchParams.set("sort", options.sort);
    }
    if (options.author) {
      searchParams.set("author", options.author);
    }
    if (options.tags) {
      searchParams.set("tags", options.tags);
    }
    if (options.page !== undefined) {
      searchParams.set("page", String(options.page));
    }

    const query = searchParams.toString();
    const response = await fetch(
      this.url(`/api/skills${query ? `?${query}` : ""}`)
    );
    const body = (await response.json().catch(() => null)) as
      | SkillListResponse
      | { error?: string }
      | null;

    if (
      !response.ok ||
      !body ||
      "error" in body ||
      !Array.isArray(body.skills) ||
      !body.pagination
    ) {
      throw new CliError(
        `Failed to list skills: ${body?.error || response.statusText}`,
        { exitCode: 1, data: body }
      );
    }

    return body;
  }

  async getSkill(id: string): Promise<SkillRecord> {
    const response = await fetch(this.url(`/api/skills/${id}`));
    const body = (await response.json().catch(() => null)) as
      | SkillRecord
      | { error?: string }
      | null;

    if (!response.ok || !body || "error" in body) {
      throw new CliError(
        `Failed to inspect skill ${id}: ${body?.error || response.statusText}`,
        { exitCode: 1, data: body }
      );
    }

    return body;
  }

  async listAuthors(
    options: ListAuthorsOptions = {}
  ): Promise<AuthorListResponse> {
    const pathname = options.trusted
      ? "/api/index/trusted-authors"
      : "/api/index/authors";
    const response = await fetch(this.url(pathname));
    const body = (await response.json().catch(() => null)) as
      | AuthorListResponse
      | { error?: string }
      | null;

    if (
      !response.ok ||
      !body ||
      "error" in body ||
      !Array.isArray(body.authors)
    ) {
      throw new CliError(
        `Failed to list authors: ${body?.error || response.statusText}`,
        { exitCode: 1, data: body }
      );
    }

    return body;
  }

  async getAgentTrust(pubkey: string): Promise<AgentTrustResponse> {
    const response = await fetch(this.url(`/api/agents/${pubkey}/trust`));
    const body = (await response.json().catch(() => null)) as
      | AgentTrustResponse
      | { error?: string }
      | null;

    if (!response.ok || !body || "error" in body) {
      throw new CliError(
        `Failed to fetch agent trust for ${pubkey}: ${
          body?.error || response.statusText
        }`,
        { exitCode: 1, data: body }
      );
    }

    return body;
  }

  async fetchRemoteText(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new CliError(
        `Failed to fetch skill content from ${url}: ${response.status} ${response.statusText}`
      );
    }
    return response.text();
  }

  async downloadRaw(
    id: string,
    options?: {
      auth?: AuthPayload;
      fetchImpl?: typeof fetch;
    }
  ): Promise<DownloadResponse> {
    const headers: Record<string, string> = {};
    if (options?.auth) {
      headers["X-AgentVouch-Auth"] = JSON.stringify(options.auth);
    }

    const response = await (options?.fetchImpl ?? fetch)(
      this.url(`/api/skills/${id}/raw`),
      {
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      }
    );

    const paymentResponseHeader = response.headers.get("PAYMENT-RESPONSE");
    const paymentResponse = paymentResponseHeader
      ? decodePaymentResponseHeader(paymentResponseHeader)
      : undefined;

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        content: await response.text(),
        paymentResponse,
      };
    }

    const body = getJsonContentType(response)
      ? ((await response.json().catch(() => null)) as { error?: string } | null)
      : null;

    return {
      ok: false,
      status: response.status,
      error:
        body?.error ||
        (await response.text().catch(() => response.statusText)) ||
        response.statusText,
      requirement: parsePaymentRequirement(response, body),
      directPurchaseRequired: parseDirectPurchaseRequired(body),
      listingRequired: parseListingRequired(body),
      x402PaymentRequired: parseX402PaymentRequired(body),
      paymentResponse,
    };
  }

  async verifyDirectPurchase(
    id: string,
    body: {
      signature: string;
      buyer: string;
      listingAddress: string;
    }
  ): Promise<void> {
    const response = await fetch(this.url(`/api/skills/${id}/purchase/verify`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;

    if (!response.ok || !payload?.ok) {
      throw new CliError(
        `Failed to verify purchase for ${id}: ${
          payload?.error || response.statusText
        }`,
        { exitCode: 1, data: payload }
      );
    }
  }

  async publishSkill(
    body: Record<string, unknown>
  ): Promise<PublishedSkillRecord> {
    const response = await fetch(this.url("/api/skills"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | PublishedSkillRecord
      | { error?: string }
      | null;

    if (!response.ok || !payload || "error" in payload) {
      throw new CliError(
        `Failed to publish repo skill: ${
          payload?.error || response.statusText
        }`,
        { exitCode: 1, data: payload }
      );
    }

    return payload;
  }

  async linkSkillListing(
    skillId: string,
    body: Record<string, unknown>
  ): Promise<SkillRecord> {
    const response = await fetch(this.url(`/api/skills/${skillId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | SkillRecord
      | { error?: string }
      | null;

    if (!response.ok || !payload || "error" in payload) {
      throw new CliError(
        `Failed to link repo skill ${skillId} to on-chain listing: ${
          payload?.error || response.statusText
        }`,
        { exitCode: 1, data: payload }
      );
    }

    return payload;
  }

  async addSkillVersion(
    skillId: string,
    body: Record<string, unknown>
  ): Promise<{ version: number }> {
    const response = await fetch(this.url(`/api/skills/${skillId}/versions`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | { version: number; error?: never }
      | { error?: string }
      | null;

    if (!response.ok || !payload || "error" in payload) {
      throw new CliError(
        `Failed to add skill version for ${skillId}: ${
          payload?.error || response.statusText
        }`,
        { exitCode: 1, data: payload }
      );
    }

    return payload;
  }

  async checkSkillUpdate(
    skillId: string,
    options: {
      installedVersion?: number;
      source?: "repo" | "chain";
      listing?: string | null;
    } = {}
  ): Promise<SkillUpdateCheckResponse> {
    const searchParams = new URLSearchParams();
    if (options.installedVersion !== undefined) {
      searchParams.set("installed_version", String(options.installedVersion));
    }
    if (options.source) {
      searchParams.set("source", options.source);
    }
    if (options.listing) {
      searchParams.set("listing", options.listing);
    }

    const query = searchParams.toString();
    const response = await fetch(
      this.url(`/api/skills/${skillId}/update${query ? `?${query}` : ""}`)
    );
    const payload = (await response.json().catch(() => null)) as
      | SkillUpdateCheckResponse
      | { error?: string }
      | null;

    if (!response.ok || !payload || "error" in payload) {
      throw new CliError(
        `Failed to check for updates for ${skillId}: ${
          payload?.error || response.statusText
        }`,
        { exitCode: 1, data: payload }
      );
    }

    return payload;
  }
}
