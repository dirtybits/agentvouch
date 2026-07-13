import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  AGENTVOUCH_DEFAULT_BASE_URL,
  AGENTVOUCH_DEFAULT_RPC_URL,
} from "@agentvouch/protocol";
import { Keypair } from "@solana/web3.js";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.AGENTVOUCH_BASE_URL ?? AGENTVOUCH_DEFAULT_BASE_URL;
const rpcUrl = process.env.AGENTVOUCH_RPC_URL ?? AGENTVOUCH_DEFAULT_RPC_URL;
const cliPath = path.resolve("packages/agentvouch-cli/dist/bin.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureCliBuilt() {
  if (!existsSync(cliPath)) {
    throw new Error(
      `[smoke] missing ${cliPath}. Run \`npm run build:cli\` (or \`npm ci\` which triggers the prepare hook) first.`
    );
  }

  await access(cliPath);
}

async function fetchJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `${label} failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

async function runCliJson(args, label) {
  const { stdout, stderr } = await execFileAsync("node", [cliPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
  });

  if (stderr.trim()) {
    throw new Error(`${label} wrote to stderr: ${stderr.trim()}`);
  }

  return JSON.parse(stdout);
}

function isFreeSkill(skill) {
  const usdcPrice = BigInt(skill.price_usdc_micros ?? "0");
  const historicalSolPrice = BigInt(skill.price_lamports ?? 0);

  return (
    skill.payment_flow === "free" ||
    (usdcPrice === 0n && historicalSolPrice === 0n)
  );
}

async function createPublishFixture() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentvouch-smoke-"));
  const keypair = Keypair.generate();
  const keypairPath = path.join(tempDir, "id.json");
  const skillFile = path.join(tempDir, "SKILL.md");

  await writeFile(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
  await writeFile(
    skillFile,
    "# Smoke Skill\n\nDisposable publish dry-run verification.\n"
  );

  return { tempDir, keypairPath, skillFile };
}

async function runOptionalLivePublishSmoke() {
  if (process.env.AGENTVOUCH_LIVE_PUBLISH !== "1") {
    return;
  }

  const keypairPath = process.env.AGENTVOUCH_LIVE_PUBLISH_KEYPAIR;
  assert(
    keypairPath,
    "AGENTVOUCH_LIVE_PUBLISH_KEYPAIR is required when AGENTVOUCH_LIVE_PUBLISH=1."
  );

  const liveSkillFile =
    process.env.AGENTVOUCH_LIVE_PUBLISH_SKILL_FILE ??
    (await createPublishFixture()).skillFile;
  const skillId = `smoke-live-${Date.now()}`;

  await runCliJson(
    [
      "author",
      "register",
      "--keypair",
      keypairPath,
      "--rpc-url",
      rpcUrl,
      "--json",
    ],
    "cli author register"
  );

  const publish = await runCliJson(
    [
      "skill",
      "publish",
      "--file",
      liveSkillFile,
      "--skill-id",
      skillId,
      "--name",
      "Smoke Live Publish",
      "--description",
      "Env-gated live publish verification",
      "--keypair",
      keypairPath,
      "--base-url",
      baseUrl,
      "--rpc-url",
      rpcUrl,
      "--json",
    ],
    "cli live publish"
  );

  const detail = await fetchJson(
    `${baseUrl}/api/skills/${publish.repoSkillId}`,
    "live published skill lookup"
  );

  assert(
    detail.on_chain_address === publish.listingAddress,
    "Live publish did not link the expected on-chain address."
  );
}

async function main() {
  await ensureCliBuilt();

  const list = await fetchJson(
    `${baseUrl}/api/skills?sort=newest`,
    "skills list"
  );
  assert(
    Array.isArray(list.skills),
    "Skills list did not return a skills array."
  );
  assert(list.skills.length > 0, "Skills list returned no skills to inspect.");

  const repoCandidates = list.skills.filter(
    (skill) => skill.source !== "chain"
  );
  let repoSkill = null;
  let detail = null;
  let installSkill = null;
  for (const candidate of repoCandidates) {
    const candidateDetail = await fetchJson(
      `${baseUrl}/api/skills/${candidate.id}`,
      `smoke candidate ${candidate.id}`
    );
    if (
      !repoSkill &&
      candidateDetail.author_pubkey &&
      (candidateDetail.author_trust_summary || candidateDetail.author_trust)
    ) {
      repoSkill = candidate;
      detail = candidateDetail;
    }
    if (
      !installSkill &&
      isFreeSkill(candidateDetail) &&
      !candidateDetail.on_chain_address
    ) {
      installSkill = candidateDetail;
    }
    if (repoSkill && installSkill) break;
  }
  assert(repoSkill?.id, "Could not find a repo skill with trust data.");
  assert(
    installSkill?.id,
    "Could not find a free repo skill for install dry-run."
  );

  assert(detail, "Could not load a repo skill for smoke checks.");
  assert(detail.id === repoSkill.id, "Skill inspect returned the wrong id.");
  assert(detail.author_pubkey, "Skill detail is missing author_pubkey.");
  assert(
    detail.author_trust_summary || detail.author_trust,
    "Skill detail is missing trust data."
  );

  const trust = await fetchJson(
    `${baseUrl}/api/agents/${detail.author_pubkey}/trust`,
    "trust lookup"
  );
  assert(
    trust.trust?.recommended_action,
    "Trust lookup is missing the normalized trust summary."
  );
  assert(trust.author_trust, "Trust lookup is missing raw author_trust.");

  const discoveryManifest = await fetchJson(
    `${baseUrl}/.well-known/agentvouch.json`,
    "discovery manifest"
  );
  assert(discoveryManifest, "Discovery manifest returned an empty response.");

  const openapi = await fetchJson(`${baseUrl}/openapi.json`, "openapi");
  assert(openapi.paths?.["/api/skills"], "OpenAPI is missing /api/skills.");

  const indexSkills = await fetchJson(
    `${baseUrl}/api/index/skills`,
    "index skills"
  );
  assert(
    Array.isArray(indexSkills.skills),
    "Index skills response is malformed."
  );

  const cliList = await runCliJson(
    ["skill", "list", "--base-url", baseUrl, "--json"],
    "cli list"
  );
  assert(Array.isArray(cliList.skills), "CLI skill list JSON is malformed.");

  const cliInspect = await runCliJson(
    ["skill", "inspect", repoSkill.id, "--base-url", baseUrl, "--json"],
    "cli inspect"
  );
  assert(
    cliInspect.id === repoSkill.id,
    "CLI inspect returned the wrong skill."
  );

  const installDryRun = await runCliJson(
    [
      "skill",
      "install",
      installSkill.id,
      "--out",
      path.join(os.tmpdir(), "agentvouch-smoke-install.md"),
      "--dry-run",
      "--base-url",
      baseUrl,
      "--rpc-url",
      rpcUrl,
      "--json",
    ],
    "cli install dry-run"
  );
  assert(installDryRun.ok === true, "CLI install dry-run failed.");

  const publishFixture = await createPublishFixture();
  const publishDryRun = await runCliJson(
    [
      "skill",
      "publish",
      "--file",
      publishFixture.skillFile,
      "--skill-id",
      `smoke-dry-run-${Date.now()}`,
      "--name",
      "Smoke Dry Run",
      "--description",
      "Publish dry-run verification",
      "--keypair",
      publishFixture.keypairPath,
      "--price-usdc",
      "1",
      "--base-url",
      baseUrl,
      "--rpc-url",
      rpcUrl,
      "--dry-run",
      "--json",
    ],
    "cli publish dry-run"
  );
  assert(
    publishDryRun.mode === "dry-run",
    "CLI publish dry-run did not succeed."
  );

  await runOptionalLivePublishSmoke();

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "api-list",
          "api-inspect",
          "api-trust",
          "api-discovery",
          "cli-list-json",
          "cli-inspect-json",
          "cli-install-dry-run",
          "cli-publish-dry-run",
          ...(process.env.AGENTVOUCH_LIVE_PUBLISH === "1"
            ? ["cli-live-publish"]
            : []),
        ],
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
