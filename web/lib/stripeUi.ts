// UI-safe Stripe flag, kept out of `@/lib/stripe`.
//
// `@/lib/stripe` imports `node:crypto` for webhook signature verification and
// reads server-only env (STRIPE_SECRET_KEY, AGENTVOUCH_STRIPE_*). Rendering
// code only ever needs the public flag, so it lives here and this module stays
// importable from a client component without dragging Node-only code into the
// browser bundle.
//
// Per AGENTS.md: render-affecting defaults read only NEXT_PUBLIC-prefixed env;
// the server-only activation check is the separately-named
// `isStripeCheckoutServerEnabled` in `@/lib/stripe`. The two are deliberately
// independent — this flag controls whether the UI is offered, not whether
// checkout is permitted. The server gate is authoritative.
export function isStripeCheckoutUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED === "true";
}
