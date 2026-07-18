import { describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
import { getAddressCodec } from "@solana/kit";
import { privateKeyToAccount } from "viem/accounts";
import {
  BASE_CHAIN_CONTEXT,
  BASE_SEPOLIA_CHAIN_CONTEXT,
  getConfiguredSolanaChainContext,
} from "@/lib/chains";
import {
  buildWalletLinkChallengeMessage,
  normalizeWalletLinkTarget,
  verifyWalletLinkChallengeSignature,
  WALLET_LINK_CHALLENGE_VERSION,
} from "@/lib/walletLinkChallenge";

const issuedAt = new Date();
const expiresAt = new Date(issuedAt.getTime() + 300_000);
const challengeId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";

describe("wallet link challenge", () => {
  it("accepts only the configured Solana network or Base Sepolia", () => {
    const evm = normalizeWalletLinkTarget({
      chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
      address: "0x1111111111111111111111111111111111111111",
    });
    expect(evm).toEqual({
      chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
      normalizedAddress: "0x1111111111111111111111111111111111111111",
    });
    expect(
      normalizeWalletLinkTarget({
        chainContext: BASE_CHAIN_CONTEXT,
        address: "0x1111111111111111111111111111111111111111",
      })
    ).toBeNull();
    expect(
      normalizeWalletLinkTarget({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        address: "not-a-wallet",
      })
    ).toBeNull();
  });

  it("domain-separates the account, chain, address, origin, nonce, and expiry", () => {
    const base = {
      id: challengeId,
      accountId,
      chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
      normalizedAddress: "0x1111111111111111111111111111111111111111",
      origin: "https://agentvouch.xyz/some/path",
      issuedAt,
      expiresAt,
    };
    const message = buildWalletLinkChallengeMessage(base);
    expect(message).toContain("Action: link-wallet");
    expect(message).toContain(`Account: ${accountId}`);
    expect(message).toContain(`Challenge: ${challengeId}`);
    expect(message).toContain("Origin: https://agentvouch.xyz");
    expect(
      buildWalletLinkChallengeMessage({
        ...base,
        accountId: crypto.randomUUID(),
      })
    ).not.toBe(message);
    expect(
      buildWalletLinkChallengeMessage({
        ...base,
        chainContext: getConfiguredSolanaChainContext(),
      })
    ).not.toBe(message);
    expect(
      buildWalletLinkChallengeMessage({ ...base, id: crypto.randomUUID() })
    ).not.toBe(message);
  });

  it("verifies a Solana Ed25519 signature over the exact server message", async () => {
    const pair = nacl.sign.keyPair();
    const address = getAddressCodec().decode(pair.publicKey);
    const message = buildWalletLinkChallengeMessage({
      id: challengeId,
      accountId,
      chainContext: getConfiguredSolanaChainContext(),
      normalizedAddress: address,
      origin: "https://agentvouch.xyz",
      issuedAt,
      expiresAt,
    });
    const signature = Buffer.from(
      nacl.sign.detached(new TextEncoder().encode(message), pair.secretKey)
    ).toString("base64");
    const challenge = {
      id: challengeId,
      accountId,
      chainContext: getConfiguredSolanaChainContext(),
      normalizedAddress: address,
      version: WALLET_LINK_CHALLENGE_VERSION,
      message,
      issuedAt,
      expiresAt,
    };
    await expect(
      verifyWalletLinkChallengeSignature(challenge, signature)
    ).resolves.toEqual({ valid: true });
    await expect(
      verifyWalletLinkChallengeSignature(
        { ...challenge, message: `${message}\nChanged: true` },
        signature
      )
    ).resolves.toMatchObject({ valid: false });
  });

  it("routes Base personal-sign verification through the smart-account-aware client", async () => {
    const account = privateKeyToAccount(
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    const message = buildWalletLinkChallengeMessage({
      id: challengeId,
      accountId,
      chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
      normalizedAddress: account.address.toLowerCase(),
      origin: "https://agentvouch.xyz",
      issuedAt,
      expiresAt,
    });
    const signature = await account.signMessage({ message });
    const verifyMessage = vi.fn().mockResolvedValue(true);
    await expect(
      verifyWalletLinkChallengeSignature(
        {
          id: challengeId,
          accountId,
          chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
          normalizedAddress: account.address.toLowerCase(),
          version: WALLET_LINK_CHALLENGE_VERSION,
          message,
          issuedAt,
          expiresAt,
        },
        signature,
        { evmClient: { verifyMessage } }
      )
    ).resolves.toEqual({ valid: true });
    expect(verifyMessage).toHaveBeenCalledWith({
      address: account.address.toLowerCase(),
      message,
      signature,
    });
  });

  it("rejects unsupported challenge versions before signature verification", async () => {
    const verifyMessage = vi.fn();
    await expect(
      verifyWalletLinkChallengeSignature(
        {
          id: challengeId,
          accountId,
          chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
          normalizedAddress: "0x1111111111111111111111111111111111111111",
          version: 99,
          message: "wrong-version",
          issuedAt,
          expiresAt,
        },
        "0x1234",
        { evmClient: { verifyMessage } }
      )
    ).resolves.toMatchObject({ valid: false });
    expect(verifyMessage).not.toHaveBeenCalled();
  });

  it("rejects expired challenges before signature verification", async () => {
    const verifyMessage = vi.fn();
    await expect(
      verifyWalletLinkChallengeSignature(
        {
          id: challengeId,
          accountId,
          chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
          normalizedAddress: "0x1111111111111111111111111111111111111111",
          version: WALLET_LINK_CHALLENGE_VERSION,
          message: "expired",
          issuedAt: new Date(Date.now() - 2_000),
          expiresAt: new Date(Date.now() - 1_000),
        },
        "0x1234",
        { evmClient: { verifyMessage } }
      )
    ).resolves.toEqual({
      valid: false,
      error: "Wallet link challenge expired",
    });
    expect(verifyMessage).not.toHaveBeenCalled();
  });
});
