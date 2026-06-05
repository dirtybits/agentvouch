import Link from "next/link";
import { notFound } from "next/navigation";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { buildMetadata } from "@/lib/seo";
import { getAllSlugs, getPost } from "@/lib/blog";

export async function generateStaticParams() {
  const slugs = await getAllSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) {
    return buildMetadata({ title: "Post not found", path: `/blog/${slug}` });
  }
  return buildMetadata({
    title: post.title,
    description: post.subtitle ?? `${post.title} — from the AgentVouch blog.`,
    path: `/blog/${slug}`,
  });
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <article className="font-article max-w-3xl mx-auto px-6 py-10 text-gray-700 dark:text-gray-300">
        <Link
          href="/blog"
          className="text-sm text-[var(--lobster-accent)] hover:underline"
        >
          ← Blog
        </Link>
        <div className="mt-6">
          <MarkdownRenderer content={post.content} />
        </div>
      </article>
    </main>
  );
}
