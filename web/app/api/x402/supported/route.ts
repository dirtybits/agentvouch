import { NextResponse } from "next/server";
import { getConfiguredUsdcMint, getFacilitatorUrl } from "@/lib/x402";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchChainContext,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";
import { isProtocolX402BridgeEnabled } from "@/lib/x402BridgePoc";

export async function GET() {
  const chainContext = getAgentVouchChainContext();
  const bridgeEnabled = isProtocolX402BridgeEnabled();

  if (!bridgeEnabled) {
    console.info(
      `[x402-supported] protocol bridge disabled for program=${getAgentVouchProgramId()} chain=${chainContext}`
    );
  }

  return NextResponse.json({
    schemes: ["exact"],
    networks: [chainContext],
    chain_contexts: [chainContext],
    assets: [
      {
        address: getConfiguredUsdcMint(),
        symbol: "USDC",
        decimals: 6,
        name: "USD Coin",
        flow: bridgeEnabled
          ? "x402-bridge-or-direct-purchase-skill"
          : "direct-purchase-skill",
      },
    ],
    program: {
      id: getAgentVouchProgramId(),
      protocol_version: AGENTVOUCH_PROTOCOL_VERSION,
      instructions: ["purchaseSkill"],
    },
    capabilities: {
      repo_x402_usdc: false,
      repo_x402_usdc_legacy_entitlements: true,
      protocol_listed_x402_bridge: bridgeEnabled,
      protocol_listed_purchase_flow: bridgeEnabled
        ? "x402-bridge-or-direct-purchase-skill"
        : "direct-purchase-skill",
      protocol_listed_message: bridgeEnabled
        ? "Protocol-listed x402 bridge support is explicitly enabled."
        : "Paid marketplace skills require direct purchase_skill verification unless the protocol x402 bridge is enabled. New repo-only x402 purchases are disabled; historical entitlements can still re-download with X-AgentVouch-Auth.",
    },
    bridge: {
      status: bridgeEnabled ? "enabled" : "disabled",
      feature_flag: "AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED",
      default_enabled: false,
    },
    facilitator: {
      url: getFacilitatorUrl(),
      endpoints: {
        supported: "/supported",
        verify: "/verify",
        settle: "/settle",
      },
    },
    version: "2.4.0-usdc-direct-purchase-gated",
  });
}
