import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

import {
  baseUsdcMicros,
  computeListingId,
  formatBaseUsdc,
  skillIdHashFrom,
} from "@/lib/adapters/baseWallet";
import { BASE_USDC_DECIMALS } from "@/lib/adapters/baseWalletConfig";

describe("Base wallet USDC helpers", () => {
  it("uses Circle USDC 6-decimal micros", () => {
    expect(BASE_USDC_DECIMALS).toBe(6);
    expect(baseUsdcMicros("1.23")).toBe(1_230_000n);
    expect(formatBaseUsdc(1_230_000n)).toBe("1.23");
  });
});

describe("Base wallet listing ids", () => {
  it("matches the AgentVouchEvm skillIdHash/listingId derivation", () => {
    const author = getAddress("0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854");
    const skillIdHash = skillIdHashFrom("phase-5-smoke");

    expect(skillIdHash).toBe(
      "0xa3c9880642c1aa4475cb46a9ecc6ec45fd931c8615615ed3f37dda22e1461bf8"
    );
    expect(computeListingId(author, skillIdHash)).toBe(
      "0x9a06da52dc8297f03a7dd570a72bcffaefea565f98d4c09fec9451410dc49cda"
    );
  });
});
