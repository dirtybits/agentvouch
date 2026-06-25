import { describe, expect, it } from "vitest";

import { getAdapter } from "@/lib/adapters";
import { BaseAdapter } from "@/lib/adapters/base";
import { SolanaAdapter } from "@/lib/adapters/solana";
import {
  BASE_CHAIN_CONTEXT,
  BASE_SEPOLIA_CHAIN_CONTEXT,
  SOLANA_DEVNET_CHAIN_CONTEXT,
} from "@/lib/chains";

// Deterministic (no-network) coverage for the BaseAdapter read slice: registry routing + the pure
// identity/formatting helpers. The live getListing read is exercised separately against the
// contract (see the Phase 3a verification in the plan), since it requires network access.

describe("getAdapter routing", () => {
  it("routes Base Sepolia (eip155:84532) to BaseAdapter", () => {
    const adapter = getAdapter(BASE_SEPOLIA_CHAIN_CONTEXT);
    expect(adapter).toBeInstanceOf(BaseAdapter);
    expect(adapter.chainContext).toBe(BASE_SEPOLIA_CHAIN_CONTEXT);
  });

  it("routes Base mainnet (eip155:8453) to BaseAdapter", () => {
    expect(getAdapter(BASE_CHAIN_CONTEXT)).toBeInstanceOf(BaseAdapter);
  });

  it("routes Solana contexts to SolanaAdapter", () => {
    expect(getAdapter(SOLANA_DEVNET_CHAIN_CONTEXT)).toBeInstanceOf(
      SolanaAdapter
    );
  });
});

describe("BaseAdapter identity / formatting", () => {
  const adapter = new BaseAdapter(BASE_SEPOLIA_CHAIN_CONTEXT);
  const addr = "0x6Fd9E7Fd459eE5D7503d9D549e75596A2c4FD854";

  it("validates EVM addresses and rejects non-EVM", () => {
    expect(adapter.isValidAddress(addr)).toBe(true);
    expect(adapter.isValidAddress("0x123")).toBe(false);
    expect(adapter.isValidAddress("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toBe(
      false
    );
  });

  it('shortens addresses as "0x1234...5678"', () => {
    expect(adapter.shortenAddress(addr)).toBe("0x6Fd9...D854");
    expect(adapter.shortenAddress("0xabc")).toBe("0xabc");
  });

  it("builds Base Sepolia explorer URLs for eip155:84532", () => {
    expect(adapter.explorerTxUrl("0xtx")).toBe(
      "https://sepolia.basescan.org/tx/0xtx"
    );
    expect(adapter.explorerAddressUrl(addr)).toBe(
      `https://sepolia.basescan.org/address/${addr}`
    );
  });

  it("builds Base mainnet explorer URLs for eip155:8453", () => {
    const mainnet = new BaseAdapter(BASE_CHAIN_CONTEXT);
    expect(mainnet.explorerTxUrl("0xtx")).toBe("https://basescan.org/tx/0xtx");
  });
});
