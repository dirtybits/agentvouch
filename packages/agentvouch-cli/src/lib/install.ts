import path from "node:path";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactSvmScheme, toClientSvmSigner } from "@x402/svm";
import type { AuthPayload } from "@agentvouch/protocol";
import { CliError } from "./errors.js";
import {
  assertWritableOutputPath,
  writeBytesFile,
  writeUtf8File,
} from "./fs.js";
import { type SkillRecord, AgentVouchApiClient } from "./http.js";
import {
  buildInstalledSkillMetadata,
  getInstallMetadataPath,
  writeInstalledSkillMetadata,
} from "./metadata.js";
import { createDownloadAuthPayload, loadKeypair } from "./signer.js";
import { AgentVouchSolanaClient } from "./solana.js";
import {
  DOWNLOAD_TREE_CAPS,
  ingestTarArchive,
  isDirectoryLikeOutput,
  type SkillTreeInputFile,
  writeSkillFilesToDirectory,
} from "./archive.js";
import {
  TreeHashMismatchError,
  verifySingleFile,
  verifyTreeFiles,
} from "./integrity.js";

export interface InstallSkillInput {
  id: string;
  out: string;
  tree?: boolean;
  force?: boolean;
  dryRun?: boolean;
  baseUrl: string;
  rpcUrl: string;
  keypairPath?: string;
}

type InstallKind = "raw" | "archive";

function skillHasTree(skill: SkillRecord): boolean {
  return Boolean(skill.tree_hash || (skill.files && skill.files.length > 1));
}

function resolveInstallKind(
  skill: SkillRecord,
  outputPath: string,
  forceTree = false
): InstallKind {
  if (forceTree) return "archive";
  return skillHasTree(skill) && isDirectoryLikeOutput(outputPath)
    ? "archive"
    : "raw";
}

async function downloadForKind(
  api: AgentVouchApiClient,
  kind: InstallKind,
  id: string,
  options?: {
    auth?: AuthPayload;
    fetchImpl?: typeof fetch;
  }
) {
  return kind === "archive"
    ? api.downloadArchive(id, options)
    : api.downloadRaw(id, options);
}

function hasDownloadPayload(
  kind: InstallKind,
  download: Awaited<ReturnType<typeof downloadForKind>>
) {
  return kind === "archive"
    ? download.archive !== undefined
    : download.content !== undefined;
}

type DownloadResult = Awaited<ReturnType<typeof downloadForKind>>;

type VerifiedDownload =
  | { kind: "archive"; files: SkillTreeInputFile[]; treeHash: string }
  | { kind: "raw"; bytes: Buffer; treeHash: string };

/**
 * Stop before any download or payment when the published record has nothing
 * to check the download against. Otherwise a paid install could take the
 * payment and then refuse to write the files.
 */
function assertDownloadCanBeVerified(
  kind: InstallKind,
  skill: SkillRecord,
  id: string
) {
  if (!skill.tree_hash) {
    throw new CliError(
      `Skill ${id} has no published tree_hash, so the CLI cannot check the download. Nothing was downloaded or paid.`
    );
  }
  if (
    kind === "raw" &&
    !skill.files?.some((file) => file.path === "SKILL.md")
  ) {
    throw new CliError(
      `The published file list for skill ${id} has no entry for SKILL.md, so the CLI cannot check the download. Nothing was downloaded or paid.`
    );
  }
}

/** Check downloaded bytes against the published hashes (docs/SKILL_TREE_HASH.md). */
function verifyDownloadAgainst(
  kind: InstallKind,
  download: DownloadResult,
  skill: SkillRecord,
  label: string
): VerifiedDownload {
  if (kind === "archive") {
    if (!download.archive) {
      throw new CliError("Archive download did not include an archive body.");
    }
    const files = ingestTarArchive(download.archive, DOWNLOAD_TREE_CAPS);
    const treeHash = verifyTreeFiles(
      files.map((file) => ({ path: file.path, bytes: file.content })),
      { treeHash: skill.tree_hash, label }
    );
    return { kind, files, treeHash };
  }

  const bytes =
    download.bytes ??
    (download.content !== undefined
      ? Buffer.from(download.content, "utf8")
      : undefined);
  if (!bytes) {
    throw new CliError("Raw download did not include skill content.");
  }
  const treeHash = verifySingleFile(
    { path: "SKILL.md", bytes },
    { treeHash: skill.tree_hash, manifest: skill.files, label }
  );
  return { kind, bytes, treeHash };
}

/**
 * Verify a download. If it does not match, re-read the skill once: a new version
 * may have been published between the detail read and the download.
 */
async function verifyDownload(
  api: AgentVouchApiClient,
  id: string,
  kind: InstallKind,
  download: DownloadResult,
  skill: SkillRecord
): Promise<{ verified: VerifiedDownload; skill: SkillRecord }> {
  try {
    return {
      verified: verifyDownloadAgainst(kind, download, skill, id),
      skill,
    };
  } catch (error) {
    if (!(error instanceof TreeHashMismatchError)) throw error;
    const latest = await api.getSkill(id);
    if (!latest.tree_hash || latest.tree_hash === skill.tree_hash) throw error;
    return {
      verified: verifyDownloadAgainst(kind, download, latest, id),
      skill: latest,
    };
  }
}

/** Verify, then write the files and the install metadata (not in a dry run). */
async function completeDownload(
  context: {
    api: AgentVouchApiClient;
    id: string;
    kind: InstallKind;
    outputPath: string;
    dryRun: boolean;
    skill: SkillRecord;
  },
  download: DownloadResult
): Promise<{ filesWritten: number | null; treeHash: string }> {
  const { verified, skill } = await verifyDownload(
    context.api,
    context.id,
    context.kind,
    download,
    context.skill
  );
  if (context.dryRun) {
    return { filesWritten: null, treeHash: verified.treeHash };
  }

  let filesWritten: number | null = null;
  if (verified.kind === "archive") {
    filesWritten = await writeSkillFilesToDirectory(
      context.outputPath,
      verified.files
    );
  } else {
    await writeBytesFile(context.outputPath, verified.bytes);
  }
  await writeInstalledSkillMetadata(
    context.outputPath,
    buildInstalledSkillMetadata(context.id, skill, {
      installedFormat: context.kind === "archive" ? "tree" : "file",
      verifiedTreeHash: verified.treeHash,
    })
  );
  return { filesWritten, treeHash: verified.treeHash };
}

async function resolveChainSkillContent(
  skill: SkillRecord,
  api: AgentVouchApiClient
): Promise<string> {
  if (
    skill.payment_flow === "direct-purchase-skill" ||
    BigInt(skill.price_usdc_micros ?? "0") > 0n
  ) {
    throw new CliError(
      `Skill ${skill.id} is chain-only and paid in USDC. Use the repo-backed skill id for signed raw downloads.`
    );
  }

  if (skill.content) {
    return skill.content;
  }

  if (
    skill.skill_uri?.startsWith("http://") ||
    skill.skill_uri?.startsWith("https://")
  ) {
    return api.fetchRemoteText(skill.skill_uri);
  }

  throw new CliError(
    `Skill ${skill.id} does not expose downloadable content through the API.`
  );
}

async function createX402Fetch(options: {
  authHeader?: string;
  rpcUrl: string;
  keypairPath: string;
}) {
  const keypair = loadKeypair(options.keypairPath);
  const signer = toClientSvmSigner(
    await createKeyPairSignerFromBytes(Uint8Array.from(keypair.secretKey))
  );
  const client = new x402HTTPClient(
    new x402Client().register(
      "solana:*",
      new ExactSvmScheme(signer, { rpcUrl: options.rpcUrl })
    )
  );

  if (options.authHeader) {
    // Capture into a const so the narrowing survives into the async closure
    // (a property read would re-widen to string | undefined inside the callback).
    const authHeader = options.authHeader;
    client.onPaymentRequired(async () => ({
      headers: {
        "X-AgentVouch-Auth": authHeader,
      },
    }));
  }

  return wrapFetchWithPayment(fetch, client);
}

export async function installSkill(input: InstallSkillInput) {
  const api = new AgentVouchApiClient(input.baseUrl);
  const skill = await api.getSkill(input.id);
  const outputPath = path.resolve(input.out);
  const metadataPath = getInstallMetadataPath(outputPath);
  const installKind = resolveInstallKind(skill, outputPath, input.tree);

  if (!input.dryRun) {
    await assertWritableOutputPath(outputPath, input.force);
  }

  const isChainOnly =
    skill.source === "chain" || input.id.startsWith("chain-") || !skill.id;

  if (isChainOnly) {
    const content = await resolveChainSkillContent(skill, api);
    if (!input.dryRun) {
      await writeUtf8File(outputPath, content);
      await writeInstalledSkillMetadata(
        outputPath,
        buildInstalledSkillMetadata(input.id, skill, {
          installedFormat: "file",
        })
      );
    }
    return {
      ok: true,
      mode: "chain-direct",
      skillId: input.id,
      outputPath,
      metadataPath,
      priceUsdcMicros: skill.price_usdc_micros ?? null,
      dryRun: !!input.dryRun,
    };
  }

  assertDownloadCanBeVerified(installKind, skill, input.id);

  const signedInitialAuth =
    input.keypairPath && BigInt(skill.price_usdc_micros ?? "0") > 0n
      ? createDownloadAuthPayload(
          loadKeypair(input.keypairPath),
          input.id,
          skill.on_chain_address ?? undefined
        )
      : undefined;
  const initialDownload = await downloadForKind(
    api,
    installKind,
    input.id,
    signedInitialAuth ? { auth: signedInitialAuth } : undefined
  );
  const downloadContext = {
    api,
    id: input.id,
    kind: installKind,
    outputPath,
    skill,
  };

  if (initialDownload.ok && hasDownloadPayload(installKind, initialDownload)) {
    const { filesWritten, treeHash } = await completeDownload(
      { ...downloadContext, dryRun: !!input.dryRun },
      initialDownload
    );
    return {
      ok: true,
      mode: installKind === "archive" ? "free-archive" : "free-raw",
      skillId: input.id,
      outputPath,
      metadataPath,
      priceUsdcMicros: skill.price_usdc_micros ?? null,
      filesWritten,
      treeHash,
      dryRun: !!input.dryRun,
    };
  }

  if (!input.dryRun && initialDownload.status === 401 && !input.keypairPath) {
    throw new CliError(
      "Paid installs require --keypair so the CLI can sign X-AgentVouch-Auth before receiving x402 bridge requirements."
    );
  }

  if (
    initialDownload.status !== 402 ||
    (!initialDownload.requirement &&
      !initialDownload.x402PaymentRequired &&
      !initialDownload.directPurchaseRequired &&
      !initialDownload.listingRequired)
  ) {
    throw new CliError(
      `Failed to download skill ${input.id}: ${
        initialDownload.error || "unexpected response"
      }`
    );
  }

  if (input.dryRun) {
    return {
      ok: true,
      mode: initialDownload.listingRequired
        ? "listing-required-dry-run"
        : initialDownload.x402PaymentRequired
        ? "x402-usdc-dry-run"
        : installKind === "archive"
        ? "paid-archive-dry-run"
        : "paid-raw-dry-run",
      skillId: input.id,
      outputPath,
      metadataPath,
      legacySolBaseUnits: initialDownload.requirement?.amount ?? null,
      priceUsdcMicros:
        initialDownload.x402PaymentRequired?.accepts[0]?.amount ??
        initialDownload.directPurchaseRequired?.amountMicros ??
        initialDownload.listingRequired?.amountMicros ??
        skill.price_usdc_micros ??
        null,
      listingAddress:
        initialDownload.requirement?.skillListingAddress ??
        initialDownload.directPurchaseRequired?.skillListingAddress ??
        skill.on_chain_address ??
        null,
      requirement:
        initialDownload.x402PaymentRequired ??
        initialDownload.requirement ??
        initialDownload.directPurchaseRequired ??
        initialDownload.listingRequired,
      dryRun: true,
    };
  }

  if (!input.keypairPath) {
    throw new CliError(
      "Paid installs require --keypair so the CLI can either reuse a prior entitlement or complete the required payment flow."
    );
  }

  if (initialDownload.listingRequired) {
    const keypair = loadKeypair(input.keypairPath);
    const auth = createDownloadAuthPayload(keypair, input.id, undefined);
    const signedDownload = await downloadForKind(api, installKind, input.id, {
      auth,
    });

    if (signedDownload.ok && hasDownloadPayload(installKind, signedDownload)) {
      const { filesWritten, treeHash } = await completeDownload(
        { ...downloadContext, dryRun: false },
        signedDownload
      );

      return {
        ok: true,
        mode:
          installKind === "archive"
            ? "signed-entitlement-archive"
            : "signed-entitlement",
        skillId: input.id,
        outputPath,
        metadataPath,
        priceUsdcMicros:
          initialDownload.listingRequired.amountMicros ??
          skill.price_usdc_micros ??
          null,
        listingAddress: null,
        alreadyPurchased: true,
        filesWritten,
        treeHash,
        dryRun: false,
      };
    }

    throw new CliError(
      `Skill ${
        input.id
      } is paid but has no linked on-chain SkillListing. New repo-only x402 purchases are disabled; ask the author to run agentvouch skill link-listing ${
        input.id
      } --price-usdc <amount>. ${
        initialDownload.listingRequired.message ?? ""
      }`.trim()
    );
  }

  if (initialDownload.x402PaymentRequired) {
    const authPayload = createDownloadAuthPayload(
      loadKeypair(input.keypairPath),
      input.id,
      skill.on_chain_address ?? undefined
    );
    const authHeader = JSON.stringify(authPayload);

    const paidFetch = await createX402Fetch({
      authHeader,
      rpcUrl: input.rpcUrl,
      keypairPath: input.keypairPath,
    });
    const paidDownload = await downloadForKind(api, installKind, input.id, {
      auth: authPayload,
      fetchImpl: paidFetch,
    });

    if (!paidDownload.ok || !hasDownloadPayload(installKind, paidDownload)) {
      throw new CliError(
        `USDC x402 payment completed but download failed: ${
          paidDownload.error || "unexpected response"
        }`
      );
    }

    const { filesWritten, treeHash } = await completeDownload(
      { ...downloadContext, dryRun: false },
      paidDownload
    );

    return {
      ok: true,
      mode: installKind === "archive" ? "x402-usdc-archive" : "x402-usdc",
      skillId: input.id,
      outputPath,
      metadataPath,
      legacySolBaseUnits: skill.price_lamports ?? null,
      priceUsdcMicros:
        paidDownload.paymentResponse?.amount ??
        initialDownload.x402PaymentRequired.accepts[0]?.amount ??
        skill.price_usdc_micros ??
        null,
      listingAddress: skill.on_chain_address ?? null,
      purchaseTx: paidDownload.paymentResponse?.transaction ?? null,
      alreadyPurchased: !paidDownload.paymentResponse,
      filesWritten,
      treeHash,
      dryRun: false,
    };
  }

  if (!skill.on_chain_address) {
    throw new CliError(
      `Skill ${input.id} returned a payment requirement but has no linked on-chain listing.`
    );
  }

  const keypair = loadKeypair(input.keypairPath);
  const solana = new AgentVouchSolanaClient(keypair, input.rpcUrl);
  const skillListingAddress =
    initialDownload.requirement?.skillListingAddress ??
    initialDownload.directPurchaseRequired?.skillListingAddress;
  if (!skillListingAddress) {
    throw new CliError(
      `Skill ${input.id} returned a direct-purchase requirement without a listing address.`
    );
  }
  if (!skill.author_pubkey) {
    throw new CliError(
      `Skill ${input.id} requires direct purchase but has no wallet author.`
    );
  }
  const purchase = await solana.purchaseSkill(
    skillListingAddress,
    skill.author_pubkey
  );
  if (purchase.tx) {
    await api.verifyDirectPurchase(input.id, {
      signature: purchase.tx,
      buyer: keypair.publicKey.toBase58(),
      listingAddress: skillListingAddress,
    });
  }
  const auth = createDownloadAuthPayload(
    keypair,
    input.id,
    skillListingAddress
  );
  const signedDownload = await downloadForKind(api, installKind, input.id, {
    auth,
  });

  if (!signedDownload.ok || !hasDownloadPayload(installKind, signedDownload)) {
    throw new CliError(
      `Purchase completed but signed raw download failed: ${
        signedDownload.error || "unexpected response"
      }`
    );
  }

  const { filesWritten, treeHash } = await completeDownload(
    { ...downloadContext, dryRun: false },
    signedDownload
  );

  return {
    ok: true,
    mode: installKind === "archive" ? "paid-archive" : "paid-raw",
    skillId: input.id,
    outputPath,
    metadataPath,
    legacySolBaseUnits: initialDownload.requirement?.amount ?? null,
    priceUsdcMicros:
      initialDownload.directPurchaseRequired?.amountMicros ??
      skill.price_usdc_micros ??
      null,
    listingAddress: skillListingAddress,
    purchaseTx: purchase.tx,
    alreadyPurchased: purchase.alreadyPurchased,
    filesWritten,
    treeHash,
    dryRun: false,
  };
}
