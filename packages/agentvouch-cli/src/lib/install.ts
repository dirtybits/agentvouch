import path from "node:path";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactSvmScheme, toClientSvmSigner } from "@x402/svm";
import type { AuthPayload } from "@agentvouch/protocol";
import { CliError } from "./errors.js";
import { assertWritableOutputPath, writeUtf8File } from "./fs.js";
import { type SkillRecord, AgentVouchApiClient } from "./http.js";
import {
  buildInstalledSkillMetadata,
  getInstallMetadataPath,
  writeInstalledSkillMetadata,
} from "./metadata.js";
import { createDownloadAuthPayload, loadKeypair } from "./signer.js";
import { AgentVouchSolanaClient } from "./solana.js";
import {
  isDirectoryLikeOutput,
  writeTarArchiveToDirectory,
} from "./archive.js";

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

async function writeDownloadOutput(
  kind: InstallKind,
  outputPath: string,
  download: Awaited<ReturnType<typeof downloadForKind>>
): Promise<number | null> {
  if (kind === "archive") {
    if (!download.archive) {
      throw new CliError("Archive download did not include an archive body.");
    }
    return writeTarArchiveToDirectory(outputPath, download.archive);
  }

  if (download.content === undefined) {
    throw new CliError("Raw download did not include skill content.");
  }
  await writeUtf8File(outputPath, download.content);
  return null;
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
    client.onPaymentRequired(async () => ({
      headers: {
        "X-AgentVouch-Auth": options.authHeader,
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
  if (initialDownload.ok && hasDownloadPayload(installKind, initialDownload)) {
    const filesWritten = input.dryRun
      ? null
      : await writeDownloadOutput(installKind, outputPath, initialDownload);
    if (!input.dryRun) {
      await writeInstalledSkillMetadata(
        outputPath,
        buildInstalledSkillMetadata(input.id, skill, {
          installedFormat: installKind === "archive" ? "tree" : "file",
        })
      );
    }
    return {
      ok: true,
      mode: installKind === "archive" ? "free-archive" : "free-raw",
      skillId: input.id,
      outputPath,
      metadataPath,
      priceUsdcMicros: skill.price_usdc_micros ?? null,
      filesWritten,
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
      const filesWritten = await writeDownloadOutput(
        installKind,
        outputPath,
        signedDownload
      );
      await writeInstalledSkillMetadata(
        outputPath,
        buildInstalledSkillMetadata(input.id, skill, {
          installedFormat: installKind === "archive" ? "tree" : "file",
        })
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
        dryRun: false,
      };
    }

    throw new CliError(
      `Skill ${input.id} is paid but has no linked on-chain SkillListing. New repo-only x402 purchases are disabled; ask the author to run agentvouch skill link-listing ${input.id} --price-usdc <amount>. ${
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

    const filesWritten = await writeDownloadOutput(
      installKind,
      outputPath,
      paidDownload
    );
    await writeInstalledSkillMetadata(
      outputPath,
      buildInstalledSkillMetadata(input.id, skill, {
        installedFormat: installKind === "archive" ? "tree" : "file",
      })
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

  const filesWritten = await writeDownloadOutput(
    installKind,
    outputPath,
    signedDownload
  );
  await writeInstalledSkillMetadata(
    outputPath,
    buildInstalledSkillMetadata(input.id, skill, {
      installedFormat: installKind === "archive" ? "tree" : "file",
    })
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
    dryRun: false,
  };
}
