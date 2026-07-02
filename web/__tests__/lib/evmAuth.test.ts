import { describe, expect, it, vi } from "vitest";
import { verifyEvmWalletSignature } from "@/lib/evmAuth";

const EVM_ADDRESS = "0x52908400098527886E0F7030069857D2E4169EE7";
const HEX_SIGNATURE = "0xdeadbeef";

function payload(
  overrides: Partial<Parameters<typeof verifyEvmWalletSignature>[0]> = {}
) {
  return {
    pubkey: EVM_ADDRESS,
    signature: HEX_SIGNATURE,
    message: "AgentVouch Skill Repo\nAction: publish-skill\nTimestamp: 1",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("verifyEvmWalletSignature", () => {
  it("accepts a verified signature and lowercases the address for storage", async () => {
    const client = { verifyMessage: vi.fn().mockResolvedValue(true) };
    const result = await verifyEvmWalletSignature(payload(), { client });
    expect(result.valid).toBe(true);
    expect(result.pubkey).toBe(EVM_ADDRESS.toLowerCase());
    expect(client.verifyMessage).toHaveBeenCalledWith(
      expect.objectContaining({ address: EVM_ADDRESS })
    );
  });

  it("rejects a failed verification", async () => {
    const client = { verifyMessage: vi.fn().mockResolvedValue(false) };
    const result = await verifyEvmWalletSignature(payload(), { client });
    expect(result.valid).toBe(false);
    expect(result.pubkey).toBeNull();
  });

  it("rejects expired payloads without calling the RPC", async () => {
    const client = { verifyMessage: vi.fn() };
    const result = await verifyEvmWalletSignature(
      payload({ timestamp: Date.now() - 10 * 60_000 }),
      { client }
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Signature expired");
    expect(client.verifyMessage).not.toHaveBeenCalled();
  });

  it("rejects non-EVM addresses and non-hex signatures", async () => {
    const client = { verifyMessage: vi.fn() };
    const badAddress = await verifyEvmWalletSignature(
      payload({ pubkey: "not-an-address" }),
      { client }
    );
    expect(badAddress.valid).toBe(false);

    const badSignature = await verifyEvmWalletSignature(
      payload({ signature: "AAAA" }),
      { client }
    );
    expect(badSignature.valid).toBe(false);
    expect(client.verifyMessage).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC verification throws", async () => {
    const client = {
      verifyMessage: vi.fn().mockRejectedValue(new Error("rpc down")),
    };
    const result = await verifyEvmWalletSignature(payload(), { client });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("rpc down");
  });
});
