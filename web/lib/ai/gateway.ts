import { gateway } from "ai";

// Shared Vercel AI Gateway entry point. Models are plain "provider/model" strings
// that route through the gateway automatically (auth: AI_GATEWAY_API_KEY → OIDC).
export { gateway };

// Model choices live here so both AI phases share one source of truth.
// - SUMMARY_MODEL: cheap, NON-reasoning model for high-volume one-liners. Reasoning
//   models (e.g. qwen *-flash / *-thinking) burn tokens and fail structured output,
//   so we use gemini-2.0-flash-lite (chosen 2026-05-29: reliable generateObject,
//   cheapest tier). One-line swap if the model choice changes.
// - SCAN_MODEL: defaults to the accessible gateway model proven in production;
//   override AI_SCAN_MODEL when the project has paid access to a stronger model.
export const SUMMARY_MODEL = "google/gemini-2.0-flash-lite";
export const SCAN_MODEL =
  process.env.AI_SCAN_MODEL || "google/gemini-2.0-flash-lite";

// Cost-attribution tags surfaced in the AI Gateway dashboard.
export function gatewayTags(feature: string): string[] {
  const env = process.env.VERCEL_ENV ?? "development";
  return [`feature:${feature}`, `env:${env}`];
}
