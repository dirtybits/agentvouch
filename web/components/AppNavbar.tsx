"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import favicon from "@/app/favicon.png";
import { ClientWalletButton } from "@/components/ClientWalletButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  navButtonSizeClass,
  navPillActiveClass,
  navPillIdleClass,
} from "@/lib/buttonStyles";
type NavItem = {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
};

const navItems: NavItem[] = [
  {
    href: "/skills",
    label: "Skills",
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
];

function navLinkClass(isActive: boolean) {
  return [
    `${navButtonSizeClass} transition whitespace-nowrap`,
    isActive ? navPillActiveClass : navPillIdleClass,
  ].join(" ");
}

export function AppNavbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/80 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-2 font-heading font-bold text-gray-900 dark:text-white text-sm shrink-0"
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
        <div className="min-w-0 flex-1 flex items-center gap-1 overflow-x-auto">
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
        <div className="flex items-center gap-2 shrink-0">
          <ClientWalletButton />
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
