"use client";

import { CopyCodeBlock } from "@/components/CopyCodeBlock";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** Prose scale. Defaults to "sm" (matches app/skill UI text); blog uses "lg". */
  size?: "sm" | "base" | "lg";
  /** Rendering mode. Skill files use a denser technical-reader treatment. */
  variant?: "default" | "skill";
}

function splitFrontmatter(content: string): {
  frontmatter: string | null;
  body: string;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: null, body: content };
  }

  const closeIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---"
  );
  if (closeIndex < 0) {
    return { frontmatter: null, body: content };
  }

  return {
    frontmatter: lines.slice(1, closeIndex).join("\n").trim(),
    body: lines
      .slice(closeIndex + 1)
      .join("\n")
      .trimStart(),
  };
}

function FrontmatterBlock({ value }: { value: string }) {
  if (!value) return null;

  return (
    <div className="not-prose mb-5 rounded-sm border border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] px-3 py-2 font-heading text-[12px] leading-5 text-gray-700 dark:text-gray-200">
      <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-[var(--sea-accent-strong)]">
        skill metadata
      </div>
      <div className="space-y-0.5">
        {value.split("\n").map((line, index) => {
          const separator = line.indexOf(":");
          const hasKey = separator > 0;
          return (
            <div key={`${line}-${index}`} className="break-words">
              {hasKey ? (
                <>
                  <span className="text-gray-500 dark:text-gray-400">
                    {line.slice(0, separator + 1)}
                  </span>{" "}
                  <span>{line.slice(separator + 1).trimStart()}</span>
                </>
              ) : (
                line
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MarkdownRenderer({
  content,
  className = "",
  size = "sm",
  variant = "default",
}: MarkdownRendererProps) {
  const sizeClass =
    size === "lg" ? "prose-lg" : size === "base" ? "prose-base" : "prose-sm";
  const skillParts = variant === "skill" ? splitFrontmatter(content) : null;
  const markdownContent = skillParts?.body ?? content;
  const variantClass =
    variant === "skill"
      ? [
          "font-heading text-[13px] leading-6 text-gray-700 dark:text-gray-300",
          "prose-headings:font-heading prose-headings:font-normal prose-headings:tracking-normal",
          "prose-h1:mt-6 prose-h1:mb-3 prose-h1:text-[22px] prose-h1:leading-tight",
          "prose-h2:mt-6 prose-h2:mb-2 prose-h2:text-[16px] prose-h2:leading-snug",
          "prose-h3:mt-5 prose-h3:mb-2 prose-h3:text-[14px] prose-h3:leading-snug",
          "prose-p:my-3 prose-p:leading-6",
          "prose-ul:my-3 prose-ol:my-3 prose-li:my-1",
          "prose-strong:font-semibold prose-hr:my-5",
        ].join(" ")
      : "";
  const inlineCodeClass =
    variant === "skill"
      ? "rounded-sm border border-[var(--lobster-accent-border)] bg-[var(--lobster-accent-soft)] px-1.5 py-0.5 font-heading text-[0.92em] text-[var(--lobster-accent)]"
      : "bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 text-sm text-pink-600 dark:text-pink-400";
  return (
    <div
      className={`prose ${sizeClass} dark:prose-invert max-w-none ${variantClass} ${className}`}
    >
      {skillParts?.frontmatter ? (
        <FrontmatterBlock value={skillParts.frontmatter} />
      ) : null}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Generic prose elements (headings, paragraphs, lists, blockquote, hr,
          // tables) are styled by @tailwindcss/typography via the `prose` wrapper.
          // Only genuinely custom rendering stays below.
          code: ({ children, className: codeClassName }) => {
            const isBlock = codeClassName?.includes("language-");
            if (isBlock) {
              const language = codeClassName?.match(/language-([\w-]+)/)?.[1];
              const value = String(children).replace(/\n$/, "");
              return (
                <CopyCodeBlock
                  value={value}
                  language={language}
                  className={
                    variant === "skill"
                      ? "not-prose my-4 p-3 text-xs"
                      : "not-prose my-4 p-4 text-sm"
                  }
                />
              );
            }
            return <code className={inlineCodeClass}>{children}</code>;
          },
          // Unwrap the markdown <pre>; fenced blocks render via CopyCodeBlock.
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
        }}
      >
        {markdownContent}
      </ReactMarkdown>
    </div>
  );
}
