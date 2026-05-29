// Coral Sigil — a deterministic, SSR-safe identity avatar generated purely from a
// seed string (an author/agent wallet address). Same seed → identical seal, every
// render, on server and client. No Math.random / Date — safe for SSR + hydration.
// See design/agent-sigil/philosophy.md for the aesthetic intent.

// On-brand coral-terminal palette. Chaos may only rearrange approved colors.
const PALETTE = [
  "#F28A61", // coral
  "#FD522E", // ember
  "#F59E0B", // amber
  "#D95A2B", // lobster
  "#FDBA8C", // light coral
  "#7C2D12", // deep
  "#5F8F9B", // sea
  "#4E7782", // sea-strong
];

// Hash a string into a 32-bit seed (xmur3).
function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

// mulberry32 PRNG — deterministic stream from a 32-bit seed.
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Shape {
  kind: "polygon" | "circle";
  points?: string;
  cx: number;
  cy: number;
  r: number;
  fill: string;
  opacity: number;
  blend: "normal" | "overlay";
}

function polygonPoints(
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotDeg: number
): string {
  const rot = (rotDeg * Math.PI) / 180;
  const pts: string[] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = rot + (i / sides) * Math.PI * 2;
    pts.push(
      `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(
        2
      )}`
    );
  }
  return pts.join(" ");
}

interface AgentSigilProps {
  /** Stable seed — the author/agent wallet address. */
  seed: string;
  /** Pixel size (square). Default 40. */
  size?: number;
  className?: string;
}

/**
 * Renders a deterministic geometric "agent seal" as inline SVG: a seeded coral
 * gradient field overlaid with 3–4 bold geometric forms and an occasional ring.
 */
export function AgentSigil({ seed, size = 40, className }: AgentSigilProps) {
  const seed32 = xmur3(seed || "agentvouch");
  const rng = mulberry32(seed32);
  const pick = <T,>(arr: readonly T[]): T =>
    arr[Math.floor(rng() * arr.length)];

  // Background gradient: two distinct palette tones, seeded angle.
  const bgA = pick(PALETTE);
  let bgB = pick(PALETTE);
  if (bgB === bgA) bgB = PALETTE[(PALETTE.indexOf(bgA) + 3) % PALETTE.length];
  const angle = Math.floor(rng() * 4) * 45 + 45; // 45/90/135/180
  const rad = (angle * Math.PI) / 180;
  const x2 = (0.5 + Math.cos(rad) * 0.5).toFixed(3);
  const y2 = (0.5 + Math.sin(rad) * 0.5).toFixed(3);
  const x1 = (0.5 - Math.cos(rad) * 0.5).toFixed(3);
  const y1 = (0.5 - Math.sin(rad) * 0.5).toFixed(3);

  // 3–4 bold forms.
  const shapeCount = 3 + (rng() < 0.5 ? 0 : 1);
  const shapes: Shape[] = [];
  for (let i = 0; i < shapeCount; i += 1) {
    const cx = 22 + rng() * 56;
    const cy = 22 + rng() * 56;
    const r = 16 + rng() * 22;
    const fill = pick(PALETTE);
    const opacity = 0.55 + rng() * 0.4;
    const blend: Shape["blend"] = i > 0 && rng() < 0.5 ? "overlay" : "normal";
    if (rng() < 0.62) {
      const sides = pick([3, 4, 6]);
      shapes.push({
        kind: "polygon",
        points: polygonPoints(cx, cy, r, sides, rng() * 360),
        cx,
        cy,
        r,
        fill,
        opacity,
        blend,
      });
    } else {
      shapes.push({
        kind: "circle",
        cx,
        cy,
        r: r * 0.85,
        fill,
        opacity,
        blend,
      });
    }
  }

  // Occasional sealing ring + center node for an "agent seal" feel.
  const hasRing = rng() < 0.5;
  const ringR = 30 + rng() * 12;
  const ringColor = pick(PALETTE);

  const gid = `avs-${seed32.toString(36)}`;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      preserveAspectRatio="xMidYMid slice"
      style={{ display: "block" }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1={x1} y1={y1} x2={x2} y2={y2}>
          <stop offset="0%" stopColor={bgA} />
          <stop offset="100%" stopColor={bgB} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gid})`} />
      {shapes.map((s, i) =>
        s.kind === "polygon" ? (
          <polygon
            key={i}
            points={s.points}
            fill={s.fill}
            opacity={s.opacity}
            style={{ mixBlendMode: s.blend }}
          />
        ) : (
          <circle
            key={i}
            cx={s.cx}
            cy={s.cy}
            r={s.r}
            fill={s.fill}
            opacity={s.opacity}
            style={{ mixBlendMode: s.blend }}
          />
        )
      )}
      {hasRing && (
        <circle
          cx="50"
          cy="50"
          r={ringR}
          fill="none"
          stroke={ringColor}
          strokeWidth="2.5"
          opacity="0.35"
        />
      )}
    </svg>
  );
}
