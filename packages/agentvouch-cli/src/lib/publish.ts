import path from "node:path";
import { createRepoAuthPayload, loadKeypair } from "./signer.js";
import { readUtf8File } from "./fs.js";
import { AgentVouchApiClient, type SkillRecord } from "./http.js";
import { AgentVouchSolanaClient } from "./solana.js";
import { CliError, getErrorMessage } from "./errors.js";

export interface PublishSkillInput {
  file: string;
  skillId: string;
  name: string;
  description: string;
  contact?: string;
  tags: string[];
  priceUsdcMicros: string;
  baseUrl: string;
  rpcUrl: string;
  keypairPath: string;
  dryRun?: boolean;
}

export interface AddSkillVersionInput {
  id: string;
  file: string;
  changelog?: string;
  baseUrl: string;
  keypairPath: string;
}

export interface LinkSkillListingInput {
  id: string;
  priceUsdcMicros: string;
  baseUrl: string;
  rpcUrl: string;
  keypairPath: string;
  dryRun?: boolean;
}

async function linkRepoSkillListing(input: {
  api: AgentVouchApiClient;
  solana: AgentVouchSolanaClient;
  keypairPath: string;
  baseUrl: string;
  priceUsdcMicros: string;
  repoSkill: SkillRecord;
  dryRun?: boolean;
}) {
  const authorPubkey = input.solana.authority.toBase58();
  const { repoSkill } = input;
  if (repoSkill.source === "chain") {
    throw new CliError(`Skill ${repoSkill.id} is already an on-chain skill.`);
  }
  if (repoSkill.author_pubkey !== authorPubkey) {
    throw new CliError(
      `Connected keypair ${authorPubkey} is not the author of repo skill ${repoSkill.id}.`
    );
  }

  const listingAddress = input.solana
    .getSkillListingAddress(repoSkill.skill_id)
    .toBase58();
  if (repoSkill.on_chain_address && repoSkill.on_chain_address !== listingAddress) {
    throw new CliError(
      `Repo skill ${repoSkill.id} is linked to ${repoSkill.on_chain_address}, expected ${listingAddress}.`
    );
  }

  const skillUri = `${input.baseUrl}/api/skills/${repoSkill.id}/raw`;
  if (input.dryRun) {
    return {
      repoSkillId: repoSkill.id,
      skillId: repoSkill.skill_id,
      skillUri,
      listingAddress,
      priceUsdcMicros: input.priceUsdcMicros,
      createListingTx: null as string | null,
      listingAlreadyExisted: false,
      alreadyLinked: repoSkill.on_chain_address === listingAddress,
      mode: "dry-run" as const,
    };
  }

  const chainListing = await input.solana.createSkillListing({
    skillId: repoSkill.skill_id,
    skillUri,
    name: repoSkill.name,
    description: repoSkill.description ?? "",
    priceUsdcMicros: input.priceUsdcMicros,
  });

  const linkAuth = createRepoAuthPayload(
    loadKeypair(input.keypairPath),
    "publish-skill"
  );
  await input.api.linkSkillListing(repoSkill.id, {
    auth: linkAuth,
    on_chain_address: listingAddress,
  });

  return {
    repoSkillId: repoSkill.id,
    skillId: repoSkill.skill_id,
    skillUri,
    listingAddress,
    priceUsdcMicros: input.priceUsdcMicros,
    createListingTx: chainListing.tx,
    listingAlreadyExisted: chainListing.alreadyExists,
    alreadyLinked: repoSkill.on_chain_address === listingAddress,
    mode: "linked" as const,
  };
}

export async function publishSkill(input: PublishSkillInput) {
  const content = await readUtf8File(path.resolve(input.file));
  const keypair = loadKeypair(input.keypairPath);
  const repoAuth = createRepoAuthPayload(keypair, "publish-skill");
  const solana = new AgentVouchSolanaClient(keypair, input.rpcUrl);
  const listingAddress = solana
    .getSkillListingAddress(input.skillId)
    .toBase58();

  if (input.dryRun) {
    return {
      ok: true,
      mode: "dry-run",
      repoRequest: {
        skill_id: input.skillId,
        name: input.name,
        description: input.description,
        tags: input.tags,
        contact: input.contact,
        price_usdc_micros: input.priceUsdcMicros,
      },
      onChainListing: {
        address: listingAddress,
        priceUsdcMicros: input.priceUsdcMicros,
      },
    };
  }

  const api = new AgentVouchApiClient(input.baseUrl);
  const repoSkill = await api.publishSkill({
    auth: repoAuth,
    skill_id: input.skillId,
    name: input.name,
    description: input.description,
    tags: input.tags,
    contact: input.contact,
    content,
    price_usdc_micros: input.priceUsdcMicros,
  });

  let linkResult: Awaited<ReturnType<typeof linkRepoSkillListing>>;
  try {
    linkResult = await linkRepoSkillListing({
      api,
      solana,
      keypairPath: input.keypairPath,
      baseUrl: input.baseUrl,
      priceUsdcMicros: input.priceUsdcMicros,
      repoSkill: {
        ...repoSkill,
        author_pubkey: keypair.publicKey.toBase58(),
        name: input.name,
        description: input.description,
        on_chain_address: null,
        total_installs: 0,
      },
    });
  } catch (error) {
    throw new CliError(
      `Repo skill ${repoSkill.id} was published, but the on-chain listing was not linked: ${getErrorMessage(
        error
      )}\nRetry with: agentvouch skill link-listing ${repoSkill.id} --price-usdc ${
        Number(BigInt(input.priceUsdcMicros)) / 1_000_000
      } --keypair ${input.keypairPath} --base-url ${input.baseUrl} --rpc-url ${
        input.rpcUrl
      }`,
      { data: { repoSkillId: repoSkill.id, cause: error } }
    );
  }

  return {
    ok: true,
    repoSkillId: repoSkill.id,
    skillId: input.skillId,
    skillUri: linkResult.skillUri,
    listingAddress: linkResult.listingAddress,
    priceUsdcMicros: input.priceUsdcMicros,
    repoIpfsCid: repoSkill.ipfs_cid,
    createListingTx: linkResult.createListingTx,
    listingAlreadyExisted: linkResult.listingAlreadyExisted,
  };
}

export async function linkSkillListing(input: LinkSkillListingInput) {
  const keypair = loadKeypair(input.keypairPath);
  const api = new AgentVouchApiClient(input.baseUrl);
  const solana = new AgentVouchSolanaClient(keypair, input.rpcUrl);
  const repoSkill = await api.getSkill(input.id);

  const result = await linkRepoSkillListing({
    api,
    solana,
    keypairPath: input.keypairPath,
    baseUrl: input.baseUrl,
    priceUsdcMicros: input.priceUsdcMicros,
    repoSkill,
    dryRun: input.dryRun,
  });

  return {
    ok: true,
    ...result,
  };
}

export async function addSkillVersion(input: AddSkillVersionInput) {
  const api = new AgentVouchApiClient(input.baseUrl);
  const keypair = loadKeypair(input.keypairPath);
  const auth = createRepoAuthPayload(keypair, "publish-skill");
  const content = await readUtf8File(path.resolve(input.file));
  const result = await api.addSkillVersion(input.id, {
    auth,
    content,
    changelog: input.changelog,
  });

  return {
    ok: true,
    skillId: input.id,
    version: result.version,
  };
}
