import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { ConfirmedSignatureInfo } from "@solana/web3.js";
import { Agentvouch } from "../target/types/agentvouch";

const MIN_PLAUSIBLE_REGISTERED_AT = 946_684_800; // 2000-01-01T00:00:00Z
const MAX_FUTURE_SKEW_SECONDS = 366 * 24 * 60 * 60;

type Options = {
  apply: boolean;
  allInvalid: boolean;
  authorPubkey: string | null;
  limit: number | null;
};

type RepairTarget = {
  author: PublicKey;
  agentProfilePda: PublicKey;
  currentRegisteredAt: number;
  currentReputationScore: string;
};

function printUsage(): never {
  console.error(`Usage:
  ts-node scripts/repair-agent-registered-at.ts --author <AUTHOR_PUBKEY> [--apply]
  ts-node scripts/repair-agent-registered-at.ts --all-invalid [--limit <N>] [--apply]

Notes:
  - Dry run is the default. Pass --apply to submit repair transactions.
  - Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET to point at the config authority.
`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  let apply = false;
  let allInvalid = false;
  let authorPubkey: string | null = null;
  let limit: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--all-invalid") {
      allInvalid = true;
      continue;
    }
    if (arg === "--author") {
      authorPubkey = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--limit") {
      const parsed = Number.parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      limit = parsed;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if ((!authorPubkey && !allInvalid) || (authorPubkey && allInvalid)) {
    printUsage();
  }

  return { apply, allInvalid, authorPubkey, limit };
}

function isPlausibleRegisteredAt(
  timestamp: number,
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  return (
    Number.isFinite(timestamp) &&
    timestamp >= MIN_PLAUSIBLE_REGISTERED_AT &&
    timestamp <= nowSeconds + MAX_FUTURE_SKEW_SECONDS
  );
}

function formatTimestamp(timestamp: number) {
  return `${timestamp} (${new Date(timestamp * 1000).toISOString()})`;
}

async function deriveAgentProfilePda(
  programId: PublicKey,
  author: PublicKey
): Promise<PublicKey> {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), author.toBuffer()],
    programId
  );
  return pda;
}

async function findOldestSuccessfulSignature(
  connection: anchor.web3.Connection,
  agentProfilePda: PublicKey
): Promise<ConfirmedSignatureInfo> {
  let before: string | undefined;
  let oldestSuccessful: ConfirmedSignatureInfo | null = null;

  while (true) {
    const page = await connection.getSignaturesForAddress(
      agentProfilePda,
      { before, limit: 1000 },
      "confirmed"
    );

    if (page.length === 0) break;

    const successfulInPage = page.filter((entry) => entry.err === null);
    if (successfulInPage.length > 0) {
      oldestSuccessful = successfulInPage[successfulInPage.length - 1];
    }

    if (page.length < 1000) break;
    before = page[page.length - 1]?.signature;
  }

  if (!oldestSuccessful) {
    throw new Error(
      `No successful signature history found for ${agentProfilePda.toBase58()}`
    );
  }

  return oldestSuccessful;
}

async function recoverRegisteredAtFromHistory(
  connection: anchor.web3.Connection,
  agentProfilePda: PublicKey
): Promise<{ timestamp: number; signature: string }> {
  const oldestSuccessful = await findOldestSuccessfulSignature(
    connection,
    agentProfilePda
  );

  if (oldestSuccessful.blockTime != null) {
    return {
      timestamp: oldestSuccessful.blockTime,
      signature: oldestSuccessful.signature,
    };
  }

  const tx = await connection.getTransaction(oldestSuccessful.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx?.blockTime) {
    throw new Error(
      `Oldest signature ${oldestSuccessful.signature} has no recoverable blockTime`
    );
  }

  return {
    timestamp: tx.blockTime,
    signature: oldestSuccessful.signature,
  };
}

async function loadTargets(
  program: Program<Agentvouch>,
  options: Options
): Promise<RepairTarget[]> {
  if (options.authorPubkey) {
    const author = new PublicKey(options.authorPubkey);
    const agentProfilePda = await deriveAgentProfilePda(
      program.programId,
      author
    );
    const profile = await program.account.agentProfile.fetch(agentProfilePda);
    return [
      {
        author,
        agentProfilePda,
        currentRegisteredAt: profile.registeredAt.toNumber(),
        currentReputationScore: profile.reputationScore.toString(),
      },
    ];
  }

  const allProfiles = await program.account.agentProfile.all();
  const invalidProfiles = allProfiles.filter((entry) => {
    const registeredAt = entry.account.registeredAt.toNumber();
    return !isPlausibleRegisteredAt(registeredAt);
  });
  const limitedProfiles =
    options.limit != null
      ? invalidProfiles.slice(0, options.limit)
      : invalidProfiles;

  return limitedProfiles.map((entry) => ({
    author: entry.account.authority,
    agentProfilePda: entry.publicKey,
    currentRegisteredAt: entry.account.registeredAt.toNumber(),
    currentReputationScore: entry.account.reputationScore.toString(),
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .Agentvouch as Program<Agentvouch>;
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const config = await program.account.reputationConfig.fetch(configPda);

  if (!config.authority.equals(provider.wallet.publicKey)) {
    throw new Error(
      `Connected wallet ${provider.wallet.publicKey.toBase58()} is not the config authority ${config.authority.toBase58()}`
    );
  }

  const targets = await loadTargets(program, options);
  if (targets.length === 0) {
    console.log("No agent profiles need repair.");
    return;
  }

  console.log(
    options.apply
      ? `Repairing ${targets.length} agent profile(s)...`
      : `Dry run: evaluating ${targets.length} agent profile(s)...`
  );

  for (const target of targets) {
    console.log("\n---");
    console.log("Author:", target.author.toBase58());
    console.log("AgentProfile PDA:", target.agentProfilePda.toBase58());
    console.log(
      "Current registered_at:",
      target.currentRegisteredAt > 0
        ? formatTimestamp(target.currentRegisteredAt)
        : String(target.currentRegisteredAt)
    );
    console.log("Current reputation_score:", target.currentReputationScore);

    const recovered = await recoverRegisteredAtFromHistory(
      provider.connection,
      target.agentProfilePda
    );

    console.log("Recovered signature:", recovered.signature);
    console.log(
      "Recovered registered_at:",
      formatTimestamp(recovered.timestamp)
    );

    if (target.currentRegisteredAt === recovered.timestamp) {
      console.log("No change needed.");
      continue;
    }

    if (!options.apply) {
      console.log("Dry run only. Re-run with --apply to submit the repair.");
      continue;
    }

    const tx = await program.methods
      .repairAgentRegisteredAt(new anchor.BN(recovered.timestamp))
      .accountsPartial({
        agentProfile: target.agentProfilePda,
        config: configPda,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    console.log("Repair transaction:", tx);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
