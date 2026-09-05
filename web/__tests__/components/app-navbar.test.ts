import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { navItems } from "@/components/AppNavbar";

const appNavbarSource = readFileSync(
  new URL("../../components/AppNavbar.tsx", import.meta.url),
  "utf8"
);

describe("AppNavbar navigation", () => {
  it("keeps Docs active for documentation detail pages", () => {
    const docs = navItems.find((item) => item.href === "/docs");

    expect(docs).toBeDefined();
    expect(docs?.match("/docs")).toBe(true);
    expect(docs?.match("/docs/skill-md-security")).toBe(true);
    expect(docs?.match("/skills")).toBe(false);
  });

  it("keeps a theme control in the mobile menu when the header toggle is hidden", () => {
    const mobileMenuStart = appNavbarSource.indexOf(
      'id="mobile-navigation-menu"'
    );

    expect(mobileMenuStart).toBeGreaterThan(-1);
    expect(appNavbarSource.slice(mobileMenuStart)).toContain("<ThemeToggle />");
  });
});
