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
    expect(body.capabilities.repo_x402_usdc).toBe(false);
    expect(body.capabilities.repo_x402_usdc_legacy_entitlements).toBe(true);
    expect(body.capabilities.protocol_listed_purchase_flow).toBe(
      "direct-purchase-skill"
    );
    expect(body.capabilities.protocol_listed_message).toContain(
      "New repo-only x402 purchases are disabled"
    );
    expect(body.bridge.status).toBe("disabled");
    expect(body.program.instructions).toEqual(["purchaseSkill"]);
  });

  it("reports bridge enabled only when the explicit feature flag is set", async () => {
    process.env.AGENTVOUCH_X402_PROTOCOL_BRIDGE_ENABLED = "true";

    const res = await GET();
    const body = await res.json();

    expect(body.capabilities.protocol_listed_x402_bridge).toBe(true);
    expect(body.bridge.status).toBe("enabled");
    expect(body.program.instructions).toEqual([
      "purchaseSkill",
      "settleX402Purchase",
    ]);
  });
});
