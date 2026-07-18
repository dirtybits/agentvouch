import {
  BASE_SEPOLIA_CHAIN_CONTEXT,
  getConfiguredSolanaChainContext,
  normalizeInputChainContext,
} from "@/lib/chains";
import { normalizeChainAddressForStorage } from "@/lib/chainAddress";
import { verifyWalletSignature } from "@/lib/auth";
import { verifyEvmWalletSignature } from "@/lib/evmAuth";
import type { PublicClient } from "viem";

export const WALLET_LINK_CHALLENGE_VERSION = 1;
export const WALLET_LINK_CHALLENGE_TTL_MS = 5 * 60_000;

export type WalletLinkTarget = {
  chainContext: string;
  normalizedAddress: string;
};

export type WalletLinkChallenge = WalletLinkTarget & {
  id: string;
  accountId: string;
  message: string;
  issuedAt: Date;
  expiresAt: Date;
  version: number;
};

export function normalizeWalletLinkTarget(input: {
  chainContext: string | null | undefined;
  address: string | null | undefined;
}): WalletLinkTarget | null {
  const chainContext = normalizeInputChainContext(input.chainContext);
  const configuredSolana = getConfiguredSolanaChainContext();
  if (
    chainContext !== BASE_SEPOLIA_CHAIN_CONTEXT &&
    chainContext !== configuredSolana
  ) {
    return null;
  }
  const normalizedAddress = normalizeChainAddressForStorage({
    chainContext,
    value: input.address,
  });
  return normalizedAddress ? { chainContext, normalizedAddress } : null;
}

export function buildWalletLinkChallengeMessage(input: {
  id: string;
  accountId: string;
  chainContext: string;
  normalizedAddress: string;
  origin: string;
  issuedAt: Date;
  expiresAt: Date;
  version?: number;
}): string {
  const origin = new URL(input.origin).origin;
  return [
    "AgentVouch wallet ownership verification",
    `Version: ${input.version ?? WALLET_LINK_CHALLENGE_VERSION}`,
    "Action: link-wallet",
    `Account: ${input.accountId}`,
    `Chain: ${input.chainContext}`,
    `Address: ${input.normalizedAddress}`,
    `Origin: ${origin}`,
    `Challenge: ${input.id}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expiration Time: ${input.expiresAt.toISOString()}`,
  ].join("\n");
}

export async function verifyWalletLinkChallengeSignature(
  challenge: WalletLinkChallenge,
  signature: string,
  options?: { evmClient?: Pick<PublicClient, "verifyMessage"> }
): Promise<{ valid: boolean; error?: string }> {
  if (challenge.version !== WALLET_LINK_CHALLENGE_VERSION) {
    return { valid: false, error: "Unsupported wallet link challenge version" };
  }
  if (
    !Number.isFinite(challenge.issuedAt.getTime()) ||
    !Number.isFinite(challenge.expiresAt.getTime()) ||
    challenge.expiresAt.getTime() <= Date.now() ||
    challenge.expiresAt.getTime() <= challenge.issuedAt.getTime()
  ) {
    return { valid: false, error: "Wallet link challenge expired" };
  }
  const timestamp = challenge.issuedAt.getTime();
  if (challenge.chainContext === BASE_SEPOLIA_CHAIN_CONTEXT) {
    const result = await verifyEvmWalletSignature(
      {
        pubkey: challenge.normalizedAddress,
        signature,
        message: challenge.message,
        timestamp,
      },
      { client: options?.evmClient }
    );
    return result.valid
      ? { valid: true }
      : { valid: false, error: result.error ?? "Invalid Base signature" };
  }

  if (challenge.chainContext !== getConfiguredSolanaChainContext()) {
    return { valid: false, error: "Unsupported wallet link chain" };
  }
  const result = verifyWalletSignature({
    pubkey: challenge.normalizedAddress,
    signature,
    message: challenge.message,
    timestamp,
  });
  return result.valid
    ? { valid: true }
    : { valid: false, error: result.error ?? "Invalid Solana signature" };
}
