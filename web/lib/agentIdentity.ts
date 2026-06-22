import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
} from "@solana/kit";
import { computeSchemaFingerprint, runSchemaDdlOnce, sql } from "@/lib/db";
import {
  getConfiguredSolanaChainContext,
  normalizeInputChainContext,
  normalizePersistedChainContext,
} from "@/lib/chains";
import { buildWalletFallbackUsername } from "@/lib/authorDisplay";
import type { GithubSession } from "@/lib/githubOAuth";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "../generated/agentvouch/src/generated/programs";

export type AgentIdentitySource = "local" | "erc8004" | "imported";
export type AgentUsernameSource = "fallback" | "user";

export interface AgentGithubProfile {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  url: string;
}

export interface AgentIdentityBinding {
  id: string;
  bindingType: string;
  chainContext: string;
  bindingRef: string;
  registryAddress: string | null;
  externalAgentId: string | null;
  isPrimary: boolean;
  verificationStatus: string;
  rawUpstreamChainLabel: string | null;
  rawUpstreamChainId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AgentIdentitySummary {
  id: string;
  canonicalAgentId: string;
  identitySource: AgentIdentitySource;
  homeChainContext: string | null;
  status: string;
  displayName: string | null;
  username: string | null;
  usernameSource: AgentUsernameSource;
  githubProfile: AgentGithubProfile | null;
  bindings: AgentIdentityBinding[];
  ownerWallet: string | null;
  operationalWallet: string | null;
  agentProfilePda: string | null;
  registryAsset: string | null;
}

export interface GithubLinkedWallet {
  agentId: string;
  canonicalAgentId: string;
  username: string | null;
  displayName: string | null;
  walletPubkey: string;
  chainContext: string;
  linkedAt: string | null;
}

const BINDING_TYPES = {
  walletOwner: "wallet_owner",
  walletOperational: "wallet_operational",
  agentProfilePda: "agent_profile_pda",
  solana8004Asset: "solana_8004_asset",
  evm8004Token: "evm_8004_token",
  githubProfile: "github_profile",
} as const;

const LOCAL_IDENTITY_REGISTRY = "agentvouch-local";
const GITHUB_BINDING_CONTEXT = "github";
const USERNAME_MAX_LENGTH = 32;
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

let schemaReady: Promise<void> | null = null;

function hasDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

type DbAgent = {
  id: string;
  canonical_agent_id: string;
  identity_source: AgentIdentitySource;
  home_chain_context: string | null;
  status: string;
  display_name: string | null;
  username: string | null;
  username_source: AgentUsernameSource | null;
};

type DbBinding = {
  id: string;
  binding_type: string;
  chain_context: string;
  binding_ref: string;
  registry_address: string | null;
  external_agent_id: string | null;
  is_primary: boolean;
  verification_status: string;
  raw_upstream_chain_label: string | null;
  raw_upstream_chain_id: string | null;
  metadata: Record<string, unknown> | string | null;
};

type DbGithubLinkedWallet = {
  agent_id: string;
  canonical_agent_id: string;
  username: string | null;
  display_name: string | null;
  wallet_pubkey: string;
  chain_context: string;
  linked_at: Date | string | null;
};

export function buildLocalCanonicalAgentId(
  walletPubkey: string,
  chainContext = getConfiguredSolanaChainContext()
): string {
  const normalized = normalizePersistedChainContext(chainContext);
  return `${normalized}:${LOCAL_IDENTITY_REGISTRY}#${walletPubkey}`;
}

export function buildRegistryCanonicalAgentId(
  registryAddress: string,
  recordId: string,
  chainContext = getConfiguredSolanaChainContext()
): string {
  const normalized = normalizePersistedChainContext(chainContext);
  return `${normalized}:${registryAddress}#${recordId}`;
}

export function buildFallbackAgentUsername(walletPubkey: string): string {
  return buildWalletFallbackUsername(walletPubkey);
}

export function normalizeAgentUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error(
      "Username must be 3-32 characters using lowercase letters, numbers, or hyphens, and cannot start or end with a hyphen."
    );
  }
  return normalized;
}

function parseBindingMetadata(
  metadata: DbBinding["metadata"]
): Record<string, unknown> | null {
  if (!metadata) return null;
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return metadata;
}

function githubProfileFromMetadata(
  metadata: Record<string, unknown> | null
): AgentGithubProfile | null {
  if (
    !metadata ||
    typeof metadata.id !== "string" ||
    typeof metadata.login !== "string"
  ) {
    return null;
  }
  return {
    id: metadata.id,
    login: metadata.login,
    name: typeof metadata.name === "string" ? metadata.name : null,
    avatarUrl:
      typeof metadata.avatarUrl === "string" ? metadata.avatarUrl : null,
    url:
      typeof metadata.url === "string"
        ? metadata.url
        : `https://github.com/${metadata.login}`,
  };
}

async function ensureUniqueUsername(
  requestedUsername: string,
  agentId?: string | null
): Promise<string> {
  const base = normalizeAgentUsername(requestedUsername).slice(
    0,
    USERNAME_MAX_LENGTH
  );
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate =
      attempt === 0
        ? base
        : `${base.slice(
            0,
            USERNAME_MAX_LENGTH - String(attempt + 1).length - 1
          )}-${attempt + 1}`;
    const rows = await sql()<DbAgent>`
      SELECT id, canonical_agent_id, identity_source, home_chain_context, status, display_name, username, username_source
      FROM agents
      WHERE lower(username) = lower(${candidate})
        ${agentId ? sql()`AND id <> ${agentId}::uuid` : sql()``}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return candidate;
    }
  }
  throw new Error(
    "Unable to reserve a unique username. Please choose another one."
  );
}

async function ensureAgentUsername(
  agent: DbAgent,
  walletPubkey?: string | null
): Promise<DbAgent> {
  if (agent.username) {
    return agent;
  }
  const fallback = walletPubkey
    ? buildFallbackAgentUsername(walletPubkey)
    : `agent-${agent.id.replace(/-/g, "").slice(0, 8)}`;
  const username = await ensureUniqueUsername(fallback, agent.id);
  const rows = await sql()<DbAgent>`
    UPDATE agents
    SET username = ${username},
        username_source = 'fallback',
        updated_at = NOW()
    WHERE id = ${agent.id}::uuid
    RETURNING id, canonical_agent_id, identity_source, home_chain_context, status, display_name, username, username_source
  `;
  return rows[0] ?? { ...agent, username, username_source: "fallback" };
}

export async function ensureAgentIdentitySchema(): Promise<void> {
  if (!hasDatabaseConfigured()) {
    return;
  }

  if (schemaReady) {
    return schemaReady;
  }

  schemaReady = (async () => {
    const db = sql();
    const fingerprint = computeSchemaFingerprint(
      runAgentIdentityDdl.toString()
    );
    await runSchemaDdlOnce(db, "agent_identity", fingerprint, () =>
      runAgentIdentityDdl(db)
    );
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}

async function runAgentIdentityDdl(db: ReturnType<typeof sql>) {
  await db`
      CREATE TABLE IF NOT EXISTS agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        canonical_agent_id TEXT NOT NULL UNIQUE,
        display_name VARCHAR(128),
        username VARCHAR(32),
        username_source VARCHAR(16) NOT NULL DEFAULT 'fallback',
        home_chain_context VARCHAR(64),
        identity_source VARCHAR(32) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

  await db`
      CREATE TABLE IF NOT EXISTS agent_identity_bindings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        binding_type VARCHAR(32) NOT NULL,
        chain_context VARCHAR(64) NOT NULL,
        binding_ref TEXT NOT NULL,
        registry_address TEXT,
        external_agent_id TEXT,
        is_primary BOOLEAN NOT NULL DEFAULT false,
        verification_status VARCHAR(16) NOT NULL DEFAULT 'verified',
        raw_upstream_chain_label TEXT,
        raw_upstream_chain_id TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(agent_id, binding_type, chain_context, binding_ref)
      )
    `;

  await db`
      ALTER TABLE agents
      ADD COLUMN IF NOT EXISTS username VARCHAR(32)
    `;

  await db`
      ALTER TABLE agents
      ADD COLUMN IF NOT EXISTS username_source VARCHAR(16) NOT NULL DEFAULT 'fallback'
    `;

  await db`
      ALTER TABLE agent_identity_bindings
      ADD COLUMN IF NOT EXISTS metadata JSONB
    `;

  await db`
      WITH fallback_usernames AS (
        SELECT
          a.id,
          'wallet-' || lower(left(regexp_replace(b.binding_ref, '[^a-zA-Z0-9]', '', 'g'), 6)) AS base_username,
          row_number() OVER (
            PARTITION BY lower(left(regexp_replace(b.binding_ref, '[^a-zA-Z0-9]', '', 'g'), 6))
            ORDER BY a.created_at ASC, a.id ASC
          ) AS collision_index
        FROM agents a
        JOIN agent_identity_bindings b ON b.agent_id = a.id
        WHERE b.binding_type = ${BINDING_TYPES.walletOwner}
          AND (a.username IS NULL OR a.username = '')
      )
      UPDATE agents a
      SET username = CASE
            WHEN fallback_usernames.collision_index = 1 THEN fallback_usernames.base_username
            ELSE left(fallback_usernames.base_username, 29) || '-' || fallback_usernames.collision_index::text
          END,
          username_source = 'fallback',
          updated_at = NOW()
      FROM fallback_usernames
      WHERE a.id = fallback_usernames.id
    `;

  await db`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_username_lower
      ON agents(lower(username))
      WHERE username IS NOT NULL
    `;

  await db`
      CREATE INDEX IF NOT EXISTS idx_agent_identity_bindings_lookup
      ON agent_identity_bindings(binding_type, chain_context, binding_ref)
    `;

  await db`
      CREATE INDEX IF NOT EXISTS idx_agent_identity_bindings_agent
      ON agent_identity_bindings(agent_id)
    `;

  await db`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_identity_bindings_unique_identity_surface
      ON agent_identity_bindings(chain_context, binding_ref)
      WHERE binding_type IN ('solana_8004_asset', 'agent_profile_pda', 'evm_8004_token')
    `;

  await db`
      CREATE INDEX IF NOT EXISTS idx_agent_identity_bindings_github_profile
      ON agent_identity_bindings(agent_id, binding_type)
      WHERE binding_type = 'github_profile'
    `;
}

async function deriveAgentProfilePda(walletPubkey: string): Promise<string> {
  const textEncoder = getUtf8Encoder();
  const addressEncoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: AGENTVOUCH_PROGRAM_ADDRESS,
    seeds: [
      textEncoder.encode("agent"),
      addressEncoder.encode(walletPubkey as Address),
    ],
  });

  return pda;
}

async function buildSyntheticLocalIdentity(params: {
  walletPubkey: string;
  chainContext?: string | null;
  hasAgentProfile?: boolean;
}): Promise<AgentIdentitySummary> {
  const chainContext = normalizePersistedChainContext(params.chainContext);
  const bindings: AgentIdentityBinding[] = [
    {
      id: `ephemeral-wallet-owner:${chainContext}:${params.walletPubkey}`,
      bindingType: BINDING_TYPES.walletOwner,
      chainContext,
      bindingRef: params.walletPubkey,
      registryAddress: null,
      externalAgentId: null,
      isPrimary: true,
      verificationStatus: "derived",
      rawUpstreamChainLabel: null,
      rawUpstreamChainId: null,
      metadata: null,
    },
  ];

  let agentProfilePda: string | null = null;
  if (params.hasAgentProfile) {
    agentProfilePda = await deriveAgentProfilePda(params.walletPubkey);
    bindings.push({
      id: `ephemeral-agent-profile:${chainContext}:${agentProfilePda}`,
      bindingType: BINDING_TYPES.agentProfilePda,
      chainContext,
      bindingRef: agentProfilePda,
      registryAddress: null,
      externalAgentId: null,
      isPrimary: false,
      verificationStatus: "derived",
      rawUpstreamChainLabel: null,
      rawUpstreamChainId: null,
      metadata: null,
    });
  }

  return {
    id: `ephemeral:${chainContext}:${params.walletPubkey}`,
    canonicalAgentId: buildLocalCanonicalAgentId(
      params.walletPubkey,
      chainContext
    ),
    identitySource: "local",
    homeChainContext: chainContext,
    status: "active",
    displayName: null,
    username: buildFallbackAgentUsername(params.walletPubkey),
    usernameSource: "fallback",
    githubProfile: null,
    bindings,
    ownerWallet: params.walletPubkey,
    operationalWallet: null,
    agentProfilePda,
    registryAsset: null,
  };
}

async function getAgentByWallet(
  walletPubkey: string,
  chainContext: string
): Promise<DbAgent | null> {
  const rows = await sql()`
    SELECT a.id, a.canonical_agent_id, a.identity_source, a.home_chain_context, a.status, a.display_name, a.username, a.username_source
    FROM agents a
    JOIN agent_identity_bindings b ON b.agent_id = a.id
    WHERE b.binding_type = ${BINDING_TYPES.walletOwner}
      AND b.binding_ref = ${walletPubkey}
      AND b.chain_context = ${chainContext}
    ORDER BY a.updated_at DESC
    LIMIT 1
  `;

  return (rows[0] as DbAgent | undefined) ?? null;
}

async function getAgentByCanonicalId(
  canonicalAgentId: string
): Promise<DbAgent | null> {
  const rows = await sql()`
    SELECT id, canonical_agent_id, identity_source, home_chain_context, status, display_name, username, username_source
    FROM agents
    WHERE canonical_agent_id = ${canonicalAgentId}
    LIMIT 1
  `;

  return (rows[0] as DbAgent | undefined) ?? null;
}

async function upsertBinding(
  agentId: string,
  binding: {
    bindingType: string;
    chainContext: string;
    bindingRef: string;
    registryAddress?: string | null;
    externalAgentId?: string | null;
    isPrimary?: boolean;
    verificationStatus?: string;
    rawUpstreamChainLabel?: string | null;
    rawUpstreamChainId?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  await sql()`
    INSERT INTO agent_identity_bindings (
      agent_id,
      binding_type,
      chain_context,
      binding_ref,
      registry_address,
      external_agent_id,
      is_primary,
      verification_status,
      raw_upstream_chain_label,
      raw_upstream_chain_id,
      metadata
    )
    VALUES (
      ${agentId}::uuid,
      ${binding.bindingType},
      ${binding.chainContext},
      ${binding.bindingRef},
      ${binding.registryAddress ?? null},
      ${binding.externalAgentId ?? null},
      ${binding.isPrimary ?? false},
      ${binding.verificationStatus ?? "verified"},
      ${binding.rawUpstreamChainLabel ?? null},
      ${binding.rawUpstreamChainId ?? null},
      ${binding.metadata ? JSON.stringify(binding.metadata) : null}::jsonb
    )
    ON CONFLICT (agent_id, binding_type, chain_context, binding_ref)
    DO UPDATE SET
      registry_address = COALESCE(EXCLUDED.registry_address, agent_identity_bindings.registry_address),
      external_agent_id = COALESCE(EXCLUDED.external_agent_id, agent_identity_bindings.external_agent_id),
      is_primary = EXCLUDED.is_primary,
      verification_status = EXCLUDED.verification_status,
      raw_upstream_chain_label = COALESCE(EXCLUDED.raw_upstream_chain_label, agent_identity_bindings.raw_upstream_chain_label),
      raw_upstream_chain_id = COALESCE(EXCLUDED.raw_upstream_chain_id, agent_identity_bindings.raw_upstream_chain_id),
      metadata = COALESCE(EXCLUDED.metadata, agent_identity_bindings.metadata)
  `;
}

async function loadAgentSummary(agent: DbAgent): Promise<AgentIdentitySummary> {
  const bindings = (await sql()`
    SELECT
      id,
      binding_type,
      chain_context,
      binding_ref,
      registry_address,
      external_agent_id,
      is_primary,
      verification_status,
      raw_upstream_chain_label,
      raw_upstream_chain_id,
      metadata
    FROM agent_identity_bindings
    WHERE agent_id = ${agent.id}::uuid
    ORDER BY is_primary DESC, created_at ASC
  `) as DbBinding[];

  const mappedBindings: AgentIdentityBinding[] = bindings.map((binding) => {
    const metadata = parseBindingMetadata(binding.metadata);
    return {
      id: binding.id,
      bindingType: binding.binding_type,
      chainContext: binding.chain_context,
      bindingRef: binding.binding_ref,
      registryAddress: binding.registry_address,
      externalAgentId: binding.external_agent_id,
      isPrimary: binding.is_primary,
      verificationStatus: binding.verification_status,
      rawUpstreamChainLabel: binding.raw_upstream_chain_label,
      rawUpstreamChainId: binding.raw_upstream_chain_id,
      metadata,
    };
  });

  const ownerWallet =
    mappedBindings.find(
      (binding) => binding.bindingType === BINDING_TYPES.walletOwner
    )?.bindingRef ?? null;
  const operationalWallet =
    mappedBindings.find(
      (binding) => binding.bindingType === BINDING_TYPES.walletOperational
    )?.bindingRef ?? null;
  const agentProfilePda =
    mappedBindings.find(
      (binding) => binding.bindingType === BINDING_TYPES.agentProfilePda
    )?.bindingRef ?? null;
  const registryAsset =
    mappedBindings.find(
      (binding) => binding.bindingType === BINDING_TYPES.solana8004Asset
    )?.bindingRef ?? null;
  const githubProfile =
    githubProfileFromMetadata(
      mappedBindings.find(
        (binding) => binding.bindingType === BINDING_TYPES.githubProfile
      )?.metadata ?? null
    ) ?? null;

  return {
    id: agent.id,
    canonicalAgentId: agent.canonical_agent_id,
    identitySource: agent.identity_source,
    homeChainContext: agent.home_chain_context,
    status: agent.status,
    displayName: agent.display_name,
    username: agent.username,
    usernameSource: agent.username_source ?? "fallback",
    githubProfile,
    bindings: mappedBindings,
    ownerWallet,
    operationalWallet,
    agentProfilePda,
    registryAsset,
  };
}

export async function upsertLocalAgentIdentity(params: {
  walletPubkey: string;
  chainContext?: string | null;
  displayName?: string | null;
  hasAgentProfile?: boolean;
}): Promise<AgentIdentitySummary> {
  if (!hasDatabaseConfigured()) {
    return buildSyntheticLocalIdentity(params);
  }

  await ensureAgentIdentitySchema();

  const chainContext = normalizePersistedChainContext(params.chainContext);
  const existingAgent = await getAgentByWallet(
    params.walletPubkey,
    chainContext
  );
  if (existingAgent) {
    const existingWithUsername = await ensureAgentUsername(
      existingAgent,
      params.walletPubkey
    );
    await sql()`
      UPDATE agents
      SET display_name = COALESCE(display_name, ${
        params.displayName?.trim() || null
      }),
          home_chain_context = COALESCE(home_chain_context, ${chainContext}),
          updated_at = NOW()
      WHERE id = ${existingAgent.id}::uuid
    `;

    await upsertBinding(existingAgent.id, {
      bindingType: BINDING_TYPES.walletOwner,
      chainContext,
      bindingRef: params.walletPubkey,
      isPrimary: true,
    });

    if (params.hasAgentProfile) {
      const agentProfilePda = await deriveAgentProfilePda(params.walletPubkey);
      await upsertBinding(existingAgent.id, {
        bindingType: BINDING_TYPES.agentProfilePda,
        chainContext,
        bindingRef: agentProfilePda,
      });
    }

    const refreshedAgent =
      (await getAgentByWallet(params.walletPubkey, chainContext)) ??
      existingWithUsername;
    return loadAgentSummary(refreshedAgent);
  }

  const canonicalAgentId = buildLocalCanonicalAgentId(
    params.walletPubkey,
    chainContext
  );
  const displayName = params.displayName?.trim() || null;

  const fallbackUsername = await ensureUniqueUsername(
    buildFallbackAgentUsername(params.walletPubkey)
  );

  const rows = await sql()`
    INSERT INTO agents (canonical_agent_id, display_name, username, username_source, home_chain_context, identity_source, status)
    VALUES (${canonicalAgentId}, ${displayName}, ${fallbackUsername}, 'fallback', ${chainContext}, 'local', 'active')
    ON CONFLICT (canonical_agent_id)
    DO UPDATE SET
      display_name = COALESCE(agents.display_name, EXCLUDED.display_name),
      username = COALESCE(agents.username, EXCLUDED.username),
      username_source = COALESCE(agents.username_source, EXCLUDED.username_source),
      home_chain_context = EXCLUDED.home_chain_context,
      updated_at = NOW()
    RETURNING id, canonical_agent_id, identity_source, home_chain_context, status, display_name, username, username_source
  `;

  const agent = rows[0] as DbAgent;

  await upsertBinding(agent.id, {
    bindingType: BINDING_TYPES.walletOwner,
    chainContext,
    bindingRef: params.walletPubkey,
    isPrimary: true,
  });

  if (params.hasAgentProfile) {
    const agentProfilePda = await deriveAgentProfilePda(params.walletPubkey);
    await upsertBinding(agent.id, {
      bindingType: BINDING_TYPES.agentProfilePda,
      chainContext,
      bindingRef: agentProfilePda,
    });
  }

  return loadAgentSummary(agent);
}

export async function resolveAgentIdentityByWallet(
  walletPubkey: string,
  options?: {
    chainContext?: string | null;
    createIfMissing?: boolean;
    hasAgentProfile?: boolean;
    persistDerived?: boolean;
  }
): Promise<AgentIdentitySummary | null> {
  if (!hasDatabaseConfigured()) {
    return buildSyntheticLocalIdentity({
      walletPubkey,
      chainContext: options?.chainContext,
      hasAgentProfile: options?.hasAgentProfile,
    });
  }

  await ensureAgentIdentitySchema();

  const chainContext = normalizePersistedChainContext(options?.chainContext);
  const persistDerived = options?.persistDerived !== false;
  let agent = await getAgentByWallet(walletPubkey, chainContext);

  if (!agent && persistDerived && options?.createIfMissing !== false) {
    return upsertLocalAgentIdentity({
      walletPubkey,
      chainContext,
      hasAgentProfile: options?.hasAgentProfile,
    });
  }

  if (!agent) {
    return null;
  }

  if (persistDerived) {
    agent = await ensureAgentUsername(agent, walletPubkey);

    if (options?.hasAgentProfile) {
      const agentProfilePda = await deriveAgentProfilePda(walletPubkey);
      await upsertBinding(agent.id, {
        bindingType: BINDING_TYPES.agentProfilePda,
        chainContext,
        bindingRef: agentProfilePda,
      });
    }

    agent = (await getAgentByWallet(walletPubkey, chainContext)) ?? agent;
  }

  return loadAgentSummary(agent);
}

export async function resolveManyAgentIdentitiesByWallet(
  walletPubkeys: string[],
  options?: {
    chainContext?: string | null;
    hasAgentProfileByWallet?: Map<string, boolean>;
    persistDerived?: boolean;
  }
): Promise<Map<string, AgentIdentitySummary>> {
  const uniqueWallets = [...new Set(walletPubkeys.filter(Boolean))];
  const entries = await Promise.all(
    uniqueWallets.map(async (walletPubkey) => {
      const identity = await resolveAgentIdentityByWallet(walletPubkey, {
        chainContext: options?.chainContext,
        createIfMissing: options?.persistDerived === false ? false : true,
        hasAgentProfile:
          options?.hasAgentProfileByWallet?.get(walletPubkey) ?? false,
        persistDerived: options?.persistDerived,
      });
      return [walletPubkey, identity] as const;
    })
  );

  const map = new Map<string, AgentIdentitySummary>();
  for (const [walletPubkey, identity] of entries) {
    if (identity) {
      map.set(walletPubkey, identity);
    }
  }
  return map;
}

export async function linkSolanaRegistryIdentity(params: {
  ownerWalletPubkey: string;
  registryAddress: string;
  coreAssetPubkey: string;
  operationalWalletPubkey?: string | null;
  displayName?: string | null;
  chainContext?: string | null;
  rawUpstreamChainLabel?: string | null;
  rawUpstreamChainId?: string | null;
  externalAgentId?: string | null;
  hasAgentProfile?: boolean;
}): Promise<AgentIdentitySummary> {
  if (!hasDatabaseConfigured()) {
    throw new Error(
      "DATABASE_URL environment variable is required to persist registry identity links."
    );
  }

  await ensureAgentIdentitySchema();

  const normalizedChainContext =
    normalizeInputChainContext(
      params.chainContext ?? getConfiguredSolanaChainContext()
    ) ?? getConfiguredSolanaChainContext();

  const currentAgent =
    (await resolveAgentIdentityByWallet(params.ownerWalletPubkey, {
      chainContext: normalizedChainContext,
      createIfMissing: true,
      hasAgentProfile: params.hasAgentProfile,
    })) ??
    (await upsertLocalAgentIdentity({
      walletPubkey: params.ownerWalletPubkey,
      chainContext: normalizedChainContext,
      hasAgentProfile: params.hasAgentProfile,
    }));

  const canonicalAgentId = buildRegistryCanonicalAgentId(
    params.registryAddress,
    params.coreAssetPubkey,
    normalizedChainContext
  );

  const existingAgent = await getAgentByCanonicalId(canonicalAgentId);
  if (existingAgent && existingAgent.id !== currentAgent.id) {
    throw new Error(
      "This registry identity is already linked to another agent."
    );
  }

  const rows = await sql()`
    UPDATE agents
    SET canonical_agent_id = ${canonicalAgentId},
        identity_source = 'erc8004',
        home_chain_context = ${normalizedChainContext},
        display_name = COALESCE(${
          params.displayName?.trim() || null
        }, display_name),
        updated_at = NOW()
    WHERE id = ${currentAgent.id}::uuid
    RETURNING id, canonical_agent_id, identity_source, home_chain_context, status, display_name, username, username_source
  `;

  const agent = rows[0] as DbAgent;

  await upsertBinding(agent.id, {
    bindingType: BINDING_TYPES.walletOwner,
    chainContext: normalizedChainContext,
    bindingRef: params.ownerWalletPubkey,
    isPrimary: true,
    rawUpstreamChainLabel: params.rawUpstreamChainLabel,
    rawUpstreamChainId: params.rawUpstreamChainId,
  });

  await upsertBinding(agent.id, {
    bindingType: BINDING_TYPES.solana8004Asset,
    chainContext: normalizedChainContext,
    bindingRef: params.coreAssetPubkey,
    registryAddress: params.registryAddress,
    externalAgentId: params.externalAgentId,
    rawUpstreamChainLabel: params.rawUpstreamChainLabel,
    rawUpstreamChainId: params.rawUpstreamChainId,
  });

  if (params.operationalWalletPubkey) {
    await upsertBinding(agent.id, {
      bindingType: BINDING_TYPES.walletOperational,
      chainContext: normalizedChainContext,
      bindingRef: params.operationalWalletPubkey,
      registryAddress: params.registryAddress,
      rawUpstreamChainLabel: params.rawUpstreamChainLabel,
      rawUpstreamChainId: params.rawUpstreamChainId,
    });
  }

  if (params.hasAgentProfile) {
    const agentProfilePda = await deriveAgentProfilePda(
      params.ownerWalletPubkey
    );
    await upsertBinding(agent.id, {
      bindingType: BINDING_TYPES.agentProfilePda,
      chainContext: normalizedChainContext,
      bindingRef: agentProfilePda,
    });
  }

  return loadAgentSummary(agent);
}

export async function updateAgentUsername(params: {
  walletPubkey: string;
  username: string;
  chainContext?: string | null;
  hasAgentProfile?: boolean;
}): Promise<AgentIdentitySummary> {
  if (!hasDatabaseConfigured()) {
    throw new Error(
      "DATABASE_URL environment variable is required to persist usernames."
    );
  }

  await ensureAgentIdentitySchema();

  const chainContext = normalizePersistedChainContext(params.chainContext);
  const currentAgent =
    (await resolveAgentIdentityByWallet(params.walletPubkey, {
      chainContext,
      createIfMissing: true,
      hasAgentProfile: params.hasAgentProfile,
    })) ??
    (await upsertLocalAgentIdentity({
      walletPubkey: params.walletPubkey,
      chainContext,
      hasAgentProfile: params.hasAgentProfile,
    }));
  const username = await ensureUniqueUsername(params.username, currentAgent.id);

  const rows = await sql()<DbAgent>`
    UPDATE agents
    SET username = ${username},
        username_source = 'user',
        updated_at = NOW()
    WHERE id = ${currentAgent.id}::uuid
    RETURNING id, canonical_agent_id, identity_source, home_chain_context, status, display_name, username, username_source
  `;

  return loadAgentSummary(rows[0]);
}

export async function linkGithubProfileToAgent(params: {
  walletPubkey: string;
  githubSession: GithubSession;
  chainContext?: string | null;
  hasAgentProfile?: boolean;
}): Promise<AgentIdentitySummary> {
  if (!hasDatabaseConfigured()) {
    throw new Error(
      "DATABASE_URL environment variable is required to persist GitHub links."
    );
  }

  await ensureAgentIdentitySchema();

  const chainContext = normalizePersistedChainContext(params.chainContext);
  const currentAgent =
    (await resolveAgentIdentityByWallet(params.walletPubkey, {
      chainContext,
      createIfMissing: true,
      hasAgentProfile: params.hasAgentProfile,
    })) ??
    (await upsertLocalAgentIdentity({
      walletPubkey: params.walletPubkey,
      chainContext,
      hasAgentProfile: params.hasAgentProfile,
    }));

  await upsertBinding(currentAgent.id, {
    bindingType: BINDING_TYPES.githubProfile,
    chainContext: GITHUB_BINDING_CONTEXT,
    bindingRef: `github:${params.githubSession.id}`,
    externalAgentId: params.githubSession.id,
    verificationStatus: "verified",
    metadata: {
      id: params.githubSession.id,
      login: params.githubSession.login,
      name: params.githubSession.name,
      avatarUrl: params.githubSession.avatarUrl,
      url: `https://github.com/${params.githubSession.login}`,
    },
  });

  const refreshedAgent = (await getAgentByWallet(
    params.walletPubkey,
    chainContext
  )) ?? {
    id: currentAgent.id,
    canonical_agent_id: currentAgent.canonicalAgentId,
    identity_source: currentAgent.identitySource,
    home_chain_context: currentAgent.homeChainContext,
    status: currentAgent.status,
    display_name: currentAgent.displayName,
    username: currentAgent.username,
    username_source: currentAgent.usernameSource,
  };
  return loadAgentSummary(refreshedAgent);
}

export async function listGithubLinkedWallets(
  githubSession: GithubSession
): Promise<GithubLinkedWallet[]> {
  if (!hasDatabaseConfigured()) {
    return [];
  }

  await ensureAgentIdentitySchema();

  const rows = await sql()<DbGithubLinkedWallet>`
    SELECT
      a.id AS agent_id,
      a.canonical_agent_id,
      a.username,
      a.display_name,
      wallet_binding.binding_ref AS wallet_pubkey,
      wallet_binding.chain_context,
      github_binding.created_at AS linked_at
    FROM agent_identity_bindings github_binding
    JOIN agents a ON a.id = github_binding.agent_id
    JOIN agent_identity_bindings wallet_binding
      ON wallet_binding.agent_id = a.id
      AND wallet_binding.binding_type = ${BINDING_TYPES.walletOwner}
      AND wallet_binding.is_primary = true
    WHERE github_binding.binding_type = ${BINDING_TYPES.githubProfile}
      AND github_binding.chain_context = ${GITHUB_BINDING_CONTEXT}
      AND github_binding.binding_ref = ${`github:${githubSession.id}`}
    ORDER BY github_binding.created_at DESC, a.created_at DESC
  `;

  return rows.map((row) => ({
    agentId: row.agent_id,
    canonicalAgentId: row.canonical_agent_id,
    username: row.username,
    displayName: row.display_name,
    walletPubkey: row.wallet_pubkey,
    chainContext: row.chain_context,
    linkedAt:
      row.linked_at instanceof Date
        ? row.linked_at.toISOString()
        : row.linked_at,
  }));
}
