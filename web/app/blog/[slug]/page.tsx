import Link from "next/link";
import { notFound } from "next/navigation";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { buildMetadata } from "@/lib/seo";
import { getCanonicalUrl, SITE_NAME, SITE_OG_IMAGE_PATH } from "@/lib/site";
import { getAllSlugs, getPost } from "@/lib/blog";

function resolveImageUrl(image: string | null): string {
  return getCanonicalUrl(image ?? SITE_OG_IMAGE_PATH);
}

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
  const metadata = buildMetadata({
    title: post.title,
    description: post.subtitle ?? `${post.title} — from the AgentVouch blog.`,
    path: `/blog/${slug}`,
    keywords: post.tags,
  });
  const image = resolveImageUrl(post.image);
  return {
    ...metadata,
    openGraph: {
      ...metadata.openGraph,
      type: "article" as const,
      publishedTime: post.publishedAt ?? undefined,
      modifiedTime: post.updatedAt ?? post.publishedAt ?? undefined,
      images: [{ url: image, alt: post.title }],
      tags: post.tags,
    },
    twitter: { ...metadata.twitter, images: [image] },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  const canonicalUrl = getCanonicalUrl(`/blog/${slug}`);
  const description =
    post.subtitle ?? `${post.title} — from the AgentVouch blog.`;
  const blogPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
    datePublished: post.publishedAt ?? undefined,
    dateModified: post.updatedAt ?? post.publishedAt ?? undefined,
    image: [resolveImageUrl(post.image)],
    keywords: post.tags.length ? post.tags.join(", ") : undefined,
    author: {
      "@type": "Organization",
      name: SITE_NAME,
      url: getCanonicalUrl("/"),
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: getCanonicalUrl("/"),
    },
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(blogPostingJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <article className="font-body max-w-3xl mx-auto px-6 py-10 text-gray-700 dark:text-gray-300">
        <Link
          href="/blog"
          className="text-sm text-[var(--lobster-accent)] hover:underline"
        >
          ← Blog
        </Link>
        {post.publishedAt && (
          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            Published{" "}
            <time dateTime={post.publishedAt}>
              {post.publishedAt.slice(0, 10)}
            </time>
            {post.updatedAt && post.updatedAt !== post.publishedAt && (
              <>
                {" "}
                · Updated{" "}
                <time dateTime={post.updatedAt}>
                  {post.updatedAt.slice(0, 10)}
                </time>
              </>
            )}
          </p>
        )}
        <div className="mt-6">
          <MarkdownRenderer content={post.content} size="lg" />
        </div>
      </article>
    </main>
  );
}
