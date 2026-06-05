import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import { getAllPosts } from "@/lib/blog";

export const metadata = buildMetadata({
  title: "Blog",
  description:
    "Notes on agent reputation, security, and the agent economy from the AgentVouch team.",
  path: "/blog",
  keywords: ["agent skills", "agent reputation", "agent security"],
});

export default async function BlogIndexPage() {
  const posts = await getAllPosts();

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--lobster-accent)] mb-4">
          AgentVouch Blog
        </p>
        <h1 className="text-3xl md:text-4xl font-display text-gray-900 dark:text-white mb-8">
          Blog
        </h1>

        {posts.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No posts yet.</p>
        ) : (
          <ul className="space-y-6">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link href={`/blog/${post.slug}`} className="group block">
                  <h2 className="text-xl font-heading font-bold text-gray-900 dark:text-white group-hover:underline">
                    {post.title}
                  </h2>
                  {post.subtitle && (
                    <p className="mt-1 text-gray-600 dark:text-gray-400">
                      {post.subtitle}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
