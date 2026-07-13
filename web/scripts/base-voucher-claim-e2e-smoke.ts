import { existsSync, readFileSync } from "node:fs";
import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBundlerClient,
  toCoinbaseSmartAccount,
} from "viem/account-abstraction";
import { baseSepolia } from "viem/chains";

const DEFAULT_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEFAULT_AUTHOR = "0x191370b682924527c1A5fD6B484A4BC37460CA30";
const REWARD_INDEX_SCALE = 1_000_000_000_000n;

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const claimAbi = parseAbi([
  "function PROTOCOL_VERSION() view returns (string)",
  "function getProfile(address agent) view returns ((bool registered,string metadataUri,uint256 reputationScore,uint64 totalVouchesReceived,uint64 totalVouchesGiven,uint256 totalVouchStakeReceivedUsdcMicros,uint256 authorBondUsdcMicros,uint64 activeFreeListingCount,uint64 openDisputes,uint64 upheldDisputes,uint64 dismissedDisputes,uint256 rewardIndexUsdcMicrosX1e12,uint256 unclaimedVoucherRevenueUsdcMicros,uint64 registeredAt))",
  "function getVouch(address voucher, address vouchee) view returns ((address voucher,address vouchee,uint256 stakeUsdcMicros,uint8 status,uint256 cumulativeRevenueUsdcMicros,uint64 linkedListingCount,uint256 entryRewardIndexUsdcMicrosX1e12,uint256 pendingRewardsUsdcMicros,uint64 lastPayoutAt))",
  "function claimVoucherRevenue(address author)",
  "event VoucherRevenueClaimed(address indexed voucher, address indexed author, uint256 amount)",
]);

async function main() {
  loadEnvFile("web/.env.local");
  loadEnvFile(
    process.env.AGENTVOUCH_HARNESS_ENV ?? "contracts/base-poc/harness/.env"
  );
  const rpc =
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ??
    process.env.BASE_SEPOLIA_RPC_URL ??
    "https://base-sepolia-rpc.publicnode.com";
  const contract = getAddress(
    requireEnv("NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS")
  );
  const usdc = getAddress(
    process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS ?? DEFAULT_USDC
  );
  const paymasterRpcUrl =
    process.env.NEXT_PUBLIC_BASE_CDP_PAYMASTER_RPC_URL ??
    process.env.NEXT_PUBLIC_CDP_RPC_URL ??
    process.env.CDP_RPC_URL;
  assert(paymasterRpcUrl, "Missing Base CDP paymaster/bundler endpoint");
  const author = getAddress(
    process.env.BASE_VOUCHER_CLAIM_SMOKE_AUTHOR ??
      process.env.BASE_VOUCH_SMOKE_AUTHOR ??
      DEFAULT_AUTHOR
  );
  const owner = privateKeyToAccount(requireEnv("VOUCHER_OWNER_PK") as Hex);
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpc),
  });
  const voucher = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [owner],
    version: "1.1",
  });
  const [
    chainId,
    protocolVersion,
    voucherProfile,
    authorProfile,
    vouch,
    usdcBefore,
    ethBefore,
  ] = await Promise.all([
    publicClient.getChainId(),
    publicClient.readContract({
      address: contract,
      abi: claimAbi,
      functionName: "PROTOCOL_VERSION",
    }),
    publicClient.readContract({
      address: contract,
      abi: claimAbi,
      functionName: "getProfile",
      args: [voucher.address],
    }),
    publicClient.readContract({
      address: contract,
      abi: claimAbi,
      functionName: "getProfile",
      args: [author],
    }),
    publicClient.readContract({
      address: contract,
      abi: claimAbi,
      functionName: "getVouch",
      args: [voucher.address, author],
    }),
    publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [voucher.address],
    }),
    publicClient.getBalance({ address: voucher.address }),
  ]);
  const accruedSinceEntry =
    (vouch.stakeUsdcMicros *
      (authorProfile.rewardIndexUsdcMicrosX1e12 -
        vouch.entryRewardIndexUsdcMicrosX1e12)) /
    REWARD_INDEX_SCALE;
  const expectedClaimable = vouch.pendingRewardsUsdcMicros + accruedSinceEntry;
  assert(
    chainId === baseSepolia.id,
    `Expected Base Sepolia (${baseSepolia.id}), got ${chainId}`
  );
  assert(
    protocolVersion === "base-v1-candidate",
    `Unexpected protocol version: ${protocolVersion}`
  );
  assert(voucherProfile.registered, "Voucher smart account is not registered");
  assert(authorProfile.registered, "Target Base author is not registered");
  assert(vouch.status === 0, "Voucher does not have an active vouch");
  assert(vouch.stakeUsdcMicros > 0n, "Voucher has no stake to claim against");
  assert(expectedClaimable > 0n, "Voucher has no claimable revenue");
  console.log(`voucher=${voucher.address}`);
  console.log(`author=${author}`);
  console.log(`expectedClaimableUsdc=${formatUnits(expectedClaimable, 6)}`);
  if (process.env.BASE_VOUCHER_CLAIM_SMOKE_DRY_RUN === "1") {
    console.log("result=PASS Base Sepolia voucher claim preflight only");
    return;
  }
  const bundler = createBundlerClient({
    account: voucher,
    client: publicClient,
    transport: http(paymasterRpcUrl),
    paymaster: true,
  });
  const userOpHash = await bundler.sendUserOperation({
    calls: [
      {
        to: contract,
        abi: claimAbi,
        functionName: "claimVoucherRevenue",
        args: [author],
      },
    ] as never,
  });
  const userOpReceipt = await bundler.waitForUserOperationReceipt({
    hash: userOpHash,
  });
  assert(
    userOpReceipt.success,
    `Base voucher claim UserOp ${userOpHash} reverted`
  );
  const transactionHash = userOpReceipt.receipt.transactionHash;
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });
  assert(
    receipt.status === "success",
    "Base voucher claim transaction reverted"
  );
  const claimEvent = receipt.logs
    .map((log) => {
      try {
        return decodeEventLog({
          abi: claimAbi,
          data: log.data,
          topics: log.topics,
        });
      } catch {
        return null;
      }
    })
    .find((event) => event?.eventName === "VoucherRevenueClaimed");
  assert(claimEvent, "Receipt lacks a VoucherRevenueClaimed event");
  assert(
    getAddress(String(claimEvent.args.voucher)) === voucher.address &&
      getAddress(String(claimEvent.args.author)) === author &&
      claimEvent.args.amount === expectedClaimable,
    "VoucherRevenueClaimed event did not match the expected claim"
  );
  const [vouchAfter, authorProfileAfter, usdcAfter, ethAfter] =
    await Promise.all([
      publicClient.readContract({
        address: contract,
        abi: claimAbi,
        functionName: "getVouch",
        args: [voucher.address, author],
      }),
      publicClient.readContract({
        address: contract,
        abi: claimAbi,
        functionName: "getProfile",
        args: [author],
      }),
      publicClient.readContract({
        address: usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [voucher.address],
      }),
      publicClient.getBalance({ address: voucher.address }),
    ]);
  assert(
    usdcAfter - usdcBefore === expectedClaimable,
    "Voucher USDC delta did not equal the claimed revenue"
  );
  assert(
    ethAfter === ethBefore,
    "Voucher smart-account ETH changed despite sponsored gas"
  );
  assert(
    vouchAfter.pendingRewardsUsdcMicros === 0n,
    "Voucher pending rewards were not cleared after claim"
  );
  assert(
    vouchAfter.cumulativeRevenueUsdcMicros ===
      vouch.cumulativeRevenueUsdcMicros + expectedClaimable,
    "Voucher cumulative revenue did not increase by the claim"
  );
  assert(
    authorProfileAfter.unclaimedVoucherRevenueUsdcMicros ===
      authorProfile.unclaimedVoucherRevenueUsdcMicros - expectedClaimable,
    "Author unclaimed voucher revenue did not decrease by the claim"
  );
  console.log(`userOp=${userOpHash}`);
  console.log(`transaction=${transactionHash}`);
  console.log(`explorer=https://sepolia.basescan.org/tx/${transactionHash}`);
  console.log(
    `voucherUsdc=${formatUnits(usdcBefore, 6)} -> ${formatUnits(usdcAfter, 6)}`
  );
  console.log(
    `voucherEth=${formatEther(ethBefore)} -> ${formatEther(ethAfter)}`
  );
  console.log("result=PASS Base Sepolia voucher revenue claim E2E");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
