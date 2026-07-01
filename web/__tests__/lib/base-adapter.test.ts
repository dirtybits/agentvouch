import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAdapter } from "@/lib/adapters";
import { BaseAdapter } from "@/lib/adapters/base";
import { SolanaAdapter } from "@/lib/adapters/solana";
import {
  BASE_CHAIN_CONTEXT,
  BASE_SEPOLIA_CHAIN_CONTEXT,
  ETHEREUM_MAINNET_CHAIN_CONTEXT,
  SOLANA_DEVNET_CHAIN_CONTEXT,
  SOLANA_MAINNET_CHAIN_CONTEXT,
} from "@/lib/chains";

// Deterministic (no-network) coverage for the BaseAdapter read slice: registry routing + the pure
// identity/formatting helpers. The live getListing read is exercised separately against the
// contract (see the Phase 3a verification in the plan), since it requires network access.

const ORIGINAL_ENV = { ...process.env };

describe("getAdapter routing", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SOLANA_CHAIN_CONTEXT;
    delete process.env.NEXT_PUBLIC_SOLANA_CHAIN_CONTEXT;
    delete process.env.SOLANA_RPC_URL;
    delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("routes Base Sepolia (eip155:84532) to BaseAdapter", () => {
    const adapter = getAdapter(BASE_SEPOLIA_CHAIN_CONTEXT);
    expect(adapter).toBeInstanceOf(BaseAdapter);
    expect(adapter.chainContext).toBe(BASE_SEPOLIA_CHAIN_CONTEXT);
  });

  it("normalizes the Base Sepolia alias before constructing the adapter", () => {
    const adapter = getAdapter("base-sepolia");
    expect(adapter).toBeInstanceOf(BaseAdapter);
    expect(adapter.chainContext).toBe(BASE_SEPOLIA_CHAIN_CONTEXT);
  });

  it("rejects Base mainnet until RPC and contract config exist", () => {
    expect(() => getAdapter(BASE_CHAIN_CONTEXT)).toThrow(
      /BaseAdapter reads only support eip155:84532/
    );
    expect(() => getAdapter("base")).toThrow(
      /BaseAdapter reads only support eip155:84532/
    );
  });

  it("rejects non-Base EVM chains", () => {
    expect(() => getAdapter(ETHEREUM_MAINNET_CHAIN_CONTEXT)).toThrow(
      /Unsupported EVM chain context/
    );
  });

  it("routes configured Solana contexts to SolanaAdapter", () => {
    const adapter = getAdapter("solana:devnet");
    expect(adapter).toBeInstanceOf(SolanaAdapter);
    expect(adapter.chainContext).toBe(SOLANA_DEVNET_CHAIN_CONTEXT);
  });

  it("rejects Solana contexts that do not match the configured environment", () => {
    expect(() => getAdapter(SOLANA_MAINNET_CHAIN_CONTEXT)).toThrow(
      /SolanaAdapter reads use the configured Solana environment/
    );

    process.env.NEXT_PUBLIC_SOLANA_CHAIN_CONTEXT = "solana:mainnet-beta";
    const adapter = getAdapter("solana:mainnet-beta");
    expect(adapter).toBeInstanceOf(SolanaAdapter);
    expect(adapter.chainContext).toBe(SOLANA_MAINNET_CHAIN_CONTEXT);
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

  it("keeps event-log enumeration disabled by default", async () => {
    await expect(adapter.listSkillListings()).rejects.toThrow(
      /event scan is disabled by default/
    );
  });

  it("rejects direct Base mainnet construction until config exists", () => {
    expect(() => new BaseAdapter(BASE_CHAIN_CONTEXT)).toThrow(
      /BaseAdapter reads only support eip155:84532/
    );
  });
});
