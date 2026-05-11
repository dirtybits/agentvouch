import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Agentvouch } from "../target/types/agentvouch";

const M13_REPUTATION_CONFIG_MIN_LEN = 491;

type Options = {
  apply: boolean;
};

function printUsage(): never {
  console.error(`Usage:
  ts-node scripts/migrate-config.ts [--apply]

Notes:
  - Dry run is the default. Pass --apply to submit the migration transaction.
  - Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET to point at the config authority.
`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  let apply = false;

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    printUsage();
  }

  return { apply };
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

  const accountInfo = await provider.connection.getAccountInfo(
    configPda,
    "confirmed"
  );
  if (!accountInfo) {
    throw new Error(
      `Config PDA ${configPda.toBase58()} does not exist on this cluster. Run initialize_config instead.`
    );
  }

  if (!accountInfo.owner.equals(program.programId)) {
    throw new Error(
      `Config PDA ${configPda.toBase58()} is owned by ${accountInfo.owner.toBase58()}, expected ${program.programId.toBase58()}`
    );
  }

  console.log("Program ID:", program.programId.toBase58());
  console.log("Config PDA:", configPda.toBase58());
  console.log("Config size:", accountInfo.data.length, "bytes");

  if (accountInfo.data.length >= M13_REPUTATION_CONFIG_MIN_LEN) {
    const config = await program.account.reputationConfig.fetch(configPda);
    console.log("Config already uses the M13 layout.");
    console.log("Config authority:", config.configAuthority.toBase58());
    return;
  }

  if (!options.apply) {
    console.log("Dry run only. Re-run with --apply to migrate the config.");
    return;
  }

  const tx = await program.methods
    .migrateConfigM13()
    .accountsStrict({
      config: configPda,
      payer: provider.wallet.publicKey,
      authority: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("Migration transaction:", tx);

  const migratedAccount = await program.account.reputationConfig.fetch(
    configPda
  );
  console.log(
    "Migrated config authority:",
    migratedAccount.configAuthority.toBase58()
  );
  console.log(
    "Author proceeds lock seconds:",
    migratedAccount.authorProceedsLockSeconds.toString()
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
