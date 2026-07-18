export type BuyerAuthConfiguration = {
  enabled: boolean;
  featureFlagEnabled: boolean;
  publicFeatureFlagEnabled: boolean;
  clerkConfigured: boolean;
};

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function getBuyerAuthConfiguration(): BuyerAuthConfiguration {
  const featureFlagEnabled = enabled(process.env.AGENTVOUCH_BUYER_AUTH_ENABLED);
  const publicFeatureFlagEnabled = enabled(
    process.env.NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED
  );
  const clerkConfigured = Boolean(
    process.env.CLERK_SECRET_KEY?.trim() &&
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  );

  return {
    enabled: featureFlagEnabled && publicFeatureFlagEnabled && clerkConfigured,
    featureFlagEnabled,
    publicFeatureFlagEnabled,
    clerkConfigured,
  };
}

export function isBuyerAuthServerEnabled() {
  return getBuyerAuthConfiguration().enabled;
}

export function isBuyerAuthUiEnabled() {
  return (
    enabled(process.env.NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED) &&
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim())
  );
}

/**
 * Account-scoped card access is a separate rollout boundary from buyer auth.
 * Both server and public flags must agree so SSR, hydration, checkout, webhook
 * fulfillment, and raw access fail closed together.
 */
export function isBuyerCardAccessServerEnabled() {
  return (
    isBuyerAuthServerEnabled() &&
    enabled(process.env.AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED) &&
    enabled(process.env.NEXT_PUBLIC_AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED)
  );
}

export function isBuyerCardAccessUiEnabled() {
  return (
    isBuyerAuthUiEnabled() &&
    enabled(process.env.NEXT_PUBLIC_AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED)
  );
}
