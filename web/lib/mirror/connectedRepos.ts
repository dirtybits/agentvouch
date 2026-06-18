// First-party "connected repos": a wallet authorizes a public GitHub repo it
// owns to be kept in sync as its OWN listings (attributed to the wallet, not a
// synthetic GitHub identity like community mirrors). This module owns the
// connected_repos table CRUD and repo-ownership verification.
//
// Ownership is proven one of two ways (see verifyRepoOwnership):
//   - linked-login: the repo owner matches the GitHub account the wallet linked
//     on /settings (covers personal repos, github.com/<you>/<repo>).
//   - verify-file: the repo contains .well-known/agentvouch.json with the
//     wallet pubkey (works for any public repo incl. orgs; agent-friendly).
//
// Connected repos must be PUBLIC — the sync engine fetches content over
// unauthenticated raw.githubusercontent.com.

import { sql } from "@/lib/db";
import { resolveAgentIdentityByWallet } from "@/lib/agentIdentity";

export type ConnectedRepo = {
  id: string;
  owner_wallet: string;
  github_owner: string;
  github_repo: string;
  branch: string;
  include_paths: string[];
  verification_method: string;
  status: string;
  last_commit_sha: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_detail: string | null;
  created_at: string;
  updated_at: string;
};

export type OwnershipResult =
  | { verified: true; method: "linked-login" | "verify-file" }
  | { verified: false; reason: string };

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,120}$/;

export const VERIFICATION_FILE_PATH = ".well-known/agentvouch.json";

export function validateRepoCoords(input: {
  githubOwner: string;
  githubRepo: string;
  branch?: string;
}): { ok: true; branch: string } | { ok: false; error: string } {
  if (!OWNER_RE.test(input.githubOwner)) {
    return { ok: false, error: "Invalid GitHub owner" };
  }
  if (!REPO_RE.test(input.githubRepo)) {
    return { ok: false, error: "Invalid GitHub repo" };
  }
  const branch = (input.branch || "main").trim();
  if (!BRANCH_RE.test(branch)) {
    return { ok: false, error: "Invalid branch" };
  }
  return { ok: true, branch };
}

async function linkedGithubLogin(walletPubkey: string): Promise<string | null> {
  const summary = await resolveAgentIdentityByWallet(walletPubkey, {
    createIfMissing: false,
    persistDerived: false,
  }).catch(() => null);
  return summary?.githubProfile?.login ?? null;
}

async function repoVerificationFileMatches(
  githubOwner: string,
  githubRepo: string,
  branch: string,
  walletPubkey: string
): Promise<boolean> {
  const url = `https://raw.githubusercontent.com/${githubOwner}/${githubRepo}/${branch}/${VERIFICATION_FILE_PATH}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "agentvouch-connect" },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      owner_wallet?: unknown;
      wallet?: unknown;
    };
    const claimed = String(body.owner_wallet ?? body.wallet ?? "").trim();
    return claimed === walletPubkey;
  } catch {
    return false;
  }
}

export async function verifyRepoOwnership(input: {
  walletPubkey: string;
  githubOwner: string;
  githubRepo: string;
  branch: string;
}): Promise<OwnershipResult> {
  const login = await linkedGithubLogin(input.walletPubkey);
  if (login && login.toLowerCase() === input.githubOwner.toLowerCase()) {
    return { verified: true, method: "linked-login" };
  }

  if (
    await repoVerificationFileMatches(
      input.githubOwner,
      input.githubRepo,
      input.branch,
      input.walletPubkey
    )
  ) {
    return { verified: true, method: "verify-file" };
  }

  return {
    verified: false,
    reason: login
      ? `Repo owner "${input.githubOwner}" is not your linked GitHub account (@${login}), and ${VERIFICATION_FILE_PATH} with your wallet was not found on ${input.githubOwner}/${input.githubRepo}@${input.branch}.`
      : `Link your GitHub account on /settings (if you own ${input.githubOwner}), or add ${VERIFICATION_FILE_PATH} containing {"owner_wallet":"${input.walletPubkey}"} to the repo.`,
  };
}

export async function listConnectedRepos(
  ownerWallet: string
): Promise<ConnectedRepo[]> {
  return sql()<ConnectedRepo>`
    SELECT * FROM connected_repos
    WHERE owner_wallet = ${ownerWallet}
    ORDER BY created_at DESC
  `;
}

export async function listActiveConnectedRepos(): Promise<ConnectedRepo[]> {
  return sql()<ConnectedRepo>`
    SELECT * FROM connected_repos
    WHERE status = 'active'
    ORDER BY created_at ASC
  `;
}

export async function getConnectedRepo(
  id: string
): Promise<ConnectedRepo | null> {
  const rows = await sql()<ConnectedRepo>`
    SELECT * FROM connected_repos WHERE id = ${id}::uuid LIMIT 1
  `;
  return rows[0] ?? null;
}

export type CreateConnectedRepoResult =
  | { ok: true; repo: ConnectedRepo; created: boolean }
  | { ok: false; status: number; error: string };

export async function createConnectedRepo(input: {
  ownerWallet: string;
  githubOwner: string;
  githubRepo: string;
  branch: string;
  includePaths: string[];
  verificationMethod: string;
}): Promise<CreateConnectedRepoResult> {
  // Idempotent for the same owner; conflict if another wallet already claimed it.
  const existing = await sql()<ConnectedRepo>`
    SELECT * FROM connected_repos
    WHERE github_owner = ${input.githubOwner} AND github_repo = ${input.githubRepo}
    LIMIT 1
  `;
  if (existing[0]) {
    if (existing[0].owner_wallet !== input.ownerWallet) {
      return {
        ok: false,
        status: 409,
        error: `${input.githubOwner}/${input.githubRepo} is already connected by another wallet.`,
      };
    }
    const [updated] = await sql()<ConnectedRepo>`
      UPDATE connected_repos
      SET branch = ${input.branch},
          include_paths = ${input.includePaths}::text[],
          verification_method = ${input.verificationMethod},
          status = 'active',
          updated_at = NOW()
      WHERE id = ${existing[0].id}::uuid
      RETURNING *
    `;
    return { ok: true, repo: updated, created: false };
  }

  const [repo] = await sql()<ConnectedRepo>`
    INSERT INTO connected_repos (
      owner_wallet, github_owner, github_repo, branch,
      include_paths, verification_method, status
    ) VALUES (
      ${input.ownerWallet}, ${input.githubOwner}, ${input.githubRepo}, ${input.branch},
      ${input.includePaths}::text[], ${input.verificationMethod}, 'active'
    )
    RETURNING *
  `;
  return { ok: true, repo, created: true };
}

export async function deleteConnectedRepo(
  id: string,
  ownerWallet: string
): Promise<boolean> {
  const rows = await sql()<{ id: string }>`
    DELETE FROM connected_repos
    WHERE id = ${id}::uuid AND owner_wallet = ${ownerWallet}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function updateConnectedRepoSyncState(
  id: string,
  state: {
    lastCommitSha?: string | null;
    status?: "ok" | "error";
    detail?: string | null;
  }
): Promise<void> {
  await sql()`
    UPDATE connected_repos
    SET last_synced_at = NOW(),
        last_commit_sha = COALESCE(${
          state.lastCommitSha ?? null
        }, last_commit_sha),
        last_sync_status = ${state.status ?? null},
        last_sync_detail = ${state.detail ?? null},
        updated_at = NOW()
    WHERE id = ${id}::uuid
  `;
}
