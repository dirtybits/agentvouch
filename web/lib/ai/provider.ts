import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import {
  AI_PROVIDER,
  JASMINE_MODEL,
  SCAN_MODEL,
  SUMMARY_MODEL,
  gatewayTags,
} from "@/lib/ai/gateway";

type Feature = "skill-summary" | "skill-scan";
type ModelOptions = {
  model: LanguageModel;
  providerOptions?: { gateway: { tags: string[] } };
  maxOutputTokens?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
  temperature?: number;
};

function jasmineConfig() {
  const rawUrl = process.env.JASMINE_BASE_URL?.trim();
  if (!rawUrl) throw new Error("JASMINE_BASE_URL is required for Jasmine");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      "JASMINE_BASE_URL must be an absolute API URL ending in /v1"
    );
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/, "") !== "/v1" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    (loopback && process.env.VERCEL === "1")
  ) {
    throw new Error(
      "JASMINE_BASE_URL requires HTTPS /v1; local development may use loopback HTTP"
    );
  }

  const apiKey = process.env.JASMINE_API_KEY?.trim();
  const clientId = process.env.JASMINE_CF_ACCESS_CLIENT_ID?.trim();
  const clientSecret = process.env.JASMINE_CF_ACCESS_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error("Both Jasmine Cloudflare Access credentials are required");
  }
  if (!loopback && !apiKey && !clientId) {
    throw new Error("Remote Jasmine requires a service credential");
  }
  const timeoutMs = Number(process.env.JASMINE_TIMEOUT_MS ?? 45_000);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 120_000
  ) {
    throw new Error("JASMINE_TIMEOUT_MS must be between 1000 and 120000");
  }
  return {
    baseURL: url.toString().replace(/\/$/, ""),
    apiKey,
    headers:
      clientId && clientSecret
        ? {
            "CF-Access-Client-Id": clientId,
            "CF-Access-Client-Secret": clientSecret,
          }
        : undefined,
    timeoutMs,
  };
}

// Called only when generating, so cache reads never need endpoint credentials.
// Keep these settings on the server: callers already import the DB-backed AI modules.
export function advisoryModelOptions(feature: Feature): ModelOptions {
  if (AI_PROVIDER === "gateway") {
    return {
      model: feature === "skill-scan" ? SCAN_MODEL : SUMMARY_MODEL,
      providerOptions: { gateway: { tags: gatewayTags(feature) } },
    };
  }
  const { timeoutMs, ...config } = jasmineConfig();
  const jasmine = createOpenAICompatible({
    ...config,
    name: "jasmine",
    supportsStructuredOutputs: true,
    transformRequestBody: (body) => ({
      ...body,
      chat_template_kwargs: { enable_thinking: false },
    }),
    fetch: async (input, init) => {
      let response: Response;
      try {
        // Do not forward service credentials or skill content to a login redirect.
        response = await fetch(input, { ...init, redirect: "error" });
      } catch {
        throw new Error(
          init?.signal?.aborted
            ? "Jasmine request timed out or was cancelled"
            : "Jasmine connection failed"
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        // Upstream error bodies can contain prompts or proxy details.
        throw new Error(`Jasmine request failed (HTTP ${response.status})`);
      }
      return response;
    },
  });
  return {
    model: jasmine.chatModel(JASMINE_MODEL),
    maxOutputTokens: feature === "skill-scan" ? 4096 : 512,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(timeoutMs),
    temperature: 0,
  };
}
