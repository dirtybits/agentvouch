import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/x402/supported/route";

describe("GET /api/x402/supported", () => {
  beforeEach(() => {
    delete process.env.AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED;
  });

  it("does not advertise legacy SOL or protocol-listed x402 by default", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.assets.map((asset: { symbol: string }) => asset.symbol)).toEqual([
      "USDC",
    ]);
    expect(body.capabilities.protocol_listed_x402_bridge).toBe(false);
    expect(body.capabilities.protocol_listed_purchase_flow).toBe(
      "direct-purchase-skill"
    );
    expect(body.bridge.status).toBe("disabled");
  });

  it("reports bridge enabled only when the explicit feature flag is set", async () => {
    process.env.AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED = "true";

    const res = await GET();
    const body = await res.json();

    expect(body.capabilities.protocol_listed_x402_bridge).toBe(true);
    expect(body.bridge.status).toBe("enabled");
  });
});
