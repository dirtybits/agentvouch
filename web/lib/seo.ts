import type { Metadata } from "next";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_OG_IMAGE_PATH,
  SITE_TAGLINE,
  SITE_TWITTER_IMAGE_PATH,
  getCanonicalUrl,
  truncateDescription,
} from "@/lib/site";

type BuildMetadataParams = {
  title: string;
  description?: string;
  path?: string;
  keywords?: string[];
};

export function buildMetadata({
  title,
  description = SITE_DESCRIPTION,
  path = "/",
  keywords = [],
}: BuildMetadataParams): Metadata {
  const normalizedDescription = truncateDescription(description);
  const canonical = getCanonicalUrl(path);
  const ogImage = getCanonicalUrl(SITE_OG_IMAGE_PATH);
  const twitterImage = getCanonicalUrl(SITE_TWITTER_IMAGE_PATH);

  return {
    title,
    description: normalizedDescription,
    keywords,
    alternates: {
      canonical,
    },
    openGraph: {
      type: "website",
      url: canonical,
      siteName: SITE_NAME,
      title,
      description: normalizedDescription,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: `${SITE_NAME} social card`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: normalizedDescription,
      images: [twitterImage],
    },
  };
}

export function buildDefaultMetadata(): Metadata {
  const googleVerification =
    process.env.GOOGLE_SITE_VERIFICATION ||
    process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;

  return {
    metadataBase: new URL(getCanonicalUrl("/")),
    title: {
      default: `${SITE_NAME} | ${SITE_TAGLINE}`,
      template: `%s | ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    alternates: {
      canonical: getCanonicalUrl("/"),
    },
    openGraph: {
      type: "website",
      url: getCanonicalUrl("/"),
      siteName: SITE_NAME,
      title: `${SITE_NAME} | ${SITE_TAGLINE}`,
      description: SITE_DESCRIPTION,
      images: [
        {
          url: getCanonicalUrl(SITE_OG_IMAGE_PATH),
          width: 1200,
          height: 630,
          alt: `${SITE_NAME} social card`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${SITE_NAME} | ${SITE_TAGLINE}`,
      description: SITE_DESCRIPTION,
      images: [getCanonicalUrl(SITE_TWITTER_IMAGE_PATH)],
    },
    verification: googleVerification
      ? {
          google: googleVerification,
        }
      : undefined,
  };
}

type DocFaq = { q: string; a: string };

type BuildDocJsonLdParams = {
  title: string;
  description: string;
  path: string;
  /** ISO date (YYYY-MM-DD). Omit for pages without a stable publish date. */
  published?: string;
  faqs?: DocFaq[];
};

/**
 * Build a schema.org `@graph` for a docs/content page: BreadcrumbList
 * (Docs → title), a TechArticle node, and an optional FAQPage. Pages render it
 * with a single `application/ld+json` script. Chain-agnostic on purpose — no
 * per-chain facts belong in human-facing structured data.
 */
export function buildDocJsonLd({
  title,
  description,
  path,
  published,
  faqs,
}: BuildDocJsonLdParams) {
  const url = getCanonicalUrl(path);
  const org = {
    "@type": "Organization",
    name: SITE_NAME,
    url: getCanonicalUrl("/"),
  };

  const graph: Record<string, unknown>[] = [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Docs",
          item: getCanonicalUrl("/docs"),
        },
        { "@type": "ListItem", position: 2, name: title, item: url },
      ],
    },
    {
      "@type": "TechArticle",
      headline: title,
      description: truncateDescription(description),
      url,
      inLanguage: "en",
      ...(published
        ? { datePublished: published, dateModified: published }
        : {}),
      author: org,
      publisher: org,
    },
  ];

  if (faqs && faqs.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}
