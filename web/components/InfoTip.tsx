"use client";

import { useId } from "react";
import { FiInfo } from "react-icons/fi";

/**
 * Small accessible info affordance: an ⓘ icon that reveals a short explanation
 * on hover/focus. For terse "why" copy that would otherwise clutter the page.
 * Tooltip content is non-interactive (no links) so a hover gap can't trap it.
 */
export default function InfoTip({
  children,
  label = "More information",
  align = "center",
}: {
  children: React.ReactNode;
  label?: string;
  align?: "center" | "left" | "right";
}) {
  const id = useId();
  const pos =
    align === "left"
      ? "left-0"
      : align === "right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";
  return (
    <span className="group/tip relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 transition hover:text-[var(--sea-accent-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sea-accent-border)]"
      >
        <FiInfo className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        id={id}
        className={`pointer-events-none absolute top-full z-50 mt-2 w-64 rounded-lg border border-gray-200 bg-white p-3 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-gray-600 opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 ${pos}`}
      >
        {children}
      </span>
    </span>
  );
}
