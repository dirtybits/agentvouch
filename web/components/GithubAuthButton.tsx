"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Image, { type ImageLoader } from "next/image";
import { navButtonSecondaryInlineClass } from "@/lib/buttonStyles";

type SessionUser = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

type SessionState =
  | { status: "loading" }
  | { status: "hidden" } // OAuth not configured — render nothing
  | { status: "anon" }
  | { status: "authed"; user: SessionUser };

const passthroughLoader: ImageLoader = ({ src }) => src;

function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function GithubAuthButton() {
  const pathname = usePathname();
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/github/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (!data.configured) {
          setState({ status: "hidden" });
        } else if (data.authenticated && data.user) {
          setState({ status: "authed", user: data.user });
        } else {
          setState({ status: "anon" });
        }
      })
      .catch(() => {
        if (active) setState({ status: "hidden" });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Hidden until we know it's configured — avoids a flash of a control that may
  // not belong, and renders nothing when OAuth creds aren't set.
  if (state.status === "loading" || state.status === "hidden") return null;

  const returnTo = encodeURIComponent(pathname || "/skills/publish");

  if (state.status === "anon") {
    return (
      <a
        href={`/api/auth/github/start?returnTo=${returnTo}`}
        className={`${navButtonSecondaryInlineClass} flex items-center gap-1.5`}
        title="Sign in with GitHub to publish a free skill"
      >
        <GithubMark />
        <span>GitHub</span>
      </a>
    );
  }

  const { user } = state;
  const handleLogout = async () => {
    await fetch("/api/auth/github/logout", { method: "POST" }).catch(() => {});
    setShowMenu(false);
    setState({ status: "anon" });
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className={`${navButtonSecondaryInlineClass} flex items-center gap-1.5`}
        title={`Signed in as @${user.login}`}
      >
        {user.avatarUrl ? (
          <Image
            loader={passthroughLoader}
            unoptimized
            src={user.avatarUrl}
            alt=""
            width={18}
            height={18}
            className="rounded-full"
          />
        ) : (
          <GithubMark />
        )}
        <span className="font-mono max-w-[120px] truncate">@{user.login}</span>
      </button>
      {showMenu && (
        <div className="absolute right-0 mt-2 w-44 rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg z-50 py-1">
          <div className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
            GitHub publisher
          </div>
          <button
            onClick={handleLogout}
            className={`w-full ${navButtonSecondaryInlineClass} justify-start`}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
