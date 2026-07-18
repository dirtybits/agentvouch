"use client";

import { useAuth, useReverification } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWritableChainWallet } from "@/hooks/useWritableChainWallet";
import { navButtonPrimaryInlineClass } from "@/lib/buttonStyles";
import { getChainDisplayLabel } from "@/lib/chains";
import { shortenChainAddress } from "@/lib/chainAddress";

type WalletLink = {
  chainContext: string;
  normalizedAddress: string;
  verifiedAt: string;
};

type ChallengeResponse = {
  challengeId: string;
  message: string;
};

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  return typeof body?.error === "string"
    ? body.error
    : `Request failed (${response.status}).`;
}

export function BuyerWalletLinks() {
  const { isLoaded, isSignedIn } = useAuth();
  const wallet = useWritableChainWallet();
  const [links, setLinks] = useState<WalletLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    const response = await fetch("/api/account/wallet-links", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await responseError(response));
    const body = (await response.json()) as { links?: WalletLink[] };
    setLinks(Array.isArray(body.links) ? body.links : []);
    setLoading(false);
  }, [isSignedIn]);

  useEffect(() => {
    void loadLinks().catch((error: unknown) => {
      setMessage(
        error instanceof Error ? error.message : "Could not load wallets."
      );
      setLoading(false);
    });
  }, [loadLinks]);

  const requestChallenge = useReverification(
    async (chainContext: string, address: string) =>
      fetch("/api/account/wallet-links/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chainContext, address }),
      })
  );

  const linkConnectedWallet = useCallback(async () => {
    if (!wallet?.signMessage) {
      setMessage("Connect a wallet that supports message signing first.");
      return;
    }
    setLinking(true);
    setMessage(null);
    try {
      const challengeResponse = await requestChallenge(
        wallet.chainContext,
        wallet.address
      );
      if (!challengeResponse.ok) {
        throw new Error(await responseError(challengeResponse));
      }
      const challenge = (await challengeResponse.json()) as ChallengeResponse;
      const signature = await wallet.signMessage(challenge.message);
      const verifyResponse = await fetch("/api/account/wallet-links/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          signature,
        }),
      });
      if (!verifyResponse.ok) {
        throw new Error(await responseError(verifyResponse));
      }
      await loadLinks();
      setMessage("Wallet linked.");
    } catch (error: unknown) {
      setMessage(
        error instanceof Error ? error.message : "Wallet linking failed."
      );
    } finally {
      setLinking(false);
    }
  }, [loadLinks, requestChallenge, wallet]);

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
      ) : links.length ? (
        <ul className="space-y-2">
          {links.map((link) => (
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

      <button
        type="button"
        onClick={() => void linkConnectedWallet()}
        disabled={linking || !wallet?.signMessage}
        className={navButtonPrimaryInlineClass}
      >
        {linking
          ? "Linking…"
          : wallet
          ? `Link ${getChainDisplayLabel(wallet.chainContext)} wallet`
          : "Connect a wallet to link it"}
      </button>
      {message ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
      ) : null}
    </section>
  );
}
