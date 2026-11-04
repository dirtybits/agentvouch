"use client";

import { useRef, useState } from "react";
import { useModal } from "@phantom/react-sdk";
import { navButtonPrimaryInlineClass } from "@/lib/buttonStyles";

export function PhantomSocialSignInButton({
  onBeforeOpen,
}: {
  onBeforeOpen: () => Promise<void>;
}) {
  const { open, isOpened } = useModal();
  const openingRef = useRef(false);
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setIsOpening(true);
    setError(null);
    try {
      // Invalidate restored Base sessions before an explicit Solana choice.
      // A click handler covers keyboard activation as well as pointer input.
      await onBeforeOpen();
      open();
    } catch {
      setError("Could not open sign-in. Please try again.");
    } finally {
      openingRef.current = false;
      setIsOpening(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`${navButtonPrimaryInlineClass} w-full disabled:opacity-60`}
        onClick={handleClick}
        disabled={isOpening}
        aria-haspopup="dialog"
        aria-expanded={isOpened}
        aria-busy={isOpening}
      >
        {isOpening ? "Opening sign-in..." : "Continue with Google/Apple"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </>
  );
}
