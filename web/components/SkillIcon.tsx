import type { ReactNode } from "react";
import { AgentSigil } from "@/components/AgentSigil";

interface SkillIconProps {
  /** Stable seed (author pubkey / identity) — drives the deterministic sigil. */
  seed: string;
  /** Pixel size of the square icon. Default 44. */
  size?: number;
  /** Tailwind ring color class for the icon edge (e.g. a verdict ring). */
  ringClass?: string;
  /** Optional corner badge node (e.g. a verdict status dot). */
  badge?: ReactNode;
}

/**
 * Deterministic identity avatar: a generative "Coral Sigil" seeded so the same
 * author/agent gets the same seal across all their skills, with a soft top
 * highlight for depth and an optional corner badge. See AgentSigil + the
 * philosophy in design/agent-sigil/philosophy.md.
 */
export function SkillIcon({
  seed,
  size = 44,
  ringClass = "ring-black/10 dark:ring-white/15",
  badge,
}: SkillIconProps) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className={`relative h-full w-full overflow-hidden rounded-2xl shadow-sm ring-1 ring-inset ${ringClass}`}
      >
        <AgentSigil seed={seed} size={size} className="h-full w-full" />
        {/* soft top highlight for depth */}
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/20 to-transparent" />
      </div>
      {badge && <span className="absolute -bottom-1 -right-1">{badge}</span>}
    </div>
  );
}
