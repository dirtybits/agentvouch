import { isAddress } from "@solana/kit";
import { getConfiguredUsdcMint, getFacilitatorUrl } from "@/lib/x402";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchChainContext,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";

export type X402BridgePocCheck = {
  id: string;
  passed: boolean;
  detail: string;
};

export type X402BridgePocReport = {
  status: "pass" | "fail";
  productionEnabled: boolean;
  chainContext: string;
  programId: string;
  protocolVersion: string;
  usdcMint: string;
  facilitatorUrl: string;
  checks: X402BridgePocCheck[];
};

export function isProtocolX402BridgeEnabled() {
  return process.env.AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED === "true";
}

export function evaluateX402BridgePoc(): X402BridgePocReport {
  const usdcMint = getConfiguredUsdcMint();
  const checks: X402BridgePocCheck[] = [
    {
      id: "feature-flag-default-off",
      passed: !isProtocolX402BridgeEnabled(),
      detail:
        "Protocol-listed x402 bridge support must stay disabled until the full POC passes.",
    },
    {
      id: "usdc-mint-configured",
      passed: isAddress(usdcMint),
      detail: `Configured USDC mint: ${usdcMint}`,
    },
    {
      id: "facilitator-configured",
      passed: getFacilitatorUrl().length > 0,
      detail: `Facilitator URL: ${getFacilitatorUrl()}`,
    },
    {
      id: "protocol-settlement-instruction",
      passed: false,
      detail:
        "No production settle_x402_purchase instruction is enabled; direct purchase_skill remains canonical.",
    },
    {
      id: "payer-binding-and-idempotency",
      passed: false,
      detail:
        "Payer extraction, deterministic memo binding, retry handling, and refund policy require a live settlement harness before enablement.",
    },
  ];

  const productionEnabled = isProtocolX402BridgeEnabled();
  const status =
    !productionEnabled && checks.every((check) => check.passed) ? "pass" : "fail";

  return {
    status,
    productionEnabled,
    chainContext: getAgentVouchChainContext(),
    programId: getAgentVouchProgramId(),
    protocolVersion: AGENTVOUCH_PROTOCOL_VERSION,
    usdcMint,
    facilitatorUrl: getFacilitatorUrl(),
    checks,
  };
}
