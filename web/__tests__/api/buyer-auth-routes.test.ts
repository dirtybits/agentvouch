import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  session: vi.fn(),
  sameOrigin: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/lib/buyerSession", () => ({
  getBuyerAuthStatus: () => mocks.status(),
  getBuyerSession: (request: Request) => mocks.session(request),
  isSameOriginMutation: (request: Request) => mocks.sameOrigin(request),
  revokeCurrentBuyerSession: () => mocks.revoke(),
}));

import { GET as getSession } from "@/app/api/auth/buyer/session/route";
import { POST as logout } from "@/app/api/auth/buyer/logout/route";

describe("buyer auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status.mockReturnValue({
      enabled: false,
      clerkConfigured: false,
      featureFlagEnabled: false,
      publicFeatureFlagEnabled: false,
    });
  });

  it("reports disabled auth without resolving a database account", async () => {
    const response = await getSession(
      new Request("https://agentvouch.xyz/api/auth/buyer/session")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: false,
      enabled: false,
      authenticated: false,
      accountId: null,
    });
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("returns only the opaque account id for an authenticated buyer", async () => {
    mocks.status.mockReturnValue({
      enabled: true,
      clerkConfigured: true,
      featureFlagEnabled: true,
      publicFeatureFlagEnabled: true,
    });
    mocks.session.mockResolvedValue({
      accountId: "57ab388b-9564-49de-8027-dfd35f822fa4",
    });
    const response = await getSession(
      new Request("https://agentvouch.xyz/api/auth/buyer/session")
    );
    expect(await response.json()).toEqual({
      configured: true,
      enabled: true,
      authenticated: true,
      accountId: "57ab388b-9564-49de-8027-dfd35f822fa4",
    });
  });

  it("rejects cross-origin logout before revoking a session", async () => {
    mocks.status.mockReturnValue({ enabled: true });
    mocks.sameOrigin.mockReturnValue(false);
    const response = await logout(
      new Request("https://agentvouch.xyz/api/auth/buyer/logout", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      })
    );
    expect(response.status).toBe(403);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("revokes the current same-origin buyer session", async () => {
    mocks.status.mockReturnValue({ enabled: true });
    mocks.sameOrigin.mockReturnValue(true);
    mocks.revoke.mockResolvedValue(true);
    const response = await logout(
      new Request("https://agentvouch.xyz/api/auth/buyer/logout", {
        method: "POST",
        headers: { origin: "https://agentvouch.xyz" },
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, revoked: true });
  });
});
