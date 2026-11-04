import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbQuery, sql } = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ sql }));

const MODEL = "huihui-qwen3-8-27b-ud-q4-k-xl";
const envKeys = [
  "AI_PROVIDER",
  "AI_SCAN_MODEL",
  "AI_SCAN_MAX_INPUT_BYTES",
  "JASMINE_BASE_URL",
  "JASMINE_MODEL",
  "JASMINE_API_KEY",
  "JASMINE_CF_ACCESS_CLIENT_ID",
  "JASMINE_CF_ACCESS_CLIENT_SECRET",
  "JASMINE_TIMEOUT_MS",
  "VERCEL",
  "VERCEL_ENV",
] as const;
const fetchMock = vi.fn<typeof fetch>();
const cleanFiles = [
  {
    path: "SKILL.md",
    contentType: "text/markdown",
    bytes: Buffer.from("# Helper\nSummarize a local file."),
  },
];

function completion(content: unknown): Response {
  return Response.json({
    id: "fixture-completion",
    object: "chat.completion",
    created: 1,
    model: MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            typeof content === "string" ? content : JSON.stringify(content),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
  });
}

function requestedBody(index = 0) {
  const [url, init] = fetchMock.mock.calls[index];
  return {
    url: String(url),
    init,
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body)),
  };
}

describe("Jasmine advisory provider", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of envKeys) vi.stubEnv(key, undefined);
    vi.stubEnv("AI_PROVIDER", "jasmine");
    vi.stubEnv("JASMINE_BASE_URL", "http://127.0.0.1:18085/v1/");
    vi.stubGlobal("fetch", fetchMock);
    sql.mockReturnValue(dbQuery);
    fetchMock.mockResolvedValue(
      completion({ verdict: "review", risk: "low", findings: [] })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the real scanner schema to Chat Completions with thinking disabled", async () => {
    const { scanSkillTree } = await import("@/lib/ai/scan");
    await expect(scanSkillTree(cleanFiles)).resolves.toEqual({
      verdict: "review",
      risk: "low",
      findings: [],
      truncated: false,
    });

    const { url, init, headers, body } = requestedBody();
    expect(url).toBe("http://127.0.0.1:18085/v1/chat/completions");
    expect(init?.redirect).toBe("error");
    expect(headers.has("Authorization")).toBe(false);
    expect(body).toMatchObject({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
      response_format: {
        type: "json_schema",
        json_schema: {
          schema: { properties: { verdict: { enum: ["review", "avoid"] } } },
        },
      },
    });
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[0].content).toContain("UNTRUSTED DATA");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sql).not.toHaveBeenCalled();
  });

  it("uses the same endpoint for summaries with a smaller output limit", async () => {
    fetchMock.mockResolvedValueOnce(
      completion({
        oneLiner: "Summarizes a local file.",
        capabilities: ["file summaries"],
      })
    );
    const { summarizeSkill } = await import("@/lib/ai/summarize");
    await expect(
      summarizeSkill("# Helper\nSummarize a local file.")
    ).resolves.toEqual({
      oneLiner: "Summarizes a local file.",
      capabilities: ["file summaries"],
    });
    expect(requestedBody().body).toMatchObject({
      model: MODEL,
      max_tokens: 512,
    });
    expect(sql).not.toHaveBeenCalled();
  });

  it.each(["bearer", "cloudflare", "both"])(
    "sends %s service authentication in headers only",
    async (mode) => {
      vi.stubEnv("JASMINE_BASE_URL", "https://jasmine-api.example.com/v1");
      if (mode !== "cloudflare")
        vi.stubEnv("JASMINE_API_KEY", "fixture-bearer");
      if (mode !== "bearer") {
        vi.stubEnv("JASMINE_CF_ACCESS_CLIENT_ID", "fixture-client-id");
        vi.stubEnv("JASMINE_CF_ACCESS_CLIENT_SECRET", "fixture-client-secret");
      }
      const { scanSkillTree } = await import("@/lib/ai/scan");
      await scanSkillTree(cleanFiles);
      const { url, headers, body } = requestedBody();
      expect(url).toBe("https://jasmine-api.example.com/v1/chat/completions");
      expect(headers.get("Authorization")).toBe(
        mode === "cloudflare" ? null : "Bearer fixture-bearer"
      );
      expect(headers.get("CF-Access-Client-Id")).toBe(
        mode === "bearer" ? null : "fixture-client-id"
      );
      expect(headers.get("CF-Access-Client-Secret")).toBe(
        mode === "bearer" ? null : "fixture-client-secret"
      );
      expect(JSON.stringify(body)).not.toContain("fixture-");
    }
  );

  it.each([429, 503])(
    "does not retry or fall back after HTTP %i",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        new Response("PRIVATE_UPSTREAM_DETAIL", { status })
      );
      const { scanSkillTree } = await import("@/lib/ai/scan");
      await expect(scanSkillTree(cleanFiles)).rejects.toMatchObject({
        message: `Jasmine request failed (HTTP ${status})`,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requestedBody().url).toContain("127.0.0.1:18085");
    }
  );

  it("does not retry or disclose transport details after a failed redirect", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("PRIVATE_REDIRECT_DETAIL"));
    const { scanSkillTree } = await import("@/lib/ai/scan");
    await expect(scanSkillTree(cleanFiles)).rejects.toMatchObject({
      message: "Jasmine connection failed",
    });
    expect(requestedBody().init?.redirect).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "not JSON",
    { verdict: "allow", risk: "low", findings: [] },
    { verdict: "review", risk: "low", findings: "not an array" },
  ])(
    "rejects invalid scanner output without substituting an advisory result: %j",
    async (output) => {
      fetchMock.mockResolvedValueOnce(completion(output));
      const { scanSkillTree } = await import("@/lib/ai/scan");
      await expect(scanSkillTree(cleanFiles)).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sql).not.toHaveBeenCalled();
    }
  );

  it("cancels a slow request at the configured deadline without retrying", async () => {
    vi.stubEnv("JASMINE_TIMEOUT_MS", "1000");
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const { scanSkillTree } = await import("@/lib/ai/scan");
    await expect(scanSkillTree(cleanFiles)).rejects.toThrow(
      "Jasmine request timed out or was cancelled"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each<{ name: string; env: Record<string, string | undefined> }>([
    { name: "missing URL", env: { JASMINE_BASE_URL: undefined } },
    { name: "invalid URL", env: { JASMINE_BASE_URL: "not-a-url" } },
    {
      name: "remote HTTP",
      env: {
        JASMINE_BASE_URL: "http://jasmine-api.example.com/v1",
        JASMINE_API_KEY: "fixture",
      },
    },
    {
      name: "URL credentials",
      env: {
        JASMINE_BASE_URL: "https://user:secret@jasmine-api.example.com/v1",
        JASMINE_API_KEY: "fixture",
      },
    },
    {
      name: "URL query",
      env: { JASMINE_BASE_URL: "http://localhost:18085/v1?key=secret" },
    },
    {
      name: "non-API path",
      env: { JASMINE_BASE_URL: "http://localhost:18085/api/v2/chat" },
    },
    {
      name: "missing remote authentication",
      env: { JASMINE_BASE_URL: "https://jasmine-api.example.com/v1" },
    },
    {
      name: "partial Cloudflare authentication",
      env: { JASMINE_CF_ACCESS_CLIENT_ID: "fixture-id" },
    },
    { name: "Vercel loopback", env: { VERCEL: "1" } },
    { name: "unbounded timeout", env: { JASMINE_TIMEOUT_MS: "120001" } },
  ])("rejects $name before sending content", async ({ env }) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const { advisoryModelOptions } = await import("@/lib/ai/provider");
    expect(() => advisoryModelOptions("skill-scan")).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("truncates scanner input at 32 KiB even when the gateway cap is larger", async () => {
    vi.stubEnv("AI_SCAN_MAX_INPUT_BYTES", String(512 * 1024));
    const { MAX_SCAN_INPUT_BYTES, scanSkillTree } = await import(
      "@/lib/ai/scan"
    );
    expect(MAX_SCAN_INPUT_BYTES).toBe(32 * 1024);
    const result = await scanSkillTree([
      {
        ...cleanFiles[0],
        bytes: Buffer.concat([
          Buffer.alloc(32 * 1024, "a"),
          Buffer.from("DROP_THIS_TAIL"),
        ]),
      },
    ]);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(requestedBody().body.messages)).not.toContain(
      "DROP_THIS_TAIL"
    );
  });

  it("permits operators to lower the Jasmine input cap", async () => {
    vi.stubEnv("AI_SCAN_MAX_INPUT_BYTES", "1024");
    const { MAX_SCAN_INPUT_BYTES } = await import("@/lib/ai/scan");
    expect(MAX_SCAN_INPUT_BYTES).toBe(1024);
  });

  it("reads model-qualified cached scans without endpoint credentials", async () => {
    vi.stubEnv("JASMINE_BASE_URL", undefined);
    vi.stubEnv("JASMINE_MODEL", "fixture-huihui");
    vi.stubEnv("AI_SCAN_MODEL", "google/unused-gateway-model");
    const { SUMMARY_MODEL, SCAN_MODEL } = await import("@/lib/ai/gateway");
    expect(SUMMARY_MODEL).toBe("jasmine/fixture-huihui");
    expect(SCAN_MODEL).toBe(SUMMARY_MODEL);
    dbQuery.mockResolvedValueOnce([
      {
        scan_verdict: "review",
        scan_risk: "low",
        scan_findings: [],
        scan_model: SCAN_MODEL,
        scan_rubric_version: "v1",
      },
    ]);
    const { getCachedSkillScan } = await import("@/lib/ai/scan");
    await expect(getCachedSkillScan("fixture-hash")).resolves.toMatchObject({
      model: SCAN_MODEL,
      verdict: "review",
    });
    expect(dbQuery.mock.calls[0].slice(1)).toContain(SCAN_MODEL);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the gateway default and explicit scan-model override", async () => {
    vi.stubEnv("AI_PROVIDER", undefined);
    vi.stubEnv("JASMINE_BASE_URL", undefined);
    vi.stubEnv("AI_SCAN_MODEL", "google/fixture-scan-model");
    vi.stubEnv("VERCEL_ENV", "preview");
    const { advisoryModelOptions } = await import("@/lib/ai/provider");
    expect(advisoryModelOptions("skill-scan")).toEqual({
      model: "google/fixture-scan-model",
      providerOptions: {
        gateway: { tags: ["feature:skill-scan", "env:preview"] },
      },
    });
    expect(advisoryModelOptions("skill-summary").model).toBe(
      "google/gemini-2.5-flash-lite"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a misspelled provider instead of selecting the gateway", async () => {
    vi.stubEnv("AI_PROVIDER", "jasmin");
    await expect(import("@/lib/ai/gateway")).rejects.toThrow(
      "AI_PROVIDER must be gateway or jasmine"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
