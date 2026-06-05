"use client";

import { CopyCodeBlock } from "@/components/CopyCodeBlock";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** Prose scale. Defaults to "sm" (matches app/skill UI text); blog uses "lg". */
  size?: "sm" | "base" | "lg";
}

export default function MarkdownRenderer({
  content,
  className = "",
  size = "sm",
}: MarkdownRendererProps) {
  const sizeClass =
    size === "lg" ? "prose-lg" : size === "base" ? "prose-base" : "prose-sm";
  return (
    <div
      className={`prose ${sizeClass} dark:prose-invert max-w-none ${className}`}
    >
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
                  className="not-prose my-4 p-4 text-sm"
                />
              );
            }
            return (
              <code className="bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 text-sm text-pink-600 dark:text-pink-400">
                {children}
              </code>
            );
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
        {content}
      </ReactMarkdown>
    </div>
  );
}
