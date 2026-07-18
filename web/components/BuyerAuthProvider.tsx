import { ClerkProvider } from "@clerk/nextjs";
import { isBuyerAuthServerEnabled } from "@/lib/buyerAuthConfig";

export function BuyerAuthProvider({ children }: { children: React.ReactNode }) {
  if (!isBuyerAuthServerEnabled()) return children;
  return <ClerkProvider>{children}</ClerkProvider>;
}
