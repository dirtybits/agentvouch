import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentVouchApiClient } from "../src/lib/http.js";
import { writeInstalledSkillMetadata } from "../src/lib/metadata.js";
import { AgentVouchSolanaClient } from "../src/lib/solana.js";
import { updateSkill } from "../src/lib/update.js";

async function createKeypairFile() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentvouch-cli-"));
  const keypair = Keypair.generate();
  const keypairPath = path.join(tempDir, "id.json");
  await writeFile(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
  return { tempDir, keypairPath, keypair };
}

describe("updateSkill", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns noop when the installed version is current", async () => {
    const { tempDir } = await createKeypairFile();
    const outputPath = path.join(tempDir, "SKILL.md");
    await writeFile(outputPath, "# skill\n", "utf8");
    await writeInstalledSkillMetadata(outputPath, {
      schema_version: 1,
      installed_with: "agentvouch-cli",
      skill_id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      source: "repo",
      installed_version: 2,
      on_chain_address: "ListingAddr1",
      skill_slug: "calendar-agent",
      author_pubkey: Keypair.generate().publicKey.toBase58(),
      price_lamports: 0,
      installed_at: new Date().toISOString(),
    });

    const checkSpy = vi
      .spyOn(AgentVouchApiClient.prototype, "checkSkillUpdate")
      .mockResolvedValue({
        id: "595f5534-07ae-4839-a45a-b6858ab731fe",
        skill_slug: "calendar-agent",
        source: "repo",
        status: "up_to_date",
        installed_version: 2,
        latest_version: 2,
        latest_updated_at: new Date().toISOString(),
        on_chain_address: "ListingAddr1",
        price_lamports: 0,
        requires_purchase: false,
        listing_changed: false,
      });
    const downloadSpy = vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw");

    const result = await updateSkill({
      file: outputPath,
      baseUrl: "https://agentvouch.xyz",
      rpcUrl: "https://api.devnet.solana.com",
    });

    expect(result.action).toBe("noop");
    expect(checkSpy).toHaveBeenCalledWith(
      "595f5534-07ae-4839-a45a-b6858ab731fe",
      expect.objectContaining({
        installedVersion: 2,
        listing: "ListingAddr1",
      })
    );
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("updates free skills and rewrites install metadata", async () => {
    const { tempDir } = await createKeypairFile();
    const outputPath = path.join(tempDir, "SKILL.md");
    await writeFile(outputPath, "# old\n", "utf8");
    await writeInstalledSkillMetadata(outputPath, {
      schema_version: 1,
      installed_with: "agentvouch-cli",
      skill_id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      source: "repo",
      installed_version: 1,
      on_chain_address: null,
      skill_slug: "calendar-agent",
      author_pubkey: Keypair.generate().publicKey.toBase58(),
      price_lamports: 0,
      installed_at: new Date().toISOString(),
    });

    vi.spyOn(AgentVouchApiClient.prototype, "checkSkillUpdate").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_slug: "calendar-agent",
      source: "repo",
      status: "update_available",
      installed_version: 1,
      latest_version: 2,
      latest_updated_at: new Date().toISOString(),
      on_chain_address: null,
      price_lamports: 0,
      requires_purchase: false,
      listing_changed: false,
    });
    vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_id: "calendar-agent",
      author_pubkey: Keypair.generate().publicKey.toBase58(),
      name: "Calendar Agent",
      description: "Free skill",
      current_version: 2,
      on_chain_address: null,
      total_installs: 0,
      price_lamports: 0,
    });
    vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw").mockResolvedValue({
      ok: true,
      status: 200,
      content: "# updated\n",
    });

    const result = await updateSkill({
      file: outputPath,
      baseUrl: "https://agentvouch.xyz",
      rpcUrl: "https://api.devnet.solana.com",
    });

    expect(result.action).toBe("update");
    expect(result.mode).toBe("free-raw");
    expect(await readFile(outputPath, "utf8")).toBe("# updated\n");
    const metadata = JSON.parse(
      await readFile(`${outputPath}.agentvouch.json`, "utf8")
    );
    expect(metadata.installed_version).toBe(2);
  });

  it("updates paid skills when the listing is already purchased", async () => {
    const { tempDir, keypairPath } = await createKeypairFile();
    const outputPath = path.join(tempDir, "SKILL.md");
    await writeFile(outputPath, "# old paid\n", "utf8");
    await writeInstalledSkillMetadata(outputPath, {
      schema_version: 1,
      installed_with: "agentvouch-cli",
      skill_id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      source: "repo",
      installed_version: 1,
      on_chain_address: "ListingAddr1",
      skill_slug: "calendar-agent",
      author_pubkey: Keypair.generate().publicKey.toBase58(),
      price_lamports: 1_000_000,
      installed_at: new Date().toISOString(),
    });

    vi.spyOn(AgentVouchApiClient.prototype, "checkSkillUpdate").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_slug: "calendar-agent",
      source: "repo",
      status: "update_available",
      installed_version: 1,
      latest_version: 2,
      latest_updated_at: new Date().toISOString(),
      on_chain_address: "ListingAddr1",
      price_lamports: 1_000_000,
      requires_purchase: true,
      listing_changed: false,
    });
    vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_id: "calendar-agent",
      author_pubkey: Keypair.generate().publicKey.toBase58(),
      name: "Calendar Agent",
      description: "Paid skill",
      current_version: 2,
      on_chain_address: "ListingAddr1",
      total_installs: 0,
      price_lamports: 1_000_000,
    });
    vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw")
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        error: "Payment required",
        requirement: {
          scheme: "exact",
          network: "solana",
          programId: "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg",
          instruction: "purchaseSkill",
          skillListingAddress: "ListingAddr1",
          mint: "So11111111111111111111111111111111111111112",
          amount: 1_000_000,
          resource: "abc123",
          expiry: Math.floor(Date.now() / 1000) + 300,
          nonce: "nonce",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        content: "# paid updated\n",
      });
    const purchaseSpy = vi
      .spyOn(AgentVouchSolanaClient.prototype, "purchaseSkill")
      .mockResolvedValue({
        tx: undefined,
        alreadyPurchased: true,
        purchase: "purchase-pda",
      });

    const result = await updateSkill({
      file: outputPath,
      keypairPath,
      baseUrl: "https://agentvouch.xyz",
      rpcUrl: "https://api.devnet.solana.com",
    });

    expect(result.action).toBe("update");
    expect(result.mode).toBe("paid-raw");
    expect(purchaseSpy).toHaveBeenCalledTimes(1);
    expect(result.purchaseTx).toBeUndefined();
  });

  it("updates paid skills and reports a purchase transaction when needed", async () => {
    const { tempDir, keypairPath } = await createKeypairFile();
    const outputPath = path.join(tempDir, "SKILL.md");
    await writeFile(outputPath, "# old paid\n", "utf8");
    await writeInstalledSkillMetadata(outputPath, {
      schema_version: 1,
      installed_with: "agentvouch-cli",
      skill_id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      source: "repo",
      installed_version: 1,
      on_chain_address: "ListingAddr1",
      skill_slug: "calendar-agent",
      author_pubkey: Keypair.generate().publicKey.toBase58(),
      price_lamports: 1_000_000,
      installed_at: new Date().toISOString(),
    });

    vi.spyOn(AgentVouchApiClient.prototype, "checkSkillUpdate").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_slug: "calendar-agent",
      source: "repo",
      status: "update_available",
      installed_version: 1,
      latest_version: 3,
      latest_updated_at: new Date().toISOString(),
      on_chain_address: "ListingAddr1",
      price_lamports: 1_000_000,
      requires_purchase: true,
      listing_changed: false,
    });
    vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_id: "calendar-agent",
      author_pubkey: Keypair.generate().publicKey.toBase58(),
      name: "Calendar Agent",
      description: "Paid skill",
      current_version: 3,
      on_chain_address: "ListingAddr1",
      total_installs: 0,
      price_lamports: 1_000_000,
    });
    vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw")
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        error: "Payment required",
        requirement: {
          scheme: "exact",
          network: "solana",
          programId: "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg",
          instruction: "purchaseSkill",
          skillListingAddress: "ListingAddr1",
          mint: "So11111111111111111111111111111111111111112",
          amount: 1_000_000,
          resource: "abc123",
          expiry: Math.floor(Date.now() / 1000) + 300,
          nonce: "nonce",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        content: "# paid updated\n",
      });
    vi.spyOn(AgentVouchSolanaClient.prototype, "purchaseSkill").mockResolvedValue({
      tx: "purchase-tx-1",
      alreadyPurchased: false,
      purchase: "purchase-pda",
    });
    vi.spyOn(
      AgentVouchApiClient.prototype,
      "verifyDirectPurchase"
    ).mockResolvedValue();

    const result = await updateSkill({
      file: outputPath,
      keypairPath,
      baseUrl: "https://agentvouch.xyz",
      rpcUrl: "https://api.devnet.solana.com",
    });

    expect(result.action).toBe("update");
    expect(result.purchaseTx).toBe("purchase-tx-1");
  });

  it("adopts a legacy install when --id is provided", async () => {
    const { tempDir } = await createKeypairFile();
    const outputPath = path.join(tempDir, "SKILL.md");
    await writeFile(outputPath, "# legacy\n", "utf8");

    vi.spyOn(AgentVouchApiClient.prototype, "checkSkillUpdate").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_slug: "calendar-agent",
      source: "repo",
      status: "unknown_installed_version",
      installed_version: null,
      latest_version: 4,
      latest_updated_at: new Date().toISOString(),
      on_chain_address: null,
      price_lamports: 0,
      requires_purchase: false,
      listing_changed: false,
    });
    vi.spyOn(AgentVouchApiClient.prototype, "getSkill").mockResolvedValue({
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      skill_id: "calendar-agent",
      author_pubkey: Keypair.generate().publicKey.toBase58(),
      name: "Calendar Agent",
      description: "Free skill",
      current_version: 4,
      on_chain_address: null,
      total_installs: 0,
      price_lamports: 0,
    });
    vi.spyOn(AgentVouchApiClient.prototype, "downloadRaw").mockResolvedValue({
      ok: true,
      status: 200,
      content: "# adopted\n",
    });

    const result = await updateSkill({
      file: outputPath,
      id: "595f5534-07ae-4839-a45a-b6858ab731fe",
      baseUrl: "https://agentvouch.xyz",
      rpcUrl: "https://api.devnet.solana.com",
    });

    expect(result.action).toBe("adopt");
    const metadata = JSON.parse(
      await readFile(`${outputPath}.agentvouch.json`, "utf8")
    );
    expect(metadata.skill_id).toBe("595f5534-07ae-4839-a45a-b6858ab731fe");
    expect(metadata.installed_version).toBe(4);
  });
});
