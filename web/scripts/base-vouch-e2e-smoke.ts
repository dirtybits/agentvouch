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
const STAKE_USDC_MICROS = 1_000_000n;

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

const profileAbi = parseAbi([
  "function PROTOCOL_VERSION() view returns (string)",
  "function getProfile(address agent) view returns ((bool registered,string metadataUri,uint256 reputationScore,uint64 totalVouchesReceived,uint64 totalVouchesGiven,uint256 totalVouchStakeReceivedUsdcMicros,uint256 authorBondUsdcMicros,uint64 activeFreeListingCount,uint64 openDisputes,uint64 upheldDisputes,uint64 dismissedDisputes,uint256 rewardIndexUsdcMicrosX1e12,uint256 unclaimedVoucherRevenueUsdcMicros,uint64 registeredAt))",
  "function getVouch(address voucher, address vouchee) view returns ((address voucher,address vouchee,uint256 stakeUsdcMicros,uint8 status,uint256 cumulativeRevenueUsdcMicros,uint64 linkedListingCount,uint256 entryRewardIndexUsdcMicrosX1e12,uint256 pendingRewardsUsdcMicros,uint64 lastPayoutAt))",
  "function registerAgent(string metadataUri)",
  "function vouch(address vouchee, uint256 stake)",
  "event Vouched(address indexed voucher, address indexed vouchee, uint256 stake)",
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
    process.env.BASE_VOUCH_SMOKE_AUTHOR ?? DEFAULT_AUTHOR
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
    version,
    voucherProfile,
    authorProfile,
    beforeVouch,
    beforeUsdc,
    beforeEth,
  ] = await Promise.all([
    publicClient.getChainId(),
    publicClient.readContract({
      address: contract,
      abi: profileAbi,
      functionName: "PROTOCOL_VERSION",
    }),
    publicClient.readContract({
      address: contract,
      abi: profileAbi,
      functionName: "getProfile",
      args: [voucher.address],
    }),
    publicClient.readContract({
      address: contract,
      abi: profileAbi,
      functionName: "getProfile",
      args: [author],
    }),
    publicClient.readContract({
      address: contract,
      abi: profileAbi,
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

  console.log(`preflightVoucher=${voucher.address}`);
  console.log(`preflightAuthor=${author}`);
  console.log(`preflightVoucherRegistered=${voucherProfile.registered}`);
  console.log(`preflightAuthorRegistered=${authorProfile.registered}`);
  console.log(`preflightVoucherUsdc=${formatUnits(beforeUsdc, 6)}`);
  if (process.env.BASE_VOUCH_SMOKE_DRY_RUN === "1") {
    console.log("result=PASS Base Sepolia vouch preflight only");
    return;
  }
  assert(
    chainId === baseSepolia.id,
    `Expected Base Sepolia (${baseSepolia.id}), got ${chainId}`
  );
  assert(
    version === "base-v1-candidate",
    `Unexpected protocol version: ${version}`
  );
  assert(authorProfile.registered, "Target Base author is not registered");
  assert(
    beforeUsdc >= STAKE_USDC_MICROS,
    "Voucher lacks 1 test USDC for the smoke"
  );

  const bundler = createBundlerClient({
    account: voucher,
    client: publicClient,
    transport: http(paymasterRpcUrl),
    paymaster: true,
  });
  let registrationUserOp: Hex | null = null;
  let registrationTransaction: Hex | null = null;
  if (!voucherProfile.registered) {
    registrationUserOp = await bundler.sendUserOperation({
      calls: [
        {
          to: contract,
          abi: profileAbi,
          functionName: "registerAgent",
          args: [`agentvouch://base-passkey/${voucher.address.toLowerCase()}`],
        },
      ] as never,
    });
    const registrationReceipt = await bundler.waitForUserOperationReceipt({
      hash: registrationUserOp,
    });
    assert(
      registrationReceipt.success,
      `Base voucher registration UserOp ${registrationUserOp} reverted`
    );
    registrationTransaction = registrationReceipt.receipt.transactionHash;
    const registeredProfile = await publicClient.readContract({
      address: contract,
      abi: profileAbi,
      functionName: "getProfile",
      args: [voucher.address],
    });
    assert(
      registeredProfile.registered,
      "Voucher registration did not persist"
    );
  }

  const allowance = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [voucher.address, contract],
  });
  const calls: unknown[] = [];
  if (allowance !== STAKE_USDC_MICROS && allowance !== 0n) {
    calls.push({
      to: usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [contract, 0n],
    });
  }
  if (allowance !== STAKE_USDC_MICROS) {
    calls.push({
      to: usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [contract, STAKE_USDC_MICROS],
    });
  }
  calls.push({
    to: contract,
    abi: profileAbi,
    functionName: "vouch",
    args: [author, STAKE_USDC_MICROS],
  });
  const userOpHash = await bundler.sendUserOperation({ calls: calls as never });
  const userOpReceipt = await bundler.waitForUserOperationReceipt({
    hash: userOpHash,
  });
  assert(userOpReceipt.success, `Base vouch UserOp ${userOpHash} reverted`);
  const transactionHash = userOpReceipt.receipt.transactionHash;
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });
  assert(receipt.status === "success", "Base vouch transaction reverted");
  const vouchEvent = receipt.logs
    .map((log) => {
      try {
        return decodeEventLog({
          abi: profileAbi,
          data: log.data,
          topics: log.topics,
        });
      } catch {
        return null;
      }
    })
    .find((event) => event?.eventName === "Vouched");
  assert(vouchEvent, "Receipt lacks a Vouched event");
  assert(
    getAddress(String(vouchEvent.args.voucher)) === voucher.address &&
      getAddress(String(vouchEvent.args.vouchee)) === author &&
      vouchEvent.args.stake === STAKE_USDC_MICROS,
    "Vouched event did not match the requested voucher, author, and stake"
  );

  const [afterVouch, afterUsdc, afterEth, afterAuthorProfile] =
    await Promise.all([
      publicClient.readContract({
        address: contract,
        abi: profileAbi,
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
      publicClient.readContract({
        address: contract,
        abi: profileAbi,
        functionName: "getProfile",
        args: [author],
      }),
    ]);

  assert(
    afterVouch.stakeUsdcMicros ===
      beforeVouch.stakeUsdcMicros + STAKE_USDC_MICROS,
    "Vouch stake did not increase by exactly 1 USDC"
  );
  assert(afterVouch.status === 0, "Vouch is not active after the write");
  assert(
    beforeUsdc - afterUsdc === STAKE_USDC_MICROS,
    "Voucher USDC delta was not exactly -1 USDC"
  );
  assert(
    beforeEth === afterEth,
    "Voucher smart-account ETH changed despite sponsored gas"
  );
  assert(
    afterAuthorProfile.totalVouchStakeReceivedUsdcMicros ===
      authorProfile.totalVouchStakeReceivedUsdcMicros + STAKE_USDC_MICROS,
    "Author backing total did not increase by exactly 1 USDC"
  );

  console.log(`voucher=${voucher.address}`);
  console.log(`author=${author}`);
  if (registrationUserOp)
    console.log(`registrationUserOp=${registrationUserOp}`);
  if (registrationTransaction)
    console.log(`registrationTransaction=${registrationTransaction}`);
  console.log(`userOp=${userOpHash}`);
  console.log(`transaction=${transactionHash}`);
  console.log(`explorer=https://sepolia.basescan.org/tx/${transactionHash}`);
  console.log(
    `voucherUsdc=${formatUnits(beforeUsdc, 6)} -> ${formatUnits(afterUsdc, 6)}`
  );
  console.log(
    `voucherEth=${formatEther(beforeEth)} -> ${formatEther(afterEth)}`
  );
  console.log(
    `vouchStake=${formatUnits(beforeVouch.stakeUsdcMicros, 6)} -> ${formatUnits(
      afterVouch.stakeUsdcMicros,
      6
    )}`
  );
  console.log("result=PASS Base Sepolia passkey vouch E2E");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
