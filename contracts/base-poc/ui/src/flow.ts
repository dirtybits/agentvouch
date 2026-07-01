import {
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  stringToHex,
  erc20Abi,
  parseUnits,
  formatUnits,
  http,
  type Address,
  type Hex,
} from "viem";
import { createBundlerClient, type SmartAccount } from "viem/account-abstraction";
import {
  publicClient,
  agentVouchAddress,
  usdcAddress,
  cdpRpcUrl,
  USDC_DECIMALS,
} from "./config";
import { agentVouchAbi } from "./abi";

// --- Reads (work without a paymaster) ---

export const getEthBalance = (address: Address) =>
  publicClient.getBalance({ address });

export const getUsdcBalance = (address: Address) =>
  publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });

export const usdcMicros = (amountUsdc: string): bigint =>
  parseUnits(amountUsdc, USDC_DECIMALS);

export const formatUsdc = (micros: bigint): string =>
  formatUnits(micros, USDC_DECIMALS);

// listingId == keccak256(abi.encode(author, skillIdHash)) — must match the contract + harness.
export const skillIdHashFrom = (skillId: string): Hex =>
  keccak256(stringToHex(skillId));

export const computeListingId = (author: Address, skillIdHash: Hex): Hex =>
  keccak256(
    encodeAbiParameters(parseAbiParameters("address, bytes32"), [
      author,
      skillIdHash,
    ]),
  );

// --- Sponsored writes (require the CDP bundler/paymaster) ---

export function requireCdp(): string {
  if (!cdpRpcUrl) {
    throw new Error(
      "VITE_CDP_RPC_URL is not set — add your CDP Paymaster & Bundler URL to .env.local and restart the dev server.",
    );
  }
  return cdpRpcUrl;
}

function bundlerFor(account: SmartAccount) {
  return createBundlerClient({
    account,
    client: publicClient,
    transport: http(requireCdp()),
    paymaster: true, // CDP serves pm_getPaymasterData on the same endpoint
  });
}

export interface StepResult {
  userOpHash: Hex;
  txHash: Hex;
  success: boolean;
  actualGasCost: bigint; // wei the paymaster paid; the user paid 0
}

async function send(account: SmartAccount, calls: unknown[]): Promise<StepResult> {
  const bundler = bundlerFor(account);
  const userOpHash = await bundler.sendUserOperation({ calls: calls as never });
  const receipt = await bundler.waitForUserOperationReceipt({ hash: userOpHash });
  if (!receipt.success) {
    throw new Error(`UserOp ${userOpHash} reverted on-chain`);
  }
  return {
    userOpHash,
    txHash: receipt.receipt.transactionHash,
    success: receipt.success,
    actualGasCost: receipt.actualGasCost,
  };
}

export const registerAgent = (account: SmartAccount, metadataUri: string) =>
  send(account, [
    {
      to: agentVouchAddress,
      abi: agentVouchAbi,
      functionName: "registerAgent",
      args: [metadataUri],
    },
  ]);

export const createSkillListing = (
  account: SmartAccount,
  p: {
    skillIdHash: Hex;
    uri: string;
    name: string;
    description: string;
    priceMicros: bigint;
  },
) =>
  send(account, [
    {
      to: agentVouchAddress,
      abi: agentVouchAbi,
      functionName: "createSkillListing",
      args: [p.skillIdHash, p.uri, p.name, p.description, p.priceMicros],
    },
  ]);

// Batched in one UserOp: approve the contract to pull USDC, then purchase. Atomic.
export const purchaseSkill = (
  account: SmartAccount,
  listingId: Hex,
  priceMicros: bigint,
) =>
  send(account, [
    {
      to: usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [agentVouchAddress, priceMicros],
    },
    {
      to: agentVouchAddress,
      abi: agentVouchAbi,
      functionName: "purchaseSkill",
      args: [listingId],
    },
  ]);
