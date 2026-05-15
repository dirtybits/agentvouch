import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentVouchApiClient } from "../src/lib/http.js";
import { installSkill } from "../src/lib/install.js";
import { AgentVouchSolanaClient } from "../src/lib/solana.js";

async function createKeypairFile() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentvouch-cli-"));
  const keypair = Keypair.generate();
  const keypairPath = path.join(tempDir, "id.json");
  await writeFile(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
  return { tempDir, keypairPath, keypair };
}

describe("installSkill", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads free repo-backed skills directly", async () => {
    const { tempDir } = await createKeypairFile();
    const outputPath = path.join(tempDir, "SKILL.md");

    vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_id: "calendar-agent",
      author_pubkey: Keypair.generate().publicKey.toBase58(),
      name: "Calendar Agent",
      description: "Free skill",
      on_chain_address: null,
      total_installs: 0,
    });
    vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw").mockResolvedValue({
      ok: true,
      status: 200,
      content: "# free skill\n",
    });
    const purchaseSpy = vi.spyOn(
      AgentVouchSolanaClient.prototype,
      "purchaseSkill"
    );

    const result = await installSkill({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      out: outputPath,
      baseUrl: "https://agentvouch.xyz",
      rpcUrl: "https://api.devnet.solana.com",
    });

    expect(result.mode).toBe("free-raw");
    expect(purchaseSpy).not.toHaveBeenCalled();
    expect(result.metadataPath).toBe(`${outputPath}.agentvouch.json`);
    const metadata = JSON.parse(await readFile(result.metadataPath, "utf8"));
    expect(metadata).toMatchObject({
      skill_id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      source: "repo",
      installed_version: 1,
    });
  });

  it("handles paid downloads via purchase plus signed retry", async () => {
    const { tempDir, keypairPath } = await createKeypairFile();
    const outputPath = path.join(tempDir, "SKILL.md");
    const author = Keypair.generate().publicKey.toBase58();
    const downloadSpy = vi
      .spyOn(AgentVouchApiClient.prototype, "downloadRaw")
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        error: "Payment required",
        requirement: {
          scheme: "exact",
          network: "solana",
          programId: "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg",
          instruction: "purchaseSkill",
          skillListingAddress: "37Mm4DzMockListing",
          mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
          amount: 1_000_000,
          resource: "abc123",
          expiry: Math.floor(Date.now() / 1000) + 300,
          nonce: "nonce",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        content: "# paid skill\n",
      });
    vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_id: "calendar-agent",
      author_pubkey: author,
      name: "Calendar Agent",
      description: "Paid skill",
      on_chain_address: "37Mm4DzMockListing",
      total_installs: 0,
      price_usdc_micros: "1000000",
      currency_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    });
    const purchaseSpy = vi
      .spyOn(AgentVouchSolanaClient.prototype, "purchaseSkill")
      .mockResolvedValue({
        tx: "mock-purchase-tx",
        alreadyPurchased: false,
        purchase: "purchase-pda",
      });
    const verifySpy = vi
      .spyOn(AgentVouchApiClient.prototype, "verifyDirectPurchase")
      .mockResolvedValue();

    const result = await installSkill({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      out: outputPath,
      keypairPath,
      baseUrl: "https://agentvouch.xyz",
      rpcUrl: "https://api.devnet.solana.com",
    });

    expect(result.mode).toBe("paid-raw");
    expect(purchaseSpy).toHaveBeenCalledWith("37Mm4DzMockListing", author);
    expect(verifySpy).toHaveBeenCalledWith(
      "595f5534-07ae-4839-a45a-b6858ab731fe",
      expect.objectContaining({
        signature: "mock-purchase-tx",
        listingAddress: "37Mm4DzMockListing",
      })
    );
    expect(downloadSpy).toHaveBeenCalledTimes(2);
  });

  it("refuses new listing-required paid installs when no entitlement exists", async () => {
    const { tempDir, keypairPath } = await createKeypairFile();
    const outputPath = path.join(tempDir, "SKILL.md");
    const author = Keypair.generate().publicKey.toBase58();
    vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_id: "calendar-agent",
      author_pubkey: author,
      name: "Calendar Agent",
      description: "Paid skill",
      on_chain_address: null,
      total_installs: 0,
      price_usdc_micros: "1000000",
      currency_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      payment_flow: "listing-required",
    });
    vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw")
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        error: "On-chain listing required",
        listingRequired: {
          amountMicros: "1000000",
          currencyMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
          message: "This paid repo skill is not installable yet.",
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        error: "On-chain listing required",
        listingRequired: {
          amountMicros: "1000000",
          currencyMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
          message: "This paid repo skill is not installable yet.",
        },
      });

    await expect(
      installSkill({
        id: "595f5534-07ae-4839-a45a-b6858ab731fe",
        out: outputPath,
        keypairPath,
        baseUrl: "https://agentvouch.xyz",
        rpcUrl: "https://api.devnet.solana.com",
      })
    ).rejects.toThrow("has no linked on-chain SkillListing");
  });

  it("allows signed re-download for historical unlinked paid entitlements", async () => {
    const { tempDir, keypairPath } = await createKeypairFile();
    const outputPath = path.join(tempDir, "SKILL.md");
    const author = Keypair.generate().publicKey.toBase58();
    vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_id: "calendar-agent",
      author_pubkey: author,
      name: "Calendar Agent",
      description: "Paid skill",
      on_chain_address: null,
      total_installs: 0,
      price_usdc_micros: "1000000",
      currency_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      payment_flow: "listing-required",
    });
    vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw")
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        error: "On-chain listing required",
        listingRequired: {
          amountMicros: "1000000",
          currencyMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
          message: "This paid repo skill is not installable yet.",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        content: "# historical paid skill\n",
      });

    const result = await installSkill({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      out: outputPath,
      keypairPath,
      baseUrl: "https://agentvouch.xyz",
      rpcUrl: "https://api.devnet.solana.com",
    });

    expect(result.mode).toBe("signed-entitlement");
    expect(await readFile(outputPath, "utf8")).toContain(
      "# historical paid skill"
    );
  });

  it("keeps signed auth on the paid x402 bridge retry", async () => {
    const { tempDir, keypairPath } = await createKeypairFile();
    const outputPath = path.join(tempDir, "SKILL.md");
    const author = Keypair.generate().publicKey.toBase58();
    const downloadSpy = vi
      .spyOn(AgentVouchApiClient.prototype, "downloadRaw")
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        error: "Payment required",
        x402PaymentRequired: {
          x402Version: 2,
          error: "Payment required",
          resource: {
            url: "https://agentvouch.xyz/api/skills/skill-id/raw",
            description: "AgentVouch skill",
            mimeType: "text/markdown; charset=utf-8",
          },
          accepts: [
            {
              scheme: "exact",
              network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
              amount: "10000",
              payTo: "PayTo111111111111111111111111111111111111",
              maxTimeoutSeconds: 300,
              asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
              extra: {},
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        content: "# bridge paid skill\n",
        paymentResponse: {
          success: true,
          transaction: "x402-settlement-tx",
          network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
          amount: "10000",
        },
      });
    vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_id: "calendar-agent",
      author_pubkey: author,
      name: "Calendar Agent",
      description: "Paid skill",
      on_chain_address: "37Mm4DzMockListing",
      total_installs: 0,
      price_usdc_micros: "10000",
      currency_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      payment_flow: "x402-bridge-purchase-skill",
    });

    const result = await installSkill({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      out: outputPath,
      keypairPath,
      baseUrl: "https://agentvouch.xyz",
      rpcUrl: "https://api.devnet.solana.com",
    });

    expect(result.mode).toBe("x402-usdc");
    expect(downloadSpy).toHaveBeenCalledTimes(2);
    expect(downloadSpy.mock.calls[0]?.[1]).toMatchObject({
      auth: expect.objectContaining({
        pubkey: expect.any(String),
      }),
    });
    expect(downloadSpy.mock.calls[1]?.[1]).toMatchObject({
      auth: expect.objectContaining({
        pubkey: expect.any(String),
      }),
      fetchImpl: expect.any(Function),
    });
  });
});
