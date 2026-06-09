"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { encodeBase64 } from "@/lib/base64";
import { useAgentVouchWallet } from "@/components/WalletContextProvider";
import { useAgentVouchTransactionSigner } from "@/hooks/useAgentVouchTransactionSigner";
import {
  navButtonInlineClass,
  navButtonPrimaryInlineClass,
} from "@/lib/buttonStyles";
import {
  FiKey,
  FiPlus,
  FiTrash2,
  FiLoader,
  FiCopy,
  FiCheck,
  FiShield,
  FiArrowLeft,
  FiAlertTriangle,
} from "react-icons/fi";
import { getErrorMessage } from "@/lib/errors";

interface ApiKeyRow {
  id: string;
  key_prefix: string;
  name: string;
  permissions: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export default function SettingsPage() {
  const { status, account } = useAgentVouchWallet();
  const { signMessage } = useAgentVouchTransactionSigner();
  const connected = status === "connected" && !!account;
  const walletAddress = account ?? null;

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const signAuth = useCallback(
    async (action: string) => {
      if (!walletAddress || !signMessage)
        throw new Error("Wallet not connected");
      const timestamp = Date.now();
      const message = `AgentVouch Skill Repo\nAction: ${action}\nTimestamp: ${timestamp}`;
      const msgBytes = new TextEncoder().encode(message);
      const sigBytes = await signMessage(msgBytes);
      const signature = encodeBase64(sigBytes);
      return { pubkey: walletAddress, signature, message, timestamp };
    },
    [walletAddress, signMessage]
  );

  const loadKeys = useCallback(async () => {
    if (!connected || !walletAddress || !signMessage) return;
    setLoading(true);
    try {
      const auth = await signAuth("list-keys");
      const res = await fetch("/api/keys", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load keys");
      }

      const data = await res.json();
      setKeys(data.keys || []);
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, walletAddress]);

  useEffect(() => {
    if (connected) loadKeys();
  }, [connected, loadKeys]);

  const createKey = async () => {
    if (!connected) return;
    setCreating(true);
    setError(null);
    setNewKey(null);
    try {
      const auth = await signAuth("create-key");
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth, name: newKeyName || "default" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create key");

      setNewKey(data.key);
      setNewKeyName("");
      await loadKeys();
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    if (!connected) return;
    setRevoking(keyId);
    setError(null);
    try {
      const auth = await signAuth("revoke-key");
      const res = await fetch("/api/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth, key_id: keyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to revoke key");
      await loadKeys();
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    } finally {
      setRevoking(null);
    }
  };

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link
                href="/skills"
                className="text-sm text-gray-400 dark:text-gray-500 hover:text-[var(--sea-accent)] transition flex items-center gap-1"
              >
                <FiArrowLeft className="w-3.5 h-3.5" />
                Back
              </Link>
            </div>
            <h1 className="text-3xl font-display text-gray-900 dark:text-white mb-1">
              Settings
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Manage API keys for programmatic access to AgentVouch.
            </p>
          </div>
        </div>

        {!connected ? (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
            <FiKey className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-700 mb-4" />
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              Connect your wallet to manage API keys.
            </p>
          </div>
        ) : (
          <>
            {/* Newly created key banner */}
            {newKey && (
              <div className="rounded-sm border border-green-200 dark:border-green-800/50 bg-green-50 dark:bg-green-900/10 p-4 mb-6">
                <div className="flex items-start gap-3">
                  <FiAlertTriangle className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-normal text-green-800 dark:text-green-300 mb-1">
                      API key created — copy it now!
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400 mb-2">
                      This key will not be shown again.
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono bg-green-100 dark:bg-green-900/40 rounded px-3 py-2 text-green-800 dark:text-green-300 break-all">
                        {newKey}
                      </code>
                      <button
                        onClick={copyKey}
                        className="shrink-0 p-2 rounded-lg bg-green-200 dark:bg-green-800 hover:bg-green-300 dark:hover:bg-green-700 transition text-green-700 dark:text-green-300"
                      >
                        {copied ? (
                          <FiCheck className="w-4 h-4" />
                        ) : (
                          <FiCopy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-sm border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/10 p-4 mb-6">
                <p className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              </div>
            )}

            {/* Create key */}
            <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
              <h2 className="text-sm font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <FiPlus className="w-4 h-4" />
                Create API Key
              </h2>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Key name (e.g., my-agent)"
                  className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sea-focus-ring)] focus:border-[var(--sea-accent)]"
                  maxLength={64}
                />
                <button
                  onClick={createKey}
                  disabled={creating}
                  className={navButtonPrimaryInlineClass}
                >
                  {creating ? (
                    <>
                      <FiLoader className="w-4 h-4 animate-spin" />
                      Creating…
                    </>
                  ) : (
                    <>
                      <FiKey className="w-4 h-4" />
                      Generate Key
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Use API keys for programmatic access. Pass via{" "}
                <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">
                  Authorization: Bearer sk_...
                </code>
              </p>
            </div>

            {/* Active keys */}
            <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
              <h2 className="text-sm font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <FiShield className="w-4 h-4" />
                Active Keys ({activeKeys.length})
              </h2>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <FiLoader className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : activeKeys.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">
                  No active API keys yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {activeKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex items-center justify-between p-3 rounded-sm bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700"
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-normal text-gray-900 dark:text-white">
                            {key.name}
                          </span>
                          <code className="text-xs font-mono text-[var(--sea-accent)] bg-[var(--sea-accent-soft)] px-1.5 py-0.5 rounded border border-[var(--sea-accent-border)]">
                            {key.key_prefix}...
                          </code>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                          <span>
                            Created{" "}
                            {new Date(key.created_at).toLocaleDateString()}
                          </span>
                          {key.last_used_at && (
                            <span>
                              Last used{" "}
                              {new Date(key.last_used_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => revokeKey(key.id)}
                        disabled={revoking === key.id}
                        className={`${navButtonInlineClass} gap-1.5 font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-40`}
                      >
                        {revoking === key.id ? (
                          <FiLoader className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FiTrash2 className="w-3.5 h-3.5" />
                        )}
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Revoked keys */}
            {revokedKeys.length > 0 && (
              <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <h2 className="text-sm font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
                  Revoked Keys ({revokedKeys.length})
                </h2>
                <div className="space-y-2">
                  {revokedKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex items-center justify-between p-3 rounded-sm bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 opacity-60"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500 dark:text-gray-400 line-through">
                            {key.name}
                          </span>
                          <code className="text-xs font-mono text-gray-400 dark:text-gray-500">
                            {key.key_prefix}...
                          </code>
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          Revoked{" "}
                          {key.revoked_at
                            ? new Date(key.revoked_at).toLocaleDateString()
                            : ""}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
