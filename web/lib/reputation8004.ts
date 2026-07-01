import { getConfiguredSolanaChainContext } from "@/lib/chains";
import { resolveAgentIdentityByWallet } from "@/lib/agentIdentity";
import { Keypair, PublicKey } from "@solana/web3.js";
import { SolanaSDK, Tag } from "8004-solana";

type Solana8004Cluster = "devnet" | "mainnet-beta";

let sdkPromise: Promise<SolanaSDK | null> | null = null;

function resolve8004Cluster(): Solana8004Cluster {
  if (process.env.EIGHT004_CLUSTER === "mainnet-beta") {
    return "mainnet-beta";
  }
  if (process.env.EIGHT004_CLUSTER === "devnet") {
    return "devnet";
  }

  return getConfiguredSolanaChainContext() ===
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
    ? "mainnet-beta"
    : "devnet";
}

function loadFeedbackSigner(): Keypair | null {
  const rawSecret = process.env.EIGHT004_PRIVATE_KEY?.trim();
  if (!rawSecret) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawSecret);
    if (!Array.isArray(parsed)) {
      throw new Error("expected JSON array");
    }
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  } catch (error) {
    throw new Error(
      `EIGHT004_PRIVATE_KEY must be a JSON array of secret key bytes: ${
        error instanceof Error ? error.message : "invalid value"
      }`
    );
  }
}

async function getFeedbackSdk(): Promise<SolanaSDK | null> {
  if (process.env.EIGHT004_ENABLED !== "true") {
    return null;
  }

  if (!sdkPromise) {
    sdkPromise = (async () => {
      const signer = loadFeedbackSigner();
      if (!signer) {
        return null;
      }

      return new SolanaSDK({
        cluster: resolve8004Cluster(),
        signer,
      });
    })();
  }

  return sdkPromise;
}

export async function writeUsdcPurchaseFeedback(input: {
  authorWalletPubkey: string;
  buyerWalletPubkey: string;
  txSignature: string;
  skillId: string;
  endpoint: string;
}) {
  try {
    const sdk = await getFeedbackSdk();
    if (!sdk) {
      return { skipped: "disabled" as const };
    }

    const identity = await resolveAgentIdentityByWallet(
      input.authorWalletPubkey,
      {
        createIfMissing: false,
      }
    );
    const authorAgentAsset = identity?.registryAsset;
    if (!authorAgentAsset) {
      return { skipped: "no-registry-asset" as const };
    }

    const feedbackResult = await sdk.giveFeedback(
      new PublicKey(authorAgentAsset),
      {
        value: "1",
        valueDecimals: 0,
        tag1: Tag.x402ResourceDelivered,
        tag2: Tag.x402Svm,
        score: 100,
        endpoint: input.endpoint,
        feedbackUri: `https://agentvouch.xyz/api/skills/${input.skillId}`,
      }
    );

    const signature =
      feedbackResult &&
      typeof feedbackResult === "object" &&
      "signature" in feedbackResult
        ? String(feedbackResult.signature)
        : null;

    return {
      skipped: null,
      signature,
    };
  } catch (error) {
    console.error("[8004] failed to write purchase feedback", {
      authorWalletPubkey: input.authorWalletPubkey,
      buyerWalletPubkey: input.buyerWalletPubkey,
      txSignature: input.txSignature,
      skillId: input.skillId,
      endpoint: input.endpoint,
      error: error instanceof Error ? error.message : String(error),
    });

    return { skipped: "error" as const };
  }
}
