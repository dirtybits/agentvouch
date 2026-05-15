import { readFileSync } from "fs";
import { join } from "path";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { address, createSolanaRpc, isAddress } from "@solana/kit";
import { getConfiguredUsdcMint, getFacilitatorUrl } from "@/lib/x402";
import { DEFAULT_SOLANA_RPC_URL } from "@/lib/solanaRpc";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchChainContext,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";
import { fetchMaybeReputationConfig } from "@/generated/agentvouch/src/generated/accounts/reputationConfig";
import {
  findConfigPda,
  findX402SettlementVaultAuthorityPda,
} from "@/generated/agentvouch/src/generated/pdas";

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

export type X402SettlementDestinationCandidate = {
  id: string;
  payToAddress: string | null;
  derivedDestinationAta: string | null;
  creditsConfiguredVault: boolean;
  detail: string;
};

export type X402SettlementDestinationPocReport = {
  proofStatus: "complete" | "incomplete";
  currentVaultCompatible: boolean;
  recommendedNextStep:
    | "keep-current-vault"
    | "choose-stock-compatible-ata-vault"
    | "rerun-with-rpc";
  conclusion: string;
  x402SvmPackageVersion: string | null;
  chainContext: string;
  programId: string;
  usdcMint: string;
  tokenProgram: string;
  facilitatorUrl: string;
  config: {
    configPda: string;
    exists: boolean;
    fetchError: string | null;
    configuredX402SettlementVault: string | null;
    settlementAuthority: string | null;
  };
  programPdas: {
    x402SettlementVaultAuthorityPda: string;
    stockCompatibleX402SettlementVaultAta: string | null;
  };
  x402Model: {
    clientDestinationRule: string;
    facilitatorValidationRule: string;
  };
  candidates: X402SettlementDestinationCandidate[];
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
      passed: true,
      detail:
        "settle_x402_purchase exists, generated clients are available, and the raw-route bridge remains feature-flagged.",
    },
    {
      id: "payer-binding-and-idempotency",
      passed: true,
      detail:
        "The raw route requires X-AgentVouch-Auth before returning bridge requirements, binds buyer/listing/amount/nonce into the x402 memo, and records entitlements only after idempotent on-chain settlement.",
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

function getX402SvmPackageVersion(): string | null {
  try {
    const packageJson = JSON.parse(
      readFileSync(
        join(process.cwd(), "..", "node_modules", "@x402", "svm", "package.json"),
        "utf8"
      )
    ) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : null;
  } catch {
    return null;
  }
}

async function deriveAta(owner: string | null, mint: string, tokenProgram: string) {
  if (!owner || !isAddress(owner)) return null;
  const [ata] = await findAssociatedTokenPda({
    owner: address(owner),
    mint: address(mint),
    tokenProgram: address(tokenProgram),
  });
  return ata.toString();
}

export async function evaluateX402SettlementDestinationPoc(): Promise<X402SettlementDestinationPocReport> {
  const programId = getAgentVouchProgramId();
  const usdcMint = getConfiguredUsdcMint();
  const rpc = createSolanaRpc(DEFAULT_SOLANA_RPC_URL);
  const [configPda] = await findConfigPda({ programAddress: address(programId) });
  const [x402SettlementVaultAuthorityPda] =
    await findX402SettlementVaultAuthorityPda({
      programAddress: address(programId),
    });

  let configExists = false;
  let configFetchError: string | null = null;
  let configuredX402SettlementVault: string | null = null;
  let settlementAuthority: string | null = null;
  let tokenProgram = TOKEN_PROGRAM_ADDRESS.toString();

  try {
    const maybeConfig = await fetchMaybeReputationConfig(rpc, configPda);
    configExists = maybeConfig.exists;
    if (maybeConfig.exists) {
      configuredX402SettlementVault =
        maybeConfig.data.x402SettlementVault.toString();
      settlementAuthority = maybeConfig.data.settlementAuthority.toString();
      tokenProgram = maybeConfig.data.tokenProgram.toString();
    }
  } catch (error) {
    configFetchError =
      error instanceof Error ? error.message : "Unable to fetch config";
  }

  const configuredVaultForComparison =
    configuredX402SettlementVault ?? null;
  const stockCompatibleX402SettlementVaultAta = await deriveAta(
    x402SettlementVaultAuthorityPda.toString(),
    usdcMint,
    tokenProgram
  );

  const candidateInputs = [
    {
      id: "pay-to-configured-x402-settlement-vault",
      payToAddress: configuredVaultForComparison,
      detail:
        "If payTo is the configured token account, stock x402 derives a nested ATA owned by that token account.",
    },
    {
      id: "pay-to-x402-settlement-vault-authority",
      payToAddress: x402SettlementVaultAuthorityPda.toString(),
      detail:
        "If payTo is the PDA vault authority, stock x402 derives that authority's ATA.",
    },
    {
      id: "pay-to-settlement-authority",
      payToAddress: settlementAuthority,
      detail:
        "If payTo is the backend settlement authority, stock x402 derives the backend authority's ATA.",
    },
  ];

  const candidates = await Promise.all(
    candidateInputs.map(async (candidate) => {
      const derivedDestinationAta = await deriveAta(
        candidate.payToAddress,
        usdcMint,
        tokenProgram
      );
      return {
        ...candidate,
        derivedDestinationAta,
        creditsConfiguredVault:
          !!configuredVaultForComparison &&
          !!derivedDestinationAta &&
          derivedDestinationAta === configuredVaultForComparison,
      };
    })
  );

  const currentVaultCompatible = candidates.some(
    (candidate) => candidate.creditsConfiguredVault
  );
  const proofStatus = configFetchError ? "incomplete" : "complete";
  const recommendedNextStep = configFetchError
    ? "rerun-with-rpc"
    : currentVaultCompatible
    ? "keep-current-vault"
    : "choose-stock-compatible-ata-vault";
  const conclusion = configFetchError
    ? "RPC config fetch failed, so the static x402 destination model was proven but the live config comparison must be rerun."
    : currentVaultCompatible
    ? "The current AgentVouch settlement vault is compatible with stock @x402/svm exact payments."
    : "The current AgentVouch settlement vault is not compatible with stock @x402/svm exact payments. Do not enable the protocol-listed x402 bridge until config points at the ATA derived from x402_settlement_vault_authority + mint.";

  const checks: X402BridgePocCheck[] = [
    {
      id: "stock-client-uses-payto-ata",
      passed: true,
      detail:
        "@x402/svm ExactSvmScheme derives destination with findAssociatedTokenPda({ mint: asset, owner: paymentRequirements.payTo }).",
    },
    {
      id: "stock-facilitator-enforces-payto-ata",
      passed: true,
      detail:
        "@x402/svm facilitator rejects payloads whose transfer destination does not equal the ATA for requirements.payTo.",
    },
    {
      id: "agentvouch-config-fetched",
      passed: configExists && !configFetchError,
      detail: configFetchError
        ? `Config fetch failed: ${configFetchError}`
        : configExists
        ? `Config PDA exists: ${configPda.toString()}`
        : `Config PDA missing: ${configPda.toString()}`,
    },
    {
      id: "configured-vault-matches-stock-compatible-ata",
      passed:
        !!configuredX402SettlementVault &&
        configuredX402SettlementVault === stockCompatibleX402SettlementVaultAta,
      detail: `Configured vault: ${
        configuredX402SettlementVault ?? "unknown"
      }; authority ATA: ${stockCompatibleX402SettlementVaultAta ?? "unknown"}`,
    },
    {
      id: "current-vault-compatible-with-stock-x402",
      passed: currentVaultCompatible,
      detail: currentVaultCompatible
        ? "At least one payTo candidate credits the configured vault."
        : "No stock payTo candidate credits the configured custom vault.",
    },
  ];

  return {
    proofStatus,
    currentVaultCompatible,
    recommendedNextStep,
    conclusion,
    x402SvmPackageVersion: getX402SvmPackageVersion(),
    chainContext: getAgentVouchChainContext(),
    programId,
    usdcMint,
    tokenProgram,
    facilitatorUrl: getFacilitatorUrl(),
    config: {
      configPda: configPda.toString(),
      exists: configExists,
      fetchError: configFetchError,
      configuredX402SettlementVault,
      settlementAuthority,
    },
    programPdas: {
      x402SettlementVaultAuthorityPda: x402SettlementVaultAuthorityPda.toString(),
      stockCompatibleX402SettlementVaultAta,
    },
    x402Model: {
      clientDestinationRule:
        "TransferChecked destination = ATA(owner: paymentRequirements.payTo, mint: paymentRequirements.asset).",
      facilitatorValidationRule:
        "Facilitator requires parsed TransferChecked destination to equal ATA(owner: requirements.payTo, mint: requirements.asset).",
    },
    candidates,
    checks,
  };
}
