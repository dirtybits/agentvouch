/**
 * x402 agent-purchase simulation for the AgentVouch Base POC (Base Sepolia).
 *
 * Simulates an AGENT (not a human) buying a skill the agent-native way: the agent is a plain
 * EOA that signs an EIP-3009 `receiveWithAuthorization` off-chain and NEVER sends a
 * transaction (so it spends zero gas and needs no smart account). A relayer — here the
 * marketplace, played by the deployer EOA — submits the contract's Lane B
 * `purchaseWithAuthorization`, which pulls the USDC via the agent's signature and records the
 * purchase atomically (trust-minimized: no settlement authority is trusted with funds).
 *
 * This is the headless companion to the human passkey/4337 UI. It mirrors the contract proof
 * in `test/AgentVouchEvm.X402.t.sol` (Lane B), run against the live deployment.
 *
 *   Roles:
 *     - marketplace / relayer : DEPLOYER_PRIVATE_KEY (an EOA with a little ETH; pays gas)
 *     - agent / buyer         : AGENT_PK (an EOA with USDC; signs only — run `npm run fund-agent` first)
 *
 * Run: `npm run agent-x402`
 */
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  formatEther,
  keccak256,
  stringToHex,
  encodeAbiParameters,
  parseAbiParameters,
  encodePacked,
  erc20Abi,
  getAddress,
  parseSignature,
  type Hex,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { agentVouchAbi } from "./abi";

const DEFAULT_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PRICE_USDC = process.env.AGENT_PRICE_USDC || "1";

// EIP-3009 ReceiveWithAuthorization type hash. Lane B uses receiveWithAuthorization (caller-
// bound to the payee), so the agent signs THIS type — not TransferWithAuthorization (F-1).
const RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
  stringToHex(
    "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
  )
);

const rpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(rpc),
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function reqEnv(name: string, hint = ""): string {
  const v = process.env[name];
  if (!v)
    throw new Error(
      `Missing required env var ${name}${hint ? ` — ${hint}` : ""}`
    );
  return v;
}

const av = getAddress(reqEnv("AGENTVOUCH_ADDRESS"));
const usdc = getAddress(process.env.USDC_ADDRESS || DEFAULT_USDC);
const usdcBalance = (a: Address) =>
  publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [a],
  });

async function main() {
  const deployer = privateKeyToAccount(reqEnv("DEPLOYER_PRIVATE_KEY") as Hex);
  const agent = privateKeyToAccount(
    reqEnv("AGENT_PK", "run `npm run fund-agent` first") as Hex
  );
  const market = createWalletClient({
    account: deployer,
    chain: baseSepolia,
    transport: http(rpc),
  });
  const price = parseUnits(PRICE_USDC, 6);

  console.log(
    "x402 agent-purchase simulation — Lane B (trust-minimized) on Base Sepolia\n"
  );
  console.log("  marketplace / relayer (EOA, pays gas):", deployer.address);
  console.log("  agent / buyer (EOA, signs only):      ", agent.address);
  console.log("  price:", PRICE_USDC, "USDC\n");

  // Precondition: the agent EOA must hold the price in USDC.
  const agentUsdc = await usdcBalance(agent.address);
  if (agentUsdc < price) {
    console.error(
      `Agent has ${formatUnits(
        agentUsdc,
        6
      )} USDC, needs ${PRICE_USDC}. Run \`npm run fund-agent\`` +
        ` (or faucet ${agent.address} at https://faucet.circle.com).`
    );
    process.exitCode = 1;
    return;
  }

  async function send(label: string, run: () => Promise<Hex>) {
    const hash = await run();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `  ${label.padEnd(22)} ${hash.slice(0, 10)}… ${receipt.status}`
    );
    if (receipt.status !== "success") throw new Error(`${label} reverted`);
    return receipt;
  }

  // 1. Marketplace side: ensure the author is registered (idempotent), then list a fresh skill.
  console.log("Marketplace lists a skill (relayer pays gas):");
  let needRegister = true;
  try {
    await publicClient.simulateContract({
      address: av,
      abi: agentVouchAbi,
      functionName: "registerAgent",
      args: ["ipfs://agentvouch-x402-marketplace"],
      account: deployer.address,
    });
  } catch (e) {
    if (String(e).includes("AlreadyRegistered")) needRegister = false;
    else throw e;
  }
  if (needRegister) {
    await send("register author", () =>
      market.writeContract({
        address: av,
        abi: agentVouchAbi,
        functionName: "registerAgent",
        args: ["ipfs://agentvouch-x402-marketplace"],
      })
    );
  } else {
    console.log("  register author        (already registered — skipping)");
  }

  // Unique skill per run so the agent can re-buy (a listing is unique per author+skill, and a
  // purchase is unique per buyer+listing+revision).
  const skillId = `agent-x402-${Date.now()}`;
  const skillHash = keccak256(stringToHex(skillId));
  const listingId = keccak256(
    encodeAbiParameters(parseAbiParameters("address, bytes32"), [
      deployer.address,
      skillHash,
    ])
  );
  await send("list skill", () =>
    market.writeContract({
      address: av,
      abi: agentVouchAbi,
      functionName: "createSkillListing",
      args: [
        skillHash,
        `ipfs://skill/${skillId}`,
        "Agent x402 Skill",
        "Purchased by an agent via x402 / EIP-3009",
        price,
      ],
    })
  );
  console.log("  listingId:", listingId, "\n");

  // 2. Agent side: sign an EIP-3009 authorization OFF-CHAIN. No tx, no gas, no smart account.
  //    The nonce is bound to (buyer, listingId, revision, price) so a relayer can't redirect it.
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, bytes32, uint64, uint256"),
      [agent.address, listingId, 1n, price]
    )
  );
  const domainSeparator = await publicClient.readContract({
    address: usdc,
    abi: [
      {
        type: "function",
        name: "DOMAIN_SEPARATOR",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "bytes32" }],
      },
    ],
    functionName: "DOMAIN_SEPARATOR",
  });
  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32, address, address, uint256, uint256, uint256, bytes32"
      ),
      [
        RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
        agent.address,
        av,
        price,
        validAfter,
        validBefore,
        nonce,
      ]
    )
  );
  const digest = keccak256(
    encodePacked(
      ["bytes2", "bytes32", "bytes32"],
      ["0x1901", domainSeparator, structHash]
    )
  );
  const signature = await agent.sign({ hash: digest });
  const sig = parseSignature(signature);
  const v = sig.v !== undefined ? Number(sig.v) : (sig.yParity as number) + 27;

  console.log("Agent signs the x402 payment off-chain (zero gas, no tx):");
  console.log("  EIP-3009 receiveWithAuthorization signed by", agent.address);
  console.log("  nonce bound to (buyer, listingId, revision=1, price)\n");

  // 3. Relayer submits Lane B; the contract pulls USDC via the signature + records the purchase.
  console.log("Relayer submits purchaseWithAuthorization (relayer pays gas):");
  // Simulate first to surface any revert reason. The public Base Sepolia RPC is
  // load-balanced and lags on read-after-write, so a freshly-created listing can briefly
  // read as ListingNotFound on a stale node — retry the simulate until it propagates.
  const purchaseArgs = [
    listingId,
    agent.address,
    validAfter,
    validBefore,
    v,
    sig.r,
    sig.s,
  ] as const;
  for (let attempt = 1; ; attempt++) {
    try {
      await publicClient.simulateContract({
        address: av,
        abi: agentVouchAbi,
        functionName: "purchaseWithAuthorization",
        args: purchaseArgs,
        account: deployer.address,
      });
      break;
    } catch (e) {
      const msg = String(e); // full message; the error name lives below the short line
      const transient =
        msg.includes("ListingNotFound") || msg.includes("0x7e43e638");
      if (transient && attempt < 15) {
        if (attempt === 1)
          console.log(
            "  (waiting for the listing to propagate on the public RPC…)"
          );
        await sleep(1500);
        continue;
      }
      throw e;
    }
  }
  // Send with an explicit gas limit so this write doesn't re-estimate against a lagging node.
  const receipt = await send("relay purchase", () =>
    market.writeContract({
      address: av,
      abi: agentVouchAbi,
      functionName: "purchaseWithAuthorization",
      args: purchaseArgs,
      gas: 500_000n,
    })
  );

  // 4. Report exact deltas around the settlement block. Historical reads are deterministic,
  //    so the numbers are immune to any read-after-write lag.
  const block = receipt.blockNumber;
  for (let i = 0; i < 20; i++) {
    if ((await publicClient.getBlockNumber()) >= block) break;
    await sleep(1000);
  }
  const usdcAt = (a: Address, bn: bigint) =>
    publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [a],
      blockNumber: bn,
    });
  const ethAt = (a: Address, bn: bigint) =>
    publicClient.getBalance({ address: a, blockNumber: bn });
  const [agentEthBefore, agentEthAfter] = await Promise.all([
    ethAt(agent.address, block - 1n),
    ethAt(agent.address, block),
  ]);
  const [agentUsdcBefore, agentUsdcAfter] = await Promise.all([
    usdcAt(agent.address, block - 1n),
    usdcAt(agent.address, block),
  ]);
  const [contractUsdcBefore, contractUsdcAfter] = await Promise.all([
    usdcAt(av, block - 1n),
    usdcAt(av, block),
  ]);

  console.log("\nResult:");
  console.log(
    `  agent ETH:     ${formatEther(agentEthBefore)} -> ${formatEther(
      agentEthAfter
    )}` +
      `  (Δ ${formatEther(agentEthAfter - agentEthBefore)})  ${
        agentEthAfter === agentEthBefore ? "✓ agent paid 0 gas" : ""
      }`
  );
  console.log(
    `  agent USDC:    ${formatUnits(agentUsdcBefore, 6)} -> ${formatUnits(
      agentUsdcAfter,
      6
    )}` +
      `  (Δ ${formatUnits(
        agentUsdcAfter - agentUsdcBefore,
        6
      )})  ✓ paid the price`
  );
  console.log(
    `  contract USDC: ${formatUnits(contractUsdcBefore, 6)} -> ${formatUnits(
      contractUsdcAfter,
      6
    )}` +
      `  (Δ +${formatUnits(
        contractUsdcAfter - contractUsdcBefore,
        6
      )})  (author proceeds + any voucher pool)`
  );
  console.log(
    `  settlement tx (relayer's gas): https://sepolia.basescan.org/tx/${receipt.transactionHash}`
  );
  console.log(
    "\nThe agent only signed — it sent no transaction and held no ETH. That is the x402 /"
  );
  console.log(
    "EIP-3009 property: the buyer authorizes a USDC pull, a relayer settles it on-chain."
  );
}

main().catch((err) => {
  const e = err as {
    shortMessage?: string;
    message?: string;
    metaMessages?: string[];
  };
  console.error("\nFAILED:", e.shortMessage || e.message || String(err));
  if (e.metaMessages?.length) console.error(e.metaMessages.join("\n"));
  process.exitCode = 1;
});
