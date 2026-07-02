import { describe, expect, it } from "vitest";
import {
  chainExplorerAddressUrl,
  chainExplorerTxUrl,
  formatChainAddressForDisplay,
  isEvmShapedAddress,
  isValidChainAddress,
  normalizeChainAddressForStorage,
  shortenChainAddress,
} from "@/lib/chainAddress";
import {
  BASE_SEPOLIA_CHAIN_CONTEXT,
  BASE_CHAIN_CONTEXT,
  getConfiguredSolanaChainContext,
} from "@/lib/chains";

// Real values: the deployed Base Sepolia AgentVouchEvm contract (checksummed) and the Solana
// AgentVouch program id (valid base58 with mixed case).
const EVM_CHECKSUMMED = "0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854";
const EVM_LOWER = EVM_CHECKSUMMED.toLowerCase();
const SOLANA_ADDRESS = "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg";
const EVM_LISTING_ID_BYTES32 = `0x${"ab".repeat(32)}`;

const solanaCtx = getConfiguredSolanaChainContext();

describe("isValidChainAddress", () => {
  it("validates a Base Sepolia EVM address under eip155:84532", () => {
    expect(
      isValidChainAddress({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        value: EVM_CHECKSUMMED,
      })
    ).toBe(true);
    expect(
      isValidChainAddress({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        value: EVM_LOWER,
      })
    ).toBe(true);
  });

  it("validates a Solana address under the configured Solana context", () => {
    expect(
      isValidChainAddress({ chainContext: solanaCtx, value: SOLANA_ADDRESS })
    ).toBe(true);
  });

  it("accepts legacy chain-context aliases", () => {
    expect(
      isValidChainAddress({
        chainContext: "base-sepolia",
        value: EVM_CHECKSUMMED,
      })
    ).toBe(true);
    expect(
      isValidChainAddress({
        chainContext: "solana:devnet",
        value: SOLANA_ADDRESS,
      })
    ).toBe(true);
  });

  it("rejects cross-family, garbage, bytes32, and missing-context values", () => {
    // An EVM address is not a valid Solana address and vice versa.
    expect(
      isValidChainAddress({ chainContext: solanaCtx, value: EVM_CHECKSUMMED })
    ).toBe(false);
    expect(
      isValidChainAddress({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        value: SOLANA_ADDRESS,
      })
    ).toBe(false);
    // EVM listing ids are bytes32, not addresses.
    expect(
      isValidChainAddress({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        value: EVM_LISTING_ID_BYTES32,
      })
    ).toBe(false);
    expect(
      isValidChainAddress({ chainContext: null, value: EVM_CHECKSUMMED })
    ).toBe(false);
    expect(
      isValidChainAddress({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        value: "not-an-address",
      })
    ).toBe(false);
    expect(
      isValidChainAddress({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        value: "",
      })
    ).toBe(false);
  });
});

describe("normalizeChainAddressForStorage (Phase 6 invariant)", () => {
  it("lowercases EVM addresses for storage/lookup", () => {
    expect(
      normalizeChainAddressForStorage({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        value: EVM_CHECKSUMMED,
      })
    ).toBe(EVM_LOWER);
  });

  it("preserves Solana base58 case exactly", () => {
    expect(
      normalizeChainAddressForStorage({
        chainContext: solanaCtx,
        value: SOLANA_ADDRESS,
      })
    ).toBe(SOLANA_ADDRESS);
  });

  it("returns null for invalid values and unknown contexts", () => {
    expect(
      normalizeChainAddressForStorage({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        value: "0xnothex",
      })
    ).toBeNull();
    expect(
      normalizeChainAddressForStorage({
        chainContext: "unknown:chain",
        value: EVM_CHECKSUMMED,
      })
    ).toBeNull();
    expect(
      normalizeChainAddressForStorage({ chainContext: solanaCtx, value: null })
    ).toBeNull();
  });
});

describe("formatChainAddressForDisplay", () => {
  it("checksums EVM addresses for display", () => {
    expect(
      formatChainAddressForDisplay({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        value: EVM_LOWER,
      })
    ).toBe(EVM_CHECKSUMMED);
  });

  it("passes Solana addresses through unchanged", () => {
    expect(
      formatChainAddressForDisplay({
        chainContext: solanaCtx,
        value: SOLANA_ADDRESS,
      })
    ).toBe(SOLANA_ADDRESS);
  });

  it("returns null rather than throwing for invalid input", () => {
    expect(
      formatChainAddressForDisplay({ chainContext: solanaCtx, value: "!!!" })
    ).toBeNull();
    expect(
      formatChainAddressForDisplay({ chainContext: null, value: EVM_LOWER })
    ).toBeNull();
  });
});

describe("shortenChainAddress", () => {
  it("uses the adapter 6/4 format for both chains", () => {
    expect(
      shortenChainAddress({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        value: EVM_CHECKSUMMED,
      })
    ).toBe("0x6Fd9...D854");
    expect(
      shortenChainAddress({ chainContext: solanaCtx, value: SOLANA_ADDRESS })
    ).toBe("AGNtBj...yVdg");
  });

  it("falls back to generic 6/4 truncation when no adapter supports the chain", () => {
    // Base mainnet is intentionally unsupported until Phase 8b; display must degrade, not throw.
    expect(
      shortenChainAddress({
        chainContext: BASE_CHAIN_CONTEXT,
        value: EVM_CHECKSUMMED,
      })
    ).toBe("0x6Fd9...D854");
  });

  it("returns the fallback for missing values and short strings unchanged", () => {
    expect(
      shortenChainAddress(
        { chainContext: solanaCtx, value: null },
        { fallback: "Unknown" }
      )
    ).toBe("Unknown");
    expect(shortenChainAddress({ chainContext: solanaCtx, value: "" })).toBe(
      ""
    );
    expect(shortenChainAddress({ chainContext: null, value: "short" })).toBe(
      "short"
    );
  });
});

describe("explorer URLs", () => {
  it("Base explorer URLs use sepolia.basescan.org", () => {
    expect(
      chainExplorerAddressUrl({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        value: EVM_CHECKSUMMED,
      })
    ).toBe(`https://sepolia.basescan.org/address/${EVM_CHECKSUMMED}`);
    expect(
      chainExplorerTxUrl({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        tx: EVM_LISTING_ID_BYTES32,
      })
    ).toBe(`https://sepolia.basescan.org/tx/${EVM_LISTING_ID_BYTES32}`);
  });

  it("Solana explorer URLs point at explorer.solana.com for the configured cluster", () => {
    const url = chainExplorerAddressUrl({
      chainContext: solanaCtx,
      value: SOLANA_ADDRESS,
    });
    expect(url).toContain(
      `https://explorer.solana.com/address/${SOLANA_ADDRESS}`
    );
    const txUrl = chainExplorerTxUrl({ chainContext: solanaCtx, tx: "sig123" });
    expect(txUrl).toContain("https://explorer.solana.com/tx/sig123");
  });

  it("returns null for non-address values, unsupported chains, and missing input", () => {
    // bytes32 EVM listing ids are not addresses and must not get an address link.
    expect(
      chainExplorerAddressUrl({
        chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        value: EVM_LISTING_ID_BYTES32,
      })
    ).toBeNull();
    expect(
      chainExplorerAddressUrl({
        chainContext: BASE_CHAIN_CONTEXT,
        value: EVM_CHECKSUMMED,
      })
    ).toBeNull();
    expect(chainExplorerTxUrl({ chainContext: null, tx: "sig" })).toBeNull();
    expect(
      chainExplorerTxUrl({ chainContext: solanaCtx, tx: null })
    ).toBeNull();
  });
});

describe("isEvmShapedAddress (named Phase 6 heuristic)", () => {
  it("classifies 0x-prefixed values as EVM-shaped", () => {
    expect(isEvmShapedAddress(EVM_LOWER)).toBe(true);
    expect(isEvmShapedAddress(EVM_LISTING_ID_BYTES32)).toBe(true);
  });

  it("rejects Solana-shaped and garbage values", () => {
    expect(isEvmShapedAddress(SOLANA_ADDRESS)).toBe(false);
    expect(isEvmShapedAddress("")).toBe(false);
    expect(isEvmShapedAddress(null)).toBe(false);
    expect(isEvmShapedAddress(undefined)).toBe(false);
  });
});
