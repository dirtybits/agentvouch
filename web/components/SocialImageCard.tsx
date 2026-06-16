import { SITE_NAME } from "@/lib/site";

const trustSignals = [
  "Verified author identity",
  "Peer vouches and dispute history",
  "Stake-backed trust signal",
];

const tags = ["trust score", "skills market", "agent safety", "x402 ready"];

export function SocialImageCard() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(135deg, rgb(255, 247, 237) 0%, rgb(255, 237, 213) 42%, rgb(17, 24, 39) 42%, rgb(3, 7, 18) 100%)",
        color: "rgb(17, 24, 39)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 42,
          right: 52,
          width: 190,
          height: 190,
          borderRadius: 999,
          background: "rgba(253, 82, 46, 0.22)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 132,
          bottom: 76,
          width: 280,
          height: 280,
          borderRadius: 999,
          background: "rgba(253, 82, 46, 0.16)",
        }}
      />

      <div
        style={{
          width: "56%",
          padding: "62px 56px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          zIndex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            color: "rgb(253, 82, 46)",
            fontSize: 24,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 999,
              background: "rgb(253, 82, 46)",
            }}
          />
          Agent Reputation Oracle
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 86,
              lineHeight: 0.92,
              fontWeight: 800,
              letterSpacing: "-0.06em",
            }}
          >
            {SITE_NAME}
          </div>
          <div
            style={{
              maxWidth: 570,
              fontSize: 35,
              lineHeight: 1.12,
              color: "rgb(55, 65, 81)",
            }}
          >
            Trusted skills for AI agents, backed by on-chain reputation.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 14,
            fontSize: 22,
            color: "rgb(75, 85, 99)",
          }}
        >
          <div>agentvouch.xyz</div>
          <div>•</div>
          <div>Solana</div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          padding: "70px 56px 58px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: 405,
            borderRadius: 32,
            border: "1px solid rgba(255, 255, 255, 0.18)",
            background: "rgba(15, 23, 42, 0.86)",
            padding: 28,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              color: "white",
              fontSize: 24,
            }}
          >
            <div>skill://deploy-agent</div>
            <div style={{ color: "rgb(253, 82, 46)" }}>98</div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              color: "rgb(203, 213, 225)",
              fontSize: 21,
              lineHeight: 1.25,
            }}
          >
            {trustSignals.map((signal) => (
              <div key={signal}>✓ {signal}</div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 2,
            }}
          >
            {tags.map((label) => (
              <div
                key={label}
                style={{
                  borderRadius: 999,
                  background: "rgba(253, 82, 46, 0.14)",
                  border: "1px solid rgba(253, 82, 46, 0.34)",
                  color: "rgb(255, 186, 166)",
                  padding: "8px 12px",
                  fontSize: 17,
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
