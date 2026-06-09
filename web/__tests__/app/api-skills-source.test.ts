import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("skills api source", () => {
  it("hydrates buyer purchase state for USDC and SOL listings", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/api/skills/route.ts"),
      "utf8"
    );

    expect(source).toContain("buyerHasPurchased");
    expect(source).toContain("hasUsdcPurchaseEntitlement");
    expect(source).toContain("hasOnChainPurchase");
  });

  it("keeps RPC-heavy card enrichment off the fast listing path", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/api/skills/route.ts"),
      "utf8"
    );
    const hydrateSource = fs.readFileSync(
      path.join(process.cwd(), "app/api/skills/hydrate/route.ts"),
      "utf8"
    );

    expect(source).toContain('searchParams.get("mode") === "fast"');
    expect(source).toContain('searchParams.get("deferRpc") === "1"');
    expect(source).toContain('headers["Server-Timing"]');
    expect(hydrateSource).toContain("MAX_HYDRATE_SKILLS");
    expect(hydrateSource).toContain("createPurchasePreflightContext");
    // Trust is snapshot-first: serve cached, resolve first-seen authors, and
    // revalidate stale ones in the background.
    expect(hydrateSource).toContain("partitionAuthorsByTrustFreshness");
    expect(hydrateSource).toContain("resolveTrustAndIdentity");
    expect(hydrateSource).toContain("scheduleBackgroundTrustRefresh");
  });

  it("uses ranked expanded Postgres search with trigram fallback", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/api/skills/route.ts"),
      "utf8"
    );
    const dbSource = fs.readFileSync(path.join(process.cwd(), "lib/db.ts"), "utf8");

    expect(source).toContain("websearch_to_tsquery");
    expect(source).toContain("ts_rank_cd");
    expect(source).toContain("search_rank");
    expect(source).toContain("similarity(");
    expect(source).toContain("word_similarity(");
    expect(source).toContain("% search.raw_query");
    expect(source).toContain("agentvouch_skill_search_tsvector");
    expect(source).toContain("agentvouch_skill_search_text");
    expect(dbSource).toContain("CREATE OR REPLACE FUNCTION agentvouch_skill_search_tsvector");
    expect(dbSource).toContain("array_to_string(COALESCE(tags");
    expect(source).toContain("author_display_name");
    expect(dbSource).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(dbSource).toContain("idx_skills_search_v2");
    expect(dbSource).toContain("idx_skills_search_trgm");
  });

  it("exposes repo listing activity plus recent USDC receipts", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/api/skills/activity/route.ts"),
      "utf8"
    );

    expect(source).toContain("usdc_purchase_receipts");
    expect(source).toContain("price_usdc_micros");
    expect(source).toContain("payment_flow");
  });
});
