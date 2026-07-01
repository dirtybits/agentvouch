"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FiLoader, FiSearch } from "react-icons/fi";
import { getPublicSkillPath, type PublicSkillUrlFields } from "@/lib/skillUrls";
import { formatUsdcMicros } from "@/lib/pricing";

const SEARCH_DEBOUNCE_MS = 250;
const MAX_RESULTS = 6;

type SearchResult = PublicSkillUrlFields & {
  name: string;
  description: string | null;
  price_usdc_micros?: string | null;
};

export default function SkillSearchBar() {
  const router = useRouter();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const close = useCallback(() => {
    setOpen(false);
    setHighlighted(-1);
  }, []);

  const handleQueryChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextQuery = event.target.value;
      const nextSearch = nextQuery.trim();
      setQuery(nextQuery);
      abortRef.current?.abort();
      if (!nextSearch) {
        setResults([]);
        setLoading(false);
        close();
        return;
      }
      setLoading(true);
    },
    [close]
  );

  // Debounced fetch; aborts in-flight requests so stale responses never
  // overwrite newer ones.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      return;
    }
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      fetch(
        `/api/skills?q=${encodeURIComponent(
          q
        )}&mode=fast&pageSize=${MAX_RESULTS}`,
        { signal: controller.signal }
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { skills?: SearchResult[] } | null) => {
          if (controller.signal.aborted) return;
          setResults(data?.skills ?? []);
          setOpen(true);
          setHighlighted(-1);
          setLoading(false);
        })
        .catch((error) => {
          if ((error as Error)?.name === "AbortError") return;
          setResults([]);
          setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Close when clicking outside.
  useEffect(() => {
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [close]);

  const seeAllHref = `/skills?q=${encodeURIComponent(query.trim())}`;
  // Result rows + the trailing "see all" row share one keyboard index space.
  const optionCount = results.length + (results.length > 0 ? 1 : 0);

  function choose(index: number) {
    if (index >= 0 && index < results.length) {
      router.push(getPublicSkillPath(results[index]));
    } else if (query.trim()) {
      router.push(seeAllHref);
    }
    close();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      if (query.trim()) setOpen(true);
      if (event.key === "Enter" && query.trim()) {
        router.push(seeAllHref);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((i) => (i + 1) % Math.max(optionCount, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((i) => (i <= 0 ? Math.max(optionCount, 1) - 1 : i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(highlighted >= 0 ? highlighted : results.length > 0 ? 0 : -1);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <FiSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            highlighted >= 0 ? `${listboxId}-opt-${highlighted}` : undefined
          }
          aria-label="Search for skills"
          placeholder="Search for skills"
          value={query}
          onChange={handleQueryChange}
          onFocus={() => {
            if (query.trim() && results.length > 0) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[var(--lobster-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] dark:border-gray-800 dark:bg-gray-900 dark:text-white"
        />
        {loading && (
          <FiLoader className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
        )}
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Skill search results"
          className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900"
        >
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
              No skills match &ldquo;{query.trim()}&rdquo;
            </p>
          ) : (
            <>
              <ul>
                {results.map((skill, index) => {
                  const price = formatUsdcMicros(skill.price_usdc_micros);
                  return (
                    <li key={skill.id}>
                      <button
                        type="button"
                        id={`${listboxId}-opt-${index}`}
                        role="option"
                        aria-selected={highlighted === index}
                        onMouseEnter={() => setHighlighted(index)}
                        onClick={() => choose(index)}
                        className={`flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left transition ${
                          highlighted === index
                            ? "bg-[var(--lobster-accent-soft)]"
                            : ""
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">
                            {skill.name}
                          </span>
                          {skill.description ? (
                            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                              {skill.description}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-[var(--lobster-accent)]">
                          {price ? `${price} USDC` : "Free"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                id={`${listboxId}-opt-${results.length}`}
                role="option"
                aria-selected={highlighted === results.length}
                onMouseEnter={() => setHighlighted(results.length)}
                onClick={() => choose(results.length)}
                className={`block w-full border-t border-gray-100 px-4 py-2.5 text-left text-sm text-[var(--lobster-accent)] transition dark:border-gray-800 ${
                  highlighted === results.length
                    ? "bg-[var(--lobster-accent-soft)]"
                    : ""
                }`}
              >
                See all results →
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
