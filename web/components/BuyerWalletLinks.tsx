"use client";

import { useAuth, useReverification } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useAgentVouchWallet,
  useChainWallet,
} from "@/components/WalletContextProvider";
import { useWritableChainWallet } from "@/hooks/useWritableChainWallet";
import {
  navButtonPrimaryInlineClass,
  navButtonSecondaryInlineClass,
} from "@/lib/buttonStyles";
import { getChainDisplayLabel } from "@/lib/chains";
import {
  normalizeChainAddressForStorage,
  shortenChainAddress,
} from "@/lib/chainAddress";
import {
  BASE_PASSKEY_WALLET_NAME,
  BASE_PASSKEY_WALLET_SOURCE,
} from "@/lib/adapters/baseWalletConfig";
import {
  BASE_INJECTED_WALLET_NAME,
  BASE_INJECTED_WALLET_SOURCE,
} from "@/lib/adapters/baseInjectedWallet";
import { PHANTOM_LEGACY_WALLET_NAME } from "@/lib/phantomLegacyWalletStandard";
import {
  resolvePendingWalletLinkAction,
  walletLinkResponseError,
} from "@/lib/buyerWalletLinkClient";

type WalletLink = {
  chainContext: string;
  normalizedAddress: string;
  verifiedAt: string;
};

type ChallengeResponse = {
  challengeId: string;
  message: string;
};

type ChallengePayload = ChallengeResponse | { error?: unknown };
type ConnectTarget = "phantom" | "base-passkey" | "base-injected";
type WalletLinkNotice = { kind: "success" | "error"; text: string };

export function BuyerWalletLinks() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const chain = useChainWallet();
  const solana = useAgentVouchWallet();
  const wallet = useWritableChainWallet();
  const [links, setLinks] = useState<WalletLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [linksAccountId, setLinksAccountId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [connectingTarget, setConnectingTarget] =
    useState<ConnectTarget | null>(null);
  const [pendingTarget, setPendingTarget] = useState<ConnectTarget | null>(
    null
  );
  const [notice, setNotice] = useState<WalletLinkNotice | null>(null);
  const walletLinksRequestRef = useRef(0);
  const walletLinkActionRef = useRef(0);

  useEffect(() => {
    // A wallet connection or signature may outlive a Clerk account switch.
    // Invalidate that action so it cannot link a wallet under the new buyer.
    walletLinkActionRef.current += 1;
    setPendingTarget(null);
    setConnectingTarget(null);
    setLinking(false);
  }, [isSignedIn, userId]);

  const loadLinks = useCallback(async () => {
    const requestId = ++walletLinksRequestRef.current;
    if (!isSignedIn || !userId) {
      setLinks([]);
      setLinksLoaded(false);
      setLinksAccountId(null);
      setLoading(false);
      return false;
    }
    setLinksLoaded(false);
    setLoading(true);
    try {
      const response = await fetch("/api/account/wallet-links", {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(await walletLinkResponseError(response));
      const body = (await response.json()) as { links?: WalletLink[] };
      if (walletLinksRequestRef.current !== requestId) return false;
      setLinks(Array.isArray(body.links) ? body.links : []);
      setLinksLoaded(true);
      setLinksAccountId(userId);
      setLoading(false);
      return true;
    } catch (error) {
      if (walletLinksRequestRef.current !== requestId) return false;
      throw error;
    }
  }, [isSignedIn, userId]);

  useEffect(() => {
    void loadLinks().catch((error: unknown) => {
      setNotice({
        kind: "error",
        text:
          error instanceof Error ? error.message : "Could not load wallets.",
      });
      setLoading(false);
    });
  }, [loadLinks]);

  const requestChallenge = useReverification(
    async (chainContext: string, address: string) => {
      const response = await fetch("/api/account/wallet-links/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainContext, address }),
      });
      // Clerk's reverification hook works with the decoded payload. Returning
      // JSON here lets it recognize the strict-reverification hint and avoids
      // treating the decoded retry result as another Response later.
      const payload = (await response
        .json()
        .catch(() => null)) as ChallengePayload | null;
      return payload ?? { error: `Request failed (${response.status}).` };
    }
  );

  const linkConnectedWallet = useCallback(
    async (existingActionId?: number) => {
      const actionId = existingActionId ?? ++walletLinkActionRef.current;
      const isCurrentAction = () => walletLinkActionRef.current === actionId;
      if (!wallet?.signMessage) {
        if (isCurrentAction()) {
          setNotice({
            kind: "error",
            text: "Connect a wallet that supports message signing first.",
          });
        }
        return;
      }
      if (!isCurrentAction()) return;
      setLinking(true);
      setNotice(null);
      try {
        const challengeResponse = await requestChallenge(
          wallet.chainContext,
          wallet.address
        );
        if (!isCurrentAction()) return;
        if (
          !challengeResponse ||
          typeof challengeResponse !== "object" ||
          !("challengeId" in challengeResponse) ||
          typeof challengeResponse.challengeId !== "string" ||
          !("message" in challengeResponse) ||
          typeof challengeResponse.message !== "string"
        ) {
          const error =
            challengeResponse &&
            typeof challengeResponse === "object" &&
            "error" in challengeResponse &&
            typeof challengeResponse.error === "string"
              ? challengeResponse.error
              : "Wallet challenge response was invalid.";
          throw new Error(error);
        }
        const challenge = challengeResponse as ChallengeResponse;
        const signature = await wallet.signMessage(challenge.message);
        if (!isCurrentAction()) return;
        const verifyResponse = await fetch("/api/account/wallet-links/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeId: challenge.challengeId,
            signature,
          }),
        });
        if (!isCurrentAction()) return;
        if (!verifyResponse.ok) {
          throw new Error(await walletLinkResponseError(verifyResponse));
        }
        const linksRefreshed = await loadLinks();
        if (!isCurrentAction() || !linksRefreshed) return;
        setNotice({ kind: "success", text: "Wallet linked." });
      } catch (error: unknown) {
        if (!isCurrentAction()) return;
        setNotice({
          kind: "error",
          text:
            error instanceof Error ? error.message : "Wallet linking failed.",
        });
      } finally {
        if (!isCurrentAction()) return;
        setPendingTarget(null);
        setLinking(false);
      }
    },
    [loadLinks, requestChallenge, wallet]
  );

  const targetIsConnected = useCallback(
    (target: ConnectTarget) => {
      if (target === "phantom") return chain.source === "phantom-extension";
      if (target === "base-passkey")
        return chain.source === BASE_PASSKEY_WALLET_SOURCE;
      return chain.source === BASE_INJECTED_WALLET_SOURCE;
    },
    [chain.source]
  );

  const linksAreForCurrentBuyer = linksLoaded && linksAccountId === userId;
  const visibleLinks = linksAreForCurrentBuyer ? links : [];
  const currentWalletLinked = Boolean(
    linksAreForCurrentBuyer &&
      wallet &&
      links.some(
        (link) =>
          link.chainContext === wallet.chainContext &&
          link.normalizedAddress ===
            normalizeChainAddressForStorage({
              chainContext: wallet.chainContext,
              value: wallet.address,
            })
      )
  );

  const connectAndLink = useCallback(
    async (target: ConnectTarget) => {
      const actionId = ++walletLinkActionRef.current;
      const isCurrentAction = () => walletLinkActionRef.current === actionId;
      setNotice(null);
      if (targetIsConnected(target) && wallet?.signMessage) {
        await linkConnectedWallet(actionId);
        return;
      }

      setConnectingTarget(target);
      setPendingTarget(null);
      try {
        if (target === "phantom") {
          await chain.base.disconnect();
          if (solana.status === "connected") await solana.disconnect();
          await solana.connectPhantomExtension();
        } else {
          if (solana.status === "connected") await solana.disconnect();
          if (target === "base-passkey") {
            await chain.base.connect();
          } else {
            await chain.base.connectInjected();
          }
        }
        if (!isCurrentAction()) return;
        setPendingTarget(target);
      } catch (error: unknown) {
        if (!isCurrentAction()) return;
        setNotice({
          kind: "error",
          text:
            error instanceof Error
              ? error.message
              : "Wallet connection failed.",
        });
      } finally {
        if (isCurrentAction()) setConnectingTarget(null);
      }
    },
    [chain.base, linkConnectedWallet, solana, targetIsConnected, wallet]
  );

  useEffect(() => {
    const action = resolvePendingWalletLinkAction({
      hasPendingTarget: Boolean(pendingTarget),
      connecting: Boolean(connectingTarget),
      linking,
      linksLoaded: linksAreForCurrentBuyer,
      canSign: Boolean(wallet?.signMessage),
      targetConnected: Boolean(
        pendingTarget && targetIsConnected(pendingTarget)
      ),
      currentWalletLinked,
    });
    if (action === "wait" || !pendingTarget) return;

    const settledTarget = pendingTarget;
    setPendingTarget(null);
    if (action === "already-linked") {
      const walletName =
        settledTarget === "phantom"
          ? PHANTOM_LEGACY_WALLET_NAME
          : settledTarget === "base-passkey"
          ? BASE_PASSKEY_WALLET_NAME
          : BASE_INJECTED_WALLET_NAME;
      setNotice({
        kind: "success",
        text: `${walletName} is already linked to this account.`,
      });
      return;
    }
    void linkConnectedWallet();
  }, [
    connectingTarget,
    currentWalletLinked,
    linkConnectedWallet,
    linking,
    linksAreForCurrentBuyer,
    pendingTarget,
    targetIsConnected,
    wallet,
  ]);

  if (!isLoaded)
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Loading account…
      </p>
    );
  if (!isSignedIn) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        <Link
          href="/sign-in"
          className="text-[var(--sea-accent-strong)] hover:underline"
        >
          Sign in
        </Link>{" "}
        to manage linked wallets.
      </p>
    );
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Linked wallets
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          A signed, one-time challenge proves control without exposing your
          Google or email identity onchain.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Loading wallets…
        </p>
      ) : visibleLinks.length ? (
        <ul className="space-y-2">
          {visibleLinks.map((link) => (
            <li
              key={`${link.chainContext}:${link.normalizedAddress}`}
              className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="font-medium text-gray-900 dark:text-white">
                {getChainDisplayLabel(link.chainContext)}
              </div>
              <div className="font-mono text-sm text-gray-500 dark:text-gray-400">
                {shortenChainAddress({
                  chainContext: link.chainContext,
                  value: link.normalizedAddress,
                })}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No wallets linked yet.
        </p>
      )}

      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          aria-live={notice.kind === "error" ? "assertive" : "polite"}
          className={
            notice.kind === "error"
              ? "rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
              : "rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          }
        >
          {notice.text}
        </p>
      ) : null}

      {wallet?.signMessage ? (
        <button
          type="button"
          onClick={() => void linkConnectedWallet()}
          disabled={
            !linksAreForCurrentBuyer ||
            currentWalletLinked ||
            linking ||
            !!connectingTarget ||
            !!pendingTarget
          }
          className={navButtonPrimaryInlineClass}
        >
          {currentWalletLinked
            ? "Current wallet linked"
            : linking
            ? "Linking…"
            : `Link current ${getChainDisplayLabel(
                wallet.chainContext
              )} wallet`}
        </button>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {wallet ? "Or connect and link another wallet:" : "Choose a wallet:"}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void connectAndLink("phantom")}
            disabled={
              !linksAreForCurrentBuyer ||
              (targetIsConnected("phantom") && currentWalletLinked) ||
              linking ||
              !!connectingTarget ||
              !!pendingTarget ||
              !solana.phantomInstalled
            }
            className={navButtonSecondaryInlineClass}
          >
            {targetIsConnected("phantom") && currentWalletLinked
              ? `${PHANTOM_LEGACY_WALLET_NAME} linked`
              : connectingTarget === "phantom"
              ? "Connecting Phantom…"
              : targetIsConnected("phantom")
              ? `Link ${PHANTOM_LEGACY_WALLET_NAME}`
              : `Connect & link ${PHANTOM_LEGACY_WALLET_NAME}`}
          </button>
          <button
            type="button"
            onClick={() => void connectAndLink("base-passkey")}
            disabled={
              !linksAreForCurrentBuyer ||
              (targetIsConnected("base-passkey") && currentWalletLinked) ||
              linking ||
              !!connectingTarget ||
              !!pendingTarget ||
              !chain.base.configured
            }
            className={navButtonSecondaryInlineClass}
          >
            {targetIsConnected("base-passkey") && currentWalletLinked
              ? `${BASE_PASSKEY_WALLET_NAME} linked`
              : connectingTarget === "base-passkey"
              ? "Opening passkey…"
              : targetIsConnected("base-passkey")
              ? `Link ${BASE_PASSKEY_WALLET_NAME}`
              : `Connect & link ${BASE_PASSKEY_WALLET_NAME}`}
          </button>
          <button
            type="button"
            onClick={() => void connectAndLink("base-injected")}
            disabled={
              !linksAreForCurrentBuyer ||
              (targetIsConnected("base-injected") && currentWalletLinked) ||
              linking ||
              !!connectingTarget ||
              !!pendingTarget ||
              !chain.base.configured ||
              !chain.base.injectedAvailable
            }
            className={navButtonSecondaryInlineClass}
          >
            {targetIsConnected("base-injected") && currentWalletLinked
              ? `${BASE_INJECTED_WALLET_NAME} linked`
              : connectingTarget === "base-injected"
              ? "Opening MetaMask…"
              : targetIsConnected("base-injected")
              ? `Link ${BASE_INJECTED_WALLET_NAME}`
              : `Connect & link ${BASE_INJECTED_WALLET_NAME}`}
          </button>
        </div>
        {!solana.phantomInstalled ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Install the Phantom browser extension to link a Solana wallet.
          </p>
        ) : null}
      </div>
    </section>
  );
}
