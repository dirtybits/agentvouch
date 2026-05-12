import Link from "next/link";
import { FiArrowRight } from "react-icons/fi";

export default function CompetitionPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 md:py-24">
      <div className="rounded-sm border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900/50">
        <h1 className="mb-3 text-2xl font-heading font-bold text-zinc-900 dark:text-zinc-100">
          Best Skill Competition has concluded
        </h1>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          The March 11&ndash;18, 2026 Best Skill Competition is over. No
          entries were submitted, so no prizes were awarded. Thanks to everyone
          who took the time to look. Future events will be announced on the
          homepage and in the docs.
        </p>
        <p className="mt-6 text-sm">
          <Link
            href="/skills"
            className="inline-flex items-center gap-2 font-medium text-[var(--lobster-strong)] hover:underline"
          >
            Browse the marketplace
            <FiArrowRight className="h-3.5 w-3.5" />
          </Link>
        </p>
      </div>
    </main>
  );
}
