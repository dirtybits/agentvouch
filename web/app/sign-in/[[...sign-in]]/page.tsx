import { SignIn } from "@clerk/nextjs";
import { notFound } from "next/navigation";
import { isBuyerAuthServerEnabled } from "@/lib/buyerAuthConfig";

export default function BuyerSignInPage() {
  if (!isBuyerAuthServerEnabled()) notFound();

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-7xl items-center justify-center px-4 py-12 md:px-6">
      <SignIn
        fallbackRedirectUrl="/skills"
        signUpFallbackRedirectUrl="/skills"
        withSignUp
      />
    </main>
  );
}
