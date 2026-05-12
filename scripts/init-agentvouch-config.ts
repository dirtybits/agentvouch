import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { Agentvouch } from "../target/types/agentvouch";

const DEVNET_CHAIN_CONTEXT = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const TESTNET_CHAIN_CONTEXT = "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z";
const MAINNET_CHAIN_CONTEXT = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type Options = {
  apply: boolean;
  usdcMint?: string;
  chainContext?: string;
  configAuthority?: string;
  treasuryAuthority?: string;
  settlementAuthority?: string;
  pauseAuthority?: string;
  slashPercentage: number;
  cooldownPeriod: number;
};

type InitializeAccounts = {
  config: PublicKey;
  usdcMint: PublicKey;
  protocolTreasuryVaultAuthority: PublicKey;
  protocolTreasuryVault: PublicKey;
  x402SettlementVaultAuthority: PublicKey;
  x402SettlementVault: PublicKey;
  authority: PublicKey;
  payer: PublicKey;
  tokenProgram: PublicKey;
  systemProgram: PublicKey;
};

function printUsage(exitCode = 1): never {
  console.error(`Usage:
  USDC_MINT=<mint> AGENTVOUCH_WALLET=<keypair> AGENTVOUCH_RPC_URL=<rpc> \\
    npm exec ts-node -- scripts/init-agentvouch-config.ts [--apply]

Options:
  --apply                         Submit the initialize_config transaction.
  --usdc-mint <pubkey>            USDC mint to store in config. Required unless USDC_MINT is set.
  --chain-context <caip2>         Chain context stored in config. Defaults from env/RPC.
  --config-authority <pubkey>     Defaults to payer.
  --treasury-authority <pubkey>   Defaults to payer.
  --settlement-authority <pubkey> Defaults to payer.
  --pause-authority <pubkey>      Defaults to payer.
  --slash-percentage <0-100>      Defaults to 50.
  --cooldown-period <seconds>     Defaults to 86400.

Environment:
  INIT_AGENTVOUCH_CONFIG_APPLY=1 may be used instead of --apply.
  AGENTVOUCH_RPC_URL avoids Anchor.toml provider defaults when using anchor run.
  AGENTVOUCH_WALLET avoids Anchor.toml provider defaults when using anchor run.
  SOLANA_RPC_URL may be used instead of AGENTVOUCH_RPC_URL.
  ANCHOR_PROVIDER_URL and ANCHOR_WALLET are still supported for direct ts-node use.

Notes:
  - Dry run is the default. Use --apply only after reviewing the printed PDAs and simulation result.
  - The script is idempotent: if the config PDA already exists, it prints the current config and exits.
`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apply: process.env.INIT_AGENTVOUCH_CONFIG_APPLY === "1",
    slashPercentage: 50,
    cooldownPeriod: 86_400,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) printUsage();
      i += 1;
      return value;
    };

    if (arg === "--help" || arg === "-h") printUsage(0);
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }
    if (arg === "--usdc-mint") {
      options.usdcMint = next();
      continue;
    }
    if (arg === "--chain-context") {
      options.chainContext = next();
      continue;
    }
    if (arg === "--config-authority") {
      options.configAuthority = next();
      continue;
    }
    if (arg === "--treasury-authority") {
      options.treasuryAuthority = next();
      continue;
    }
    if (arg === "--settlement-authority") {
      options.settlementAuthority = next();
      continue;
    }
    if (arg === "--pause-authority") {
      options.pauseAuthority = next();
      continue;
    }
    if (arg === "--slash-percentage") {
      options.slashPercentage = Number(next());
      continue;
    }
    if (arg === "--cooldown-period") {
      options.cooldownPeriod = Number(next());
      continue;
    }
    printUsage();
  }

  return options;
}

function expandTilde(filePath: string) {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/"))
    return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function readKeypair(filePath: string) {
  const expanded = expandTilde(filePath);
  const secret = JSON.parse(fs.readFileSync(expanded, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function requirePubkey(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is required`);
  return new PublicKey(value);
}

function inferChainContext(rpcUrl: string) {
  const lower = rpcUrl.toLowerCase();
  if (lower.includes("devnet")) return DEVNET_CHAIN_CONTEXT;
  if (lower.includes("testnet")) return TESTNET_CHAIN_CONTEXT;
  if (lower.includes("mainnet")) return MAINNET_CHAIN_CONTEXT;
  return null;
}

function inferChainContextFromMint(usdcMint: PublicKey) {
  const mint = usdcMint.toBase58();
  if (mint === DEVNET_USDC_MINT) return DEVNET_CHAIN_CONTEXT;
  if (mint === MAINNET_USDC_MINT) return MAINNET_CHAIN_CONTEXT;
  return null;
}

function getChainContext(
  options: Options,
  rpcUrl: string,
  usdcMint: PublicKey
) {
  const configured =
    options.chainContext ||
    process.env.SOLANA_CHAIN_CONTEXT ||
    process.env.NEXT_PUBLIC_SOLANA_CHAIN_CONTEXT ||
    inferChainContext(rpcUrl) ||
    inferChainContextFromMint(usdcMint);

  if (!configured) {
    throw new Error(
      "Unable to infer chain context. Pass --chain-context or set SOLANA_CHAIN_CONTEXT."
    );
  }

  return configured;
}

function derivePda(programId: PublicKey, seeds: Buffer[]) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function buildInitializeAccounts(
  programId: PublicKey,
  payer: PublicKey,
  usdcMint: PublicKey
): InitializeAccounts {
  return {
    config: derivePda(programId, [Buffer.from("config")]),
    usdcMint,
    protocolTreasuryVaultAuthority: derivePda(programId, [
      Buffer.from("treasury_vault_authority"),
    ]),
    protocolTreasuryVault: derivePda(programId, [
      Buffer.from("treasury_vault"),
    ]),
    x402SettlementVaultAuthority: derivePda(programId, [
      Buffer.from("x402_settlement_vault_authority"),
    ]),
    x402SettlementVault: derivePda(programId, [
      Buffer.from("x402_settlement_vault"),
    ]),
    authority: payer,
    payer,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
}

function printAccounts(accounts: InitializeAccounts) {
  console.log("Config PDA:", accounts.config.toBase58());
  console.log("USDC mint:", accounts.usdcMint.toBase58());
  console.log(
    "Protocol treasury vault authority:",
    accounts.protocolTreasuryVaultAuthority.toBase58()
  );
  console.log(
    "Protocol treasury vault:",
    accounts.protocolTreasuryVault.toBase58()
  );
  console.log(
    "x402 settlement vault authority:",
    accounts.x402SettlementVaultAuthority.toBase58()
  );
  console.log(
    "x402 settlement vault:",
    accounts.x402SettlementVault.toBase58()
  );
  console.log("Payer:", accounts.payer.toBase58());
}

async function printExistingConfig(
  program: Program<Agentvouch>,
  configPda: PublicKey
) {
  const config = await program.account.reputationConfig.fetch(configPda);
  console.log("Config already initialized. No transaction sent.");
  console.log("Authority:", config.authority.toBase58());
  console.log("Config authority:", config.configAuthority.toBase58());
  console.log("Treasury authority:", config.treasuryAuthority.toBase58());
  console.log("Settlement authority:", config.settlementAuthority.toBase58());
  console.log("Pause authority:", config.pauseAuthority.toBase58());
  console.log("USDC mint:", config.usdcMint.toBase58());
  console.log(
    "Protocol treasury vault:",
    config.protocolTreasuryVault.toBase58()
  );
  console.log("x402 settlement vault:", config.x402SettlementVault.toBase58());
  console.log("Chain context:", config.chainContext);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rpcUrl =
    process.env.AGENTVOUCH_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.ANCHOR_PROVIDER_URL;
  const walletPath = process.env.AGENTVOUCH_WALLET || process.env.ANCHOR_WALLET;

  if (!rpcUrl) {
    throw new Error(
      "AGENTVOUCH_RPC_URL, SOLANA_RPC_URL, or ANCHOR_PROVIDER_URL is required to initialize config."
    );
  }
  if (!walletPath) {
    throw new Error(
      "AGENTVOUCH_WALLET or ANCHOR_WALLET is required to initialize config."
    );
  }
  if (
    !Number.isInteger(options.slashPercentage) ||
    options.slashPercentage < 0 ||
    options.slashPercentage > 100
  ) {
    throw new Error("--slash-percentage must be an integer between 0 and 100.");
  }
  if (!Number.isInteger(options.cooldownPeriod) || options.cooldownPeriod < 0) {
    throw new Error("--cooldown-period must be a non-negative integer.");
  }

  const payer = readKeypair(walletPath);
  const usdcMint = requirePubkey(
    options.usdcMint || process.env.USDC_MINT,
    "USDC_MINT"
  );
  const chainContext = getChainContext(options, rpcUrl, usdcMint);
  const configAuthority = requirePubkey(
    options.configAuthority ||
      process.env.CONFIG_AUTHORITY ||
      payer.publicKey.toBase58(),
    "CONFIG_AUTHORITY"
  );
  const treasuryAuthority = requirePubkey(
    options.treasuryAuthority ||
      process.env.TREASURY_AUTHORITY ||
      payer.publicKey.toBase58(),
    "TREASURY_AUTHORITY"
  );
  const settlementAuthority = requirePubkey(
    options.settlementAuthority ||
      process.env.SETTLEMENT_AUTHORITY ||
      payer.publicKey.toBase58(),
    "SETTLEMENT_AUTHORITY"
  );
  const pauseAuthority = requirePubkey(
    options.pauseAuthority ||
      process.env.PAUSE_AUTHORITY ||
      payer.publicKey.toBase58(),
    "PAUSE_AUTHORITY"
  );

  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(rpcUrl, "confirmed"),
    new anchor.Wallet(payer),
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.Agentvouch as Program<Agentvouch>;
  const accounts = buildInitializeAccounts(
    program.programId,
    payer.publicKey,
    usdcMint
  );

  console.log("Program ID:", program.programId.toBase58());
  console.log("RPC:", rpcUrl);
  console.log("Chain context:", chainContext);
  console.log("Apply:", options.apply ? "yes" : "no");
  console.log("Config authority:", configAuthority.toBase58());
  console.log("Treasury authority:", treasuryAuthority.toBase58());
  console.log("Settlement authority:", settlementAuthority.toBase58());
  console.log("Pause authority:", pauseAuthority.toBase58());
  console.log("Slash percentage:", options.slashPercentage);
  console.log("Cooldown period:", options.cooldownPeriod, "seconds");
  printAccounts(accounts);

  const [configInfo, mintInfo] = await Promise.all([
    provider.connection.getAccountInfo(accounts.config, "confirmed"),
    provider.connection.getAccountInfo(usdcMint, "confirmed"),
  ]);

  if (configInfo) {
    if (!configInfo.owner.equals(program.programId)) {
      throw new Error(
        `Config PDA is owned by ${configInfo.owner.toBase58()}, expected ${program.programId.toBase58()}`
      );
    }
    await printExistingConfig(program, accounts.config);
    return;
  }

  if (!mintInfo) {
    throw new Error(
      `USDC mint ${usdcMint.toBase58()} does not exist on this RPC.`
    );
  }
  if (!mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    throw new Error(
      `USDC mint ${usdcMint.toBase58()} is owned by ${mintInfo.owner.toBase58()}, expected ${TOKEN_PROGRAM_ID.toBase58()}`
    );
  }

  const ix = await program.methods
    .initializeConfig(
      chainContext,
      configAuthority,
      treasuryAuthority,
      settlementAuthority,
      pauseAuthority,
      options.slashPercentage,
      new anchor.BN(options.cooldownPeriod)
    )
    .accounts(accounts)
    .instruction();

  const simulationTx = new Transaction().add(ix);
  simulationTx.feePayer = payer.publicKey;
  simulationTx.recentBlockhash = (
    await provider.connection.getLatestBlockhash("confirmed")
  ).blockhash;
  simulationTx.sign(payer);
  const simulation = await provider.connection.simulateTransaction(
    simulationTx
  );

  console.log("Simulation error:", JSON.stringify(simulation.value.err));
  if (simulation.value.logs) {
    console.log("Simulation logs:");
    for (const log of simulation.value.logs) console.log("  " + log);
  }
  if (simulation.value.err) {
    throw new Error(
      "initialize_config simulation failed; not sending transaction."
    );
  }

  if (!options.apply) {
    console.log(
      "Dry run only. Re-run with --apply or INIT_AGENTVOUCH_CONFIG_APPLY=1 to initialize config."
    );
    return;
  }

  const tx = await program.methods
    .initializeConfig(
      chainContext,
      configAuthority,
      treasuryAuthority,
      settlementAuthority,
      pauseAuthority,
      options.slashPercentage,
      new anchor.BN(options.cooldownPeriod)
    )
    .accounts(accounts)
    .rpc();

  console.log("Config initialized.");
  console.log("Transaction:", tx);
  await printExistingConfig(program, accounts.config);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
