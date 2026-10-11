import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  sql: vi.fn(),
}));

import {
  getBaseX402PayloadFromBody,
  getBaseX402SkillIdFromBody,
  hasInvalidBaseX402SkillId,
  loadBaseX402Skill,
} from "@/lib/baseX402Api";
import { sql } from "@/lib/db";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const SKILL_ID = "11111111-1111-4111-8111-111111111111";

const baseSkill = {
  id: SKILL_ID,
  price_usdc_micros: "1234567",
  currency_mint: null,
  chain_context: "eip155:84532",
  on_chain_protocol_version: "base-v1-candidate",
  on_chain_program_id: null,
  evm_listing_id: "7",
  evm_contract_address: "0x1111111111111111111111111111111111111111",
};

describe("Base x402 API input helpers", () => {
  it("accepts the current and legacy payload fields without treating scalars as payments", () => {
    const payload = { authorization: "signed" };

    expect(getBaseX402PayloadFromBody({ paymentPayload: payload })).toBe(
      payload
    );
    expect(getBaseX402PayloadFromBody({ payload })).toBe(payload);
    expect(getBaseX402PayloadFromBody({ paymentPayload: "signed" })).toBeNull();
    expect(getBaseX402PayloadFromBody({ paymentPayload: null })).toBeNull();
  });

  it("normalizes accepted skill-id aliases and separates absent from malformed IDs", () => {
    for (const field of ["skillDbId", "skill_id", "skillId"] as const) {
      expect(getBaseX402SkillIdFromBody({ [field]: `  ${SKILL_ID}  ` })).toBe(
        SKILL_ID
      );
      expect(hasInvalidBaseX402SkillId({ [field]: `  ${SKILL_ID}  ` })).toBe(
        false
      );
    }

    expect(getBaseX402SkillIdFromBody({ skillDbId: "not-a-uuid" })).toBeNull();
    expect(hasInvalidBaseX402SkillId({ skillDbId: "not-a-uuid" })).toBe(true);
    expect(getBaseX402SkillIdFromBody({ skillDbId: "   " })).toBeNull();
    expect(hasInvalidBaseX402SkillId({ skillDbId: "   " })).toBe(false);
  });
});

describe("loadBaseX402Skill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only a paid Base Sepolia listing and preserves its exact micro-unit price", async () => {
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([baseSkill]));

    await expect(loadBaseX402Skill(SKILL_ID)).resolves.toEqual(baseSkill);
  });

  it("rejects non-Base listings and missing paid prices after lookup", async () => {
    mockSql.mockReturnValue(
      vi
        .fn()
        .mockResolvedValueOnce([
          { ...baseSkill, chain_context: "solana:devnet" },
        ])
        .mockResolvedValueOnce([{ ...baseSkill, price_usdc_micros: "0" }])
    );

    await expect(loadBaseX402Skill(SKILL_ID)).rejects.toThrow(
      "Skill is not a Base x402 listing"
    );
    await expect(loadBaseX402Skill(SKILL_ID)).rejects.toThrow(
      "Base x402 skill is missing a paid USDC price"
    );
  });

  it("returns null when the UUID has no listing row", async () => {
    mockSql.mockReturnValue(vi.fn().mockResolvedValue([]));

    await expect(loadBaseX402Skill(SKILL_ID)).resolves.toBeNull();
  });
});
