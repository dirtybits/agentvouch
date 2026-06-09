import type { ComponentProps } from "react";
import {
  loadMarketplaceBrowseSnapshot,
  MARKETPLACE_PAGE_SIZE,
} from "@/lib/marketplaceBrowse";
import MarketplaceClient from "./MarketplaceClient";

export const dynamic = "force-dynamic";

type InitialSkills = ComponentProps<typeof MarketplaceClient>["initialSkills"];

/**
 * Server shell for the marketplace. Renders the default browse view (page 1,
 * trusted sort) from the Postgres snapshot so first paint shows real cards;
 * MarketplaceClient takes over for search, sort, pagination, and wallet state.
 * On snapshot failure the client falls back to fetching from /api/skills.
 */
export default async function MarketplacePage() {
  const snapshot = await loadMarketplaceBrowseSnapshot({
    pageSize: MARKETPLACE_PAGE_SIZE,
  });

  return (
    <MarketplaceClient
      initialSkills={
        snapshot ? (snapshot.skills as unknown as InitialSkills) : null
      }
      initialTotal={snapshot?.total ?? 0}
      pageSize={MARKETPLACE_PAGE_SIZE}
    />
  );
}
