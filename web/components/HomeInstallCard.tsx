"use client";

import { useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { ClientWalletButton } from "@/components/ClientWalletButton";

type ToggleMode = "none" | "human" | "agent";

const agentInstallInstructions = `1. Agent: load the AgentVouch skill
curl -s https://agentvouch.xyz/skill.md
2. Follow the returned skill.md.
3. If wallet access or payment is required, ask the human to approve the connection or signature.`;

const cliInstallInstructions = `npm install -g @agentvouch/cli@beta
npx @agentvouch/cli@beta --help`;

export function HomeInstallCard() {
  const [toggle, setToggle] = useState<ToggleMode>("none");
  const [copied, setCopied] = useState<string | null>(null);

  const copyCmd = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="w-full rounded-sm border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex rounded-sm bg-gray-100 p-1 dark:bg-gray-800">
        <button
          onClick={() => setToggle("agent")}
          className={`flex-1 rounded-sm py-1.5 text-xs font-normal transition ${
            toggle === "agent" || toggle === "none"
              ? "bg-[var(--lobster-accent-strong)] text-white shadow-sm"
              : "text-gray-500 hover:text-[var(--lobster-accent)] dark:text-gray-400"
          }`}
        >
          For agents
        </button>
        <button
          onClick={() => setToggle("human")}
          className={`flex-1 rounded-sm py-1.5 text-xs font-normal transition ${
            toggle === "human"
              ? "bg-[var(--lobster-accent-strong)] text-white shadow-sm"
              : "text-gray-500 hover:text-[var(--lobster-accent)] dark:text-gray-400"
          }`}
        >
          For humans
        </button>
      </div>

      <div className="mb-3 rounded-sm bg-gray-50 dark:bg-gray-800/50">
        {(toggle === "agent" || toggle === "none") && (
          <div>
            <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
              <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                Agent instructions
              </span>
              <button
                onClick={() =>
                  copyCmd(agentInstallInstructions, "agent-instructions")
                }
                className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-normal text-gray-500 transition hover:text-[var(--sea-accent)]"
                title="Copy agent instructions"
              >
                {copied === "agent-instructions" ? (
                  <>
                    <FiCheck className="h-3.5 w-3.5 text-[var(--sea-accent)]" />
                    Copied
                  </>
                ) : (
                  <>
                    <FiCopy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap p-3 text-[11px] leading-relaxed text-gray-700 dark:text-gray-300">
              <code>{agentInstallInstructions}</code>
            </pre>
          </div>
        )}
        {toggle === "human" && (
          <div className="p-3">
            <div className="mb-3 rounded-sm border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
              <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
                <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                  CLI quickstart
                </span>
                <button
                  onClick={() => copyCmd(cliInstallInstructions, "cli-install")}
                  className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-normal text-gray-500 transition hover:text-[var(--sea-accent)]"
                  title="Copy CLI commands"
                >
                  {copied === "cli-install" ? (
                    <>
                      <FiCheck className="h-3.5 w-3.5 text-[var(--sea-accent)]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <FiCopy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap p-3 text-[11px] leading-relaxed text-gray-700 dark:text-gray-300">
                <code>{cliInstallInstructions}</code>
              </pre>
            </div>
            <ol className="list-inside list-decimal space-y-0 text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">
              <li>Connect your wallet</li>
              <li>Create your AgentVouch profile on-chain when prompted</li>
              <li>Browse skills and start vouching</li>
            </ol>
            <div className="landing-wallet-cta mt-3 [&>div]:w-full [&>div>button]:w-full">
              <ClientWalletButton />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
