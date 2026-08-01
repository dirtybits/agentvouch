import { pathToFileURL } from "node:url";
import {
  getStripeCheckoutActivation,
  getStripeLivePilotScope,
  type StripeKeyMode,
} from "../lib/stripe";
import {
  buildStripeReconciliationAlerts,
  listOpenStripeReconciliationItemsReadOnly,
} from "../lib/stripeReconciliation";
import { getStripeLivePilotMonitorSnapshotReadOnly } from "../lib/stripeLivePilotReadOnly";

export type StripeOpsMode = "preflight" | "monitor";

export function parseStripeOpsMode(args: string[]): StripeOpsMode {
  if (args.some((arg) => /apply|write|resolve|secret|key/i.test(arg))) {
    throw new Error(
      "Stripe operations command is read-only; apply/write/resolve and secret-bearing arguments are disabled"
    );
  }
  const mode = args[0] ?? "preflight";
  if (mode !== "preflight" && mode !== "monitor") {
    throw new Error(
      `Unsupported mode ${mode}; only read-only preflight and monitor modes are enabled`
    );
  }
  if (args.length > 1) {
    throw new Error("Stripe operations command accepts exactly one mode");
  }
  return mode;
}

export type StripePreviewPreflight = {
  readOnly: true;
  checkoutEnabled: boolean;
  stripeConfigured: boolean;
  serverFlagEnabled: boolean;
  uiFlagEnabled: boolean;
  production: boolean;
  productionEdgeRateLimitReady: boolean;
  keyMode: StripeKeyMode;
  liveModeAcknowledged: boolean;
  keyModePermitted: boolean;
  livePilotScopeReady: boolean;
  livePilotImplementationReady: boolean;
  buyerCardAccessServerEnabled: boolean;
  buyerCardAccessUiEnabled: boolean;
  buyerAuthenticationReady: boolean;
  databaseConfigured: boolean;
  blockers: string[];
};

export function buildStripePreviewPreflight(
  env: Readonly<Record<string, string | undefined>> = process.env
): StripePreviewPreflight {
  const activation = getStripeCheckoutActivation(env);
  const uiFlagEnabled = env.NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED === "true";
  const databaseConfigured = Boolean(env.DATABASE_URL?.trim());
  const buyerCardAccessServerEnabled =
    env.AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED === "true";
  const buyerCardAccessUiEnabled =
    env.NEXT_PUBLIC_AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED === "true";
  const buyerAuthenticationReady = Boolean(
    env.AGENTVOUCH_BUYER_AUTH_ENABLED === "true" &&
      env.NEXT_PUBLIC_AGENTVOUCH_BUYER_AUTH_ENABLED === "true" &&
      env.CLERK_SECRET_KEY?.trim() &&
      env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  );
  const blockers: string[] = [];

  if (!databaseConfigured) blockers.push("DATABASE_URL is not configured");
  if (!activation.stripeConfigured) {
    blockers.push("Stripe API and webhook secrets are not both configured");
  }
  if (!activation.serverFlagEnabled) {
    blockers.push("AGENTVOUCH_STRIPE_CHECKOUT_ENABLED is not true");
  }
  if (!uiFlagEnabled) {
    blockers.push("NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED is not true");
  }
  if (!activation.productionEdgeRateLimitReady) {
    blockers.push(
      "production edge rate limit is not acknowledged by AGENTVOUCH_STRIPE_EDGE_RATE_LIMIT_READY"
    );
  }
  if (!activation.keyModePermitted) {
    blockers.push(
      activation.keyMode === "live"
        ? "STRIPE_SECRET_KEY is a live key and AGENTVOUCH_STRIPE_LIVE_MODE_ENABLED is not true"
        : "STRIPE_SECRET_KEY is not a recognized Stripe test or live key"
    );
  }
  if (!activation.livePilotScopeReady) {
    blockers.push(
      "live Stripe checkout requires valid server-only buyer/skill allowlists, reservation TTL and reconciliation SLA, plus unit, GMV, completed-payment, and concurrent-reservation caps"
    );
  }
  if (activation.keyMode === "live" && !buyerCardAccessServerEnabled) {
    blockers.push("AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED is not true");
  }
  if (activation.keyMode === "live" && !buyerCardAccessUiEnabled) {
    blockers.push(
      "NEXT_PUBLIC_AGENTVOUCH_BUYER_CARD_ACCESS_ENABLED is not true"
    );
  }
  if (activation.keyMode === "live" && !buyerAuthenticationReady) {
    blockers.push(
      "buyer authentication flags and Clerk credentials are not fully configured"
    );
  }
  if (!activation.livePilotImplementationReady) {
    blockers.push(
      "live Stripe pilot remains source-disabled pending founder decisions, schema rehearsal, WAF proof, monitoring readiness, and explicit activation review"
    );
  }

  return {
    readOnly: true,
    checkoutEnabled: activation.enabled,
    stripeConfigured: activation.stripeConfigured,
    serverFlagEnabled: activation.serverFlagEnabled,
    uiFlagEnabled,
    production: activation.production,
    productionEdgeRateLimitReady: activation.productionEdgeRateLimitReady,
    // Mode name only — never the key or any resolved secret value.
    keyMode: activation.keyMode,
    liveModeAcknowledged: activation.liveModeAcknowledged,
    keyModePermitted: activation.keyModePermitted,
    livePilotScopeReady: activation.livePilotScopeReady,
    livePilotImplementationReady: activation.livePilotImplementationReady,
    buyerCardAccessServerEnabled,
    buyerCardAccessUiEnabled,
    buyerAuthenticationReady,
    databaseConfigured,
    blockers,
  };
}

export async function runStripeOps(
  mode: StripeOpsMode,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<{ ok: boolean; output: Record<string, unknown> }> {
  const preflight = buildStripePreviewPreflight(env);
  if (mode === "preflight") {
    return {
      ok: preflight.blockers.length === 0,
      output: { mode, ...preflight },
    };
  }

  if (!preflight.databaseConfigured) {
    return {
      ok: false,
      output: { mode, ...preflight, items: [], alerts: [] },
    };
  }

  const items = await listOpenStripeReconciliationItemsReadOnly();
  const alerts = buildStripeReconciliationAlerts(items);
  const livePilotScope = getStripeLivePilotScope(env);
  const livePilot = livePilotScope
    ? await getStripeLivePilotMonitorSnapshotReadOnly({
        reconciliationSlaMinutes: livePilotScope.reconciliationSlaMinutes,
      })
    : null;
  if (livePilot?.staleReservations) {
    alerts.push({
      eventId: "stripe-live-pilot:stale-reservations",
      severity: "critical",
      message: `${livePilot.staleReservations} stale live-pilot reservation(s)`,
    });
  }
  if (livePilot?.missingFinancials) {
    alerts.push({
      eventId: "stripe-live-pilot:missing-financials",
      severity: "critical",
      message: `${livePilot.missingFinancials} paid live-pilot payment(s) missing fee/net reconciliation`,
    });
  }
  if (livePilot?.openReviews) {
    alerts.push({
      eventId: "stripe-live-pilot:open-reviews",
      severity: "critical",
      message: `${livePilot.openReviews} live-pilot ledger review item(s)`,
    });
  }
  return {
    ok: preflight.blockers.length === 0 && alerts.length === 0,
    output: {
      mode,
      ...preflight,
      openReviewCount: items.length,
      items,
      alerts,
      livePilot: livePilot
        ? {
            ...livePilot,
            remainingGrossUsdCents: Math.max(
              0,
              livePilotScope!.maxGrossUsdCents - livePilot.grossReservedUsdCents
            ),
            remainingCompletedPayments: Math.max(
              0,
              livePilotScope!.maxCompletedPayments -
                livePilot.completedPayments -
                livePilot.concurrentReservations
            ),
            remainingConcurrentReservations: Math.max(
              0,
              livePilotScope!.maxConcurrentReservations -
                livePilot.concurrentReservations
            ),
          }
        : null,
    },
  };
}

async function main(): Promise<void> {
  const mode = parseStripeOpsMode(process.argv.slice(2));
  const result = await runStripeOps(mode);
  console.log(JSON.stringify(result.output, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
