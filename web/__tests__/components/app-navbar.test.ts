import { describe, expect, it } from "vitest";
import { navItems } from "@/components/AppNavbar";

describe("AppNavbar navigation", () => {
  it("keeps Docs active for documentation detail pages", () => {
    const docs = navItems.find((item) => item.href === "/docs");

    expect(docs).toBeDefined();
    expect(docs?.match("/docs")).toBe(true);
    expect(docs?.match("/docs/skill-md-security")).toBe(true);
    expect(docs?.match("/skills")).toBe(false);
  });
});
