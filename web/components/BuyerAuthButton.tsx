"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { navButtonSecondaryInlineClass } from "@/lib/buttonStyles";
import { isBuyerAuthUiEnabled } from "@/lib/buyerAuthConfig";

export function BuyerAuthButton() {
  if (!isBuyerAuthUiEnabled()) return null;
  return <EnabledBuyerAuthButton />;
}

function EnabledBuyerAuthButton() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <Link href="/sign-in" className={navButtonSecondaryInlineClass}>
        Sign in
      </Link>
    );
  }
  return (
    <UserButton
      appearance={{ elements: { avatarBox: "h-9 w-9" } }}
      userProfileMode="modal"
    />
  );
}
