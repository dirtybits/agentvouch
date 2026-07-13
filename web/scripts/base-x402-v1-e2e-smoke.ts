import { neon } from "@neondatabase/serverless";
import { existsSync, readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodePacked,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseSignature,
  stringToHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

loadEnvFile("web/.env.local");
loadEnvFile(
  process.env.AGENTVOUCH_HARNESS_ENV ?? "contracts/base-poc/harness/.env"
);

const ORIGIN = process.env.AGENTVOUCH_SMOKE_ORIGIN ?? "http://localhost:3003";
const PRICE = 1_000_000n;
const USDC = getAddress(
  process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS ??
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
);
const CONTRACT = getAddress(requireEnv("NEXT_PUBLIC_BASE_AGENTVOUCH_ADDRESS"));
const AUTHOR_KEY = requireEnv("DEPLOYER_PRIVATE_KEY") as Hex;
const AGENT_KEY = requireEnv("AGENT_PK") as Hex;
const RPC =
  process.env.BASE_SEPOLIA_RPC_URL ??
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ??
  "https://base-sepolia-rpc.publicnode.com";
const DATABASE_URL = requireEnv("DATABASE_URL");
const RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
  stringToHex(
    "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
  )
);
const AV_ABI = parseAbi([
  "function createSkillListing(bytes32 skillIdHash, string uri, string name, string description, uint256 priceUsdcMicros) returns (bytes32)",
  "function PROTOCOL_VERSION() view returns (string)",
]);
const USDC_ABI = parseAbi([
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function parseJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Expected JSON (${response.status}): ${text.slice(0, 600)}`
    );
  }
}

function publisherAuth(
  account: ReturnType<typeof privateKeyToAccount>,
  action: string,
  skillId?: string
) {
  const timestamp = Date.now();
  const message = skillId
    ? `AgentVouch Skill Repo\nAction: ${action}\nSkill id: ${skillId}\nTimestamp: ${timestamp}`
    : `AgentVouch Skill Repo\nAction: ${action}\nTimestamp: ${timestamp}`;
  return account.signMessage({ message }).then((signature) => ({
    pubkey: account.address,
    signature,
    message,
    timestamp,
  }));
}

async function main() {
  const author = privateKeyToAccount(AUTHOR_KEY);
  const agent = privateKeyToAccount(AGENT_KEY);
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC),
  });
  const authorClient = createWalletClient({
    account: author,
    chain: baseSepolia,
    transport: http(RPC),
  });
  const db = neon(DATABASE_URL);

  const [capabilityResponse, protocolVersion] = await Promise.all([
    fetch(`${ORIGIN}/api/x402/supported`),
    publicClient.readContract({
      address: CONTRACT,
      abi: AV_ABI,
      functionName: "PROTOCOL_VERSION",
    }),
  ]);
  assert(capabilityResponse.ok, "Local x402 capability endpoint failed");
  const capability = await parseJson(capabilityResponse);
  const base = capability.base as Record<string, unknown>;
  assert(
    base.chain_context === "eip155:84532",
    "Local server is not advertising Base Sepolia"
  );
  assert(
    String(base.contract).toLowerCase() === CONTRACT.toLowerCase(),
    "Local server does not point to the v1 candidate"
  );
  assert(
    protocolVersion === "base-v1-candidate",
    "Unexpected Base protocol version"
  );

  const marker = `base-x402-v1-e2e-${Date.now()}`;
  const content = `# Base x402 v1 E2E smoke\n\nFixture: ${marker}\n`;
  const createResponse = await fetch(`${ORIGIN}/api/skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth: await publisherAuth(author, "publish-skill"),
      skill_id: marker,
      name: "Base x402 v1 E2E smoke",
      description: "DB-linked Base Sepolia x402 test fixture",
      tags: ["base-sepolia", "x402", "smoke"],
      content,
      chain_context: "eip155:84532",
      price_usdc_micros: PRICE.toString(),
    }),
  });
  const created = await parseJson(createResponse);
  assert(
    createResponse.status === 201,
    `Skill creation failed: ${JSON.stringify(created)}`
  );
  const skillDbId = String(created.id);
  assert(/^[0-9a-f-]{36}$/i.test(skillDbId), "Skill creation returned no UUID");

  const skillIdHash = keccak256(stringToHex(marker));
  const listingTx = await authorClient.writeContract({
    address: CONTRACT,
    abi: AV_ABI,
    functionName: "createSkillListing",
    args: [
      skillIdHash,
      `${ORIGIN}/api/skills/${skillDbId}/raw`,
      "Base x402 v1 E2E smoke",
      "DB-linked Base Sepolia x402 test fixture",
      PRICE,
    ],
  });
  const listingReceipt = await publicClient.waitForTransactionReceipt({
    hash: listingTx,
  });
  assert(
    listingReceipt.status === "success",
    "On-chain listing creation reverted"
  );

  let linked: Record<string, unknown> | null = null;
  let linkFailure = "";
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    const linkResponse = await fetch(`${ORIGIN}/api/skills/${skillDbId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: await publisherAuth(author, "link-base-listing", skillDbId),
        baseListing: {
          mode: "create",
          txHash: listingTx,
          authorAddress: author.address,
          chainContext: "eip155:84532",
          expectedPriceUsdcMicros: PRICE.toString(),
        },
      }),
    });
    const body = await parseJson(linkResponse);
    if (linkResponse.ok) {
      linked = body;
      break;
    }
    linkFailure = `${linkResponse.status}: ${JSON.stringify(body)}`;
    await sleep(1_500);
  }
  assert(
    linked,
    `Could not link Base listing after RPC propagation: ${linkFailure}`
  );
  const listingId = String(linked.evm_listing_id) as Hex;
  assert(
    /^0x[0-9a-f]{64}$/i.test(listingId),
    "Linked skill has no EVM listing id"
  );
  assert(
    String(linked.evm_contract_address).toLowerCase() ===
      CONTRACT.toLowerCase(),
    "Linked skill contract is not v1"
  );

  const rawUrl = `${ORIGIN}/api/skills/${skillDbId}/raw`;
  const requiredResponse = await fetch(rawUrl);
  const required = await parseJson(requiredResponse);
  assert(
    requiredResponse.status === 402,
    "Unsigned raw access did not require payment"
  );
  const accepts = required.accepts as Array<Record<string, unknown>>;
  assert(
    Array.isArray(accepts) && accepts.length === 1,
    "Missing x402 payment requirement"
  );
  const requirement = accepts[0];
  assert(
    requirement.network === "eip155:84532",
    "x402 requirement network mismatch"
  );
  assert(
    requirement.amount === PRICE.toString(),
    "x402 requirement price mismatch"
  );
  assert(
    String(requirement.payTo).toLowerCase() === CONTRACT.toLowerCase(),
    "x402 payTo mismatch"
  );
  const requirementExtra = requirement.extra as Record<string, unknown>;
  assert(
    String(requirementExtra.agentvouch_listing_id).toLowerCase() ===
      listingId.toLowerCase(),
    "x402 requirement listing mismatch"
  );

  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 1_200);
  const revision = BigInt(requirementExtra.listing_revision as string);
  const nonce = keccak256(
    encodeAbiParameters(parseAbiParameters("address,bytes32,uint64,uint256"), [
      agent.address,
      listingId,
      revision,
      PRICE,
    ])
  );
  const domainSeparator = await publicClient.readContract({
    address: USDC,
    abi: USDC_ABI,
    functionName: "DOMAIN_SEPARATOR",
  });
  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32,address,address,uint256,uint256,uint256,bytes32"
      ),
      [
        RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
        agent.address,
        CONTRACT,
        PRICE,
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
  const eip3009Signature = parseSignature(await agent.sign({ hash: digest }));
  const paymentPayload = {
    x402Version: 2,
    resource: required.resource,
    accepted: requirement,
    payload: {
      buyer: agent.address,
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
      signature: `0x${eip3009Signature.r.slice(2)}${eip3009Signature.s.slice(
        2
      )}${(eip3009Signature.v ?? Number(eip3009Signature.yParity) + 27)
        .toString(16)
        .padStart(2, "0")}`,
    },
  };
  const paymentHeader = Buffer.from(
    JSON.stringify(paymentPayload),
    "utf8"
  ).toString("base64");
  const paidResponse = await fetch(rawUrl, {
    headers: { "PAYMENT-SIGNATURE": paymentHeader },
  });
  const paidContent = await paidResponse.text();
  assert(paidResponse.status === 200, `Paid raw access failed: ${paidContent}`);
  assert(
    paidContent === content,
    "Paid raw content does not match the stored skill"
  );
  const paymentResponse = paidResponse.headers.get("payment-response");
  assert(paymentResponse, "Paid raw response lacks PAYMENT-RESPONSE");
  const paymentResult = JSON.parse(
    Buffer.from(paymentResponse, "base64").toString("utf8")
  ) as Record<string, unknown>;
  const paymentExtensions = paymentResult.extensions as Record<string, unknown>;
  const purchaseId = String(paymentExtensions.evm_purchase_id) as Hex;
  assert(
    /^0x[0-9a-f]{64}$/i.test(purchaseId),
    "Payment response has no EVM purchase id"
  );

  const duplicateResponse = await fetch(rawUrl, {
    headers: { "PAYMENT-SIGNATURE": paymentHeader },
  });
  const duplicateContent = await duplicateResponse.text();
  assert(
    duplicateResponse.status === 200,
    "Duplicate x402 retry did not return existing access"
  );
  assert(
    duplicateContent === content,
    "Duplicate x402 retry returned wrong content"
  );

  const downloadTimestamp = Date.now();
  const downloadMessage = `AgentVouch Skill Download\nAction: download-raw\nSkill id: ${skillDbId}\nListing: ${listingId}\nTimestamp: ${downloadTimestamp}`;
  const signedDownload = {
    pubkey: agent.address,
    signature: await agent.signMessage({ message: downloadMessage }),
    message: downloadMessage,
    timestamp: downloadTimestamp,
  };
  const redownloadResponse = await fetch(rawUrl, {
    headers: { "X-AgentVouch-Auth": JSON.stringify(signedDownload) },
  });
  const redownloadContent = await redownloadResponse.text();
  assert(
    redownloadResponse.status === 200,
    `Signed re-download failed: ${redownloadContent}`
  );
  assert(
    redownloadContent === content,
    "Signed re-download returned wrong content"
  );

  const receipts = await db`
    SELECT
      buyer_chain_context,
      buyer_address,
      amount_micros::text,
      payment_flow,
      protocol_version,
      evm_listing_id,
      evm_purchase_id,
      listing_revision::text
    FROM usdc_purchase_receipts
    WHERE skill_db_id = ${skillDbId}::uuid
    ORDER BY created_at ASC
  `;
  const entitlements = await db`
    SELECT
      buyer_chain_context,
      buyer_address,
      amount_micros::text,
      payment_flow,
      protocol_version,
      evm_listing_id,
      evm_purchase_id,
      listing_revision::text
    FROM usdc_purchase_entitlements
    WHERE skill_db_id = ${skillDbId}::uuid
  `;
  assert(
    receipts.length === 1,
    `Expected one receipt, found ${receipts.length}`
  );
  assert(
    entitlements.length === 1,
    `Expected one entitlement, found ${entitlements.length}`
  );
  for (const row of [...receipts, ...entitlements]) {
    assert(
      row.buyer_chain_context === "eip155:84532",
      "Persisted buyer chain mismatch"
    );
    assert(
      row.buyer_address === agent.address.toLowerCase(),
      "Persisted buyer address mismatch"
    );
    assert(row.amount_micros === PRICE.toString(), "Persisted amount mismatch");
    assert(
      row.payment_flow === "base-x402-purchase-skill",
      "Persisted payment flow mismatch"
    );
    assert(
      row.protocol_version === "base-v1-candidate",
      "Persisted protocol version mismatch"
    );
    assert(
      String(row.evm_listing_id).toLowerCase() === listingId.toLowerCase(),
      "Persisted listing mismatch"
    );
    assert(
      String(row.evm_purchase_id).toLowerCase() === purchaseId.toLowerCase(),
      "Persisted purchase mismatch"
    );
    assert(
      row.listing_revision === revision.toString(),
      "Persisted listing revision mismatch"
    );
  }

  console.log(`skillDbId=${skillDbId}`);
  console.log(`listingTx=${listingTx}`);
  console.log(`listingId=${listingId}`);
  console.log(`settlementTx=${paymentResult.transaction}`);
  console.log(`purchaseId=${purchaseId}`);
  console.log(
    `receiptCount=${receipts.length} entitlementCount=${entitlements.length}`
  );
  console.log("result=PASS DB-linked Base v1 x402 raw-to-entitlement flow");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
