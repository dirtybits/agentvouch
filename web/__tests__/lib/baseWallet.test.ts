import { describe, expect, it } from "vitest";
import { decodeErrorResult, getAddress, parseAbi } from "viem";

import { AGENTVOUCH_EVM_READ_ABI } from "@/lib/adapters/agentVouchEvmAbi";
import { buildBaseAgentMetadataUri } from "@/lib/adapters/baseAgentMetadata";
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

describe("Base wallet registration metadata", () => {
  it("builds a non-empty chain-qualified author metadata URI", () => {
    const author = getAddress("0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854");
    const uri = buildBaseAgentMetadataUri(author);

    expect(uri).toContain(`/api/author/${author}`);
    expect(uri).toContain("chainContext=eip155%3A84532");
    expect(uri).not.toBe("");
  });
});

describe("AgentVouchEvm custom errors", () => {
  it("decodes EmptyMetadata reverts from Base writes", () => {
    const decoded = decodeErrorResult({
      abi: parseAbi([...AGENTVOUCH_EVM_READ_ABI]),
      data: "0xae921357",
    });

    expect(decoded.errorName).toBe("EmptyMetadata");
  });
});
