import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import { isBuyerAuthServerEnabled } from "@/lib/buyerAuthConfig";

const buyerAuthMiddleware = clerkMiddleware({
  frontendApiProxy: { enabled: true },
});

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
