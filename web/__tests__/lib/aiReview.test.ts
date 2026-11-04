import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateSummarySafe, runScanSafe } = vi.hoisted(() => ({
  generateSummarySafe: vi.fn(),
  runScanSafe: vi.fn(),
}));
vi.mock("@/lib/ai/summarize", () => ({ generateSummarySafe }));
vi.mock("@/lib/ai/scan", () => ({ runScanSafe }));

const args = {
  skillId: "skill-123",
  content: "# Helper\nSummarize a local file.",
  treeHash: "tree-123",
  files: [
    {
      path: "SKILL.md",
      contentType: "text/markdown",
      bytes: Buffer.from("# Helper\nSummarize a local file."),
    },
  ],
  expectedVersion: 2,
};

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("automated skill review scheduling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubEnv("AI_PROVIDER", "jasmine");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("finishes Jasmine's scan before starting its summary and awaits both", async () => {
    const scan = deferred();
    const summary = deferred();
    const summaryStarted = deferred();
    const events: string[] = [];
    runScanSafe.mockImplementation(async () => {
      events.push("scan:start");
      await scan.promise;
      events.push("scan:end");
    });
    generateSummarySafe.mockImplementation(async () => {
      events.push("summary:start");
      summaryStarted.resolve();
      await summary.promise;
      events.push("summary:end");
    });
    const { runReviewSafe } = await import("@/lib/ai/review");
    let finished = false;
    const review = runReviewSafe(args).then(() => {
      finished = true;
    });

    expect(events).toEqual(["scan:start"]);
    expect(runScanSafe).toHaveBeenCalledExactlyOnceWith(
      args.treeHash,
      args.files
    );
    expect(generateSummarySafe).not.toHaveBeenCalled();
    scan.resolve();
    await summaryStarted.promise;
    expect(events).toEqual(["scan:start", "scan:end", "summary:start"]);
    expect(generateSummarySafe).toHaveBeenCalledExactlyOnceWith(
      args.skillId,
      args.content,
      { expectedVersion: args.expectedVersion }
    );
    expect(finished).toBe(false);

    summary.resolve();
    await review;
    expect(events).toEqual([
      "scan:start",
      "scan:end",
      "summary:start",
      "summary:end",
    ]);
    expect(finished).toBe(true);
  });

  it("still starts and awaits Jasmine's summary after its scan rejects", async () => {
    const scan = deferred();
    const summary = deferred();
    const summaryStarted = deferred();
    runScanSafe.mockReturnValue(scan.promise);
    generateSummarySafe.mockImplementation(() => {
      summaryStarted.resolve();
      return summary.promise;
    });
    const { runReviewSafe } = await import("@/lib/ai/review");
    let finished = false;
    const review = runReviewSafe(args).then(() => {
      finished = true;
    });

    expect(generateSummarySafe).not.toHaveBeenCalled();
    scan.reject(new Error("scan failed"));
    await summaryStarted.promise;
    expect(generateSummarySafe).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    summary.resolve();
    await expect(review).resolves.toBeUndefined();
    expect(finished).toBe(true);
  });

  it("keeps a Jasmine summary rejection best-effort", async () => {
    runScanSafe.mockResolvedValue(undefined);
    generateSummarySafe.mockRejectedValue(new Error("summary failed"));
    const { runReviewSafe } = await import("@/lib/ai/review");

    await expect(runReviewSafe(args)).resolves.toBeUndefined();
    expect(runScanSafe).toHaveBeenCalledOnce();
    expect(generateSummarySafe).toHaveBeenCalledOnce();
  });

  it.each([undefined, "gateway"])(
    "runs both gateway passes concurrently with AI_PROVIDER=%s",
    async (provider) => {
      vi.stubEnv("AI_PROVIDER", provider);
      const scan = deferred();
      const summary = deferred();
      runScanSafe.mockReturnValue(scan.promise);
      generateSummarySafe.mockReturnValue(summary.promise);
      const { runReviewSafe } = await import("@/lib/ai/review");
      let finished = false;
      const review = runReviewSafe(args).then(() => {
        finished = true;
      });

      expect(generateSummarySafe).toHaveBeenCalledOnce();
      expect(runScanSafe).toHaveBeenCalledOnce();
      summary.reject(new Error("summary failed"));
      await Promise.resolve();
      expect(finished).toBe(false);
      scan.resolve();
      await expect(review).resolves.toBeUndefined();
      expect(finished).toBe(true);
    }
  );
});
