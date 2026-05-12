import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInitializeDatabase = vi.fn();
const mockEnsureUsdcPurchaseSchema = vi.fn();
const mockEnsureAgentIdentitySchema = vi.fn();

vi.mock("@/lib/db", () => ({
  initializeDatabase: () => mockInitializeDatabase(),
}));

vi.mock("@/lib/usdcPurchases", () => ({
  ensureUsdcPurchaseSchema: () => mockEnsureUsdcPurchaseSchema(),
}));

vi.mock("@/lib/agentIdentity", () => ({
  ensureAgentIdentitySchema: () => mockEnsureAgentIdentitySchema(),
}));

import { bootstrapDatabase } from "@/lib/databaseBootstrap";

describe("bootstrapDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitializeDatabase.mockResolvedValue(undefined);
    mockEnsureUsdcPurchaseSchema.mockResolvedValue(undefined);
    mockEnsureAgentIdentitySchema.mockResolvedValue(undefined);
  });

  it("initializes core, entitlement, and agent identity schemas", async () => {
    await bootstrapDatabase();

    expect(mockInitializeDatabase).toHaveBeenCalledTimes(1);
    expect(mockEnsureUsdcPurchaseSchema).toHaveBeenCalledTimes(1);
    expect(mockEnsureAgentIdentitySchema).toHaveBeenCalledTimes(1);
  });
});
