import { NextResponse } from "next/server";
import { getConfiguredUsdcMint, getFacilitatorUrl } from "@/lib/x402";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import {
  BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  BASE_NATIVE_USDC_ADDRESS,
} from "@/lib/adapters/baseConfig";
import { BASE_X402_PURCHASE_PAYMENT_FLOW } from "@/lib/baseX402";
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
    networks: [chainContext, BASE_SEPOLIA_CHAIN_CONTEXT],
    chain_contexts: [chainContext, BASE_SEPOLIA_CHAIN_CONTEXT],
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
      {
        address: BASE_NATIVE_USDC_ADDRESS,
        symbol: "USDC",
        decimals: 6,
        name: "USD Coin",
        network: BASE_SEPOLIA_CHAIN_CONTEXT,
        flow: BASE_X402_PURCHASE_PAYMENT_FLOW,
      },
    ],
    program: {
      id: getAgentVouchProgramId(),
      protocol_version: AGENTVOUCH_PROTOCOL_VERSION,
      instructions: bridgeEnabled
        ? ["purchaseSkill", "settleX402Purchase"]
        : ["purchaseSkill"],
    },
    capabilities: {
      repo_x402_usdc: false,
      repo_x402_usdc_legacy_entitlements: true,
      protocol_listed_x402_bridge: bridgeEnabled,
      base_eip3009_x402: true,
      protocol_listed_purchase_flow: bridgeEnabled
        ? "x402-bridge-or-direct-purchase-skill"
        : "direct-purchase-skill",
      base_protocol_listed_purchase_flow: BASE_X402_PURCHASE_PAYMENT_FLOW,
      protocol_listed_message: bridgeEnabled
        ? "Protocol-listed x402 bridge support is explicitly enabled."
        : "Paid marketplace skills require direct purchase_skill verification unless the protocol x402 bridge is enabled. New repo-only x402 purchases are disabled; historical entitlements can still re-download with X-AgentVouch-Auth.",
      base_protocol_listed_message:
        "Base-listed paid skills support x402 through native USDC receiveWithAuthorization/EIP-3009. The server relays purchaseWithAuthorization and grants access only after the Base receipt is verified.",
    },
    base: {
      status: "enabled",
      chain_context: BASE_SEPOLIA_CHAIN_CONTEXT,
      chain_id: 84532,
      contract: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
      asset: BASE_NATIVE_USDC_ADDRESS,
      payment_flow: BASE_X402_PURCHASE_PAYMENT_FLOW,
      authorization:
        "EIP-3009 receiveWithAuthorization signed by the buyer EOA; relayed as AgentVouchEvm.purchaseWithAuthorization.",
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
    version: "2.5.0-base-eip3009-x402",
  });
}
