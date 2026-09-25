import { describe, expect, it } from "vitest";
import { formatUsdcMicros } from "@/lib/pricing";

describe("formatUsdcMicros", () => {
  it("formats whole, fractional, and sub-cent USDC amounts", () => {
    expect(formatUsdcMicros("1000000")).toBe("1");
    expect(formatUsdcMicros("1500000")).toBe("1.50");
    expect(formatUsdcMicros("100000")).toBe("0.10");
    expect(formatUsdcMicros("1")).toBe("0.000001");
  });

  it("preserves every micro-unit above Number's safe integer range", () => {
    expect(formatUsdcMicros("9007199254740993")).toBe("9,007,199,254.740993");
    expect(formatUsdcMicros(9007199254740993n)).toBe("9,007,199,254.740993");
  });

  it("returns null for missing or non-integer values", () => {
    expect(formatUsdcMicros(null)).toBeNull();
    expect(formatUsdcMicros("not-a-number")).toBeNull();
    expect(formatUsdcMicros("1.5")).toBeNull();
  });
});
