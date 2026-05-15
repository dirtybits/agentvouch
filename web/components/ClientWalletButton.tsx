"use client";

import { useEffect, useState, useRef } from "react";
import Image, { type ImageLoader } from "next/image";
import {
  useWallet,
  useConnectWallet,
  useDisconnectWallet,
  useWalletConnectors,
} from "@solana/connector/react";
import { ConnectButton } from "@phantom/react-sdk";
import {
  usePhantomConfigured,
  usePhantomDisconnect,
} from "./WalletContextProvider";
import { useMounted } from "@/hooks/useMounted";
import { PHANTOM_EMBEDDED_WALLET_NAME } from "@/lib/phantomEmbeddedWalletStandard";
import {
  navButtonPrimaryInlineClass,
  navButtonSecondaryInlineClass,
} from "@/lib/buttonStyles";

const PHANTOM_ICON = "https://phantom.com/_web_platform_assets/favicon.svg";
const walletTriggerClass = navButtonPrimaryInlineClass;
const walletMenuButtonClass = `w-full ${navButtonSecondaryInlineClass} justify-start`;

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
  const menuRef = useRef<HTMLDivElement>(null);

  const wallet = useWallet();
  const { connect } = useConnectWallet();
  const { disconnect } = useDisconnectWallet();
  const allConnectors = useWalletConnectors();
  // Phantom embedded appears in this list via additionalWallets; it gets its
  // own "Sign in with" UI entry below, so exclude it from the extension list.
  const extensionConnectors = dedupeConnectorsByName(
    allConnectors.filter((c) => c.name !== PHANTOM_EMBEDDED_WALLET_NAME)
  );
  const disconnectPhantomEmbedded = usePhantomDisconnect();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setShowMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!mounted) {
    return (
      <div
        className={`${navButtonPrimaryInlineClass} opacity-60 pointer-events-none`}
      >
        Loading...
      </div>
    );
  }

  if (wallet.status === "connected" && wallet.account) {
    const addr = wallet.account;
    const short = `${addr.slice(0, 4)}...${addr.slice(-4)}`;
    const isEmbedded =
      allConnectors.find((c) => c.id === wallet.connectorId)?.name ===
      PHANTOM_EMBEDDED_WALLET_NAME;
    const handleDisconnect = async () => {
      try {
        await disconnect();
      } catch {
        // ConnectorKit surfaces its own errors; ignore here.
      }
      if (isEmbedded && disconnectPhantomEmbedded) {
        try {
          await disconnectPhantomEmbedded();
        } catch {
          // Phantom session may already be cleared; safe to ignore.
        }
      }
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
          <div className="absolute right-0 mt-2 w-48 rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg z-50">
            {isEmbedded && (
              <div className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
                Phantom Embedded
              </div>
            )}
            <button onClick={handleDisconnect} className={walletMenuButtonClass}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  const socialSection = phantomConfigured ? (
    <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
        Sign in with
      </p>
      <div className="phantom-connect-wrapper">
        <ConnectButton />
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
          {socialSection}
          {!socialSection && (
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Connect a wallet extension or install one below.
              </p>
            </div>
          )}

          {extensionConnectors.length > 0 && (
            <div className="px-4 py-2.5">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                Browser Extension
              </p>
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

          {extensionConnectors.length === 0 && (
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
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition text-sm font-semibold text-purple-700 dark:text-purple-300"
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
        </div>
      )}
    </div>
  );
}
