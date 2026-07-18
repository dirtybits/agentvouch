import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import { isBuyerAuthServerEnabled } from "@/lib/buyerAuthConfig";

// Development Clerk instances must call their accounts.dev Frontend API
// directly. Clerk's Frontend API proxy is production-only and returns
// `host_invalid` when used with the development keys used by Vercel previews.
const buyerAuthMiddleware = clerkMiddleware();

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!isBuyerAuthServerEnabled()) return NextResponse.next();
  return buyerAuthMiddleware(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api)(.*)",
  ],
};
