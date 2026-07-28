import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  verifyWalletSignature: vi.fn(),
}));

vi.mock("@/lib/trust", () => ({
  verifyAuthorTrust: vi.fn(),
}));

vi.mock("@/lib/solanaAgentRegistry", () => ({
  discoverSolanaRegistryCandidatesByWallet: vi.fn(),
}));

import { POST } from "@/app/api/author/[pubkey]/discover-registry/route";
import { verifyWalletSignature } from "@/lib/auth";
import { verifyAuthorTrust } from "@/lib/trust";
import { discoverSolanaRegistryCandidatesByWallet } from "@/lib/solanaAgentRegistry";

const mockVerify = verifyWalletSignature as unknown as ReturnType<typeof vi.fn>;
const mockVerifyAuthorTrust = verifyAuthorTrust as unknown as ReturnType<
  typeof vi.fn
>;
const mockDiscover =
  discoverSolanaRegistryCandidatesByWallet as unknown as ReturnType<
    typeof vi.fn
  >;

function makeRequest(pubkey: string, body: Record<string, unknown> = {}) {
  const req = new NextRequest(
    `http://localhost/api/author/${pubkey}/discover-registry`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
  const params = Promise.resolve({ pubkey });
  return { req, params };
}

describe("POST /api/author/[pubkey]/discover-registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["literal null", "null"],
    ["malformed", "{"],
  ])("returns 400 for a %s JSON body", async (_kind, body) => {
    const res = await POST(
      new NextRequest(
        "http://localhost/api/author/Author111/discover-registry",
        {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json" },
        }
      ),
      { params: Promise.resolve({ pubkey: "Author111" }) }
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Missing auth payload",
    });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockVerifyAuthorTrust).not.toHaveBeenCalled();
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it("returns 401 when signature is invalid", async () => {
    mockVerify.mockReturnValue({
      valid: false,
      pubkey: null,
      error: "Invalid signature",
    });
    const { req, params } = makeRequest("Author111", {
      auth: { pubkey: "Author111" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the viewer wallet does not match the author wallet", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "OtherWallet" });
    const { req, params } = makeRequest("Author111", {
      auth: { pubkey: "OtherWallet" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(403);
  });

  it("returns 403 when the author is not registered on-chain", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Author111" });
    mockVerifyAuthorTrust.mockResolvedValue({ isRegistered: false });
    const { req, params } = makeRequest("Author111", {
      auth: { pubkey: "Author111" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(403);
  });

  it("returns discovered candidates for the author wallet", async () => {
    mockVerify.mockReturnValue({ valid: true, pubkey: "Author111" });
    mockVerifyAuthorTrust.mockResolvedValue({ isRegistered: true });
    mockDiscover.mockResolvedValue([
      {
        coreAssetPubkey: "Asset111",
        ownerWallet: "Author111",
      },
    ]);

    const { req, params } = makeRequest("Author111", {
      auth: { pubkey: "Author111" },
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].coreAssetPubkey).toBe("Asset111");
  });
});
