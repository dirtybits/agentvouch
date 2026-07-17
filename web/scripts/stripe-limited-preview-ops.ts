import { pathToFileURL } from "node:url";
import { getStripeCheckoutActivation } from "../lib/stripe";
import {
  buildStripeReconciliationAlerts,
  listOpenStripeReconciliationItemsReadOnly,
} from "../lib/stripeReconciliation";

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
  databaseConfigured: boolean;
  blockers: string[];
};

export function buildStripePreviewPreflight(
  env: Readonly<Record<string, string | undefined>> = process.env
): StripePreviewPreflight {
  const activation = getStripeCheckoutActivation(env);
  const uiFlagEnabled = env.NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED === "true";
  const databaseConfigured = Boolean(env.DATABASE_URL?.trim());
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

  return {
    readOnly: true,
    checkoutEnabled: activation.enabled,
    stripeConfigured: activation.stripeConfigured,
    serverFlagEnabled: activation.serverFlagEnabled,
    uiFlagEnabled,
    production: activation.production,
    productionEdgeRateLimitReady: activation.productionEdgeRateLimitReady,
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
  return {
    ok: preflight.blockers.length === 0 && alerts.length === 0,
    output: {
      mode,
      ...preflight,
      openReviewCount: items.length,
      items,
      alerts,
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
