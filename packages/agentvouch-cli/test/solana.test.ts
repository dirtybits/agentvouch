import { Keypair } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentVouchSolanaClient } from "../src/lib/solana.js";

function setMockProgram(
  client: AgentVouchSolanaClient,
  methods: Record<string, (...args: unknown[]) => unknown>
) {
  Object.defineProperty(client, "program", {
    value: { methods },
    configurable: true,
  });
}

describe("AgentVouchSolanaClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts publish USDC micros through a live BN path", async () => {
    const client = new AgentVouchSolanaClient(
      Keypair.generate(),
      "https://api.devnet.solana.com"
    );
    const rpc = vi.fn().mockResolvedValue("mock-tx");
    const signers = vi.fn().mockReturnValue({ rpc });
    const accounts = vi.fn().mockReturnValue({ signers });
    const createSkillListing = vi.fn().mockReturnValue({ accounts });

    vi.spyOn(client, "accountExists").mockResolvedValue(false);
    setMockProgram(client, { createSkillListing });

    await client.createSkillListing({
      skillId: "calendar-agent",
      skillUri: "https://agentvouch.xyz/api/skills/test/raw",
      name: "Calendar Agent",
      description: "Books meetings",
      priceUsdcMicros: 10_000,
    });

    expect(createSkillListing).toHaveBeenCalledTimes(1);
    expect(createSkillListing.mock.calls[0]?.[4]?.toString()).toBe("10000");
  });

  it("rejects unsupported paid listing prices before sending", async () => {
    const client = new AgentVouchSolanaClient(
      Keypair.generate(),
      "https://api.devnet.solana.com"
    );
    const createSkillListing = vi.fn();

    setMockProgram(client, { createSkillListing });

    await expect(
      client.createSkillListing({
        skillId: "calendar-agent",
        skillUri: "https://agentvouch.xyz/api/skills/test/raw",
        name: "Calendar Agent",
        description: "Books meetings",
        priceUsdcMicros: 1,
      })
    ).rejects.toThrow(
      "priceUsdcMicros must be 0 or at least 10000 micro-USDC."
    );
    expect(createSkillListing).not.toHaveBeenCalled();
  });

  it("converts vouch USDC micros through the same BN path", async () => {
    const client = new AgentVouchSolanaClient(
      Keypair.generate(),
      "https://api.devnet.solana.com"
    );
    const rpc = vi.fn().mockResolvedValue("mock-vouch-tx");
    const signers = vi.fn().mockReturnValue({ rpc });
    const accounts = vi.fn().mockReturnValue({ signers });
    const vouch = vi.fn().mockReturnValue({ accounts });

    vi.spyOn(client, "accountExists").mockResolvedValue(false);
    setMockProgram(client, { vouch });

    const result = await client.vouch(
      Keypair.generate().publicKey.toBase58(),
      1_000_000
    );

    expect(vouch).toHaveBeenCalledTimes(1);
    expect(vouch.mock.calls[0]?.[0]?.toString()).toBe("1000000");
    expect(result.stakeUsdcMicros).toBe(1000000);
  });
});
