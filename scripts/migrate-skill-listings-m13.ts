import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Agentvouch } from "../target/types/agentvouch";

const M13_SKILL_LISTING_MIN_LEN = 859;
const SKILL_LISTING_DISCRIMINATOR = Buffer.from([
  133, 247, 251, 51, 57, 31, 57, 30,
]);

type Options = {
  apply: boolean;
  listing?: PublicKey;
};

function printUsage(): never {
  console.error(`Usage:
  ts-node scripts/migrate-skill-listings-m13.ts [--apply] [--listing <pubkey>]

Notes:
  - Dry run is the default. Pass --apply to submit migration transactions.
  - Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET to point at either the config authority or each listing author.
  - If --listing is omitted, all legacy-sized SkillListing accounts on the configured cluster are scanned.
`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--listing") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) printUsage();
      options.listing = new PublicKey(value);
      index += 1;
      continue;
    }
    printUsage();
  }

  return options;
}

function u64Le(value: bigint | number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function pda(programId: PublicKey, ...seeds: Buffer[]) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Agentvouch as Program<Agentvouch>;
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const config = await program.account.reputationConfig.fetch(configPda);
  const usdcMint = config.usdcMint;

  const candidates = options.listing
    ? [
        {
          pubkey: options.listing,
          account: await provider.connection.getAccountInfo(
            options.listing,
            "confirmed"
          ),
        },
      ].filter(
        (
          item
        ): item is {
          pubkey: PublicKey;
          account: NonNullable<typeof item.account>;
        } => Boolean(item.account)
      )
    : await provider.connection.getProgramAccounts(program.programId, {
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: SKILL_LISTING_DISCRIMINATOR.toString("base64"),
              encoding: "base64",
            },
          },
        ],
      });

  const legacyListings = candidates.filter(
    ({ account }) =>
      account.owner.equals(program.programId) &&
      account.data.length < M13_SKILL_LISTING_MIN_LEN
  );

  console.log("Program ID:", program.programId.toBase58());
  console.log("Config PDA:", configPda.toBase58());
  console.log("Authority:", provider.wallet.publicKey.toBase58());
  console.log("Legacy listings:", legacyListings.length);

  if (!options.apply) {
    for (const { pubkey, account } of legacyListings) {
      console.log("Dry run listing:", pubkey.toBase58(), account.data.length);
    }
    console.log("Dry run only. Re-run with --apply to migrate listings.");
    return;
  }

  for (const { pubkey, account } of legacyListings) {
    const revision = u64Le(0);
    const listingSettlement = pda(
      program.programId,
      Buffer.from("listing_settlement"),
      pubkey.toBuffer(),
      revision
    );
    const authorProceedsVaultAuthority = pda(
      program.programId,
      Buffer.from("author_proceeds_vault_authority"),
      listingSettlement.toBuffer()
    );
    const authorProceedsVault = pda(
      program.programId,
      Buffer.from("author_proceeds_vault"),
      listingSettlement.toBuffer()
    );

    try {
      const tx = await program.methods
        .migrateSkillListingM13()
        .accountsStrict({
          skillListing: pubkey,
          config: configPda,
          usdcMint,
          listingSettlement,
          authorProceedsVaultAuthority,
          authorProceedsVault,
          payer: provider.wallet.publicKey,
          authority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const migrated = await provider.connection.getAccountInfo(
        pubkey,
        "confirmed"
      );
      console.log(
        "Migrated listing:",
        pubkey.toBase58(),
        "from",
        account.data.length,
        "to",
        migrated?.data.length ?? "missing",
        "tx",
        tx
      );
    } catch (error) {
      console.error(
        "Failed to migrate listing:",
        pubkey.toBase58(),
        error instanceof Error ? error.message : error
      );
      if (options.listing) {
        throw error;
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
