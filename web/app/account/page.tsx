import { notFound } from "next/navigation";
import { BuyerWalletLinks } from "@/components/BuyerWalletLinks";
import { isBuyerAuthServerEnabled } from "@/lib/buyerAuthConfig";

export default function BuyerAccountPage() {
  if (!isBuyerAuthServerEnabled()) notFound();

  return (
    <main className="mx-auto min-h-[70vh] max-w-3xl px-4 py-12 md:px-6">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
        Buyer account
      </h1>
      <p className="mt-2 mb-8 text-gray-500 dark:text-gray-400">
        Link wallets you control to the same private AgentVouch buyer account.
      </p>
      <BuyerWalletLinks />
    </main>
  );
}
