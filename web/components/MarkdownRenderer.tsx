"use client";

import { CopyCodeBlock } from "@/components/CopyCodeBlock";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export default function MarkdownRenderer({
  content,
  className = "",
}: MarkdownRendererProps) {
  return (
    <div className={`prose prose-lg dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold border-b border-gray-200 dark:border-gray-700 pb-2 mb-4">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-bold mt-6 mb-3">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>
          ),
          code: ({ children, className: codeClassName }) => {
            const isBlock = codeClassName?.includes("language-");
            if (isBlock) {
              const language = codeClassName?.match(/language-([\w-]+)/)?.[1];
              const value = String(children).replace(/\n$/, "");
              return (
                <CopyCodeBlock
                  value={value}
                  language={language}
                  className="my-4 p-4 text-sm"
                />
              );
            }
            return (
              <code className="bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 text-sm text-pink-600 dark:text-pink-400">
                {children}
              </code>
            );
          },
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
          p: ({ children }) => (
            <p className="my-4 text-lg leading-relaxed">{children}</p>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 border-l-4 border-gray-300 pl-4 italic text-gray-600 dark:border-gray-700 dark:text-gray-400">
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="my-8 border-gray-200 dark:border-gray-800" />
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-inside space-y-1 my-2">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside space-y-1 my-2">
              {children}
            </ol>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full border border-gray-200 dark:border-gray-700 rounded-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="bg-gray-100 dark:bg-gray-800 px-3 py-2 text-left text-xs font-semibold border-b border-gray-200 dark:border-gray-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
