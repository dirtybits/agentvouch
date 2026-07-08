"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiMenu, FiX } from "react-icons/fi";
import favicon from "@/app/favicon.png";
import { ClientWalletButton } from "@/components/ClientWalletButton";
import { GithubAuthButton } from "@/components/GithubAuthButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { navIconButtonClass } from "@/lib/buttonStyles";

type NavItem = {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
};

const navItems: NavItem[] = [
  {
    href: "/skills",
    label: "Marketplace",
    match: (pathname) =>
      pathname === "/skills" ||
      pathname.startsWith("/skills/") ||
      pathname.startsWith("/author/"),
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    match: (pathname) =>
      pathname === "/dashboard" || pathname.startsWith("/settings"),
  },
  {
    href: "/docs",
    label: "Docs",
    match: (pathname) => pathname === "/docs",
  },
  {
    href: "/blog",
    label: "Blog",
    match: (pathname) => pathname === "/blog" || pathname.startsWith("/blog/"),
  },
];

function navLinkClass(isActive: boolean) {
  return [
    "font-display text-[15px] px-2 py-1 transition whitespace-nowrap",
    isActive
      ? "text-gray-900 dark:text-white"
      : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white",
  ].join(" ");
}

function mobileNavLinkClass(isActive: boolean) {
  return [
    "flex items-center justify-between rounded-sm border px-3 py-2 font-display text-[15px] transition",
    isActive
      ? "border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)]"
      : "border-transparent text-gray-600 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:border-gray-800 dark:hover:bg-gray-900 dark:hover:text-white",
  ].join(" ");
}

export function AppNavbar() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!navRef.current?.contains(event.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMenuOpen]);

  return (
    <nav
      ref={navRef}
      className="sticky top-0 z-50 border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/80 backdrop-blur-sm"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center gap-3">
        <Link
          href="/"
          onClick={() => setMobileMenuOpen(false)}
          className="flex items-center gap-2 font-display text-base text-gray-900 dark:text-white shrink-0"
        >
          <Image
            src={favicon}
            alt=""
            width={24}
            height={24}
            priority
            className="rounded-sm"
          />
          AgentVouch
        </Link>
        <div className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex">
          {navItems.map((item) => {
            const isActive = item.match(pathname);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={navLinkClass(isActive)}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="min-w-0 flex-1 md:hidden" />
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden md:block">
            <GithubAuthButton />
          </div>
          <ClientWalletButton />
          <ThemeToggle />
          <button
            type="button"
            className={`${navIconButtonClass} border border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)] transition hover:bg-[var(--sea-accent-soft-hover)] md:hidden`}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-controls="mobile-navigation-menu"
            aria-expanded={mobileMenuOpen}
            title={mobileMenuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? (
              <FiX className="h-4 w-4" aria-hidden />
            ) : (
              <FiMenu className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
      </div>
      {mobileMenuOpen ? (
        <div
          id="mobile-navigation-menu"
          className="border-t border-gray-200 bg-gray-50/95 dark:border-gray-800 dark:bg-gray-950/95 md:hidden"
        >
          <div className="mx-auto max-w-7xl px-4 py-3">
            <div className="grid gap-1">
              {navItems.map((item) => {
                const isActive = item.match(pathname);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setMobileMenuOpen(false)}
                    className={mobileNavLinkClass(isActive)}
                  >
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
            <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-800">
              <GithubAuthButton />
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
