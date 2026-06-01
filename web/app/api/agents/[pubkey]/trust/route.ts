import { NextRequest, NextResponse } from "next/server";
import { resolveAuthorTrust } from "@/lib/trust";
import { resolveAgentIdentityByWallet } from "@/lib/agentIdentity";
import { listAuthorDisputesByAuthor } from "@/lib/authorDisputes";
import { buildAgentTrustSummary } from "@/lib/agentDiscovery";
import { buildTrustSignals } from "@/lib/trustSignals";
import {
  buildPublicCacheControl,
  PUBLIC_ROUTE_CACHE_SECONDS,
  PUBLIC_ROUTE_STALE_SECONDS,
} from "@/lib/cachePolicy";
import { getErrorMessage } from "@/lib/errors";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pubkey: string }> }
) {
  try {
    const { pubkey } = await params;
    const trust = await resolveAuthorTrust(pubkey);
    const identity = await resolveAgentIdentityByWallet(pubkey, {
      hasAgentProfile: trust.isRegistered,
    }).catch(() => null);
    const disputes = await listAuthorDisputesByAuthor(pubkey).catch(() => []);
    const trustSummary = buildAgentTrustSummary({
      walletPubkey: pubkey,
      trust,
      identity,
    });
    // Author-scope checklist only: this endpoint has no skill in scope, so the
    // ai_scan (skill-scope) row would be a noise "unknown" — drop it.
    const signals = buildTrustSignals({ trust, scan: null }).filter(
      (signal) => signal.scope === "author"
    );

    return NextResponse.json(
      {
        pubkey,
        trust: trustSummary,
        author_trust: trust,
        author_identity: identity,
        author_disputes: disputes,
        signals,
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
    console.error("GET /api/agents/[pubkey]/trust error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
