import { existsSync, readFileSync, writeFileSync } from "fs";
import { neon } from "@neondatabase/serverless";
import { bootstrapDatabase } from "../lib/databaseBootstrap";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchProgramId,
} from "../lib/protocolMetadata";
import { getConfiguredSolanaChainContext } from "../lib/chains";
import { getConfiguredUsdcMint } from "../lib/x402";

type Db = ReturnType<typeof neon<false, false>>;

type SkillExportRow = {
  id: string;
  skill_id: string;
  author_pubkey: string;
  name: string;
  description: string | null;
  tags: string[] | null;
  current_version: number | null;
  ipfs_cid: string | null;
  on_chain_address: string | null;
  chain_context: string | null;
  total_installs: number | null;
  contact: string | null;
  price_usdc_micros: string | null;
  currency_mint: string | null;
  on_chain_protocol_version: string | null;
  on_chain_program_id: string | null;
  created_at: string;
  updated_at: string;
};

type SkillVersionExportRow = {
  id: string;
  skill_id: string;
  version: number;
  content: string;
  ipfs_cid: string | null;
  changelog: string | null;
  created_at: string;
};

type AgentExportRow = {
  id: string;
  canonical_agent_id: string;
  display_name: string | null;
  home_chain_context: string | null;
  identity_source: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type AgentBindingExportRow = {
  id: string;
  agent_id: string;
  binding_type: string;
  chain_context: string;
  binding_ref: string;
  registry_address: string | null;
  external_agent_id: string | null;
  is_primary: boolean;
  verification_status: string;
  raw_upstream_chain_label: string | null;
  raw_upstream_chain_id: string | null;
  created_at: string;
};

type ApiKeyExportRow = {
  id: string;
  owner_pubkey: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  permissions: string[] | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type CutoverExport = {
  exportedAt: string;
  source: {
    chainContext: string;
    programId: string;
    protocolVersion: string;
  };
  policy: {
    includeAgents: boolean;
    includeApiKeys: boolean;
    includeReceipts: false;
  };
  skills: SkillExportRow[];
  skillVersions: SkillVersionExportRow[];
  agents: AgentExportRow[];
  agentIdentityBindings: AgentBindingExportRow[];
  apiKeys: ApiKeyExportRow[];
};

const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);

function getArg(name: string) {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function getArgs(name: string) {
  const values: string[] = [];
  const prefix = `--${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(prefix)) {
      values.push(arg.slice(prefix.length));
      continue;
    }
    if (arg === `--${name}` && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values.flatMap((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

function hasFlag(name: string) {
  return args.includes(`--${name}`);
}

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getDbFromEnv(name: string) {
  return neon(getRequiredEnv(name));
}

async function tableExists(db: Db, tableName: string) {
  const rows = (await db`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    ) AS exists
  `) as { exists: boolean }[];
  return rows[0]?.exists ?? false;
}

async function countRows(db: Db, tableName: string) {
  if (!(await tableExists(db, tableName))) {
    return { exists: false, count: 0 };
  }

  let rows: { count: string }[];
  switch (tableName) {
    case "skills":
      rows = (await db`SELECT COUNT(*)::text AS count FROM skills`) as {
        count: string;
      }[];
      break;
    case "skill_versions":
      rows = (await db`SELECT COUNT(*)::text AS count FROM skill_versions`) as {
        count: string;
      }[];
      break;
    case "agents":
      rows = (await db`SELECT COUNT(*)::text AS count FROM agents`) as {
        count: string;
      }[];
      break;
    case "agent_identity_bindings":
      rows = (await db`SELECT COUNT(*)::text AS count FROM agent_identity_bindings`) as {
        count: string;
      }[];
      break;
    case "api_keys":
      rows = (await db`SELECT COUNT(*)::text AS count FROM api_keys`) as {
        count: string;
      }[];
      break;
    case "usdc_purchase_receipts":
      rows = (await db`SELECT COUNT(*)::text AS count FROM usdc_purchase_receipts`) as {
        count: string;
      }[];
      break;
    case "usdc_purchase_entitlements":
      rows = (await db`SELECT COUNT(*)::text AS count FROM usdc_purchase_entitlements`) as {
        count: string;
      }[];
      break;
    default:
      throw new Error(`Unsupported inventory table: ${tableName}`);
  }
  return { exists: true, count: Number(rows[0]?.count ?? 0) };
}

async function inventory() {
  const db = getDbFromEnv("DATABASE_URL");
  const tables = [
    "skills",
    "skill_versions",
    "agents",
    "agent_identity_bindings",
    "api_keys",
    "usdc_purchase_receipts",
    "usdc_purchase_entitlements",
  ];
  const counts = Object.fromEntries(
    await Promise.all(
      tables.map(async (tableName) => [tableName, await countRows(db, tableName)])
    )
  );

  const skillRows = (await tableExists(db, "skills"))
    ? ((await db`
        SELECT
          id::text,
          skill_id,
          author_pubkey,
          on_chain_address,
          chain_context,
          price_usdc_micros::text,
          currency_mint,
          on_chain_protocol_version,
          on_chain_program_id
        FROM skills
        ORDER BY updated_at DESC
        LIMIT 50
      `) as {
        id: string;
        skill_id: string;
        author_pubkey: string;
        on_chain_address: string | null;
        chain_context: string | null;
        price_usdc_micros: string | null;
        currency_mint: string | null;
        on_chain_protocol_version: string | null;
        on_chain_program_id: string | null;
      }[])
    : [];

  const report = {
    generatedAt: new Date().toISOString(),
    counts,
    defaultClassification: {
      migrate: ["selected skills", "selected skill_versions"],
      optional: ["agents", "agent_identity_bindings", "api_keys"],
      archiveOnly: ["usdc_purchase_receipts", "usdc_purchase_entitlements"],
      dropByDefault: ["legacy devnet purchase and entitlement state"],
    },
    sampledSkills: skillRows,
  };

  const out = getArg("out");
  if (out) {
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote inventory report to ${out}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

async function bootstrap() {
  const targetUrl = process.env.TARGET_DATABASE_URL;
  if (targetUrl) {
    process.env.DATABASE_URL = targetUrl;
  }
  await bootstrapDatabase();
  console.log("Database bootstrap complete.");
}

function normalizeSkill(row: SkillExportRow): SkillExportRow {
  const hasProtocolListing = Boolean(row.on_chain_address && row.price_usdc_micros);
  return {
    ...row,
    chain_context: row.chain_context ?? getConfiguredSolanaChainContext(),
    currency_mint: row.price_usdc_micros
      ? row.currency_mint ?? getConfiguredUsdcMint()
      : row.currency_mint,
    on_chain_protocol_version: hasProtocolListing
      ? row.on_chain_protocol_version ?? AGENTVOUCH_PROTOCOL_VERSION
      : row.on_chain_protocol_version,
    on_chain_program_id: hasProtocolListing
      ? row.on_chain_program_id ?? getAgentVouchProgramId()
      : row.on_chain_program_id,
  };
}

async function exportData() {
  const db = getDbFromEnv("DATABASE_URL");
  const includeAgents = hasFlag("include-agents");
  const includeApiKeys = hasFlag("include-api-keys");
  const skillIdFilter = new Set(getArgs("skill-id"));
  const authorFilter = new Set(getArgs("author"));
  const out = getArg("out") ?? "db-cutover-export.json";

  const allSkills = (await tableExists(db, "skills"))
    ? ((await db`
        SELECT
          id::text,
          skill_id,
          author_pubkey,
          name,
          description,
          tags,
          current_version,
          ipfs_cid,
          on_chain_address,
          chain_context,
          total_installs,
          contact,
          price_usdc_micros::text,
          currency_mint,
          on_chain_protocol_version,
          on_chain_program_id,
          created_at::text,
          updated_at::text
        FROM skills
        ORDER BY created_at ASC
      `) as SkillExportRow[])
    : [];
  const skills = allSkills.filter((skill) => {
    const matchesSkill =
      skillIdFilter.size === 0 || skillIdFilter.has(skill.skill_id);
    const matchesAuthor =
      authorFilter.size === 0 || authorFilter.has(skill.author_pubkey);
    return matchesSkill && matchesAuthor;
  });

  const skillIds = skills.map((skill) => skill.id);
  const skillVersions =
    skillIds.length > 0 && (await tableExists(db, "skill_versions"))
      ? ((await db`
        SELECT
          id::text,
          skill_id::text,
          version,
          content,
          ipfs_cid,
          changelog,
          created_at::text
        FROM skill_versions
        WHERE skill_id = ANY(${skillIds}::uuid[])
        ORDER BY skill_id ASC, version ASC
      `) as SkillVersionExportRow[])
      : [];

  const agents =
    includeAgents && (await tableExists(db, "agents"))
      ? ((await db`
          SELECT
            id::text,
            canonical_agent_id,
            display_name,
            home_chain_context,
            identity_source,
            status,
            created_at::text,
            updated_at::text
          FROM agents
          ORDER BY created_at ASC
        `) as AgentExportRow[])
      : [];

  const agentIds = agents.map((agent) => agent.id);
  const agentIdentityBindings =
    includeAgents &&
    agentIds.length > 0 &&
    (await tableExists(db, "agent_identity_bindings"))
      ? ((await db`
          SELECT
            id::text,
            agent_id::text,
            binding_type,
            chain_context,
            binding_ref,
            registry_address,
            external_agent_id,
            is_primary,
            verification_status,
            raw_upstream_chain_label,
            raw_upstream_chain_id,
            created_at::text
          FROM agent_identity_bindings
          WHERE agent_id = ANY(${agentIds}::uuid[])
          ORDER BY created_at ASC
        `) as AgentBindingExportRow[])
      : [];

  const apiKeys =
    includeApiKeys && (await tableExists(db, "api_keys"))
      ? ((await db`
          SELECT
            id::text,
            owner_pubkey,
            key_hash,
            key_prefix,
            name,
            permissions,
            created_at::text,
            last_used_at::text,
            revoked_at::text
          FROM api_keys
          ORDER BY created_at ASC
        `) as ApiKeyExportRow[])
      : [];

  const payload: CutoverExport = {
    exportedAt: new Date().toISOString(),
    source: {
      chainContext: getConfiguredSolanaChainContext(),
      programId: getAgentVouchProgramId(),
      protocolVersion: AGENTVOUCH_PROTOCOL_VERSION,
    },
    policy: {
      includeAgents,
      includeApiKeys,
      includeReceipts: false,
    },
    skills: skills.map(normalizeSkill),
    skillVersions,
    agents,
    agentIdentityBindings,
    apiKeys,
  };

  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `Exported ${payload.skills.length} skills, ${payload.skillVersions.length} versions, ${payload.agents.length} agents, ${payload.agentIdentityBindings.length} bindings, ${payload.apiKeys.length} API keys to ${out}.`
  );
}

async function clearPurchaseState(db: Db) {
  if (await tableExists(db, "usdc_purchase_entitlements")) {
    await db`DELETE FROM usdc_purchase_entitlements`;
  }
  if (await tableExists(db, "usdc_purchase_receipts")) {
    await db`DELETE FROM usdc_purchase_receipts`;
  }
}

async function importData() {
  const file = getArg("file") ?? "db-cutover-export.json";
  if (!existsSync(file)) {
    throw new Error(`Export file not found: ${file}`);
  }
  const targetUrl = process.env.TARGET_DATABASE_URL;
  if (!targetUrl) {
    throw new Error("TARGET_DATABASE_URL is required for import");
  }
  process.env.DATABASE_URL = targetUrl;
  await bootstrapDatabase();
  const db = neon(targetUrl);
  const payload = JSON.parse(readFileSync(file, "utf8")) as CutoverExport;

  await clearPurchaseState(db);

  for (const skill of payload.skills) {
    const normalized = normalizeSkill(skill);
    await db`
      INSERT INTO skills (
        id,
        skill_id,
        author_pubkey,
        name,
        description,
        tags,
        current_version,
        ipfs_cid,
        on_chain_address,
        chain_context,
        total_installs,
        contact,
        price_usdc_micros,
        currency_mint,
        on_chain_protocol_version,
        on_chain_program_id,
        created_at,
        updated_at
      )
      VALUES (
        ${normalized.id}::uuid,
        ${normalized.skill_id},
        ${normalized.author_pubkey},
        ${normalized.name},
        ${normalized.description},
        ${normalized.tags ?? []}::text[],
        ${normalized.current_version ?? 1},
        ${normalized.ipfs_cid},
        ${normalized.on_chain_address},
        ${normalized.chain_context},
        ${normalized.total_installs ?? 0},
        ${normalized.contact},
        ${normalized.price_usdc_micros},
        ${normalized.currency_mint},
        ${normalized.on_chain_protocol_version},
        ${normalized.on_chain_program_id},
        ${normalized.created_at}::timestamptz,
        ${normalized.updated_at}::timestamptz
      )
      ON CONFLICT (id)
      DO UPDATE SET
        skill_id = EXCLUDED.skill_id,
        author_pubkey = EXCLUDED.author_pubkey,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        tags = EXCLUDED.tags,
        current_version = EXCLUDED.current_version,
        ipfs_cid = EXCLUDED.ipfs_cid,
        on_chain_address = EXCLUDED.on_chain_address,
        chain_context = EXCLUDED.chain_context,
        total_installs = EXCLUDED.total_installs,
        contact = EXCLUDED.contact,
        price_usdc_micros = EXCLUDED.price_usdc_micros,
        currency_mint = EXCLUDED.currency_mint,
        on_chain_protocol_version = EXCLUDED.on_chain_protocol_version,
        on_chain_program_id = EXCLUDED.on_chain_program_id,
        updated_at = EXCLUDED.updated_at
    `;
  }

  for (const version of payload.skillVersions) {
    await db`
      INSERT INTO skill_versions (
        id,
        skill_id,
        version,
        content,
        ipfs_cid,
        changelog,
        created_at
      )
      VALUES (
        ${version.id}::uuid,
        ${version.skill_id}::uuid,
        ${version.version},
        ${version.content},
        ${version.ipfs_cid},
        ${version.changelog},
        ${version.created_at}::timestamptz
      )
      ON CONFLICT (skill_id, version)
      DO UPDATE SET
        content = EXCLUDED.content,
        ipfs_cid = EXCLUDED.ipfs_cid,
        changelog = EXCLUDED.changelog
    `;
  }

  for (const agent of payload.agents) {
    await db`
      INSERT INTO agents (
        id,
        canonical_agent_id,
        display_name,
        home_chain_context,
        identity_source,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${agent.id}::uuid,
        ${agent.canonical_agent_id},
        ${agent.display_name},
        ${agent.home_chain_context},
        ${agent.identity_source},
        ${agent.status},
        ${agent.created_at}::timestamptz,
        ${agent.updated_at}::timestamptz
      )
      ON CONFLICT (canonical_agent_id)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        home_chain_context = EXCLUDED.home_chain_context,
        identity_source = EXCLUDED.identity_source,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
    `;
  }

  for (const binding of payload.agentIdentityBindings) {
    await db`
      INSERT INTO agent_identity_bindings (
        id,
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
        created_at
      )
      VALUES (
        ${binding.id}::uuid,
        ${binding.agent_id}::uuid,
        ${binding.binding_type},
        ${binding.chain_context},
        ${binding.binding_ref},
        ${binding.registry_address},
        ${binding.external_agent_id},
        ${binding.is_primary},
        ${binding.verification_status},
        ${binding.raw_upstream_chain_label},
        ${binding.raw_upstream_chain_id},
        ${binding.created_at}::timestamptz
      )
      ON CONFLICT (agent_id, binding_type, chain_context, binding_ref)
      DO UPDATE SET
        registry_address = EXCLUDED.registry_address,
        external_agent_id = EXCLUDED.external_agent_id,
        is_primary = EXCLUDED.is_primary,
        verification_status = EXCLUDED.verification_status,
        raw_upstream_chain_label = EXCLUDED.raw_upstream_chain_label,
        raw_upstream_chain_id = EXCLUDED.raw_upstream_chain_id
    `;
  }

  for (const apiKey of payload.apiKeys) {
    await db`
      INSERT INTO api_keys (
        id,
        owner_pubkey,
        key_hash,
        key_prefix,
        name,
        permissions,
        created_at,
        last_used_at,
        revoked_at
      )
      VALUES (
        ${apiKey.id}::uuid,
        ${apiKey.owner_pubkey},
        ${apiKey.key_hash},
        ${apiKey.key_prefix},
        ${apiKey.name},
        ${apiKey.permissions ?? []}::text[],
        ${apiKey.created_at}::timestamptz,
        ${apiKey.last_used_at}::timestamptz,
        ${apiKey.revoked_at}::timestamptz
      )
      ON CONFLICT (id)
      DO UPDATE SET
        owner_pubkey = EXCLUDED.owner_pubkey,
        key_hash = EXCLUDED.key_hash,
        key_prefix = EXCLUDED.key_prefix,
        name = EXCLUDED.name,
        permissions = EXCLUDED.permissions,
        last_used_at = EXCLUDED.last_used_at,
        revoked_at = EXCLUDED.revoked_at
    `;
  }

  console.log(
    `Imported ${payload.skills.length} skills and ${payload.skillVersions.length} versions. Receipts and entitlements were intentionally not imported.`
  );
}

async function sanity() {
  const db = getDbFromEnv("DATABASE_URL");
  const [skills, versions, receipts, entitlements] = await Promise.all([
    countRows(db, "skills"),
    countRows(db, "skill_versions"),
    countRows(db, "usdc_purchase_receipts"),
    countRows(db, "usdc_purchase_entitlements"),
  ]);

  const protocolRows = (await tableExists(db, "skills"))
    ? ((await db`
        SELECT COUNT(*)::text AS missing_metadata
        FROM skills
        WHERE on_chain_address IS NOT NULL
          AND price_usdc_micros IS NOT NULL
          AND (
            chain_context IS NULL
            OR on_chain_protocol_version IS NULL
            OR on_chain_program_id IS NULL
            OR currency_mint IS NULL
          )
      `) as { missing_metadata: string }[])
    : [{ missing_metadata: "0" }];

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        counts: { skills, versions, receipts, entitlements },
        protocolListedSkillsMissingMetadata: Number(
          protocolRows[0]?.missing_metadata ?? 0
        ),
      },
      null,
      2
    )
  );

  if (
    hasFlag("expect-clean-purchases") &&
    (receipts.count !== 0 || entitlements.count !== 0)
  ) {
    throw new Error(
      `Expected zero purchase rows, found receipts=${receipts.count} entitlements=${entitlements.count}`
    );
  }
}

function printHelp() {
  console.log(`AgentVouch DB cutover helper

Commands:
  inventory [--out file]                  Read-only count/sample report for current DATABASE_URL
  bootstrap                               Bootstrap schema for DATABASE_URL or TARGET_DATABASE_URL
  export --out file [--skill-id slug] [--author pubkey] [--include-agents] [--include-api-keys]
                                           Export durable rows; receipts/entitlements are excluded
  import --file file                      Import export file into TARGET_DATABASE_URL
  sanity                                  Read-only sanity checks against DATABASE_URL

Examples:
  DATABASE_URL="$OLD_DB" npm run db:cutover --workspace @agentvouch/web -- inventory --out db-inventory.json
  TARGET_DATABASE_URL="$NEW_DB" npm run db:cutover --workspace @agentvouch/web -- bootstrap
  DATABASE_URL="$OLD_DB" npm run db:cutover --workspace @agentvouch/web -- export --out db-cutover-export.json --skill-id frontenddesign --include-agents
  TARGET_DATABASE_URL="$NEW_DB" npm run db:cutover --workspace @agentvouch/web -- import --file db-cutover-export.json
  DATABASE_URL="$NEW_DB" npm run db:cutover --workspace @agentvouch/web -- sanity
  DATABASE_URL="$NEW_DB" npm run db:cutover --workspace @agentvouch/web -- sanity --expect-clean-purchases
`);
}

async function main() {
  if (command === "inventory") return inventory();
  if (command === "bootstrap") return bootstrap();
  if (command === "export") return exportData();
  if (command === "import") return importData();
  if (command === "sanity") return sanity();
  printHelp();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
