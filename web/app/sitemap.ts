import type { MetadataRoute } from "next";
import { sql } from "@/lib/db";
import { getAllPosts } from "@/lib/blog";
import { getCanonicalUrl } from "@/lib/site";
import { CONTENT_PAGES } from "@/lib/contentPages";
import { getPublicSkillPath } from "@/lib/skillUrls";

type SkillSitemapRow = {
  id: string;
  skill_id: string;
  public_slug: string;
  public_author_slug: string;
  author_pubkey: string | null;
  updated_at: string;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const blogPosts = await getAllPosts();
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: getCanonicalUrl("/"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: getCanonicalUrl("/docs"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: getCanonicalUrl("/skills"),
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: getCanonicalUrl("/blog"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    ...CONTENT_PAGES.map((page) => ({
      url: getCanonicalUrl(`/docs/${page.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...blogPosts.map((post) => ({
      url: getCanonicalUrl(`/blog/${post.slug}`),
      lastModified: post.publishedAt ? new Date(post.publishedAt) : now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];

  try {
    const rows = await sql()<SkillSitemapRow>`
      SELECT id, skill_id, public_slug, public_author_slug, author_pubkey, updated_at
      FROM skills
      ORDER BY updated_at DESC
    `;

    const skillPages: MetadataRoute.Sitemap = rows.map((row) => ({
      url: getCanonicalUrl(getPublicSkillPath(row)),
      lastModified: new Date(row.updated_at),
      changeFrequency: "weekly",
      priority: 0.7,
    }));

    const authorPages: MetadataRoute.Sitemap = [
      ...new Map(
        rows
          .filter((row): row is SkillSitemapRow & { author_pubkey: string } =>
            Boolean(row.author_pubkey)
          )
          .map((row) => [
            row.author_pubkey,
            {
              url: getCanonicalUrl(`/author/${row.author_pubkey}`),
              lastModified: new Date(row.updated_at),
              changeFrequency: "weekly" as const,
              priority: 0.7,
            },
          ])
      ).values(),
    ];

    return [...staticPages, ...skillPages, ...authorPages];
  } catch {
    return staticPages;
  }
}
