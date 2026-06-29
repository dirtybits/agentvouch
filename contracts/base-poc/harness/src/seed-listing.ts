/**
 * Seed ONE Base Sepolia listing on AgentVouchEvm for the Phase 3b render proof.
 *
 * Registers an author (the funded DEPLOYER_PRIVATE_KEY EOA, idempotent) and creates one paid
 * skill listing, then prints the exact values Phase 3b needs for the DB row. No buyer, no USDC,
 * no CDP/paymaster — the author EOA just pays gas, and createSkillListing pulls no USDC.
 *
 * Needs (contracts/base-poc/harness/.env):
 *   DEPLOYER_PRIVATE_KEY   a Base Sepolia EOA with a little test ETH (gas only)
 *   AGENTVOUCH_ADDRESS     the deployed AgentVouchEvm (Base Sepolia, e.g. 0x6Fd9…D854)
 *   BASE_SEPOLIA_RPC_URL   optional (defaults to publicnode)
 * Optional metadata overrides: SEED_SKILL_ID, SEED_NAME, SEED_DESCRIPTION, SEED_PRICE_USDC, SEED_URI.
 *
 * Run: `npm run seed-listing`  — then paste the "PHASE 3B SEED ROW" JSON block back.
 * If createSkillListing reverts because this author already listed this skill, set a new
 * SEED_SKILL_ID and re-run.
 */
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  keccak256,
  stringToHex,
  encodeAbiParameters,
  parseAbiParameters,
  getAddress,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { agentVouchAbi } from "./abi";

const CHAIN_CONTEXT = "eip155:84532";
const rpc =
  process.env.BASE_SEPOLIA_RPC_URL || "https://base-sepolia-rpc.publicnode.com";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v)
    throw new Error(`Missing required env var ${name} (see harness .env)`);
  return v;
}

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(rpc),
});

async function main() {
  const av = getAddress(reqEnv("AGENTVOUCH_ADDRESS"));
  const author = privateKeyToAccount(reqEnv("DEPLOYER_PRIVATE_KEY") as Hex);
  const market = createWalletClient({
    account: author,
    chain: baseSepolia,
    transport: http(rpc),
  });

  const skillId = process.env.SEED_SKILL_ID || "phase-3b-demo-skill";
  const name = process.env.SEED_NAME || "Phase 3b Demo Skill (Base)";
  const description =
    process.env.SEED_DESCRIPTION ||
    "Read-only Base Sepolia listing seeded for the Phase 3b marketplace render proof.";
  const uri = process.env.SEED_URI || `ipfs://skill/${skillId}`;
  const priceUsdc = process.env.SEED_PRICE_USDC || "1";
  const priceMicros = parseUnits(priceUsdc, 6);

  const skillHash = keccak256(stringToHex(skillId));
  const listingId = keccak256(
    encodeAbiParameters(parseAbiParameters("address, bytes32"), [
      author.address,
      skillHash,
    ])
  );

  console.log("Seeding a Base Sepolia listing on", av);
  console.log("  author (EOA, pays gas):", author.address);
  console.log("  skillId:", skillId, "| price:", priceUsdc, "USDC\n");

  async function send(label: string, run: () => Promise<Hex>) {
    const hash = await run();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${label.padEnd(18)} ${hash} ${receipt.status}`);
    if (receipt.status !== "success") throw new Error(`${label} reverted`);
    return hash;
  }

  // Register the author (idempotent — skip if already registered).
  let needRegister = true;
  try {
    await publicClient.simulateContract({
      address: av,
      abi: agentVouchAbi,
      functionName: "registerAgent",
      args: ["ipfs://agentvouch-phase3b-author"],
      account: author.address,
    });
  } catch (e) {
    if (String(e).includes("AlreadyRegistered")) needRegister = false;
    else throw e;
  }
  if (needRegister) {
    await send("registerAgent", () =>
      market.writeContract({
        address: av,
        abi: agentVouchAbi,
        functionName: "registerAgent",
        args: ["ipfs://agentvouch-phase3b-author"],
      })
    );
  } else {
    console.log("  registerAgent      (already registered — skipping)");
  }

  // Create the paid listing (pulls no USDC).
  const txHash = await send("createSkillListing", () =>
    market.writeContract({
      address: av,
      abi: agentVouchAbi,
      functionName: "createSkillListing",
      args: [skillHash, uri, name, description, priceMicros],
    })
  );

  const row = {
    chain_context: CHAIN_CONTEXT,
    evm_contract_address: av,
    evm_listing_id: listingId,
    evm_tx_hash: txHash,
    author_pubkey: author.address,
    name,
    description,
    uri,
    price_usdc_micros: priceMicros.toString(),
  };
  console.log(
    "\n================ PHASE 3B SEED ROW (paste this back) ================"
  );
  console.log(JSON.stringify(row, null, 2));
  console.log(
    "===================================================================="
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
