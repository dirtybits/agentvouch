import { afterEach, describe, expect, it } from "vitest";
import {
  getBuyerAuthConfiguration,
  isBuyerAuthServerEnabled,
  isBuyerAuthUiEnabled,
} from "@/lib/buyerAuthConfig";

const ENV_KEYS = [
  "AGENTVOUCH_BUYER_AUTH_ENABLED",
  "NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("buyer auth configuration", () => {
  it("fails closed unless both flags and both Clerk keys are present", () => {
    expect(isBuyerAuthServerEnabled()).toBe(false);

    process.env.AGENTVOUCH_BUYER_AUTH_ENABLED = "true";
    process.env.NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED = "true";
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    expect(isBuyerAuthServerEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_example";
    expect(isBuyerAuthServerEnabled()).toBe(true);
    expect(getBuyerAuthConfiguration()).toEqual({
      enabled: true,
      featureFlagEnabled: true,
      publicFeatureFlagEnabled: true,
      clerkConfigured: true,
    });
  });

  it("keeps the UI disabled without its public flag and publishable key", () => {
    process.env.AGENTVOUCH_BUYER_AUTH_ENABLED = "true";
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    expect(isBuyerAuthUiEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED = "TRUE";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_example";
    expect(isBuyerAuthUiEnabled()).toBe(true);
  });
});
