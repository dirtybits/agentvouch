import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  BASE_CHAIN_CONTEXT,
  BASE_SEPOLIA_CHAIN_CONTEXT,
  SOLANA_DEVNET_CHAIN_CONTEXT,
  SOLANA_MAINNET_CHAIN_CONTEXT,
  getDefaultChainContext,
  isBaseSepoliaDefaultEnabled,
  getConfiguredSolanaChainDisplayLabel,
  getConfiguredSolanaChainContext,
  getConfiguredSolanaExplorerAddressUrl,
  getConfiguredSolanaExplorerTxUrl,
  getConfiguredSolanaFmTxUrl,
  getConfiguredSolanaRpcTargetLabel,
  normalizeInputChainContext,
  normalizePersistedChainContext,
} from "@/lib/chains";

const ORIGINAL_ENV = { ...process.env };

describe("chains", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SOLANA_CHAIN_CONTEXT;
    delete process.env.NEXT_PUBLIC_SOLANA_CHAIN_CONTEXT;
    delete process.env.SOLANA_RPC_URL;
    delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    delete process.env.AGENTVOUCH_DEFAULT_CHAIN_CONTEXT;
    delete process.env.NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("normalizes legacy aliases to CAIP-2 chain contexts", () => {
    expect(normalizeInputChainContext("solana:mainnet-beta")).toBe(
      SOLANA_MAINNET_CHAIN_CONTEXT
    );
    expect(normalizeInputChainContext("solana:devnet")).toBe(
      SOLANA_DEVNET_CHAIN_CONTEXT
    );
    expect(normalizeInputChainContext("base")).toBe(BASE_CHAIN_CONTEXT);
  });

  it("uses the configured RPC cluster for bare solana aliases", () => {
    process.env.SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
    expect(normalizeInputChainContext("solana")).toBe(
      SOLANA_MAINNET_CHAIN_CONTEXT
    );
  });

  it("defaults to devnet when no explicit cluster is configured", () => {
    expect(getConfiguredSolanaChainContext()).toBe(SOLANA_DEVNET_CHAIN_CONTEXT);
  });

  it("derives configured Solana labels and explorer URLs for devnet", () => {
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "https://api.devnet.solana.com";

    expect(getConfiguredSolanaChainDisplayLabel()).toBe("Solana Devnet");
    expect(getConfiguredSolanaRpcTargetLabel()).toBe("devnet");
    expect(getConfiguredSolanaFmTxUrl("abc")).toBe(
      "https://solana.fm/tx/abc?cluster=devnet-solana"
    );
    expect(getConfiguredSolanaExplorerTxUrl("abc")).toBe(
      "https://explorer.solana.com/tx/abc?cluster=devnet"
    );
    expect(getConfiguredSolanaExplorerAddressUrl("abc")).toBe(
      "https://explorer.solana.com/address/abc?cluster=devnet"
    );
  });

  it("derives configured Solana labels and explorer URLs for mainnet", () => {
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL =
      "https://api.mainnet-beta.solana.com";

    expect(getConfiguredSolanaChainDisplayLabel()).toBe("Solana");
    expect(getConfiguredSolanaRpcTargetLabel()).toBe("mainnet");
    expect(getConfiguredSolanaFmTxUrl("abc")).toBe(
      "https://solana.fm/tx/abc?cluster=mainnet-solana"
    );
    expect(getConfiguredSolanaExplorerTxUrl("abc")).toBe(
      "https://explorer.solana.com/tx/abc"
    );
    expect(getConfiguredSolanaExplorerAddressUrl("abc")).toBe(
      "https://explorer.solana.com/address/abc"
    );
  });

  it("preserves unknown stored values instead of guessing silently", () => {
    expect(normalizePersistedChainContext("custom:unknown-network")).toBe(
      "custom:unknown-network"
    );
  });

  // Phase 8a default-chain seam (.agents/plans/base-port-chain-adapter-phase-8a.plan.md).
  describe("getDefaultChainContext", () => {
    it("defaults to Base Sepolia with no env", () => {
      expect(getDefaultChainContext()).toBe(BASE_SEPOLIA_CHAIN_CONTEXT);
      expect(isBaseSepoliaDefaultEnabled()).toBe(true);
    });

    it("rolls back to the configured Solana context via the solana alias", () => {
      process.env.AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "solana";
      process.env.NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "solana";
      expect(getDefaultChainContext()).toBe(SOLANA_DEVNET_CHAIN_CONTEXT);
      expect(isBaseSepoliaDefaultEnabled()).toBe(false);
    });

    it("ignores a server-only default var so SSR and hydration agree (PR #74 P2)", () => {
      // Only the non-public var is set. The render default is client-inlined only, so this
      // must NOT change the default — otherwise SSR renders Solana while the client (which
      // never sees this var) hydrates Base: a #418-class mismatch.
      process.env.AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "solana";
      delete process.env.NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT;
      expect(getDefaultChainContext()).toBe(BASE_SEPOLIA_CHAIN_CONTEXT);
      expect(isBaseSepoliaDefaultEnabled()).toBe(true);
    });

    it("honors a client-only NEXT_PUBLIC default var (the single render source)", () => {
      delete process.env.AGENTVOUCH_DEFAULT_CHAIN_CONTEXT;
      process.env.NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "solana";
      expect(getDefaultChainContext()).toBe(SOLANA_DEVNET_CHAIN_CONTEXT);
      expect(isBaseSepoliaDefaultEnabled()).toBe(false);
    });

    it("follows the configured Solana cluster on rollback", () => {
      process.env.SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
      process.env.AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "solana";
      process.env.NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "solana";
      expect(getDefaultChainContext()).toBe(SOLANA_MAINNET_CHAIN_CONTEXT);
    });

    it("accepts explicit aliases and CAIP-2 values", () => {
      process.env.AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "solana:devnet";
      process.env.NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT =
        "solana:devnet";
      expect(getDefaultChainContext()).toBe(SOLANA_DEVNET_CHAIN_CONTEXT);

      process.env.AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "base-sepolia";
      process.env.NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "base-sepolia";
      expect(getDefaultChainContext()).toBe(BASE_SEPOLIA_CHAIN_CONTEXT);

      process.env.AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = BASE_SEPOLIA_CHAIN_CONTEXT;
      process.env.NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT =
        BASE_SEPOLIA_CHAIN_CONTEXT;
      expect(getDefaultChainContext()).toBe(BASE_SEPOLIA_CHAIN_CONTEXT);
    });

    it("never enables Base mainnet in Phase 8a (fail-closed to Solana)", () => {
      process.env.AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = BASE_CHAIN_CONTEXT;
      process.env.NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT =
        BASE_CHAIN_CONTEXT;
      expect(getDefaultChainContext()).toBe(SOLANA_DEVNET_CHAIN_CONTEXT);

      process.env.AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "base";
      process.env.NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "base";
      expect(getDefaultChainContext()).toBe(SOLANA_DEVNET_CHAIN_CONTEXT);
    });

    it("ignores invalid values and keeps the Base Sepolia default", () => {
      process.env.AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "not-a-chain";
      process.env.NEXT_PUBLIC_AGENTVOUCH_DEFAULT_CHAIN_CONTEXT = "not-a-chain";
      expect(getDefaultChainContext()).toBe(BASE_SEPOLIA_CHAIN_CONTEXT);
    });

    it("keeps normalizePersistedChainContext(null) on configured Solana, not the Base default", () => {
      expect(normalizePersistedChainContext(null)).toBe(
        SOLANA_DEVNET_CHAIN_CONTEXT
      );
      expect(normalizePersistedChainContext("")).toBe(
        SOLANA_DEVNET_CHAIN_CONTEXT
      );
    });
  });
});
