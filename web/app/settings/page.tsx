"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { encodeBase64 } from "@/lib/base64";
import { useAgentVouchWallet } from "@/components/WalletContextProvider";
import { useAgentVouchTransactionSigner } from "@/hooks/useAgentVouchTransactionSigner";
import {
  navButtonInlineClass,
  navButtonPrimaryInlineClass,
  navButtonSecondaryInlineClass,
} from "@/lib/buttonStyles";
import {
  FiGithub,
  FiKey,
  FiPlus,
  FiTrash2,
  FiLoader,
  FiCopy,
  FiCheck,
  FiShield,
  FiArrowLeft,
  FiAlertTriangle,
  FiUser,
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

interface AgentIdentitySummary {
  username: string | null;
  usernameSource: "fallback" | "user";
  displayName: string | null;
  githubProfile: {
    login: string;
    name: string | null;
    avatarUrl: string | null;
    url: string;
  } | null;
}

interface GithubSessionState {
  configured: boolean;
  authenticated: boolean;
  user: {
    login: string;
    name: string | null;
    avatarUrl: string | null;
  } | null;
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
  const [identity, setIdentity] = useState<AgentIdentitySummary | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityStatus, setIdentityStatus] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [githubSession, setGithubSession] = useState<GithubSessionState | null>(
    null
  );
  const [linkingGithub, setLinkingGithub] = useState(false);

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

  const loadIdentity = useCallback(async () => {
    if (!connected || !walletAddress) return;
    setIdentityLoading(true);
    try {
      const res = await fetch(`/api/agents/${walletAddress}/identity`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load profile identity");
      }
      const data = await res.json();
      const nextIdentity = data.author_identity ?? null;
      setIdentity(nextIdentity);
      setUsernameDraft(nextIdentity?.username ?? "");
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    } finally {
      setIdentityLoading(false);
    }
  }, [connected, walletAddress]);

  const loadGithubSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/github/session", {
        cache: "no-store",
      });
      if (!res.ok) return;
      setGithubSession(await res.json());
    } catch {
      setGithubSession(null);
    }
  }, []);

  useEffect(() => {
    if (connected) loadKeys();
  }, [connected, loadKeys]);

  useEffect(() => {
    if (!connected) {
      setIdentity(null);
      setUsernameDraft("");
      return;
    }
    loadIdentity();
    loadGithubSession();
  }, [connected, loadIdentity, loadGithubSession]);

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

  const saveUsername = async () => {
    if (!connected || !walletAddress) return;
    setIdentitySaving(true);
    setIdentityStatus(null);
    setError(null);
    try {
      const auth = await signAuth("update-identity");
      const res = await fetch(`/api/agents/${walletAddress}/identity`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth, username: usernameDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update username");
      setIdentity(data.author_identity ?? null);
      setUsernameDraft(data.author_identity?.username ?? usernameDraft);
      setIdentityStatus("Username saved.");
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    } finally {
      setIdentitySaving(false);
    }
  };

  const linkGithub = async () => {
    if (!connected || !walletAddress) return;
    setLinkingGithub(true);
    setIdentityStatus(null);
    setError(null);
    try {
      const auth = await signAuth("link-github-profile");
      const res = await fetch(`/api/agents/${walletAddress}/identity/github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to link GitHub");
      setIdentity(data.author_identity ?? null);
      setIdentityStatus("GitHub profile linked.");
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    } finally {
      setLinkingGithub(false);
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
  const usernameChanged = usernameDraft.trim() !== (identity?.username ?? "");
  const githubReturnTo = encodeURIComponent("/settings");

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

            <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-normal uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <FiUser className="w-4 h-4" />
                    Profile Identity
                  </h2>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    Choose the public handle agents see for this wallet.
                  </p>
                </div>
                {identityLoading && (
                  <FiLoader className="mt-1 h-4 w-4 animate-spin text-gray-400" />
                )}
              </div>

              {identityStatus && (
                <div className="mb-4 rounded-sm border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                  {identityStatus}
                </div>
              )}

              <div className="grid gap-5 md:grid-cols-[1.1fr_0.9fr]">
                <div>
                  <label
                    htmlFor="agent-username"
                    className="mb-1 block text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500"
                  >
                    Username
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-gray-400">@</span>
                    <input
                      id="agent-username"
                      type="text"
                      value={usernameDraft}
                      onChange={(e) => setUsernameDraft(e.target.value)}
                      placeholder="wallet-dmt4cd"
                      className="min-w-0 flex-1 rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900 focus:border-[var(--sea-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--sea-focus-ring)] dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                      maxLength={32}
                    />
                    <button
                      type="button"
                      onClick={saveUsername}
                      disabled={!usernameChanged || identitySaving}
                      className={`${navButtonPrimaryInlineClass} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {identitySaving ? (
                        <>
                          <FiLoader className="w-4 h-4 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        "Save"
                      )}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                    {identity?.usernameSource === "fallback"
                      ? "This fallback was created from your wallet. You can replace it."
                      : "Use lowercase letters, numbers, and hyphens."}
                  </p>
                </div>

                <div className="rounded-sm border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/40">
                  <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    <FiGithub className="w-4 h-4" />
                    GitHub Profile
                  </div>
                  {identity?.githubProfile ? (
                    <div className="space-y-2">
                      <a
                        href={identity.githubProfile.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1 truncate font-mono text-sm text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                      >
                        <FiGithub className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          @{identity.githubProfile.login}
                        </span>
                      </a>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        Verified by GitHub OAuth and this wallet signature.
                      </p>
                    </div>
                  ) : githubSession?.authenticated ? (
                    <div className="space-y-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Signed in as{" "}
                        <span className="font-mono">
                          @{githubSession.user?.login}
                        </span>
                        .
                      </p>
                      <button
                        type="button"
                        onClick={linkGithub}
                        disabled={linkingGithub}
                        className={navButtonSecondaryInlineClass}
                      >
                        {linkingGithub ? (
                          <>
                            <FiLoader className="w-4 h-4 animate-spin" />
                            Linking…
                          </>
                        ) : (
                          "Link to wallet"
                        )}
                      </button>
                    </div>
                  ) : githubSession?.configured === false ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      GitHub OAuth is not configured in this environment.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Sign in with GitHub, then link that profile to this
                        wallet.
                      </p>
                      <a
                        href={`/api/auth/github/start?returnTo=${githubReturnTo}`}
                        className={navButtonSecondaryInlineClass}
                      >
                        <FiGithub className="w-4 h-4" />
                        Sign in with GitHub
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>

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
