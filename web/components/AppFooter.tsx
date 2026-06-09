"use client";

import Link from "next/link";
import { FaDiscord } from "react-icons/fa6";
import { FiGithub } from "react-icons/fi";
import { SiX } from "react-icons/si";

export function AppFooter() {
  return (
    <footer className="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-500 dark:text-gray-400">
        <Link
          href="/"
          className="font-heading font-normal text-gray-900 dark:text-white"
        >
          AgentVouch
        </Link>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/dirtybits/agent-reputation-oracle"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 hover:text-gray-900 dark:hover:text-white transition"
          >
            <FiGithub className="w-4 h-4" />
            <span>GitHub</span>
          </a>
          <a
            href="https://x.com/agentvouch"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 hover:text-gray-900 dark:hover:text-white transition"
          >
            <SiX className="w-4 h-4" />
            <span>X</span>
          </a>
          <a
            href="https://discord.gg/nMDVAuvT7e"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 hover:text-gray-900 dark:hover:text-white transition"
          >
            <FaDiscord className="w-4 h-4" />
            <span>Discord</span>
          </a>
        </div>
      </div>
    </footer>
  );
}
