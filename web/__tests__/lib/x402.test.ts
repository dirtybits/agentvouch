import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@solana/kit", () => ({
  createSolanaRpc: () => "mock-rpc",
  getProgramDerivedAddress: async () => ["MockPurchasePDA", 255],
  getAddressEncoder: () => ({
    encode: () => new Uint8Array(32),
  }),
  getUtf8Encoder: () => ({
    encode: (s: string) => new TextEncoder().encode(s),
  }),
}));

const mockFetchMaybePurchase = vi.fn();
const mockFetchMaybeSkillListing = vi.fn();
vi.mock("../../generated/agentvouch/src/generated", () => ({
  fetchMaybePurchase: (...args: unknown[]) => mockFetchMaybePurchase(...args),
  fetchMaybeSkillListing: (...args: unknown[]) =>
    mockFetchMaybeSkillListing(...args),
}));

vi.mock("../../generated/agentvouch/src/generated/programs", () => ({
  AGENTVOUCH_PROGRAM_ADDRESS: "AgNtCcWfeMYUzHxvGdZP5BJszQhx6NJGB4pQ7AN6XVWz",
}));

import {
  generatePaymentRequirement,
  hashResource,
  paymentRefFromProof,
  verifyPaymentProof,
  type PaymentRequirement,
  type PaymentProof,
} from "@/lib/x402";
import { SOLANA_DEVNET_CHAIN_CONTEXT } from "@/lib/chains";

const FAKE_SKILL_LISTING = "11111111111111111111111111111111111111111111";
const FAKE_BUYER = "22222222222222222222222222222222222222222222";

function makeRequirement(
  overrides: Partial<PaymentRequirement> = {}
): PaymentRequirement {
  return {
    scheme: "exact",
    network: "solana",
    programId: "AgNtCcWfeMYUzHxvGdZP5BJszQhx6NJGB4pQ7AN6XVWz",
    instruction: "purchaseSkill",
    skillListingAddress: FAKE_SKILL_LISTING,
    mint: "So11111111111111111111111111111111111111112",
    amount: 100_000_000,
    resource: hashResource("/api/skills/abc/raw"),
    expiry: Math.floor(Date.now() / 1000) + 300,
    nonce: "abcdef1234567890abcdef1234567890",
    ...overrides,
  };
}

function makeProof(overrides: Partial<PaymentProof> = {}): PaymentProof {
  return {
    buyer: FAKE_BUYER,
    txSignature: "a".repeat(88),
    requirement: makeRequirement(),
    ...overrides,
  };
}

describe("generatePaymentRequirement", () => {
  it("returns correct structure with all fields", () => {
    const req = generatePaymentRequirement({
      skillId: "test-skill",
      legacySolLamports: 50_000_000,
      skillListingAddress: "SkillAddr123",
      resourcePath: "/api/skills/123/raw",
    });

    expect(req.scheme).toBe("exact");
    expect(req.network).toBe("solana");
    expect(req.chainContext).toBe(SOLANA_DEVNET_CHAIN_CONTEXT);
    expect(req.programId).toBe("AgNtCcWfeMYUzHxvGdZP5BJszQhx6NJGB4pQ7AN6XVWz");
    expect(req.instruction).toBe("purchaseSkill");
    expect(req.skillListingAddress).toBe("SkillAddr123");
    expect(req.mint).toBe("So11111111111111111111111111111111111111112");
    expect(req.amount).toBe(50_000_000);
    expect(req.nonce).toHaveLength(32);
    expect(req.metadata?.skill_id).toBe("test-skill");
    expect(req.metadata?.display_price).toBe("0.0500 SOL");
  });

  it("sets expiry ~5 minutes in the future", () => {
    const before = Math.floor(Date.now() / 1000);
    const req = generatePaymentRequirement({
      skillId: "x",
      legacySolLamports: 1,
      skillListingAddress: "x",
      resourcePath: "/x",
    });
    const after = Math.floor(Date.now() / 1000);

    expect(req.expiry).toBeGreaterThanOrEqual(before + 299);
    expect(req.expiry).toBeLessThanOrEqual(after + 301);
  });

  it("generates unique nonces per call", () => {
    const opts = {
      skillId: "x",
      legacySolLamports: 1,
      skillListingAddress: "x",
      resourcePath: "/x",
    };
    const a = generatePaymentRequirement(opts);
    const b = generatePaymentRequirement(opts);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("does not include recipient field", () => {
    const req = generatePaymentRequirement({
      skillId: "x",
      legacySolLamports: 1,
      skillListingAddress: "x",
      resourcePath: "/x",
    });
    expect("recipient" in req).toBe(false);
  });
});

describe("hashResource", () => {
  it("is deterministic", () => {
    expect(hashResource("/api/skills/1/raw")).toBe(
      hashResource("/api/skills/1/raw")
    );
  });

  it("returns 32-char hex string", () => {
    const h = hashResource("/some/path");
    expect(h).toHaveLength(32);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it("differs for different paths", () => {
    expect(hashResource("/a")).not.toBe(hashResource("/b"));
  });
});

describe("paymentRefFromProof", () => {
  it("is deterministic for same proof", () => {
    const proof = makeProof();
    expect(paymentRefFromProof(proof)).toBe(paymentRefFromProof(proof));
  });

  it("differs when buyer changes", () => {
    const a = makeProof({ buyer: "a".repeat(44) });
    const b = makeProof({ buyer: "b".repeat(44) });
    expect(paymentRefFromProof(a)).not.toBe(paymentRefFromProof(b));
  });

  it("differs when nonce changes", () => {
    const req1 = makeRequirement({ nonce: "1".repeat(32) });
    const req2 = makeRequirement({ nonce: "2".repeat(32) });
    const a = makeProof({ requirement: req1 });
    const b = makeProof({ requirement: req2 });
    expect(paymentRefFromProof(a)).not.toBe(paymentRefFromProof(b));
  });

  it("differs when skillListingAddress changes", () => {
    const req1 = makeRequirement({ skillListingAddress: "A".repeat(44) });
    const req2 = makeRequirement({ skillListingAddress: "B".repeat(44) });
    const a = makeProof({ requirement: req1 });
    const b = makeProof({ requirement: req2 });
    expect(paymentRefFromProof(a)).not.toBe(paymentRefFromProof(b));
  });
});

describe("verifyPaymentProof", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchMaybeSkillListing.mockResolvedValue({
      exists: true,
      data: { currentRevision: 0n },
    });
  });

  it("rejects unsupported scheme", async () => {
    const proof = makeProof();
    Object.assign(proof.requirement, { scheme: "other" as never });
    const result = await verifyPaymentProof(proof);
    expect(result.status).toBe("invalid");
    expect(result.error).toContain("scheme");
  });

  it("rejects unsupported network", async () => {
    const proof = makeProof();
    Object.assign(proof.requirement, { network: "ethereum" as never });
    const result = await verifyPaymentProof(proof);
    expect(result.status).toBe("invalid");
    expect(result.error).toContain("network");
  });

  it("rejects mismatched chain context", async () => {
    const proof = makeProof({
      requirement: makeRequirement({ chainContext: "eip155:8453" }),
    });
    const result = await verifyPaymentProof(proof);
    expect(result.status).toBe("invalid");
    expect(result.error).toContain("chain context");
  });

  it("rejects expired requirement", async () => {
    const proof = makeProof({
      requirement: makeRequirement({
        expiry: Math.floor(Date.now() / 1000) - 10,
      }),
    });
    const result = await verifyPaymentProof(proof);
    expect(result.status).toBe("invalid");
    expect(result.error).toContain("expired");
  });

  it("rejects missing buyer", async () => {
    const proof = makeProof({ buyer: "" });
    const result = await verifyPaymentProof(proof);
    expect(result.status).toBe("invalid");
    expect(result.error).toContain("buyer");
  });

  it("returns valid when Purchase PDA exists", async () => {
    mockFetchMaybePurchase.mockResolvedValue({
      exists: true,
      data: {
        buyer: FAKE_BUYER,
        skillListing: FAKE_SKILL_LISTING,
        pricePaid: 100_000_000n,
      },
    });

    const proof = makeProof();
    const result = await verifyPaymentProof(proof);
    expect(result.status).toBe("valid");
  });

  it("returns invalid when Purchase PDA does not exist", async () => {
    mockFetchMaybePurchase.mockResolvedValue({ exists: false });

    const proof = makeProof({
      requirement: makeRequirement({ nonce: "notfound_nonce_12345678901234" }),
    });
    const result = await verifyPaymentProof(proof);
    expect(result.status).toBe("invalid");
    expect(result.error).toContain("Purchase not found");
  });

  it("returns invalid when buyer mismatch", async () => {
    mockFetchMaybePurchase.mockResolvedValue({
      exists: true,
      data: {
        buyer: "WrongBuyer",
        skillListing: FAKE_SKILL_LISTING,
        pricePaid: 100_000_000n,
      },
    });

    const proof = makeProof({
      requirement: makeRequirement({ nonce: "mismatch_nonce_1234567890123" }),
    });
    const result = await verifyPaymentProof(proof);
    expect(result.status).toBe("invalid");
    expect(result.error).toContain("mismatch");
  });

  it("returns pending when RPC fails", async () => {
    mockFetchMaybePurchase.mockRejectedValue(new Error("network timeout"));

    const proof = makeProof({
      requirement: makeRequirement({ nonce: "rpcfail_nonce_12345678901234" }),
    });
    const result = await verifyPaymentProof(proof);
    expect(result.status).toBe("pending");
    expect(result.error).toContain("network timeout");
  });
});
