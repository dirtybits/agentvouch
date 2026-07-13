"use client";

import { useTheme } from "next-themes";
import { IoSunnyOutline, IoMoonOutline } from "react-icons/io5";
import { useMounted } from "@/hooks/useMounted";
import { navIconButtonClass } from "@/lib/buttonStyles";

export function ThemeToggle() {
  const mounted = useMounted();
  const { theme, setTheme } = useTheme();

  if (!mounted) return null;

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className={`${navIconButtonClass} font-normal transition bg-[var(--sea-accent-soft)] hover:bg-[var(--sea-accent-soft-hover)] text-[var(--sea-accent-strong)] border border-[var(--sea-accent-border)]`}
      aria-label="Toggle theme"
    >
      {theme === "dark" ? <IoSunnyOutline /> : <IoMoonOutline />}
    </button>
  );
}
