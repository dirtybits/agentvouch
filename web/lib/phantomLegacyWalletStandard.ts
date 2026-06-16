import { Transaction, VersionedTransaction } from "@solana/web3.js";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

export const PHANTOM_LEGACY_WALLET_NAME = "Phantom";

const PHANTOM_ICON: `data:image/svg+xml;base64,${string}` =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48cGF0aCBmaWxsPSIjQUI5RkYyIiBkPSJNNjQgOEMzMS41IDggOCAzMC44IDggNjMuOXY1Mi4xYzAgMy43IDQuMyA1LjcgNy4yIDMuM2wxMC44LTkuMmM3LjQgNi4yIDE4LjQgMTAuOSAzOCAxMC45IDE5LjUgMCAzMC42LTQuNyAzOC0xMC45bDEwLjggOS4yYzIuOSAyLjQgNy4yLjQgNy4yLTMuM1Y2My45QzEyMCAzMC44IDk2LjUgOCA2NCA4eiIvPjxjaXJjbGUgY3g9IjQ2IiBjeT0iNjAiIHI9IjEyIiBmaWxsPSIjZmZmIi8+PGNpcmNsZSBjeD0iODIiIGN5PSI2MCIgcj0iMTIiIGZpbGw9IiNmZmYiLz48L3N2Zz4=";
const CHAINS = ["solana:mainnet", "solana:devnet"] as const;
const SIGNATURE_FEATURES = [
  "solana:signMessage",
  "solana:signTransaction",
  "solana:signAllTransactions",
  "solana:signAndSendTransaction",
] as const;

type PhantomPublicKey =
  | string
  | {
      toString(): string;
      toBytes?: () => Uint8Array;
    };

export type PhantomLegacyProvider = {
  isPhantom?: boolean;
  publicKey?: PhantomPublicKey | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<
    | {
        publicKey?: PhantomPublicKey | null;
      }
    | PhantomPublicKey
    | void
  >;
  disconnect?(): Promise<void>;
  signMessage?(
    message: Uint8Array,
    encoding?: string
  ): Promise<{ signature?: Uint8Array | string } | Uint8Array | string>;
  signTransaction?(transaction: unknown): Promise<unknown>;
  signAllTransactions?(transactions: unknown[]): Promise<unknown[]>;
  signAndSendTransaction?(
    transaction: unknown,
    options?: unknown
  ): Promise<{ signature?: string | Uint8Array } | string | Uint8Array>;
  on?(event: string, listener: (payload?: unknown) => void): void;
  off?(event: string, listener: (payload?: unknown) => void): void;
};

type StandardEvent = "change";
type StandardEventListener = (event: {
  accounts: readonly WalletAccount[];
}) => void;
type SignTransactionInput = {
  account: WalletAccount;
  transaction?: Uint8Array;
  transactions?: readonly Uint8Array[];
  chain?: string;
};
type SignAndSendInput = SignTransactionInput & {
  options?: unknown;
};

export type PhantomLegacyWalletHandle = {
  provider: PhantomLegacyProvider;
  wallet: Wallet;
  destroy: () => void;
};

type PhantomWindow = Window & {
  phantom?: { solana?: PhantomLegacyProvider };
  solana?: PhantomLegacyProvider;
};

function base58ToBytes(base58: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
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

function normalizePublicKey(value: unknown): PhantomPublicKey | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "publicKey" in value) {
    return normalizePublicKey((value as { publicKey?: unknown }).publicKey);
  }
  if (typeof (value as { toString?: unknown }).toString === "function") {
    return value as PhantomPublicKey;
  }
  return null;
}

function createAccount(publicKey: PhantomPublicKey): WalletAccount {
  const address = publicKey.toString();
  const bytes =
    typeof publicKey === "object" && typeof publicKey.toBytes === "function"
      ? publicKey.toBytes()
      : base58ToBytes(address);
  return {
    address,
    publicKey: bytes,
    chains: [...CHAINS],
    features: [...SIGNATURE_FEATURES],
  };
}

function deserializeTransactionForProvider(transaction: Uint8Array): unknown {
  try {
    return VersionedTransaction.deserialize(transaction);
  } catch {
    try {
      return Transaction.from(transaction);
    } catch {
      return transaction;
    }
  }
}

function serializeSignedTransaction(transaction: unknown): Uint8Array {
  if (transaction instanceof Uint8Array) return transaction;
  if (
    transaction &&
    typeof transaction === "object" &&
    "signedTransaction" in transaction
  ) {
    return serializeSignedTransaction(
      (transaction as { signedTransaction?: unknown }).signedTransaction
    );
  }
  const serializable = transaction as { serialize?: () => Uint8Array };
  if (typeof serializable?.serialize === "function") {
    return new Uint8Array(serializable.serialize());
  }
  throw new Error("Phantom returned an unsupported signed transaction format");
}

function readSignatureBytes(result: unknown): Uint8Array {
  if (result instanceof Uint8Array) return result;
  if (typeof result === "string") return base58ToBytes(result);
  if (result && typeof result === "object" && "signature" in result) {
    return readSignatureBytes((result as { signature?: unknown }).signature);
  }
  throw new Error("Phantom returned an unsupported signature format");
}

function readSignatureString(result: unknown): string {
  if (typeof result === "string") return result;
  if (result instanceof Uint8Array) {
    throw new Error("Phantom returned raw signature bytes for send");
  }
  if (result && typeof result === "object" && "signature" in result) {
    const signature = (result as { signature?: unknown }).signature;
    if (typeof signature === "string") return signature;
  }
  throw new Error("Phantom returned an unsupported send signature format");
}

export function getPhantomLegacyProvider(): PhantomLegacyProvider | null {
  if (typeof window === "undefined") return null;

  const { phantom, solana } = window as PhantomWindow;
  const candidates = [phantom?.solana, solana];
  return (
    candidates.find(
      (provider): provider is PhantomLegacyProvider =>
        !!provider &&
        provider.isPhantom === true &&
        typeof provider.connect === "function"
    ) ?? null
  );
}

export function createPhantomLegacyWallet(
  provider: PhantomLegacyProvider
): PhantomLegacyWalletHandle {
  let accounts = provider.publicKey
    ? [createAccount(provider.publicKey)]
    : ([] as WalletAccount[]);
  const listeners = new Map<StandardEvent, Set<StandardEventListener>>();

  const emit = () => {
    const set = listeners.get("change");
    if (!set) return;
    for (const listener of set) {
      try {
        listener({ accounts });
      } catch {
        // Match Wallet Standard reference implementations.
      }
    }
  };

  const updateAccount = (payload?: unknown) => {
    const publicKey = normalizePublicKey(payload) ?? provider.publicKey ?? null;
    accounts = publicKey ? [createAccount(publicKey)] : [];
    emit();
  };

  const clearAccount = () => {
    accounts = [];
    emit();
  };

  const signOneTransaction = async (transaction: Uint8Array) => {
    if (!provider.signTransaction) {
      throw new Error("Phantom does not support transaction signing");
    }
    const signed = await provider.signTransaction(
      deserializeTransactionForProvider(transaction)
    );
    return serializeSignedTransaction(signed);
  };

  const providerConnect = async (input?: { silent?: boolean }) => {
    const result = await provider.connect({
      onlyIfTrusted: input?.silent === true,
    });
    updateAccount(result);
    return { accounts };
  };

  const providerDisconnect = async () => {
    await provider.disconnect?.();
    clearAccount();
  };

  const onConnect = (payload?: unknown) => updateAccount(payload);
  const onAccountChanged = (payload?: unknown) => updateAccount(payload);
  const onDisconnect = () => clearAccount();
  provider.on?.("connect", onConnect);
  provider.on?.("accountChanged", onAccountChanged);
  provider.on?.("disconnect", onDisconnect);

  const wallet: Wallet = {
    version: "1.0.0",
    name: PHANTOM_LEGACY_WALLET_NAME,
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
        connect: providerConnect,
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: providerDisconnect,
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
          if (!provider.signMessage) {
            throw new Error("Phantom does not support message signing");
          }
          const results = [];
          for (const input of inputs) {
            const signature = readSignatureBytes(
              await provider.signMessage(input.message, "utf8")
            );
            results.push({ signedMessage: input.message, signature });
          }
          return results;
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0] as const,
        signTransaction: async (...inputs: SignTransactionInput[]) => {
          const signedTransactions = [];
          for (const input of inputs) {
            const transactions = input.transactions ?? [];
            if (transactions.length > 0) {
              for (const transaction of transactions) {
                signedTransactions.push(await signOneTransaction(transaction));
              }
              continue;
            }
            if (!input.transaction) {
              throw new Error("Missing transaction for Phantom signing");
            }
            signedTransactions.push(
              await signOneTransaction(input.transaction)
            );
          }

          if (inputs.length === 1 && inputs[0]?.transactions) {
            return { signedTransactions };
          }
          return signedTransactions.map((signedTransaction) => ({
            signedTransaction,
          }));
        },
      },
      "solana:signAllTransactions": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0] as const,
        signAllTransactions: async (...inputs: SignTransactionInput[]) => {
          const transactions = inputs.flatMap((input) =>
            input.transactions?.length
              ? [...input.transactions]
              : input.transaction
              ? [input.transaction]
              : []
          );
          if (transactions.length === 0) {
            throw new Error("Missing transactions for Phantom signing");
          }
          if (provider.signAllTransactions) {
            const signed = await provider.signAllTransactions(
              transactions.map(deserializeTransactionForProvider)
            );
            return {
              signedTransactions: signed.map(serializeSignedTransaction),
            };
          }
          return {
            signedTransactions: await Promise.all(
              transactions.map(signOneTransaction)
            ),
          };
        },
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0] as const,
        signAndSendTransaction: async (...inputs: SignAndSendInput[]) => {
          if (!provider.signAndSendTransaction) {
            throw new Error("Phantom does not support transaction sending");
          }
          const signatures = [];
          for (const input of inputs) {
            const transactions = input.transactions ?? [];
            if (transactions.length > 0) {
              for (const transaction of transactions) {
                signatures.push(
                  readSignatureString(
                    await provider.signAndSendTransaction(
                      deserializeTransactionForProvider(transaction),
                      input.options
                    )
                  )
                );
              }
              continue;
            }
            if (!input.transaction) {
              throw new Error("Missing transaction for Phantom send");
            }
            signatures.push(
              readSignatureString(
                await provider.signAndSendTransaction(
                  deserializeTransactionForProvider(input.transaction),
                  input.options
                )
              )
            );
          }
          return { signatures };
        },
      },
    },
  };

  return {
    provider,
    wallet,
    destroy: () => {
      provider.off?.("connect", onConnect);
      provider.off?.("accountChanged", onAccountChanged);
      provider.off?.("disconnect", onDisconnect);
    },
  };
}
