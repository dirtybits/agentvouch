import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_CHAIN_CONTEXT, SOLANA_MAINNET_CHAIN_CONTEXT } from "@/lib/chains";
import {
  buildFallbackAgentUsername,
  buildLocalCanonicalAgentId,
  buildRegistryCanonicalAgentId,
  normalizeAgentUsername,
} from "@/lib/agentIdentity";

const ORIGINAL_ENV = { ...process.env };

describe("agentIdentity", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SOLANA_CHAIN_CONTEXT;
    delete process.env.NEXT_PUBLIC_SOLANA_CHAIN_CONTEXT;
    delete process.env.SOLANA_RPC_URL;
    delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("builds local canonical ids with CAIP-2 prefixes", () => {
    expect(
      buildLocalCanonicalAgentId(
        "Wallet1111111111111111111111111111111111",
        BASE_CHAIN_CONTEXT
      )
    ).toBe(
      "eip155:8453:agentvouch-local#Wallet1111111111111111111111111111111111"
    );
  });

  it("builds registry canonical ids without losing the upstream record id", () => {
    expect(
      buildRegistryCanonicalAgentId(
        "RegistryProgram1111111111111111111111111111111",
        "CoreAsset11111111111111111111111111111111111",
        SOLANA_MAINNET_CHAIN_CONTEXT
      )
    ).toBe(
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:RegistryProgram1111111111111111111111111111111#CoreAsset11111111111111111111111111111111111"
    );
  });

  it("normalizes legacy chain aliases before composing ids", () => {
    expect(
      buildRegistryCanonicalAgentId(
        "RegistryProgram1111111111111111111111111111111",
        "42",
        "base"
      )
    ).toBe("eip155:8453:RegistryProgram1111111111111111111111111111111#42");
  });

  it("derives deterministic wallet fallback usernames", () => {
    expect(
      buildFallbackAgentUsername("AgentWallet111111111111111111111dMt4CD")
    ).toBe("wallet-dmt4cd");
  });

  it("normalizes and validates chosen usernames", () => {
    expect(normalizeAgentUsername("Dirty-Bits")).toBe("dirty-bits");
    expect(() => normalizeAgentUsername("-dirtybits")).toThrow(
      "Username must be 3-32 characters"
    );
    expect(() => normalizeAgentUsername("dirty_bits")).toThrow(
      "Username must be 3-32 characters"
    );
  });
});
