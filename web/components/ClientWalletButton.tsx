"use client";

import { useEffect, useState, useRef } from "react";
import Image, { type ImageLoader } from "next/image";
import { useConnectWallet, useWalletConnectors } from "@solana/connector/react";
import { ConnectButton } from "@phantom/react-sdk";
import { FiCheck, FiCopy } from "react-icons/fi";
import { address, createSolanaRpc } from "@solana/kit";
import {
  useAgentVouchWallet,
  useChainWallet,
  usePhantomConfigured,
} from "./WalletContextProvider";
import {
  BASE_PASSKEY_WALLET_NAME,
  shortenEvmAddress,
} from "@/lib/adapters/baseWalletConfig";
import {
  fetchBaseUsdcBalance,
  formatBaseUsdc,
} from "@/lib/adapters/baseWallet";
import {
  fetchAssociatedTokenAccountState,
  formatUsdcMicrosValue,
} from "@/lib/agentvouchUsdc";
import { isBaseSepoliaDefaultEnabled } from "@/lib/chains";
import { getConfiguredUsdcMint } from "@/lib/x402";
import { useMounted } from "@/hooks/useMounted";
import { PHANTOM_EMBEDDED_WALLET_NAME } from "@/lib/phantomEmbeddedWalletStandard";
import { PHANTOM_LEGACY_WALLET_NAME } from "@/lib/phantomLegacyWalletStandard";
import {
  navButtonPrimaryInlineClass,
  navButtonSecondaryInlineClass,
} from "@/lib/buttonStyles";

const PHANTOM_ICON = "https://phantom.com/_web_platform_assets/favicon.svg";
// Phase 8a: connect affordances follow the default chain (env-static).
const baseSepoliaDefault = isBaseSepoliaDefaultEnabled();
const walletTriggerClass = navButtonPrimaryInlineClass;
const walletMenuButtonClass = `w-full ${navButtonSecondaryInlineClass} justify-start`;
const walletMenuActionClass =
  "w-full px-4 py-3 text-left font-mono text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition";
const SOLANA_CLIENT_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

type UsdcBalanceState = {
  account: string;
  status: "loading" | "ready" | "error";
  value: string | null;
};

const passthroughImageLoader: ImageLoader = ({ src }) => src;

function WalletIconImage({
  src,
  alt,
  size,
  className,
  hideOnError = false,
}: {
  src: string;
  alt: string;
  size: number;
  className?: string;
  hideOnError?: boolean;
}) {
  const [hidden, setHidden] = useState(false);

  if (!src || hidden) return null;

  return (
    <Image
      loader={passthroughImageLoader}
      unoptimized
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      onError={hideOnError ? () => setHidden(true) : undefined}
    />
  );
}

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

function dedupeConnectorsByName<T extends { name: string }>(
  connectors: T[]
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const connector of connectors) {
    const key = connector.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(connector);
  }
  return deduped;
}

export function ClientWalletButton() {
  const mounted = useMounted();
  const phantomConfigured = usePhantomConfigured();
  const [showMenu, setShowMenu] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [baseUsdcBalance, setBaseUsdcBalance] =
    useState<UsdcBalanceState | null>(null);
  const [solanaUsdcBalance, setSolanaUsdcBalance] =
    useState<UsdcBalanceState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const wallet = useAgentVouchWallet();
  const chainWallet = useChainWallet();
  const baseWallet = chainWallet.base;
  const { connect } = useConnectWallet();
  const allConnectors = useWalletConnectors();
  // Phantom embedded appears in this list via additionalWallets; it gets its
  // own "Sign in with" UI entry below, so exclude it from the extension list.
  const extensionConnectors = dedupeConnectorsByName(
    allConnectors.filter(
      (c) =>
        c.name !== PHANTOM_EMBEDDED_WALLET_NAME &&
        c.name !== PHANTOM_LEGACY_WALLET_NAME
    )
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setShowMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const account = baseWallet.account;
    if (!account) {
      setBaseUsdcBalance(null);
      return;
    }

    let cancelled = false;
    setBaseUsdcBalance({ account, status: "loading", value: null });
    void fetchBaseUsdcBalance(account)
      .then((balance) => {
        if (cancelled) return;
        setBaseUsdcBalance({
          account,
          status: "ready",
          value: formatBaseUsdc(balance),
        });
      })
      .catch((error) => {
        console.error("Failed to fetch Base USDC balance:", error);
        if (cancelled) return;
        setBaseUsdcBalance({ account, status: "error", value: null });
      });

    return () => {
      cancelled = true;
    };
  }, [baseWallet.account]);

  useEffect(() => {
    const account = wallet.status === "connected" ? wallet.account : null;
    if (!account) {
      setSolanaUsdcBalance(null);
      return;
    }

    let cancelled = false;
    setSolanaUsdcBalance({ account, status: "loading", value: null });
    const rpc = createSolanaRpc(SOLANA_CLIENT_RPC_URL);
    void fetchAssociatedTokenAccountState(
      rpc,
      address(account),
      address(getConfiguredUsdcMint())
    )
      .then((state) => {
        if (cancelled) return;
        setSolanaUsdcBalance({
          account,
          status: "ready",
          value: formatUsdcMicrosValue(state.exists ? state.amount : 0n),
        });
      })
      .catch((error) => {
        console.error("Failed to fetch Solana USDC balance:", error);
        if (cancelled) return;
        setSolanaUsdcBalance({ account, status: "error", value: null });
      });

    return () => {
      cancelled = true;
    };
  }, [wallet.account, wallet.status]);

  const copyAddress = async (address: string) => {
    await navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    window.setTimeout(() => {
      setCopiedAddress((current) => (current === address ? null : current));
    }, 1500);
  };

  const addressMenuSection = (
    address: string,
    balance?: UsdcBalanceState | null
  ) => (
    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-normal text-gray-500 dark:text-gray-400">
          Address
        </p>
        <button
          type="button"
          onClick={() => {
            void copyAddress(address).catch((error) => {
              console.error("Failed to copy wallet address:", error);
            });
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          title="Copy address"
          aria-label="Copy wallet address"
        >
          {copiedAddress === address ? (
            <FiCheck className="h-3.5 w-3.5" />
          ) : (
            <FiCopy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          void copyAddress(address).catch((error) => {
            console.error("Failed to copy wallet address:", error);
          });
        }}
        className="mt-1 block w-full break-all rounded-sm text-left font-mono text-xs leading-relaxed text-gray-800 transition hover:text-[var(--sea-accent-strong)] dark:text-gray-200"
      >
        {address}
      </button>
      {balance?.account === address ? (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3 text-xs dark:border-gray-800">
          <span className="font-normal text-gray-500 dark:text-gray-400">
            USDC
          </span>
          <span className="font-mono text-gray-800 dark:text-gray-200">
            {balance.status === "loading"
              ? "Loading..."
              : balance.status === "ready"
              ? `${balance.value} USDC`
              : "Unavailable"}
          </span>
        </div>
      ) : null}
    </div>
  );

  if (!mounted) {
    return (
      <div
        className={`${navButtonPrimaryInlineClass} opacity-60 pointer-events-none`}
      >
        Loading...
      </div>
    );
  }

  // While a dual restore resolves, both chains can be connected for a render;
  // the pill shown follows the default chain, matching useChainWallet().
  if (
    baseWallet.account &&
    (baseSepoliaDefault || wallet.status !== "connected")
  ) {
    const handleDisconnect = async () => {
      await baseWallet.disconnect().catch(() => {});
      setShowMenu(false);
    };
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className={`${walletTriggerClass} font-mono`}
        >
          {shortenEvmAddress(baseWallet.account)}
        </button>
        {showMenu && (
          <div className="absolute right-0 mt-2 w-80 rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg z-50">
            <div className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
              {baseWallet.chainLabel}
            </div>
            {addressMenuSection(baseWallet.account, baseUsdcBalance)}
            <button
              onClick={handleDisconnect}
              className={walletMenuActionClass}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  if (wallet.status === "connected" && wallet.account) {
    const addr = wallet.account;
    const short = `${addr.slice(0, 4)}...${addr.slice(-4)}`;
    const isEmbedded = wallet.source === "phantom-embedded";
    const handleDisconnect = async () => {
      await wallet.disconnect().catch(() => {});
      setShowMenu(false);
    };
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className={`${walletTriggerClass} font-mono`}
        >
          {short}
        </button>
        {showMenu && (
          <div className="absolute right-0 mt-2 w-80 rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg z-50">
            {isEmbedded && (
              <div className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
                Phantom Embedded
              </div>
            )}
            {addressMenuSection(addr, solanaUsdcBalance)}
            <button
              onClick={handleDisconnect}
              className={walletMenuActionClass}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  // Ordered first when Base Sepolia is the default chain; under the Solana
  // rollback env it stays selectable but moves below the Solana options.
  const baseSection = (
    <div
      className={`px-4 py-2.5 ${
        baseSepoliaDefault
          ? "border-b border-gray-100 dark:border-gray-800"
          : "border-t border-gray-100 dark:border-gray-800"
      }`}
    >
      <p className="text-xs font-normal text-gray-500 dark:text-gray-400 mb-1.5">
        Base Sepolia
      </p>
      <button
        onClick={() => {
          void baseWallet
            .connect()
            .then(() => setShowMenu(false))
            .catch((error) => {
              console.error("Failed to connect Base passkey:", error);
            });
        }}
        disabled={baseWallet.status === "connecting" || !baseWallet.configured}
        className={`${walletMenuButtonClass} flex items-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-sm border border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] text-[11px] font-normal text-[var(--sea-accent-strong)]">
          B
        </span>
        {baseWallet.status === "connecting"
          ? "Opening passkey..."
          : BASE_PASSKEY_WALLET_NAME}
      </button>
      {baseWallet.error ? (
        <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
          {baseWallet.error}
        </p>
      ) : null}
    </div>
  );

  const socialSection = phantomConfigured ? (
    <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
      <p className="text-xs font-normal text-gray-700 dark:text-gray-300 mb-2">
        Sign in with
      </p>
      <div className="phantom-connect-wrapper">
        <ConnectButton fullWidth />
      </div>
    </div>
  ) : null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className={walletTriggerClass}
      >
        <span>Connect</span>
      </button>
      {showMenu && (
        <div className="absolute right-0 mt-2 w-72 rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg z-50 py-1">
          {!socialSection && (
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Connect a wallet or install one below.
              </p>
            </div>
          )}
          {baseSepoliaDefault && baseSection}
          {socialSection}

          {(wallet.phantomInstalled || extensionConnectors.length > 0) && (
            <div className="px-4 py-2.5">
              <p className="text-xs font-normal text-gray-500 dark:text-gray-400 mb-1.5">
                Browser Extension
              </p>
              {wallet.phantomInstalled && (
                <button
                  onClick={() => {
                    void wallet.connectPhantomExtension().catch((error) => {
                      console.error("Failed to connect Phantom:", error);
                    });
                    setShowMenu(false);
                  }}
                  className={`${walletMenuButtonClass} flex items-center gap-3`}
                >
                  <WalletIconImage
                    src={PHANTOM_ICON}
                    alt=""
                    size={20}
                    className="w-5 h-5 rounded"
                  />
                  {PHANTOM_LEGACY_WALLET_NAME}
                </button>
              )}
              {extensionConnectors.map((connector) => (
                <button
                  key={connector.id}
                  onClick={() => {
                    void connect(connector.id);
                    setShowMenu(false);
                  }}
                  className={`${walletMenuButtonClass} flex items-center gap-3`}
                >
                  {connector.icon && (
                    <WalletIconImage
                      src={connector.icon}
                      alt=""
                      size={20}
                      className="w-5 h-5 rounded"
                    />
                  )}
                  {connector.name}
                </button>
              ))}
            </div>
          )}

          {!wallet.phantomInstalled && extensionConnectors.length === 0 && (
            <div className="px-4 py-2.5">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                {isMobile()
                  ? "Or open this page in Phantom:"
                  : "Install a wallet extension to get started:"}
              </p>
              <div className="flex flex-col gap-1.5">
                {isMobile() && (
                  <a
                    href={`https://phantom.app/ul/browse/${encodeURIComponent(
                      typeof window !== "undefined" ? window.location.href : ""
                    )}`}
                    onClick={() => setShowMenu(false)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition text-sm font-normal text-purple-700 dark:text-purple-300"
                  >
                    <WalletIconImage
                      src={PHANTOM_ICON}
                      alt="Phantom"
                      size={16}
                      className="w-4 h-4 rounded"
                    />
                    Open in Phantom
                  </a>
                )}
                <a
                  href="https://phantom.app/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowMenu(false)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  <WalletIconImage
                    src={PHANTOM_ICON}
                    alt="Phantom"
                    size={16}
                    className="w-4 h-4 rounded"
                  />
                  Get Phantom
                </a>
                <a
                  href="https://www.backpack.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowMenu(false)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  <WalletIconImage
                    src="https://www.backpack.app/favicon.ico"
                    alt="Backpack"
                    size={16}
                    className="w-4 h-4 rounded"
                    hideOnError
                  />
                  Get Backpack
                </a>
                <a
                  href="https://solflare.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowMenu(false)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  <WalletIconImage
                    src="https://solflare.com/favicon.ico"
                    alt="Solflare"
                    size={16}
                    className="w-4 h-4 rounded"
                    hideOnError
                  />
                  Get Solflare
                </a>
              </div>
            </div>
          )}

          {!baseSepoliaDefault && baseSection}
        </div>
      )}
    </div>
  );
}
