import { describe, expect, it } from "vitest";
import { decodeErrorResult, getAddress, parseAbi } from "viem";
import { readFileSync } from "fs";
import { join } from "path";

import { AGENTVOUCH_EVM_READ_ABI } from "@/lib/adapters/agentVouchEvmAbi";
import { buildBaseAgentMetadataUri } from "@/lib/adapters/baseAgentMetadata";
import {
  baseUsdcMicros,
  computeListingId,
  formatBaseUsdc,
  isBaseDuplicatePurchaseError,
  isBaseReceiptPendingError,
  planBasePurchaseApprovals,
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

describe("Base wallet transaction receipt polling", () => {
  it("recognizes viem receipt-not-found races as pending confirmations", () => {
    expect(
      isBaseReceiptPendingError(
        new Error(
          'Transaction receipt with hash "0x1f6a3de5212bb0abfd3fc47fa7107380315a2930db9142a6e96cdfb68415a8fc" could not be found. The Transaction may not be processed on a block yet. Version: viem@2.47.6'
        )
      )
    ).toBe(true);
  });

  it("does not classify ordinary contract reverts as pending confirmations", () => {
    expect(isBaseReceiptPendingError(new Error("AlreadyPurchased()"))).toBe(
      false
    );
  });

  it("recognizes DuplicatePurchase reverts as already-owned purchases", () => {
    expect(
      isBaseDuplicatePurchaseError(
        new Error(
          'The contract function "purchaseSkill" reverted. Error: DuplicatePurchase()'
        )
      )
    ).toBe(true);
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

describe("AgentVouchEvm Base v1 trust ABI", () => {
  it("includes the config getter needed to read the live report bond", () => {
    const abi = parseAbi([...AGENTVOUCH_EVM_READ_ABI]);
    const config = abi.find(
      (entry) => entry.type === "function" && entry.name === "getConfig"
    );

    expect(config).toBeTruthy();
    expect(config?.type).toBe("function");
    if (config?.type !== "function") throw new Error("getConfig ABI missing");
    const configTuple = config.outputs[0] as
      | { type: string; components?: { name?: string }[] }
      | undefined;
    expect(configTuple?.type).toBe("tuple");
    expect(
      configTuple?.components?.some(
        (output: { name?: string }) => output.name === "disputeBondUsdcMicros"
      )
    ).toBe(true);
  });

  it("matches the deployed contract getter name, not the internal storage name", () => {
    expect(AGENTVOUCH_EVM_READ_ABI).toEqual(
      expect.arrayContaining([expect.stringContaining("function getConfig()")])
    );
    expect(AGENTVOUCH_EVM_READ_ABI).not.toEqual(
      expect.arrayContaining([expect.stringContaining("function config()")])
    );
  });
});

describe("Base wallet approval planning", () => {
  it("does not approve when allowance already exactly matches price", () => {
    expect(
      planBasePurchaseApprovals({
        allowance: 1_000_000n,
        expectedPriceUsdcMicros: 1_000_000n,
      })
    ).toEqual({ resetAllowance: false, approvePrice: false });
  });

  it("resets stale non-zero allowance before approving the exact price", () => {
    expect(
      planBasePurchaseApprovals({
        allowance: 500_000n,
        expectedPriceUsdcMicros: 1_000_000n,
      })
    ).toEqual({ resetAllowance: true, approvePrice: true });
  });

  it("approves the exact price from zero allowance", () => {
    expect(
      planBasePurchaseApprovals({
        allowance: 0n,
        expectedPriceUsdcMicros: 1_000_000n,
      })
    ).toEqual({ resetAllowance: false, approvePrice: true });
  });
});

describe("Base passkey trust-write seam", () => {
  it("routes Base trust writes through the ChainWallet implementation", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/adapters/baseWallet.ts"),
      "utf8"
    );

    for (const marker of [
      "depositBaseAuthorBond",
      "withdrawBaseAuthorBond",
      "vouchForBaseAuthor",
      "revokeBaseVouch",
      "openBaseAuthorReport",
      "claimBaseVoucherRevenue",
      "withdrawBaseAuthorProceeds",
      "updateBaseSkillListing",
      "removeBaseSkillListing",
    ]) {
      expect(source).toContain(marker);
    }
    expect(source).toContain("buildExactUsdcApprovalCalls");
    expect(source).toContain("ensureBaseAgentRegistered");
    expect(source).toContain("agentvouch://base-passkey/");
    expect(source).not.toContain('functionName: "openReport"');
    expect(source).toContain('functionName: "vouch"');
    expect(source).toContain('functionName: "updateSkillListing"');
    expect(source).toContain('"SkillListingUpdated"');
    expect(source).toContain('functionName: "removeSkillListing"');
    expect(source).toContain('"SkillListingRemoved"');
    expect(source).not.toContain("OPEN_REPORT_SELECTOR");
    expect(source).toContain(
      "General Base author reports were removed in base-v1-a1."
    );
    expect(source).toContain(
      "throw new Error(BASE_AUTHOR_REPORTS_UNAVAILABLE_MESSAGE)"
    );
    expect(source).toContain("sequentialApproval?: boolean");
    expect(source).toContain("if (input.sequentialApproval)");
    expect(source).not.toContain("sequentialApproval: true");
  });
});

describe("Base listing update seam", () => {
  it("keeps updateSkillListing in the ChainWallet interface and honest stubs", () => {
    const types = readFileSync(
      join(process.cwd(), "lib/adapters/types.ts"),
      "utf8"
    );
    const baseInjected = readFileSync(
      join(process.cwd(), "lib/adapters/baseInjectedWallet.ts"),
      "utf8"
    );
    const solana = readFileSync(
      join(process.cwd(), "lib/adapters/solanaWallet.ts"),
      "utf8"
    );

    expect(types).toContain("UpdateSkillListingInput");
    expect(types).toContain(
      "updateSkillListing(input: UpdateSkillListingInput)"
    );
    expect(baseInjected).toContain(
      "MetaMask listing updates are not enabled yet"
    );
    expect(solana).toContain("Solana listing updates are still routed through");
  });
});

describe("Base listing remove seam", () => {
  it("keeps removeSkillListing in the ChainWallet interface and honest stubs", () => {
    const types = readFileSync(
      join(process.cwd(), "lib/adapters/types.ts"),
      "utf8"
    );
    const baseInjected = readFileSync(
      join(process.cwd(), "lib/adapters/baseInjectedWallet.ts"),
      "utf8"
    );
    const solana = readFileSync(
      join(process.cwd(), "lib/adapters/solanaWallet.ts"),
      "utf8"
    );

    expect(types).toContain("removeSkillListing(input: { listingId: string })");
    expect(baseInjected).toContain(
      "MetaMask listing removal is not enabled yet"
    );
    expect(solana).toContain("Solana listing removal is still routed through");
  });
});
