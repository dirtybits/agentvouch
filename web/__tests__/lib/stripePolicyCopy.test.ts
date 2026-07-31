import { describe, expect, it } from "vitest";

import {
  CARD_CHECKOUT_RECOURSE_DISCLOSURE,
  CARD_CHECKOUT_RECOURSE_DISCLOSURE_VERSION,
} from "@/lib/stripePolicyCopy";

describe("Stripe policy copy", () => {
  it("states every material limitation before card checkout", () => {
    expect(CARD_CHECKOUT_RECOURSE_DISCLOSURE_VERSION).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
    expect(CARD_CHECKOUT_RECOURSE_DISCLOSURE).toContain("off-chain access");
    expect(CARD_CHECKOUT_RECOURSE_DISCLOSURE).toContain(
      "no AgentVouch protocol buyer recourse"
    );
    expect(CARD_CHECKOUT_RECOURSE_DISCLOSURE).toContain("no protocol receipt");
    expect(CARD_CHECKOUT_RECOURSE_DISCLOSURE).toContain(
      "protocol author proceeds"
    );
    expect(CARD_CHECKOUT_RECOURSE_DISCLOSURE).toContain("voucher rewards");
    expect(CARD_CHECKOUT_RECOURSE_DISCLOSURE).toContain("paid Report");
    expect(CARD_CHECKOUT_RECOURSE_DISCLOSURE).toContain("voucher slashing");
    expect(CARD_CHECKOUT_RECOURSE_DISCLOSURE).toContain("buyer credit");
    expect(CARD_CHECKOUT_RECOURSE_DISCLOSURE).toContain(
      "handled off-chain by the marketplace operator"
    );
  });
});
