import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInitializeDatabase, mockSql } = vi.hoisted(() => ({
  mockInitializeDatabase: vi.fn(),
  mockSql: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  initializeDatabase: mockInitializeDatabase,
  sql: () => mockSql,
}));

import {
  resolveSkillRouteParam,
  resolveSkillRoutePath,
} from "@/lib/skillRouteResolver";

describe("skill route resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats malformed percent-encoded route params as missing before database work", async () => {
    await expect(resolveSkillRoutePath("%", "skill")).resolves.toBeNull();
    await expect(resolveSkillRouteParam("%")).resolves.toBeNull();

    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    expect(mockSql).not.toHaveBeenCalled();
  });
});
