import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type {
  ConfirmedSignatureInfo,
  GetProgramAccountsFilter,
} from "@solana/web3.js";
import { Agentvouch } from "../target/types/agentvouch";

const CURRENT_AGENT_PROFILE_LEN = 293;
const LEGACY_AGENT_PROFILE_TRAILING_LEN = 41;
const MIN_PLAUSIBLE_REGISTERED_AT = 946_684_800; // 2000-01-01T00:00:00Z
const MAX_FUTURE_SKEW_SECONDS = 366 * 24 * 60 * 60;
const AGENT_PROFILE_DISCRIMINATOR = Buffer.from([
  60, 227, 42, 24, 0, 87, 86, 205,
]);

type Options = {
  apply: boolean;
  allStale: boolean;
  authorPubkey: string | null;
  limit: number | null;
};

type LayoutKind = "current" | "legacy";

type ParsedAgentProfile = {
  publicKey: PublicKey;
  authority: PublicKey;
  metadataUri: string;
  layout: LayoutKind;
  storedBump: number;
  canonicalBump: number;
  storedRegisteredAt: number;
  needsMigration: boolean;
  needsTimestampRepair: boolean;
  reasons: string[];
};

function printUsage(): never {
  console.error(`Usage:
  ts-node scripts/migrate-agent-profiles.ts --author <AUTHOR_PUBKEY> [--apply]
  ts-node scripts/migrate-agent-profiles.ts --all-stale [--limit <N>] [--apply]

Notes:
  - Dry run is the default. Pass --apply to submit migration and repair transactions.
  - Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET to point at the config authority.
`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  let apply = false;
  let allStale = false;
  let authorPubkey: string | null = null;
  let limit: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--all-stale") {
      allStale = true;
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

  if ((!authorPubkey && !allStale) || (authorPubkey && allStale)) {
    printUsage();
  }

  return { apply, allStale, authorPubkey, limit };
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

function readPubkey(data: Buffer, start: number) {
  return new PublicKey(data.subarray(start, start + 32));
}

function deriveAgentProfilePda(programId: PublicKey, authority: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), authority.toBuffer()],
    programId
  );
}

function readMetadataUri(data: Buffer) {
  const uriLen = data.readUInt32LE(40);
  const uriStart = 44;
  const uriEnd = uriStart + uriLen;

  if (uriLen > 200 || uriEnd > data.length) {
    throw new Error(`Invalid metadata URI length ${uriLen}`);
  }

  return {
    metadataUri: data.subarray(uriStart, uriEnd).toString("utf8"),
    base: uriEnd,
  };
}

function parseCurrentAgentProfile(
  publicKey: PublicKey,
  data: Buffer,
  programId: PublicKey
): ParsedAgentProfile {
  const authority = readPubkey(data, 8);
  const { metadataUri, base } = readMetadataUri(data);
  if (base + 49 > data.length) {
    throw new Error("Current AgentProfile account is truncated");
  }

  const storedRegisteredAt = Number(data.readBigInt64LE(base + 40));
  const storedBump = data.readUInt8(base + 48);
  const [, canonicalBump] = deriveAgentProfilePda(programId, authority);
  const reasons: string[] = [];

  if (storedBump !== canonicalBump) {
    reasons.push(
      `stored bump ${storedBump} != canonical bump ${canonicalBump}`
    );
  }
  if (!isPlausibleRegisteredAt(storedRegisteredAt)) {
    reasons.push(`registered_at ${storedRegisteredAt} is implausible`);
  }

  return {
    publicKey,
    authority,
    metadataUri,
    layout: "current",
    storedBump,
    canonicalBump,
    storedRegisteredAt,
    needsMigration: storedBump !== canonicalBump,
    needsTimestampRepair: !isPlausibleRegisteredAt(storedRegisteredAt),
    reasons,
  };
}

function parseLegacyAgentProfile(
  publicKey: PublicKey,
  data: Buffer,
  programId: PublicKey
): ParsedAgentProfile {
  const authority = readPubkey(data, 8);
  const { metadataUri, base } = readMetadataUri(data);
  if (base + LEGACY_AGENT_PROFILE_TRAILING_LEN > data.length) {
    throw new Error("Legacy AgentProfile account is truncated");
  }

  const storedRegisteredAt = Number(data.readBigInt64LE(base + 32));
  const storedBump = data.readUInt8(base + 40);
  const [, canonicalBump] = deriveAgentProfilePda(programId, authority);
  const reasons = [
    `legacy layout (${data.length} bytes)`,
    `stored bump ${storedBump} != canonical bump ${canonicalBump}`,
  ];

  if (!isPlausibleRegisteredAt(storedRegisteredAt)) {
    reasons.push(`registered_at ${storedRegisteredAt} is implausible`);
  }

  return {
    publicKey,
    authority,
    metadataUri,
    layout: "legacy",
    storedBump,
    canonicalBump,
    storedRegisteredAt,
    needsMigration: true,
    needsTimestampRepair: !isPlausibleRegisteredAt(storedRegisteredAt),
    reasons,
  };
}

function parseAgentProfileAccount(
  publicKey: PublicKey,
  data: Buffer,
  programId: PublicKey
): ParsedAgentProfile {
  if (data.length === CURRENT_AGENT_PROFILE_LEN) {
    return parseCurrentAgentProfile(publicKey, data, programId);
  }
  return parseLegacyAgentProfile(publicKey, data, programId);
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
): Promise<ParsedAgentProfile[]> {
  if (options.authorPubkey) {
    const author = new PublicKey(options.authorPubkey);
    const [agentProfilePda] = deriveAgentProfilePda(program.programId, author);
    const account = await program.provider.connection.getAccountInfo(
      agentProfilePda,
      "confirmed"
    );
    if (!account) {
      throw new Error(
        `Agent profile ${agentProfilePda.toBase58()} does not exist for author ${author.toBase58()}`
      );
    }
    return [
      parseAgentProfileAccount(
        agentProfilePda,
        account.data,
        program.programId
      ),
    ];
  }

  const filters: GetProgramAccountsFilter[] = [
    {
      memcmp: {
        offset: 0,
        bytes: anchor.utils.bytes.bs58.encode(AGENT_PROFILE_DISCRIMINATOR),
      },
    },
  ];

  const accounts = await program.provider.connection.getProgramAccounts(
    program.programId,
    {
      commitment: "confirmed",
      filters,
    }
  );

  const parsed = accounts
    .map((entry) =>
      parseAgentProfileAccount(
        entry.pubkey,
        entry.account.data,
        program.programId
      )
    )
    .filter((entry) => entry.needsMigration || entry.needsTimestampRepair);

  return options.limit != null ? parsed.slice(0, options.limit) : parsed;
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
    console.log("No stale agent profiles found.");
    return;
  }

  console.log(
    options.apply
      ? `Migrating ${targets.length} agent profile(s)...`
      : `Dry run: evaluating ${targets.length} agent profile(s)...`
  );

  for (const target of targets) {
    console.log("\n---");
    console.log("AgentProfile PDA:", target.publicKey.toBase58());
    console.log("Authority:", target.authority.toBase58());
    console.log("Layout:", target.layout);
    console.log("Stored bump:", target.storedBump);
    console.log("Canonical bump:", target.canonicalBump);
    console.log(
      "Stored registered_at:",
      target.storedRegisteredAt > 0
        ? formatTimestamp(target.storedRegisteredAt)
        : String(target.storedRegisteredAt)
    );
    console.log("Metadata URI:", target.metadataUri);
    console.log("Reasons:", target.reasons.join("; "));

    if (!options.apply) {
      if (target.needsTimestampRepair) {
        const recovered = await recoverRegisteredAtFromHistory(
          provider.connection,
          target.publicKey
        );
        console.log(
          "Would repair registered_at from history:",
          recovered.signature
        );
        console.log(
          "Recovered registered_at:",
          formatTimestamp(recovered.timestamp)
        );
      }
      continue;
    }

    if (target.needsMigration) {
      const tx = await program.methods
        .adminMigrateAgent()
        .accountsPartial({
          agentProfile: target.publicKey,
          config: configPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("Migration transaction:", tx);
    } else {
      console.log("Migration step skipped: layout and bump already current.");
    }

    if (!target.needsTimestampRepair) {
      continue;
    }

    const recovered = await recoverRegisteredAtFromHistory(
      provider.connection,
      target.publicKey
    );
    const repairTx = await program.methods
      .repairAgentRegisteredAt(new anchor.BN(recovered.timestamp))
      .accountsPartial({
        agentProfile: target.publicKey,
        config: configPda,
        authority: provider.wallet.publicKey,
      })
      .rpc();
    console.log("Recovered signature:", recovered.signature);
    console.log(
      "Recovered registered_at:",
      formatTimestamp(recovered.timestamp)
    );
    console.log("Repair transaction:", repairTx);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
