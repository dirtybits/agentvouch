"use client";

import { useMemo, useState } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import {
  FiAlertTriangle,
  FiChevronDown,
  FiChevronRight,
  FiCode,
  FiFileText,
  FiFolder,
  FiLoader,
  FiLock,
} from "react-icons/fi";
import type { SkillSecurityScan } from "@/lib/securityScan";
import { finalizeSlug } from "@/lib/skillDraft";

export interface SkillFileTreeEntry {
  path: string;
  size: number;
  sha256: string;
  contentType?: string;
  executable?: boolean;
}

interface SkillFileTreeProps {
  skillId: string;
  skillName: string;
  files: SkillFileTreeEntry[];
  treeHash: string | null;
  hasExecutable: boolean;
  securityScan?: SkillSecurityScan | null;
  initialContent: string | null;
  /** Paid skill whose content is gated: show the tree, lock the file body. */
  walled?: boolean;
  priceLabel?: string;
}

type TreeFileNode = {
  type: "file";
  name: string;
  path: string;
  file: SkillFileTreeEntry;
};

type TreeDirectoryNode = {
  type: "directory";
  name: string;
  path: string;
  children: TreeNode[];
};

type TreeNode = TreeFileNode | TreeDirectoryNode;

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function sortTreeNodes(a: TreeNode, b: TreeNode): number {
  if (a.path === "SKILL.md") return -1;
  if (b.path === "SKILL.md") return 1;
  if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function getSkillTreeRootName(skillName: string): string {
  return finalizeSlug(skillName) || "skill";
}

function buildTree(
  files: SkillFileTreeEntry[],
  rootName: string
): TreeDirectoryNode {
  const root: TreeDirectoryNode = {
    type: "directory",
    name: rootName,
    path: "",
    children: [],
  };

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;
    for (const [index, part] of parts.entries()) {
      const isFile = index === parts.length - 1;
      const nodePath = parts.slice(0, index + 1).join("/");
      if (isFile) {
        current.children.push({
          type: "file",
          name: part,
          path: file.path,
          file,
        });
        continue;
      }

      let directory = current.children.find(
        (child): child is TreeDirectoryNode =>
          child.type === "directory" && child.path === nodePath
      );
      if (!directory) {
        directory = {
          type: "directory",
          name: part,
          path: nodePath,
          children: [],
        };
        current.children.push(directory);
      }
      current = directory;
    }
  }

  function sortChildren(directory: TreeDirectoryNode) {
    directory.children.sort(sortTreeNodes);
    for (const child of directory.children) {
      if (child.type === "directory") sortChildren(child);
    }
  }

  sortChildren(root);
  return root;
}

function collectDirectoryPaths(directory: TreeDirectoryNode): string[] {
  return directory.children.flatMap((child) =>
    child.type === "directory"
      ? [child.path, ...collectDirectoryPaths(child)]
      : []
  );
}

export default function SkillFileTree({
  skillId,
  skillName,
  files,
  treeHash,
  hasExecutable,
  securityScan,
  initialContent,
  walled = false,
  priceLabel,
}: SkillFileTreeProps) {
  const tree = useMemo(
    () => buildTree(files, getSkillTreeRootName(skillName)),
    [files, skillName]
  );
  const [selectedPath, setSelectedPath] = useState("SKILL.md");
  const [selectedContent, setSelectedContent] = useState(initialContent ?? "");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(collectDirectoryPaths(tree))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const selected = files.find((file) => file.path === selectedPath);
  async function selectFile(file: SkillFileTreeEntry) {
    setSelectedPath(file.path);
    setError(null);
    if (walled) {
      return;
    }
    if (file.path === "SKILL.md") {
      setSelectedContent(initialContent ?? "");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/skills/${skillId}/raw?path=${encodeURIComponent(file.path)}`
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        throw new Error(body?.error || body?.message || "Unable to load file");
      }
      setSelectedContent(await response.text());
    } catch (err) {
      setSelectedContent("");
      setError(err instanceof Error ? err.message : "Unable to load file");
    } finally {
      setLoading(false);
    }
  }

  function toggleDirectory(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function renderNode(node: TreeNode, depth = 0) {
    const paddingLeft = `${depth * 14 + 8}px`;
    if (node.type === "directory") {
      const expanded = expandedPaths.has(node.path);
      return (
        <div key={node.path} className="space-y-1">
          <button
            type="button"
            onClick={() => toggleDirectory(node.path)}
            aria-expanded={expanded}
            className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left font-mono text-xs font-normal text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200"
            style={{ paddingLeft }}
          >
            {expanded ? (
              <FiChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <FiChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
            <FiFolder className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
            <span className="truncate">{node.name}/</span>
          </button>
          {expanded && (
            <div className="space-y-1">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        key={node.path}
        type="button"
        onClick={() => void selectFile(node.file)}
        className={`flex w-full items-center justify-between gap-2 rounded-sm border px-2 py-1.5 text-left text-xs transition ${
          selectedPath === node.path
            ? "border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)]"
            : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300"
        }`}
        style={{ paddingLeft }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {node.file.executable ? (
            <FiCode className="h-3 w-3 shrink-0" />
          ) : (
            <FiFileText className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </span>
        <span className="shrink-0 text-[10px] text-gray-400">
          {formatBytes(node.file.size)}
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white/70 p-6 dark:border-gray-800 dark:bg-gray-900/50">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <FiFolder className="h-4 w-4 text-gray-400" />
          <span className="text-xs font-normal uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Skill Files
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-gray-500 dark:text-gray-400">
          <span>{files.length} files</span>
          <span>{formatBytes(totalBytes)}</span>
          {treeHash && (
            <span title={treeHash}>tree {treeHash.slice(0, 10)}...</span>
          )}
        </div>
      </div>

      {hasExecutable && !securityScan ? (
        <div className="mb-4 flex items-start gap-2 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <FiAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Contains executable code — not yet security-scanned.</span>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="rounded-sm border border-gray-100 bg-gray-50/70 p-2 dark:border-gray-800 dark:bg-gray-950/40">
          <div className="mb-1 flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-gray-400">
            <FiFolder className="h-3.5 w-3.5" />
            {tree.name}/
          </div>
          <div className="space-y-1">
            {tree.children.map((node) => renderNode(node))}
          </div>
        </div>

        <div className="min-w-0 rounded-sm border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/60">
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-gray-200 pb-3 dark:border-gray-800">
            <span className="truncate font-mono text-xs font-normal text-gray-600 dark:text-gray-300">
              {selectedPath}
            </span>
            {selected && (
              <span className="font-mono text-[10px] text-gray-400">
                {selected.sha256.slice(0, 12)}...
              </span>
            )}
          </div>
          {walled ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <FiLock className="h-6 w-6 text-gray-400" />
              <p className="font-article text-lg text-gray-700 dark:text-gray-200">
                Full content unlocks after purchase
              </p>
              <p className="max-w-xs text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                You can review the file tree and the security-scan read now.
                SKILL.md and any scripts are delivered on a verified, per-buyer
                download once you purchase
                {priceLabel ? ` (${priceLabel})` : ""}.
              </p>
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <FiLoader className="h-4 w-4 animate-spin" />
              Loading file...
            </div>
          ) : error ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              {error}
            </p>
          ) : selectedPath === "SKILL.md" ? (
            <div className="font-article">
              <MarkdownRenderer content={selectedContent} />
            </div>
          ) : (
            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-gray-700 dark:text-gray-300">
              <code>{selectedContent}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
