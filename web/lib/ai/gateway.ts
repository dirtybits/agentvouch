import { gateway } from "ai";

// Gateway remains an explicit rollback option. Jasmine calls use provider.ts;
// these string identifiers are also used by DB cache readers across the app.
export { gateway };

export const AI_PROVIDER = process.env.AI_PROVIDER?.trim() || "gateway";
if (AI_PROVIDER !== "gateway" && AI_PROVIDER !== "jasmine") {
  throw new Error("AI_PROVIDER must be gateway or jasmine");
}

export const JASMINE_MODEL =
  process.env.JASMINE_MODEL?.trim() || "huihui-qwen3-8-27b-ud-q4-k-xl";

export const SUMMARY_MODEL =
  AI_PROVIDER === "jasmine"
    ? `jasmine/${JASMINE_MODEL}`
    : "google/gemini-2.5-flash-lite";
export const SCAN_MODEL =
  AI_PROVIDER === "jasmine"
    ? `jasmine/${JASMINE_MODEL}`
    : process.env.AI_SCAN_MODEL || "google/gemini-2.5-flash-lite";

// Cost-attribution tags surfaced in the AI Gateway dashboard.
export function gatewayTags(feature: string): string[] {
  const env = process.env.VERCEL_ENV ?? "development";
  return [`feature:${feature}`, `env:${env}`];
}
