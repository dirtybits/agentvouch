import type { MetadataRoute } from "next";
import { sql } from "@/lib/db";
import { getCanonicalUrl } from "@/lib/site";
import { CONTENT_PAGES } from "@/lib/contentPages";

type SkillSitemapRow = {
  id: string;
  author_pubkey: string | null;
  updated_at: string;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
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
    ...CONTENT_PAGES.map((page) => ({
      url: getCanonicalUrl(`/docs/${page.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];

  try {
    const rows = await sql()<SkillSitemapRow>`
      SELECT id, author_pubkey, updated_at
      FROM skills
      ORDER BY updated_at DESC
    `;

    const skillPages: MetadataRoute.Sitemap = rows.map((row) => ({
      url: getCanonicalUrl(`/skills/${row.id}`),
      lastModified: new Date(row.updated_at),
      changeFrequency: "weekly",
      priority: 0.7,
    }));

    const authorPages: MetadataRoute.Sitemap = [
      ...new Map(
        rows
          .filter(
            (row): row is SkillSitemapRow & { author_pubkey: string } =>
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
