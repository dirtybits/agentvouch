import { NextRequest, NextResponse } from "next/server";
import { resolveAuthorTrust, verifyAuthorTrust } from "@/lib/trust";
import {
  linkSolanaRegistryIdentity,
  resolveAgentIdentityByWallet,
} from "@/lib/agentIdentity";
import { resolveBaseAuthorTrust } from "@/lib/baseAuthorTrust";
import { verifyWalletSignature, type AuthPayload } from "@/lib/auth";
import { discoverSolanaRegistryCandidatesByWallet } from "@/lib/solanaAgentRegistry";
import { listAuthorDisputesByAuthor } from "@/lib/authorDisputes";
import {
  BASE_SEPOLIA_CHAIN_CONTEXT,
  normalizeInputChainContext,
} from "@/lib/chains";
import {
  buildPublicCacheControl,
  PUBLIC_ROUTE_CACHE_SECONDS,
  PUBLIC_ROUTE_STALE_SECONDS,
} from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";
import { buildAgentTrustSummary } from "@/lib/agentDiscovery";
import { getAddress as getEvmAddress, isAddress as isEvmAddress } from "viem";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pubkey: string }> }
) {
  try {
    const { pubkey } = await params;
    const requestedChainContext =
      normalizeInputChainContext(
        request.nextUrl.searchParams.get("chainContext") ??
          request.nextUrl.searchParams.get("chain_context")
      ) ?? (isEvmAddress(pubkey) ? BASE_SEPOLIA_CHAIN_CONTEXT : null);

    if (requestedChainContext?.startsWith("eip155:")) {
      if (!isEvmAddress(pubkey)) {
        return NextResponse.json(
          { error: "EVM author routes require a valid EVM address" },
          { status: 400 }
        );
      }

      const authorAddress = getEvmAddress(pubkey);
      const authorTrust = await resolveBaseAuthorTrust(
        authorAddress,
        requestedChainContext
      );
      let authorIdentity = null;
      try {
        authorIdentity = await resolveAgentIdentityByWallet(authorAddress, {
          chainContext: requestedChainContext,
          hasAgentProfile: authorTrust.isRegistered,
        });
      } catch (error) {
        console.error(
          "Failed to resolve EVM author identity for /api/author/[pubkey]:",
          error
        );
      }

      const authorTrustSummary = buildAgentTrustSummary({
        walletPubkey: authorAddress,
        trust: authorTrust,
        identity: authorIdentity,
      });

      return NextResponse.json(
        {
          pubkey: authorAddress,
          chain_context: requestedChainContext,
          author_trust: authorTrust,
          author_trust_summary: authorTrustSummary,
          author_identity: authorIdentity,
          author_disputes: [],
        },
        {
          headers: {
            "Cache-Control": buildPublicCacheControl(
              PUBLIC_ROUTE_CACHE_SECONDS.authorTrust,
              PUBLIC_ROUTE_STALE_SECONDS.authorTrust
            ),
          },
        }
      );
    }

    const authorTrust = await resolveAuthorTrust(pubkey);
    const authorDisputes = await listAuthorDisputesByAuthor(pubkey);
    let authorIdentity = null;
    try {
      authorIdentity = await resolveAgentIdentityByWallet(pubkey, {
        hasAgentProfile: authorTrust.isRegistered,
      });
    } catch (error) {
      console.error(
        "Failed to resolve author identity for /api/author/[pubkey]:",
        error
      );
    }

    const authorTrustSummary = buildAgentTrustSummary({
      walletPubkey: pubkey,
      trust: authorTrust,
      identity: authorIdentity,
    });

    return NextResponse.json(
      {
        pubkey,
        author_trust: authorTrust,
        author_trust_summary: authorTrustSummary,
        author_identity: authorIdentity,
        author_disputes: authorDisputes,
      },
      {
        headers: {
          "Cache-Control": buildPublicCacheControl(
            PUBLIC_ROUTE_CACHE_SECONDS.authorTrust,
            PUBLIC_ROUTE_STALE_SECONDS.authorTrust
          ),
        },
      }
    );
  } catch (error: unknown) {
    console.error("GET /api/author/[pubkey] error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pubkey: string }> }
) {
  try {
    const { pubkey } = await params;
    const body = await request.json();
    const {
      auth,
      selected_registry_asset_pubkey,
      registry_address,
      core_asset_pubkey,
      operational_wallet_pubkey,
      display_name,
      chain_context,
      raw_upstream_chain_label,
      raw_upstream_chain_id,
      external_agent_id,
    } = body as {
      auth: AuthPayload;
      selected_registry_asset_pubkey?: string;
      registry_address: string;
      core_asset_pubkey: string;
      operational_wallet_pubkey?: string;
      display_name?: string;
      chain_context?: string;
      raw_upstream_chain_label?: string;
      raw_upstream_chain_id?: string;
      external_agent_id?: string;
    };

    if (!auth) {
      return NextResponse.json(
        { error: "Missing required fields: auth" },
        { status: 400 }
      );
    }

    const verification = verifyWalletSignature(auth);
    if (!verification.valid || !verification.pubkey) {
      return NextResponse.json(
        { error: verification.error || "Invalid signature" },
        { status: 401 }
      );
    }

    if (verification.pubkey !== pubkey) {
      return NextResponse.json(
        { error: "Only the author wallet can link registry identity" },
        { status: 403 }
      );
    }

    const authorTrust = await verifyAuthorTrust(pubkey);
    if (!authorTrust.isRegistered) {
      return NextResponse.json(
        {
          error:
            "You must register an on-chain AgentProfile before linking registry identity.",
        },
        { status: 403 }
      );
    }

    let authorIdentity;
    if (selected_registry_asset_pubkey) {
      const candidates = await discoverSolanaRegistryCandidatesByWallet(
        pubkey,
        { useCache: false }
      );
      const selectedCandidate = candidates.find(
        (candidate) =>
          candidate.coreAssetPubkey === selected_registry_asset_pubkey
      );

      if (!selectedCandidate) {
        return NextResponse.json(
          {
            error: "Selected registry identity was not found for this wallet.",
          },
          { status: 400 }
        );
      }

      authorIdentity = await linkSolanaRegistryIdentity({
        ownerWalletPubkey: pubkey,
        registryAddress: selectedCandidate.registryAddress,
        coreAssetPubkey: selectedCandidate.coreAssetPubkey,
        operationalWalletPubkey: selectedCandidate.operationalWallet,
        displayName: selectedCandidate.displayName,
        chainContext: selectedCandidate.chainContext,
        rawUpstreamChainLabel: selectedCandidate.rawUpstreamChainLabel,
        rawUpstreamChainId: selectedCandidate.rawUpstreamChainId,
        externalAgentId: selectedCandidate.externalAgentId,
        hasAgentProfile: true,
      });
    } else {
      if (!registry_address || !core_asset_pubkey) {
        return NextResponse.json(
          {
            error:
              "Missing required fields: registry_address, core_asset_pubkey",
          },
          { status: 400 }
        );
      }

      authorIdentity = await linkSolanaRegistryIdentity({
        ownerWalletPubkey: pubkey,
        registryAddress: registry_address,
        coreAssetPubkey: core_asset_pubkey,
        operationalWalletPubkey: operational_wallet_pubkey ?? null,
        displayName: display_name ?? null,
        chainContext: chain_context ?? null,
        rawUpstreamChainLabel: raw_upstream_chain_label ?? null,
        rawUpstreamChainId: raw_upstream_chain_id ?? null,
        externalAgentId: external_agent_id ?? null,
        hasAgentProfile: true,
      });
    }

    return NextResponse.json(
      {
        pubkey,
        author_trust: authorTrust,
        author_identity: authorIdentity,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("POST /api/author/[pubkey] error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
