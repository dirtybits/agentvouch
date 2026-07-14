import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  sql: vi.fn(),
}));
const verificationMocks = vi.hoisted(() => ({
  verifyAndIndexBasePaidPurchaseReport: vi.fn(),
  getBasePaidPurchaseReportContract: vi.fn(),
  readBasePaidPurchaseReportPreflight: vi.fn(),
  readBasePaidPurchaseReportState: vi.fn(),
}));
const purchaseMocks = vi.hoisted(() => ({
  getEvmPaidPurchaseReportIndex: vi.fn(),
}));

vi.mock("@/lib/db", () => dbMocks);
vi.mock("@/lib/basePaidPurchaseReportVerification", () => verificationMocks);
vi.mock("@/lib/usdcPurchases", () => purchaseMocks);

import { POST } from "@/app/api/skills/[id]/paid-reports/verify/route";
import { GET } from "@/app/api/skills/[id]/paid-reports/route";

const SKILL_ID = "11111111-1111-1111-1111-111111111111";
const PURCHASE_ID =
  "0xcf7cbe3e55c964334cb3f010368423852c6f75733314a9d3eeba5b753b05687f";
const TX_HASH =
  "0xfba67b3793f7c518694ae9d793264aaf7a3db84468538b7255b77e50b1078b1c";
const skill = {
  id: SKILL_ID,
  chain_context: "eip155:84532",
  on_chain_protocol_version: "base-v1-a1",
  on_chain_program_id: "0x1111111111111111111111111111111111111111",
  evm_listing_id:
    "0x9987077f66345ab282f7698aa90b486787fe3043f880d9f18556bca5ec2fd89e",
  evm_contract_address: "0x1111111111111111111111111111111111111111",
};

function request(body: unknown) {
  return new NextRequest(
    `http://localhost/api/skills/${SKILL_ID}/paid-reports/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/skills/[id]/paid-reports/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.sql.mockReturnValue(vi.fn().mockResolvedValue([skill]));
    verificationMocks.verifyAndIndexBasePaidPurchaseReport.mockResolvedValue({
      index: { reportId: "1", purchaseId: PURCHASE_ID },
      state: { reportId: "1", status: 1 },
    });
  });

  it("passes only the transaction and purchase identity into exact verification", async () => {
    const response = await POST(
      request({ txHash: TX_HASH, purchaseId: PURCHASE_ID, reportId: "999" }),
      { params: Promise.resolve({ id: SKILL_ID }) }
    );
    expect(response.status).toBe(200);
    expect(
      verificationMocks.verifyAndIndexBasePaidPurchaseReport
    ).toHaveBeenCalledWith({ skill, txHash: TX_HASH, purchaseId: PURCHASE_ID });
    expect(await response.json()).toMatchObject({
      ok: true,
      report: { index: { reportId: "1" } },
    });
  });

  it("rejects requests without both transaction hash and purchase id", async () => {
    const response = await POST(request({ txHash: TX_HASH }), {
      params: Promise.resolve({ id: SKILL_ID }),
    });
    expect(response.status).toBe(400);
    expect(
      verificationMocks.verifyAndIndexBasePaidPurchaseReport
    ).not.toHaveBeenCalled();
  });
});

describe("GET /api/skills/[id]/paid-reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.sql.mockReturnValue(vi.fn().mockResolvedValue([skill]));
    verificationMocks.getBasePaidPurchaseReportContract.mockReturnValue(
      skill.evm_contract_address
    );
    verificationMocks.readBasePaidPurchaseReportPreflight.mockResolvedValue({
      buyerAddress: "0x3fc722ba956f17b521087984f2c5c0ba47df3c6b",
      authorAddress: "0x1111111111111111111111111111111111111111",
      purchaseId: PURCHASE_ID,
      purchaseTimestamp: "1783000000",
      filingDeadline: "1783604800",
      lane: 1,
      eligible: true,
      reason: null,
      requiresExactCallSimulation: true,
    });
    purchaseMocks.getEvmPaidPurchaseReportIndex.mockResolvedValue(null);
  });

  it("returns purchase preflight even before a report has been indexed", async () => {
    const buyer = "0x3fc722ba956f17b521087984F2c5c0BA47Df3c6B";
    const response = await GET(
      new NextRequest(
        `http://localhost/api/skills/${SKILL_ID}/paid-reports?buyer=${buyer}&purchaseId=${PURCHASE_ID}`
      ),
      { params: Promise.resolve({ id: SKILL_ID }) }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      preflight: {
        authorAddress: "0x1111111111111111111111111111111111111111",
        purchaseTimestamp: "1783000000",
        filingDeadline: "1783604800",
        eligible: true,
      },
      report: null,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
