/**
 * Wallet Standard adapter for Phantom embedded (social-login) wallets.
 *
 * Phantom's embedded session lives behind `@phantom/react-sdk`'s hooks
 * (`usePhantom`, `useAccounts`, `useSolana`) and does NOT register itself
 * as a Wallet Standard wallet — meaning `@solana/connector` /
 * `@solana/client` `autoDiscover` can't see it.
 *
 * This adapter wraps the `ISolanaChain` instance from `useSolana()` in a
 * Wallet Standard `Wallet` object that ConnectorKit consumes via its
 * `additionalWallets` config option. The Phantom session lifecycle
 * (connect / disconnect / account changes) is driven externally by the
 * React provider; this module exposes `setSession()` / `clearSession()`
 * for that bridge.
 *
 * Modeled on `@solana/connector/remote`'s `createRemoteSignerWallet`,
 * with HTTP delegation swapped for direct in-process calls to
 * `ISolanaChain`.
 */

import { VersionedTransaction } from "@solana/web3.js";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

type ISolanaChain = {
  readonly publicKey: string | null;
  readonly isConnected: boolean;
  signMessage(
    message: string | Uint8Array
  ): Promise<{ signature: Uint8Array; publicKey: string }>;
  signTransaction<T>(transaction: T): Promise<T>;
  signAndSendTransaction(
    transaction: VersionedTransaction,
    options?: unknown
  ): Promise<{ signature: string }>;
  switchNetwork(network: "mainnet" | "devnet"): Promise<void>;
};

// Wallet Standard requires a `data:` URI for the icon (not https). Inline
// SVG: a small purple ghost-shaped silhouette as a visual stand-in for the
// Phantom-branded embedded wallet entry in the wallet picker.
const PHANTOM_ICON: `data:image/svg+xml;base64,${string}` =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48cGF0aCBmaWxsPSIjQUI5RkYyIiBkPSJNNjQgOEMzMS41IDggOCAzMC44IDggNjMuOXY1Mi4xYzAgMy43IDQuMyA1LjcgNy4yIDMuM2wxMC44LTkuMmM3LjQgNi4yIDE4LjQgMTAuOSAzOCAxMC45IDE5LjUgMCAzMC42LTQuNyAzOC0xMC45bDEwLjggOS4yYzIuOSAyLjQgNy4yLjQgNy4yLTMuM1Y2My45QzEyMCAzMC44IDk2LjUgOCA2NCA4eiIvPjxjaXJjbGUgY3g9IjQ2IiBjeT0iNjAiIHI9IjEyIiBmaWxsPSIjZmZmIi8+PGNpcmNsZSBjeD0iODIiIGN5PSI2MCIgcj0iMTIiIGZpbGw9IiNmZmYiLz48L3N2Zz4=";
export const PHANTOM_EMBEDDED_WALLET_NAME = "Phantom (Embedded)";
const CHAINS = ["solana:mainnet", "solana:devnet"] as const;
const ACCOUNT_FEATURES = [
  "solana:signMessage",
  "solana:signTransaction",
  "solana:signAndSendTransaction",
] as const;

type StandardEvent = "change";
type StandardEventListener = (event: { accounts: readonly WalletAccount[] }) => void;

export type PhantomEmbeddedWalletHandle = {
  wallet: Wallet;
  setSession: (chain: ISolanaChain, address: string) => void;
  clearSession: () => void;
};

function base58ToBytes(base58: string): Uint8Array {
  const ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const map = new Map<string, number>();
  for (let i = 0; i < ALPHABET.length; i++) {
    map.set(ALPHABET[i], i);
  }
  const bytes: number[] = [0];
  for (const char of base58) {
    const value = map.get(char);
    if (value === undefined) {
      throw new Error(`Invalid base58 character: ${char}`);
    }
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of base58) {
    if (char === "1") {
      bytes.push(0);
    } else {
      break;
    }
  }
  return new Uint8Array(bytes.reverse());
}

export function createPhantomEmbeddedWallet(): PhantomEmbeddedWalletHandle {
  let chain: ISolanaChain | null = null;
  let accounts: WalletAccount[] = [];
  const listeners = new Map<StandardEvent, Set<StandardEventListener>>();

  const emit = (event: StandardEvent, payload: { accounts: readonly WalletAccount[] }) => {
    const set = listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors — matches Wallet Standard reference impls.
      }
    }
  };

  const setSession = (nextChain: ISolanaChain, address: string) => {
    chain = nextChain;
    const publicKey = base58ToBytes(address);
    accounts = [
      {
        address,
        publicKey,
        chains: [...CHAINS],
        features: [...ACCOUNT_FEATURES],
      },
    ];
    emit("change", { accounts });
  };

  const clearSession = () => {
    chain = null;
    accounts = [];
    emit("change", { accounts });
  };

  const requireChain = (): ISolanaChain => {
    if (!chain) {
      throw new Error("Phantom embedded wallet is not connected");
    }
    return chain;
  };

  const wallet: Wallet = {
    version: "1.0.0",
    name: PHANTOM_EMBEDDED_WALLET_NAME,
    icon: PHANTOM_ICON,
    get chains() {
      return [...CHAINS];
    },
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => ({ accounts }),
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          // Lifecycle is driven by the Phantom SDK; the bridge calls
          // clearSession() on actual sign-out. Here we just acknowledge.
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event: StandardEvent, listener: StandardEventListener) => {
          let set = listeners.get(event);
          if (!set) {
            set = new Set();
            listeners.set(event, set);
          }
          set.add(listener);
          return () => {
            set?.delete(listener);
            if (set && set.size === 0) {
              listeners.delete(event);
            }
          };
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (
          ...inputs: { account: WalletAccount; message: Uint8Array }[]
        ) => {
          const c = requireChain();
          const results = [];
          for (const input of inputs) {
            const { signature } = await c.signMessage(input.message);
            results.push({ signedMessage: input.message, signature });
          }
          return results;
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0] as const,
        signTransaction: async (
          ...inputs: {
            account: WalletAccount;
            transaction: Uint8Array;
            chain?: string;
          }[]
        ) => {
          const c = requireChain();
          const results = [];
          for (const input of inputs) {
            const tx = VersionedTransaction.deserialize(input.transaction);
            const signed = (await c.signTransaction(tx)) as VersionedTransaction;
            results.push({ signedTransaction: signed.serialize() });
          }
          return results;
        },
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0] as const,
        signAndSendTransaction: async (
          ...inputs: {
            account: WalletAccount;
            transaction: Uint8Array;
            chain?: string;
            options?: unknown;
          }[]
        ) => {
          const c = requireChain();
          const results = [];
          for (const input of inputs) {
            const tx = VersionedTransaction.deserialize(input.transaction);
            const { signature } = await c.signAndSendTransaction(tx);
            results.push({ signature: base58ToBytes(signature) });
          }
          return results;
        },
      },
    },
  };

  return { wallet, setSession, clearSession };
}
