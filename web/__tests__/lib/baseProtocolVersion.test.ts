import { describe, expect, it, vi } from "vitest";
import { fetchBaseAgentVouchProtocolVersion } from "@/lib/baseProtocolVersion";

describe("fetchBaseAgentVouchProtocolVersion", () => {
  it("reads the live Base contract protocol version", async () => {
    const client = {
      getChainId: vi.fn().mockResolvedValue(84532),
      readContract: vi.fn().mockResolvedValue("base-v1-candidate"),
    };

    await expect(
      fetchBaseAgentVouchProtocolVersion({
        contract: "0x5992dD52Ee2015f558D0A690777C55e27b05B7d1",
        client,
      })
    ).resolves.toBe("base-v1-candidate");
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "0x5992dD52Ee2015f558D0A690777C55e27b05B7d1",
        functionName: "PROTOCOL_VERSION",
      })
    );
  });

  it("fails closed on the wrong chain", async () => {
    const client = {
      getChainId: vi.fn().mockResolvedValue(8453),
      readContract: vi.fn(),
    };

    await expect(
      fetchBaseAgentVouchProtocolVersion({
        contract: "0x5992dD52Ee2015f558D0A690777C55e27b05B7d1",
        client,
      })
    ).rejects.toThrow(/chain id 84532/i);
    expect(client.readContract).not.toHaveBeenCalled();
  });
});
