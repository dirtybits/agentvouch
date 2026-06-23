/**
 * One-time setup for the x402 agent-purchase demo.
 *
 * The x402 buyer must be a plain EOA holding USDC (it signs an EIP-3009 authorization with
 * its own key — a smart account can't, since Lane B uses ECDSA `transferWithAuthorization`).
 * This script:
 *   1. Ensures a stable agent EOA key (AGENT_PK) — generates one and appends it to .env if absent.
 *   2. Tops up that agent EOA with test USDC by moving it from an already-funded v2 smart
 *      account via a sponsored UserOp — so you don't need the faucet.
 *
 * If the paymaster rejects the sponsored transfer (its allowlist may exclude USDC.transfer),
 * it falls back to printing the agent address + the Circle faucet link.
 *
 * Run: `npm run fund-agent`  (re-run any time the agent runs low; each `agent-x402` run spends the price)
 */
import "dotenv/config";
import { appendFileSync } from "node:fs";
import {
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  erc20Abi,
  getAddress,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  createBundlerClient,
  toCoinbaseSmartAccount,
} from "viem/account-abstraction";

const DEFAULT_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TOPUP_USDC = process.env.AGENT_TOPUP_USDC || "5";

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(
    process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"
  ),
});
const usdc = getAddress(process.env.USDC_ADDRESS || DEFAULT_USDC);

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v)
    throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

const usdcBalance = (a: Hex) =>
  publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [a],
  });

// A stable agent key so the agent's address (which holds USDC) survives across runs.
function ensureAgentKey(): Hex {
  if (process.env.AGENT_PK) return process.env.AGENT_PK as Hex;
  const pk = generatePrivateKey();
  appendFileSync(
    ".env",
    `\n# Agent EOA for the x402 demo (signs EIP-3009 off-chain; never sends a tx, never needs ETH)\nAGENT_PK=${pk}\n`
  );
  process.env.AGENT_PK = pk;
  console.log("Generated a new AGENT_PK and appended it to .env (gitignored).");
  return pk;
}

async function main() {
  const agent = privateKeyToAccount(ensureAgentKey());
  console.log("Agent EOA (x402 buyer):", agent.address);
  console.log(
    "  USDC before:",
    formatUnits(await usdcBalance(agent.address), 6)
  );

  // Funder: the already-funded v2 author smart account (just a USDC-holding wallet here).
  const funder = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [privateKeyToAccount(reqEnv("AUTHOR_OWNER_PK") as Hex)],
    version: "1.1",
  });
  const funderBal = await usdcBalance(funder.address);
  console.log(
    `Funder (v2 smart account ${funder.address}): ${formatUnits(
      funderBal,
      6
    )} USDC`
  );

  const amount = parseUnits(TOPUP_USDC, 6);
  if (funderBal < amount) {
    console.error(
      `\nFunder only has ${formatUnits(
        funderBal,
        6
      )} USDC, wanted to move ${TOPUP_USDC}.` +
        ` Lower AGENT_TOPUP_USDC or fund the agent directly at https://faucet.circle.com:\n  ${agent.address}`
    );
    process.exitCode = 1;
    return;
  }

  const bundler = createBundlerClient({
    account: funder,
    client: publicClient,
    transport: http(reqEnv("CDP_RPC_URL")),
    paymaster: true,
  });

  console.log(
    `\nMoving ${TOPUP_USDC} USDC -> agent via a sponsored UserOp ...`
  );
  try {
    const hash = await bundler.sendUserOperation({
      calls: [
        {
          to: usdc,
          abi: erc20Abi,
          functionName: "transfer",
          args: [agent.address, amount],
        },
      ],
    });
    const receipt = await bundler.waitForUserOperationReceipt({ hash });
    if (!receipt.success) throw new Error("transfer UserOp reverted");
    console.log(
      `  ok: https://sepolia.basescan.org/tx/${receipt.receipt.transactionHash}`
    );
  } catch (err) {
    console.error(
      "\nSponsored transfer failed (the paymaster allowlist may exclude USDC.transfer):\n  " +
        ((err as Error).message ?? String(err))
    );
    console.error(
      `\nFallback — fund the agent EOA with test USDC at https://faucet.circle.com (Base Sepolia):\n  ${agent.address}`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    "  USDC after: ",
    formatUnits(await usdcBalance(agent.address), 6)
  );
  console.log("\nAgent is funded. Now run: npm run agent-x402");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
