import { describe, expect, it } from "vitest";
import { getChainBadge, isEvmListedSkill } from "@/lib/chainBadge";
import {
  BASE_SEPOLIA_CHAIN_CONTEXT,
  SOLANA_DEVNET_CHAIN_CONTEXT,
} from "@/lib/chains";

describe("getChainBadge", () => {
  it("does not describe repository skills as network listings", () => {
    expect(
      getChainBadge({
        chainContext: SOLANA_DEVNET_CHAIN_CONTEXT,
        onChainAddress: null,
        evmListingId: null,
      })
    ).toBeNull();
  });

  it("uses Solana purple for a listed skill with a legacy Solana alias", () => {
    expect(
      getChainBadge({
        chainContext: "solana:devnet",
        onChainAddress: "6g6v9yGCBtCF9dXJ5B9BimqURjuC8dczRZ5nko9LgtJe",
        evmListingId: null,
      })
    ).toEqual({
      chainContext: SOLANA_DEVNET_CHAIN_CONTEXT,
      label: "Solana Devnet",
      tone: "solana",
    });
  });

  it("uses Base blue for a listed skill with a legacy Base alias", () => {
    expect(
      getChainBadge({
        chainContext: "base-sepolia",
        onChainAddress: null,
        evmListingId:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
      })
    ).toEqual({
      chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
      label: "Base Sepolia",
      tone: "base",
    });
  });

  it("keeps listed EVM chains outside the local alias table visible and read-only", () => {
    const input = {
      chainContext: "eip155:10",
      onChainAddress: null,
      evmListingId:
        "0x0000000000000000000000000000000000000000000000000000000000000002",
    };

    expect(getChainBadge(input)).toEqual({
      chainContext: "eip155:10",
      label: "eip155:10",
      tone: "default",
    });
    expect(isEvmListedSkill(input)).toBe(true);
  });

  it("does not treat malformed EVM-like contexts as listed EVM skills", () => {
    const input = {
      chainContext: "eip155:not-a-chain-id",
      onChainAddress: null,
      evmListingId:
        "0x0000000000000000000000000000000000000000000000000000000000000003",
    };

    expect(getChainBadge(input)).toBeNull();
    expect(isEvmListedSkill(input)).toBe(false);
  });
});
