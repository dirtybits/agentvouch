import { readdir, readFile } from "fs/promises";
import { join } from "path";

// Blog posts are plain markdown (no frontmatter, so they paste cleanly into
// Substack/Medium). The title comes from the first `# ` heading and an optional
// subtitle from a following `*italic*` line. Filenames may carry a leading
// `YYYY-MM-DD-` prefix for ordering; it is stripped from the public slug.
const BLOG_DIR = join(process.cwd(), "content", "blog");

export interface BlogPostMeta {
  slug: string;
  title: string;
  subtitle: string | null;
}

export interface BlogPost extends BlogPostMeta {
  content: string;
}

function slugFromFile(file: string): string {
  return file.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

function parseTitleAndSubtitle(content: string): {
  title: string;
  subtitle: string | null;
} {
  const lines = content.split("\n");
  let title = "";
  let subtitle: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!title && line.startsWith("# ")) {
      title = line.slice(2).trim();
      continue;
    }
    if (title) {
      const m = line.match(/^\*(.+)\*$|^_(.+)_$/);
      subtitle = m ? (m[1] ?? m[2]).trim() : null;
      break;
    }
  }
  return { title, subtitle };
}

// Markdown filenames, newest-first. Filename-descending sort means a
// `YYYY-MM-DD-` prefix naturally orders newest-first; without one it is
// alphabetical. Returns [] if the dir is missing.
async function listFiles(): Promise<string[]> {
  try {
    const files = await readdir(BLOG_DIR);
    return files
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function getAllPosts(): Promise<BlogPostMeta[]> {
  const files = await listFiles();
  return Promise.all(
    files.map(async (file) => {
      const content = await readFile(join(BLOG_DIR, file), "utf8");
      const { title, subtitle } = parseTitleAndSubtitle(content);
      const slug = slugFromFile(file);
      return { slug, title: title || slug, subtitle };
    })
  );
}

export async function getAllSlugs(): Promise<string[]> {
  return (await listFiles()).map(slugFromFile);
}

export async function getPost(slug: string): Promise<BlogPost | null> {
  const files = await listFiles();
  const file = files.find((f) => slugFromFile(f) === slug);
  if (!file) return null;
  const content = await readFile(join(BLOG_DIR, file), "utf8");
  const { title, subtitle } = parseTitleAndSubtitle(content);
  return { slug, title: title || slug, subtitle, content };
}
