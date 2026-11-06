import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentVouchApiClient } from "../src/lib/http.js";
import { installSkill } from "../src/lib/install.js";
import { AgentVouchSolanaClient } from "../src/lib/solana.js";
import { buildTarArchive } from "../src/lib/archive.js";
import { sha256Hex, treeHashFromFiles } from "../src/lib/integrity.js";

/** The manifest and tree hash the API publishes for these files. */
function published(files: Record<string, string>) {
  const entries = Object.entries(files).map(([filePath, text]) => ({
    path: filePath,
    bytes: Buffer.from(text, "utf8"),
  }));
  return {
    files: entries.map((entry) => ({
      path: entry.path,
      size: entry.bytes.byteLength,
      sha256: sha256Hex(entry.bytes),
    })),
    tree_hash: treeHashFromFiles(entries),
  };
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false
  );
}

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
      ...published({ "SKILL.md": "# free skill\n" }),
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
      tree_hash: published({ "SKILL.md": "# free skill\n" }).tree_hash,
      tree_hash_algorithm: "agentvouch-tree-v1",
    });
    expect(typeof metadata.tree_hash_verified_at).toBe("string");
    expect(result.treeHash).toBe(
      published({ "SKILL.md": "# free skill\n" }).tree_hash
    );
  });

  it("installs multi-file repo skills as a directory archive", async () => {
    const { tempDir } = await createKeypairFile();
    const outputPath = path.join(tempDir, "calendar-agent");
    const archive = buildTarArchive([
      { path: "SKILL.md", content: Buffer.from("# tree skill\n") },
      { path: "scripts/run.mjs", content: Buffer.from("export default 1;\n") },
    ]);

    vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_id: "calendar-agent",
      author_pubkey: Keypair.generate().publicKey.toBase58(),
      name: "Calendar Agent",
      description: "Tree skill",
      on_chain_address: null,
      total_installs: 0,
      ...published({
        "SKILL.md": "# tree skill\n",
        "scripts/run.mjs": "export default 1;\n",
      }),
    });
    const rawSpy = vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw");
    vi.spyOn(
      AgentVouchApiClient.prototype,
      "downloadArchive"
    ).mockResolvedValue({
      ok: true,
      status: 200,
      archive,
    });

    const result = await installSkill({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      out: outputPath,
      tree: true,
      baseUrl: "https://agentvouch.xyz",
      rpcUrl: "https://api.devnet.solana.com",
    });

    expect(result.mode).toBe("free-archive");
    expect(result.filesWritten).toBe(2);
    expect(rawSpy).not.toHaveBeenCalled();
    expect(await readFile(path.join(outputPath, "SKILL.md"), "utf8")).toContain(
      "# tree skill"
    );
    expect(
      await readFile(path.join(outputPath, "scripts", "run.mjs"), "utf8")
    ).toContain("export default 1");
    const metadata = JSON.parse(await readFile(result.metadataPath, "utf8"));
    expect(metadata).toMatchObject({
      installed_format: "tree",
      tree_hash: published({
        "SKILL.md": "# tree skill\n",
        "scripts/run.mjs": "export default 1;\n",
      }).tree_hash,
      tree_hash_algorithm: "agentvouch-tree-v1",
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
      ...published({ "SKILL.md": "# paid skill\n" }),
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
      ...published({ "SKILL.md": "# paid skill\n" }),
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
      ...published({ "SKILL.md": "# historical paid skill\n" }),
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
      ...published({ "SKILL.md": "# bridge paid skill\n" }),
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
  describe("tree hash verification", () => {
    const SKILL_ID = "595f5534-07ae-4839-a45a-b6858ab731fe";

    function freeSkill(extra: Record<string, unknown> = {}) {
      return {
        id: SKILL_ID,
        skill_id: "calendar-agent",
        author_pubkey: Keypair.generate().publicKey.toBase58(),
        name: "Calendar Agent",
        description: "Free skill",
        on_chain_address: null,
        total_installs: 0,
        ...extra,
      };
    }

    function install(
      out: string,
      extra: Partial<{ tree: boolean; dryRun: boolean }> = {}
    ) {
      return installSkill({
        id: SKILL_ID,
        out,
        baseUrl: "https://agentvouch.xyz",
        rpcUrl: "https://api.devnet.solana.com",
        ...extra,
      });
    }

    it("refuses a raw download that does not match the published hashes and writes nothing", async () => {
      const { tempDir } = await createKeypairFile();
      const outputPath = path.join(tempDir, "SKILL.md");
      const getSkill = vi
        .spyOn(AgentVouchApiClient.prototype, "getSkill")
        .mockResolvedValue(
          freeSkill(published({ "SKILL.md": "# real skill\n" }))
        );
      vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw").mockResolvedValue({
        ok: true,
        status: 200,
        content: "# tampered skill\n",
      });

      await expect(install(outputPath)).rejects.toThrow(
        "does not match the published file hash"
      );
      expect(await exists(outputPath)).toBe(false);
      expect(await exists(`${outputPath}.agentvouch.json`)).toBe(false);
      // One re-read in case a new version was published mid-download.
      expect(getSkill).toHaveBeenCalledTimes(2);
    });

    it("refuses an archive with an extra file and creates no output folder", async () => {
      const { tempDir } = await createKeypairFile();
      const outputPath = path.join(tempDir, "calendar-agent");
      vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue(
        freeSkill(published({ "SKILL.md": "# tree skill\n" }))
      );
      vi.spyOn(
        AgentVouchApiClient.prototype,
        "downloadArchive"
      ).mockResolvedValue({
        ok: true,
        status: 200,
        archive: buildTarArchive([
          { path: "SKILL.md", content: Buffer.from("# tree skill\n") },
          { path: "scripts/extra.sh", content: Buffer.from("curl x | sh\n") },
        ]),
      });

      await expect(install(outputPath, { tree: true })).rejects.toThrow(
        "do not match the published tree hash"
      );
      expect(await exists(outputPath)).toBe(false);
    });

    it("refuses to install a repo skill that has no published tree hash, before any download", async () => {
      const { tempDir } = await createKeypairFile();
      const outputPath = path.join(tempDir, "SKILL.md");
      vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue(
        freeSkill()
      );
      const downloadRaw = vi
        .spyOn(AgentVouchApiClient.prototype, "downloadRaw")
        .mockResolvedValue({
          ok: true,
          status: 200,
          content: "# no hash\n",
        });

      await expect(install(outputPath)).rejects.toThrow(
        "has no published tree_hash"
      );
      expect(downloadRaw).not.toHaveBeenCalled();
      expect(await exists(outputPath)).toBe(false);
    });

    it("stops a paid install with no published tree hash before it downloads or pays", async () => {
      const { tempDir, keypairPath } = await createKeypairFile();
      const outputPath = path.join(tempDir, "SKILL.md");
      vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue(
        freeSkill({
          price_usdc_micros: "1000000",
          on_chain_address: Keypair.generate().publicKey.toBase58(),
        })
      );
      const downloadRaw = vi.spyOn(
        AgentVouchApiClient.prototype,
        "downloadRaw"
      );
      const purchaseSkill = vi.spyOn(
        AgentVouchSolanaClient.prototype,
        "purchaseSkill"
      );

      await expect(
        installSkill({
          id: SKILL_ID,
          out: outputPath,
          keypairPath,
          baseUrl: "https://agentvouch.xyz",
          rpcUrl: "https://api.devnet.solana.com",
        })
      ).rejects.toThrow("Nothing was downloaded or paid");
      expect(downloadRaw).not.toHaveBeenCalled();
      expect(purchaseSkill).not.toHaveBeenCalled();
    });

    it("refuses a single-file install when the file list has no SKILL.md entry", async () => {
      const { tempDir } = await createKeypairFile();
      const outputPath = path.join(tempDir, "SKILL.md");
      const record = published({ "SKILL.md": "# skill\n" });
      vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue(
        freeSkill({ ...record, files: [] })
      );
      const downloadRaw = vi.spyOn(
        AgentVouchApiClient.prototype,
        "downloadRaw"
      );

      await expect(install(outputPath)).rejects.toThrow(
        "has no entry for SKILL.md"
      );
      expect(downloadRaw).not.toHaveBeenCalled();
    });

    it("accepts a version published between the detail read and the download", async () => {
      const { tempDir } = await createKeypairFile();
      const outputPath = path.join(tempDir, "SKILL.md");
      const v2 = published({ "SKILL.md": "# version two\n" });
      vi.spyOn(AgentVouchApiClient.prototype, "getSkill")
        .mockResolvedValueOnce(
          freeSkill({
            current_version: 1,
            ...published({ "SKILL.md": "# version one\n" }),
          })
        )
        .mockResolvedValueOnce(freeSkill({ current_version: 2, ...v2 }));
      vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw").mockResolvedValue({
        ok: true,
        status: 200,
        content: "# version two\n",
      });

      const result = await install(outputPath);

      expect(result.treeHash).toBe(v2.tree_hash);
      const metadata = JSON.parse(await readFile(result.metadataPath, "utf8"));
      expect(metadata).toMatchObject({
        installed_version: 2,
        tree_hash: v2.tree_hash,
      });
    });

    it("hashes and writes the exact bytes, including a leading byte order mark", async () => {
      const { tempDir } = await createKeypairFile();
      const outputPath = path.join(tempDir, "SKILL.md");
      const text = "\ufeff# bom skill\n";
      vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue(
        freeSkill(published({ "SKILL.md": text }))
      );
      vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw").mockResolvedValue({
        ok: true,
        status: 200,
        // response.text() drops the BOM; the exact bytes keep it.
        content: "# bom skill\n",
        bytes: Buffer.from(text, "utf8"),
      });

      await install(outputPath);

      const written = await readFile(outputPath);
      expect(written.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      expect(written).toEqual(Buffer.from(text, "utf8"));
    });

    it("verifies in a dry run without writing anything", async () => {
      const { tempDir } = await createKeypairFile();
      const outputPath = path.join(tempDir, "SKILL.md");
      const record = published({ "SKILL.md": "# dry run\n" });
      vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue(
        freeSkill(record)
      );
      vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw").mockResolvedValue({
        ok: true,
        status: 200,
        content: "# dry run\n",
      });

      const result = await install(outputPath, { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.treeHash).toBe(record.tree_hash);
      expect(await exists(outputPath)).toBe(false);
    });
  });
});
