import { NextResponse } from "next/server";
import { createSolanaRpc } from "@solana/kit";
import type { Base64EncodedBytes } from "@solana/rpc-types";
import {
  getAgentProfileDecoder,
  AGENT_PROFILE_DISCRIMINATOR,
} from "../../../generated/agentvouch/src/generated";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "../../../generated/agentvouch/src/generated/programs";
import { resolveManyAgentIdentitiesByWallet } from "@/lib/agentIdentity";
import {
  buildPublicCacheControl,
  IN_MEMORY_CACHE_TTL_MS,
  PUBLIC_ROUTE_CACHE_SECONDS,
  PUBLIC_ROUTE_STALE_SECONDS,
} from "@/lib/cachePolicy";
import { initializeDatabase, sql } from "@/lib/db";
import { getErrorMessage } from "@/lib/errors";
import { listOnChainSkillListings } from "@/lib/onchain";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";

const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
const asBase64 = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64") as Base64EncodedBytes;
const LANDING_CACHE_KEY = "landing";

type LandingPayload = {
  metrics: {
    agents: number;
    authors: number;
    skills: number;
    revenue: number;
    staked: number;
    onChainDownloads: number;
    downloads: number;
  };
};

const landingCache = new Map<
  string,
  { value: LandingPayload; expiresAt: number }
>();
let inFlightLandingPayload: Promise<LandingPayload> | null = null;

function toSafeMetricNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return 0;
  }
  return Number(value);
}

function toSafeMetricNumberFromUnknown(value: unknown): number {
  if (typeof value === "bigint") {
    return toSafeMetricNumber(value);
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return toSafeMetricNumber(BigInt(value));
  }
  return 0;
}

async function getRepoInstallCount(): Promise<number> {
  try {
    await initializeDatabase();
    const rows = await sql()<{
      total_installs: string | number | bigint | null;
    }>`
      SELECT COALESCE(SUM(total_installs), 0)::bigint AS total_installs
      FROM skills
    `;
    return toSafeMetricNumberFromUnknown(rows[0]?.total_installs ?? 0);
  } catch (error) {
    console.error("Failed to load repo install count for /api/landing:", error);
    return 0;
  }
}

async function loadLandingPayload(): Promise<LandingPayload> {
  const [skillAccounts, agentAccounts, repoInstalls] = await Promise.all([
    listOnChainSkillListings(),
    rpc
      .getProgramAccounts(AGENTVOUCH_PROGRAM_ADDRESS, {
        encoding: "base64",
        filters: [
          {
            memcmp: {
              offset: 0n,
              bytes: asBase64(AGENT_PROFILE_DISCRIMINATOR),
              encoding: "base64",
            },
          },
        ],
      })
      .send(),
    getRepoInstallCount(),
  ]);

  const agentDecoder = getAgentProfileDecoder();

  const skills = skillAccounts.map(({ data }) => ({
    account: {
      author: data.author,
      totalDownloads: toSafeMetricNumber(data.totalDownloads),
      totalRevenueUsdcMicros: toSafeMetricNumber(data.totalRevenueUsdcMicros),
    },
  }));

  const agents = agentAccounts.map((a) => {
    const data = agentDecoder.decode(
      new Uint8Array(Buffer.from(a.account.data[0], "base64"))
    );
    return {
      publicKey: a.pubkey,
      account: {
        authority: data.authority,
        totalStakedFor: Number(data.totalVouchStakeUsdcMicros),
      },
    };
  });

  const authorPubkeys = [...new Set(skills.map((s) => s.account.author))];
  const registeredWallets = new Set(agents.map((a) => a.account.authority));
  let identityMap = new Map();
  try {
    identityMap = await resolveManyAgentIdentitiesByWallet(authorPubkeys, {
      hasAgentProfileByWallet: new Map(
        authorPubkeys.map((authorPubkey) => [
          authorPubkey,
          registeredWallets.has(authorPubkey),
        ])
      ),
    });
  } catch (error) {
    console.error(
      "Failed to resolve author identities for /api/landing:",
      error
    );
  }

  const authorSet = new Set(
    authorPubkeys.map(
      (authorPubkey) =>
        identityMap.get(authorPubkey)?.canonicalAgentId ?? authorPubkey
    )
  );
  const totalRevenue = skills.reduce(
    (sum, s) => sum + s.account.totalRevenueUsdcMicros,
    0
  );
  const totalStaked = agents.reduce(
    (sum, a) => sum + a.account.totalStakedFor,
    0
  );
  const onChainDownloads = skills.reduce(
    (sum, s) => sum + s.account.totalDownloads,
    0
  );

  return {
    metrics: {
      agents: agents.length,
      authors: authorSet.size,
      skills: skills.length,
      revenue: totalRevenue,
      staked: totalStaked,
      onChainDownloads,
      downloads: onChainDownloads + repoInstalls,
    },
  };
}

async function getLandingPayload(): Promise<LandingPayload> {
  if (process.env.NODE_ENV === "test") {
    return loadLandingPayload();
  }

  const now = Date.now();
  const cached = landingCache.get(LANDING_CACHE_KEY);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (inFlightLandingPayload) {
    return inFlightLandingPayload;
  }

  inFlightLandingPayload = loadLandingPayload()
    .then((value) => {
      landingCache.set(LANDING_CACHE_KEY, {
        value,
        expiresAt: Date.now() + IN_MEMORY_CACHE_TTL_MS.landing,
      });
      return value;
    })
    .finally(() => {
      inFlightLandingPayload = null;
    });

  return inFlightLandingPayload;
}

export async function GET() {
  try {
    return NextResponse.json(await getLandingPayload(), {
      headers: {
        "Cache-Control": buildPublicCacheControl(
          PUBLIC_ROUTE_CACHE_SECONDS.landing,
          PUBLIC_ROUTE_STALE_SECONDS.landing
        ),
      },
    });
  } catch (error: unknown) {
    console.error("GET /api/landing error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
