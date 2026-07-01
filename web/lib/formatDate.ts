/**
 * Format a timestamp as a stable "Mon DD, YYYY" string (e.g. "Jun 30, 2026").
 *
 * Both the locale ("en-US") and the time zone ("UTC") are pinned so the output
 * is identical on the server (prerendered / ISR HTML, built once in UTC) and on
 * the client (which would otherwise format in the viewer's local time zone).
 * Without a pinned time zone, a timestamp near a UTC midnight boundary renders a
 * different calendar day after hydration — a text-content mismatch that surfaces
 * as React hydration error #418.
 *
 * Accepts either a date/ISO string or a Unix timestamp in SECONDS (the on-chain
 * representation used for `registeredAt`, dispute `createdAt`, etc.).
 */
export function formatDate(value: string | number): string {
  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
