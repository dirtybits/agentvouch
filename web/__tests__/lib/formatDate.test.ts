import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/formatDate";

describe("formatDate", () => {
  it("formats an ISO string as 'Mon DD, YYYY'", () => {
    expect(formatDate("2026-06-15T12:00:00.000Z")).toBe("Jun 15, 2026");
  });

  it("treats a number as a Unix timestamp in seconds", () => {
    // 2026-06-15T12:00:00Z == 1781524800 seconds
    expect(formatDate(1781524800)).toBe("Jun 15, 2026");
  });

  it("produces the same output for a number and its equivalent ISO string", () => {
    const seconds = 1781524800;
    const iso = new Date(seconds * 1000).toISOString();
    expect(formatDate(seconds)).toBe(formatDate(iso));
  });

  // The #418 guard: this instant is June 30 in UTC but June 29 in any time zone
  // behind UTC (e.g. America/Los_Angeles). Pinning timeZone:"UTC" makes the
  // server (UTC prerender) and client (local zone) render the identical day, so
  // the assertion below holds regardless of the runtime's time zone. Removing
  // the pin makes this fail anywhere west of UTC.
  it("renders the UTC calendar day across a midnight boundary", () => {
    expect(formatDate("2026-06-30T03:30:00.000Z")).toBe("Jun 30, 2026");
  });
});
