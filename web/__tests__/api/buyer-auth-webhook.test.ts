import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyWebhook: vi.fn(),
  deleteBuyerAccount: vi.fn(),
}));

vi.mock("@clerk/nextjs/webhooks", () => ({
  verifyWebhook: (request: Request) => mocks.verifyWebhook(request),
}));

vi.mock("@/lib/buyerAccounts", () => ({
  deleteBuyerAccountForIdentity: (input: unknown) =>
    mocks.deleteBuyerAccount(input),
}));

import { POST } from "@/app/api/auth/buyer/webhook/route";

function webhookRequest() {
  return new NextRequest("https://agentvouch.xyz/api/auth/buyer/webhook", {
    method: "POST",
    body: "{}",
  });
}

describe("Clerk buyer lifecycle webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unverified request before touching buyer records", async () => {
    mocks.verifyWebhook.mockRejectedValue(new Error("bad signature"));

    const response = await POST(webhookRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Webhook verification failed: bad signature",
    });
    expect(mocks.deleteBuyerAccount).not.toHaveBeenCalled();
  });

  it("ignores verified lifecycle events outside the deletion contract", async () => {
    mocks.verifyWebhook.mockResolvedValue({
      type: "user.updated",
      data: { id: "user_123" },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      ignored: "user.updated",
    });
    expect(mocks.deleteBuyerAccount).not.toHaveBeenCalled();
  });

  it("rejects a verified deletion without a stable Clerk user id", async () => {
    mocks.verifyWebhook.mockResolvedValue({
      type: "user.deleted",
      data: { id: null },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(400);
    expect(mocks.deleteBuyerAccount).not.toHaveBeenCalled();
  });

  it("soft-deletes the account and removes its provider identities", async () => {
    mocks.verifyWebhook.mockResolvedValue({
      type: "user.deleted",
      data: { id: "user_123" },
    });
    mocks.deleteBuyerAccount.mockResolvedValue({
      accountId: "57ab388b-9564-49de-8027-dfd35f822fa4",
      identityLinksRemoved: 1,
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.deleteBuyerAccount).toHaveBeenCalledWith({
      provider: "clerk",
      providerSubject: "user_123",
    });
    expect(await response.json()).toEqual({
      received: true,
      deleted: true,
      identityLinksRemoved: 1,
    });
  });

  it("acks a replay after the provider identity has already been removed", async () => {
    mocks.verifyWebhook.mockResolvedValue({
      type: "user.deleted",
      data: { id: "user_123" },
    });
    mocks.deleteBuyerAccount.mockResolvedValue({
      accountId: null,
      identityLinksRemoved: 0,
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      deleted: false,
      identityLinksRemoved: 0,
    });
  });

  it("returns a retryable error when reconciliation fails", async () => {
    mocks.verifyWebhook.mockResolvedValue({
      type: "user.deleted",
      data: { id: "user_123" },
    });
    mocks.deleteBuyerAccount.mockRejectedValue(new Error("database offline"));

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "database offline" });
  });
});
