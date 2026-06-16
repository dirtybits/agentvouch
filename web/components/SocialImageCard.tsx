import { AGENTVOUCH_LOGO_DATA_URI } from "@/app/og-assets";
import { SITE_NAME } from "@/lib/site";

// AgentVouch social card, built in the brand's visual language:
//   flat gray-50 field (no surface gradients), the signature ember left rail,
//   Crimson Text serif for the wordmark + title, Inconsolata mono for the
//   eyebrow / URL, and the lobster-in-shield logo. Rendered by next/og.
const C = {
  bg: "#f9fafb", // gray-50 — flat page field
  ember: "#fd522e", // strong coral — rail
  lobster: "#d95a2b", // accent — eyebrow
  ink: "#111827", // gray-900 — wordmark
  body: "#374151", // gray-700 — serif title
  muted: "#6b7280", // gray-500 — mono description
  faint: "#4b5563", // gray-600 — footer url
} as const;

export function SocialImageCard() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: C.bg,
        fontFamily: "Inconsolata",
        color: C.ink,
      }}
    >
      {/* Signature coral rail */}
      <div style={{ width: 14, height: "100%", background: C.ember }} />

      {/* Text column */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 56px 60px 68px",
        }}
      >
        {/* Eyebrow */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: C.lobster,
            }}
          />
          <div
            style={{
              fontFamily: "Inconsolata",
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: C.lobster,
            }}
          >
            Agent Reputation Oracle
          </div>
        </div>

        {/* Hero: serif wordmark + tagline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontFamily: "Crimson Text",
              fontWeight: 600,
              fontSize: 96,
              lineHeight: 1,
              letterSpacing: "-0.01em",
              color: C.ink,
            }}
          >
            {SITE_NAME}
          </div>
          <div
            style={{
              fontFamily: "Crimson Text",
              fontWeight: 400,
              fontSize: 44,
              lineHeight: 1.12,
              color: C.body,
              maxWidth: 600,
              marginTop: 18,
            }}
          >
            Trusted Tools for AI Agents
          </div>
          <div
            style={{
              fontFamily: "Inconsolata",
              fontWeight: 400,
              fontSize: 22,
              lineHeight: 1.4,
              color: C.muted,
              maxWidth: 580,
              marginTop: 22,
            }}
          >
            Buy and sell reputation-backed skills for AI agents. Inspect Author
            trust scores. Automate agent tool security. Put your cash where your
            claw is.
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontFamily: "Inconsolata",
            fontSize: 22,
            fontWeight: 700,
            color: C.faint,
          }}
        >
          agentvouch.xyz
        </div>
      </div>

      {/* Logo column */}
      <div
        style={{
          width: 416,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          paddingRight: 56,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={AGENTVOUCH_LOGO_DATA_URI}
          alt="AgentVouch logo"
          width={324}
          height={324}
        />
      </div>
    </div>
  );
}
