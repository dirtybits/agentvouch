import path from "node:path";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactSvmScheme, toClientSvmSigner } from "@x402/svm";
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

export interface InstallSkillInput {
  id: string;
  out: string;
  force?: boolean;
  dryRun?: boolean;
  baseUrl: string;
  rpcUrl: string;
  keypairPath?: string;
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
        buildInstalledSkillMetadata(input.id, skill)
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
  const initialDownload = await api.downloadRaw(
    input.id,
    signedInitialAuth ? { auth: signedInitialAuth } : undefined
  );
  if (initialDownload.ok && initialDownload.content !== undefined) {
    if (!input.dryRun) {
      await writeUtf8File(outputPath, initialDownload.content);
      await writeInstalledSkillMetadata(
        outputPath,
        buildInstalledSkillMetadata(input.id, skill)
      );
    }
    return {
      ok: true,
      mode: "free-raw",
      skillId: input.id,
      outputPath,
      metadataPath,
      priceUsdcMicros: skill.price_usdc_micros ?? null,
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
    const signedDownload = await api.downloadRaw(input.id, { auth });

    if (signedDownload.ok && signedDownload.content !== undefined) {
      await writeUtf8File(outputPath, signedDownload.content);
      await writeInstalledSkillMetadata(
        outputPath,
        buildInstalledSkillMetadata(input.id, skill)
      );

      return {
        ok: true,
        mode: "signed-entitlement",
        skillId: input.id,
        outputPath,
        metadataPath,
        priceUsdcMicros:
          initialDownload.listingRequired.amountMicros ??
          skill.price_usdc_micros ??
          null,
        listingAddress: null,
        alreadyPurchased: true,
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
    const authHeader = JSON.stringify(
      createDownloadAuthPayload(
        loadKeypair(input.keypairPath),
        input.id,
        skill.on_chain_address ?? undefined
      )
    );

    const paidFetch = await createX402Fetch({
      authHeader,
      rpcUrl: input.rpcUrl,
      keypairPath: input.keypairPath,
    });
    const paidDownload = await api.downloadRaw(input.id, {
      fetchImpl: paidFetch,
    });

    if (!paidDownload.ok || paidDownload.content === undefined) {
      throw new CliError(
        `USDC x402 payment completed but download failed: ${
          paidDownload.error || "unexpected response"
        }`
      );
    }

    await writeUtf8File(outputPath, paidDownload.content);
    await writeInstalledSkillMetadata(
      outputPath,
      buildInstalledSkillMetadata(input.id, skill)
    );

    return {
      ok: true,
      mode: "x402-usdc",
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
  const signedDownload = await api.downloadRaw(input.id, { auth });

  if (!signedDownload.ok || signedDownload.content === undefined) {
    throw new CliError(
      `Purchase completed but signed raw download failed: ${
        signedDownload.error || "unexpected response"
      }`
    );
  }

  await writeUtf8File(outputPath, signedDownload.content);
  await writeInstalledSkillMetadata(
    outputPath,
    buildInstalledSkillMetadata(input.id, skill)
  );

  return {
    ok: true,
    mode: "paid-raw",
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
    dryRun: false,
  };
}
