import { NextResponse } from "next/server";
import { createSolanaRpc } from "@solana/kit";
import type { Base64EncodedBytes } from "@solana/rpc-types";
import {
  getAgentProfileDecoder,
  AGENT_PROFILE_DISCRIMINATOR,
  SkillStatus,
} from "../../../generated/agentvouch/src/generated";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "../../../generated/agentvouch/src/generated/programs";
import { resolveManyAgentIdentitiesByWallet } from "@/lib/agentIdentity";
import {
  buildPublicCacheControl,
  PUBLIC_ROUTE_CACHE_SECONDS,
  PUBLIC_ROUTE_STALE_SECONDS,
} from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import { listOnChainSkillListings } from "@/lib/onchain";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";

const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
const asBase64 = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64") as Base64EncodedBytes;

function toSafeMetricNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return 0;
  }
  return Number(value);
}

export async function GET() {
  try {
    const [skillAccounts, agentAccounts] = await Promise.all([
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
    ]);

    const agentDecoder = getAgentProfileDecoder();

    const skills = skillAccounts.map(({ publicKey, data }) => {
      return {
        publicKey,
        account: {
          author: data.author,
          name: data.name,
          description: data.description,
          priceUsdcMicros: toSafeMetricNumber(data.priceUsdcMicros),
          totalDownloads: toSafeMetricNumber(data.totalDownloads),
          totalRevenueUsdcMicros: toSafeMetricNumber(
            data.totalRevenueUsdcMicros
          ),
          status: data.status,
        },
      };
    });

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

    const featuredSkills = [...skills]
      .filter((skill) => skill.account.status === SkillStatus.Active)
      .sort((a, b) => b.account.totalDownloads - a.account.totalDownloads)
      .slice(0, 3)
      .map((skill) => ({
        ...skill,
        authorIdentity: identityMap.get(skill.account.author) ?? null,
      }));

    return NextResponse.json(
      {
        metrics: {
          agents: agents.length,
          authors: authorSet.size,
          skills: skills.length,
          revenue: totalRevenue,
          staked: totalStaked,
          onChainDownloads,
        },
        featuredSkills,
      },
      {
        headers: {
          "Cache-Control": buildPublicCacheControl(
            PUBLIC_ROUTE_CACHE_SECONDS.landing,
            PUBLIC_ROUTE_STALE_SECONDS.landing
          ),
        },
      }
    );
  } catch (error: unknown) {
    console.error("GET /api/landing error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
