/**
 * Gas-free UX demo for the AgentVouch Base POC.
 *
 * Drives the full core flow on Base Sepolia — register, author bond, vouch, listing,
 * purchase, voucher revenue claim, author proceeds withdrawal — where every actor is a
 * Coinbase Smart Account and a paymaster (e.g. Coinbase Developer Platform) sponsors all
 * gas. It prints each actor's ETH balance before/after (it should stay flat: the user
 * pays zero gas) and the USDC revenue split that the gasless flow produced.
 *
 * This is the live-network companion to the contract-level proof in
 * `test/gasless/AgentVouchEvm.Gasless4337.t.sol`.
 *
 * Run: `npm i && cp .env.example .env && <fill .env> && npm run demo`
 */
import "dotenv/config";
import {
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  formatEther,
  keccak256,
  stringToHex,
  encodeAbiParameters,
  parseAbiParameters,
  erc20Abi,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  createBundlerClient,
  toCoinbaseSmartAccount,
  type SmartAccount,
} from "viem/account-abstraction";
import { agentVouchAbi } from "./abi";

const DEFAULT_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia USDC
const ROLES = ["author", "voucher", "buyer"] as const;
type Role = (typeof ROLES)[number];

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(
    process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"
  ),
});

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v)
    throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

async function smartAccountFor(ownerPk: Hex): Promise<SmartAccount> {
  return toCoinbaseSmartAccount({
    client: publicClient,
    owners: [privateKeyToAccount(ownerPk)],
    version: "1.1",
  });
}

async function main() {
  // 1. Resolve persistent owner keys. Without them the smart-account addresses would
  //    change every run and you couldn't pre-fund them, so we generate a stable set,
  //    print it, and exit for you to save + fund.
  const pks: Record<Role, Hex | undefined> = {
    author: process.env.AUTHOR_OWNER_PK as Hex | undefined,
    voucher: process.env.VOUCHER_OWNER_PK as Hex | undefined,
    buyer: process.env.BUYER_OWNER_PK as Hex | undefined,
  };

  if (ROLES.some((r) => !pks[r])) {
    console.log(
      "No owner keys set. Generating a persistent set — save these to .env:\n"
    );
    for (const r of ROLES) {
      const pk = generatePrivateKey();
      const sa = await smartAccountFor(pk);
      console.log(`  ${r.toUpperCase()}_OWNER_PK=${pk}`);
      console.log(
        `    -> smart account (fund with test USDC): ${sa.address}\n`
      );
    }
    console.log(
      "Next: paste the keys into .env, fund each smart-account address above with\n" +
        ">= 10 test USDC (https://faucet.circle.com, Base Sepolia), then re-run `npm run demo`."
    );
    return;
  }

  const accounts = {
    author: await smartAccountFor(pks.author as Hex),
    voucher: await smartAccountFor(pks.voucher as Hex),
    buyer: await smartAccountFor(pks.buyer as Hex),
  } satisfies Record<Role, SmartAccount>;

  // 2. Network config.
  const cdpUrl = reqEnv("CDP_RPC_URL"); // bundler + ERC-7677 paymaster (single endpoint for CDP)
  const av = getAddress(reqEnv("AGENTVOUCH_ADDRESS"));
  const usdc = getAddress(process.env.USDC_ADDRESS || DEFAULT_USDC);

  const bundlerFor = (account: SmartAccount) =>
    createBundlerClient({
      account,
      client: publicClient,
      transport: http(cdpUrl),
      paymaster: true,
    });
  const bundlers = {
    author: bundlerFor(accounts.author),
    voucher: bundlerFor(accounts.voucher),
    buyer: bundlerFor(accounts.buyer),
  };

  // 3. Economics (must match the deployed config; USDC has 6 decimals).
  const amount = parseUnits("10", 6); // bond == stake == price == 10 USDC
  const voucherPool = (amount * 4000n) / 10_000n; // voucherShareBps = 4000
  const authorShare = amount - voucherPool;

  const usdcBalance = (a: Address) =>
    publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [a],
    });

  // 4. Funding gate: each smart account needs USDC before it can act.
  const underfunded: string[] = [];
  for (const r of ROLES) {
    const bal = await usdcBalance(accounts[r].address);
    if (bal < amount)
      underfunded.push(
        `  ${r}: ${accounts[r].address} has ${formatUnits(
          bal,
          6
        )} USDC, needs 10`
      );
  }
  if (underfunded.length) {
    console.error(
      "Underfunded smart accounts (fund via https://faucet.circle.com, Base Sepolia):\n" +
        underfunded.join("\n")
    );
    process.exitCode = 1;
    return;
  }

  // 5. Snapshot ETH (the gas-free claim: this stays flat) and USDC (the revenue split).
  const ethBefore: Record<Role, bigint> = {
    author: 0n,
    voucher: 0n,
    buyer: 0n,
  };
  const usdcBefore: Record<Role, bigint> = {
    author: 0n,
    voucher: 0n,
    buyer: 0n,
  };
  for (const r of ROLES) {
    ethBefore[r] = await publicClient.getBalance({
      address: accounts[r].address,
    });
    usdcBefore[r] = await usdcBalance(accounts[r].address);
  }

  const skillHash = keccak256(stringToHex("agentvouch-gasless-demo"));
  const listingId = keccak256(
    encodeAbiParameters(parseAbiParameters("address, bytes32"), [
      accounts.author.address,
      skillHash,
    ])
  );
  const approve = (amt: bigint) => ({
    to: usdc,
    abi: erc20Abi,
    functionName: "approve" as const,
    args: [av, amt] as const,
  });
  const call = (functionName: string, args: readonly unknown[]) => ({
    to: av,
    abi: agentVouchAbi,
    functionName,
    args,
  });

  let sponsoredWei = 0n;
  async function step(label: string, who: Role, calls: unknown[]) {
    const bundler = bundlers[who];
    const hash = await bundler.sendUserOperation({ calls: calls as never });
    const receipt = await bundler.waitForUserOperationReceipt({ hash });
    sponsoredWei += receipt.actualGasCost;
    console.log(
      `  ${label.padEnd(18)} userOp ${hash.slice(0, 10)}… ${
        receipt.success ? "OK " : "REVERTED"
      } ` + `gas sponsored: ${formatEther(receipt.actualGasCost)} ETH`
    );
    if (!receipt.success) throw new Error(`${label} reverted on-chain`);
  }

  // 6. The full gasless flow.
  console.log(
    "\nRunning gasless flow on Base Sepolia (all gas paid by the paymaster):\n"
  );
  await step("author.register", "author", [
    call("registerAgent", ["ipfs://author"]),
  ]);
  await step("voucher.register", "voucher", [
    call("registerAgent", ["ipfs://voucher"]),
  ]);
  await step("author.depositBond", "author", [
    approve(amount),
    call("depositAuthorBond", [amount]),
  ]);
  await step("voucher.vouch", "voucher", [
    approve(amount),
    call("vouch", [accounts.author.address, amount]),
  ]);
  await step("author.createListing", "author", [
    call("createSkillListing", [
      skillHash,
      "ipfs://skill",
      "Gasless Skill",
      "Demo skill",
      amount,
    ]),
  ]);
  await step("buyer.purchase", "buyer", [
    approve(amount),
    call("purchaseSkill", [listingId]),
  ]);
  await step("voucher.claim", "voucher", [
    call("claimVoucherRevenue", [accounts.author.address]),
  ]);
  await step("author.withdraw", "author", [
    call("withdrawAuthorProceeds", [listingId, 1n, authorShare]),
  ]);

  // 7. Report: prove users spent zero gas and the revenue split landed.
  console.log(
    "\nResult — user ETH balances (should be unchanged; gas was sponsored):"
  );
  for (const r of ROLES) {
    const after = await publicClient.getBalance({
      address: accounts[r].address,
    });
    const delta = after - ethBefore[r];
    console.log(
      `  ${r.padEnd(8)} ${formatEther(after)} ETH  (Δ ${formatEther(delta)})  ${
        delta === 0n ? "✓ zero gas" : ""
      }`
    );
  }
  console.log("\nResult — USDC revenue split:");
  for (const r of ROLES) {
    const after = await usdcBalance(accounts[r].address);
    console.log(
      `  ${r.padEnd(8)} ${formatUnits(after, 6)} USDC  (Δ ${formatUnits(
        after - usdcBefore[r],
        6
      )})`
    );
  }
  console.log(
    `\nExpected deltas: buyer -10 (price), voucher -6 (-10 stake +${formatUnits(
      voucherPool,
      6
    )} pool), ` +
      `author -4 (-10 bond +${formatUnits(authorShare, 6)} proceeds).`
  );
  console.log(
    `Total gas sponsored by paymaster: ${formatEther(
      sponsoredWei
    )} ETH. Users paid: 0.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
