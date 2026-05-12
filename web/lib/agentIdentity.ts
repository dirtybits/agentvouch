import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
} from "@solana/kit";
import { sql } from "@/lib/db";
import {
  getConfiguredSolanaChainContext,
  normalizeInputChainContext,
  normalizePersistedChainContext,
} from "@/lib/chains";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "../generated/agentvouch/src/generated/programs";

export type AgentIdentitySource = "local" | "erc8004" | "imported";

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
}

export interface AgentIdentitySummary {
  id: string;
  canonicalAgentId: string;
  identitySource: AgentIdentitySource;
  homeChainContext: string | null;
  status: string;
  displayName: string | null;
  bindings: AgentIdentityBinding[];
  ownerWallet: string | null;
  operationalWallet: string | null;
  agentProfilePda: string | null;
  registryAsset: string | null;
}

const BINDING_TYPES = {
  walletOwner: "wallet_owner",
  walletOperational: "wallet_operational",
  agentProfilePda: "agent_profile_pda",
  solana8004Asset: "solana_8004_asset",
  evm8004Token: "evm_8004_token",
} as const;

const LOCAL_IDENTITY_REGISTRY = "agentvouch-local";

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

export async function ensureAgentIdentitySchema(): Promise<void> {
  if (!hasDatabaseConfigured()) {
    return;
  }

  if (schemaReady) {
    return schemaReady;
  }

  schemaReady = (async () => {
    const db = sql();

    await db`
      CREATE TABLE IF NOT EXISTS agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        canonical_agent_id TEXT NOT NULL UNIQUE,
        display_name VARCHAR(128),
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
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(agent_id, binding_type, chain_context, binding_ref)
      )
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
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
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
    SELECT a.id, a.canonical_agent_id, a.identity_source, a.home_chain_context, a.status, a.display_name
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
    SELECT id, canonical_agent_id, identity_source, home_chain_context, status, display_name
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
      raw_upstream_chain_id
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
      ${binding.rawUpstreamChainId ?? null}
    )
    ON CONFLICT (agent_id, binding_type, chain_context, binding_ref)
    DO UPDATE SET
      registry_address = COALESCE(EXCLUDED.registry_address, agent_identity_bindings.registry_address),
      external_agent_id = COALESCE(EXCLUDED.external_agent_id, agent_identity_bindings.external_agent_id),
      is_primary = EXCLUDED.is_primary,
      verification_status = EXCLUDED.verification_status,
      raw_upstream_chain_label = COALESCE(EXCLUDED.raw_upstream_chain_label, agent_identity_bindings.raw_upstream_chain_label),
      raw_upstream_chain_id = COALESCE(EXCLUDED.raw_upstream_chain_id, agent_identity_bindings.raw_upstream_chain_id)
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
      raw_upstream_chain_id
    FROM agent_identity_bindings
    WHERE agent_id = ${agent.id}::uuid
    ORDER BY is_primary DESC, created_at ASC
  `) as DbBinding[];

  const mappedBindings: AgentIdentityBinding[] = bindings.map((binding) => ({
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
  }));

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

  return {
    id: agent.id,
    canonicalAgentId: agent.canonical_agent_id,
    identitySource: agent.identity_source,
    homeChainContext: agent.home_chain_context,
    status: agent.status,
    displayName: agent.display_name,
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

    return loadAgentSummary(existingAgent);
  }

  const canonicalAgentId = buildLocalCanonicalAgentId(
    params.walletPubkey,
    chainContext
  );
  const displayName = params.displayName?.trim() || null;

  const rows = await sql()`
    INSERT INTO agents (canonical_agent_id, display_name, home_chain_context, identity_source, status)
    VALUES (${canonicalAgentId}, ${displayName}, ${chainContext}, 'local', 'active')
    ON CONFLICT (canonical_agent_id)
    DO UPDATE SET
      display_name = COALESCE(agents.display_name, EXCLUDED.display_name),
      home_chain_context = EXCLUDED.home_chain_context,
      updated_at = NOW()
    RETURNING id, canonical_agent_id, identity_source, home_chain_context, status, display_name
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
  let agent = await getAgentByWallet(walletPubkey, chainContext);

  if (!agent && options?.createIfMissing !== false) {
    return upsertLocalAgentIdentity({
      walletPubkey,
      chainContext,
      hasAgentProfile: options?.hasAgentProfile,
    });
  }

  if (!agent) {
    return null;
  }

  if (options?.hasAgentProfile) {
    const agentProfilePda = await deriveAgentProfilePda(walletPubkey);
    await upsertBinding(agent.id, {
      bindingType: BINDING_TYPES.agentProfilePda,
      chainContext,
      bindingRef: agentProfilePda,
    });
  }

  agent = (await getAgentByWallet(walletPubkey, chainContext)) ?? agent;
  return loadAgentSummary(agent);
}

export async function resolveManyAgentIdentitiesByWallet(
  walletPubkeys: string[],
  options?: {
    chainContext?: string | null;
    hasAgentProfileByWallet?: Map<string, boolean>;
  }
): Promise<Map<string, AgentIdentitySummary>> {
  const uniqueWallets = [...new Set(walletPubkeys.filter(Boolean))];
  const entries = await Promise.all(
    uniqueWallets.map(async (walletPubkey) => {
      const identity = await resolveAgentIdentityByWallet(walletPubkey, {
        chainContext: options?.chainContext,
        createIfMissing: true,
        hasAgentProfile:
          options?.hasAgentProfileByWallet?.get(walletPubkey) ?? false,
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
    RETURNING id, canonical_agent_id, identity_source, home_chain_context, status, display_name
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
