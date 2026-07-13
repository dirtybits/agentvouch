import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  type Address,
} from "viem";
import {
  BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_RPC_URL,
} from "@/lib/adapters/baseConfig";

const AGENTVOUCH_EVM_PROTOCOL_ABI = parseAbi([
  "function PROTOCOL_VERSION() view returns (string)",
]);

type ProtocolVersionClient = {
  getChainId(): Promise<number>;
  readContract(args: {
    address: Address;
    abi: typeof AGENTVOUCH_EVM_PROTOCOL_ABI;
    functionName: "PROTOCOL_VERSION";
  }): Promise<unknown>;
};

function createBaseProtocolVersionClient(): ProtocolVersionClient {
  return createPublicClient({
    transport: http(BASE_SEPOLIA_RPC_URL),
  });
}

export async function fetchBaseAgentVouchProtocolVersion(input: {
  contract?: Address | string;
  client?: ProtocolVersionClient;
}): Promise<string> {
  const contract = getAddress(
    input.contract ?? BASE_AGENTVOUCH_CONTRACT_ADDRESS
  );
  const client = input.client ?? createBaseProtocolVersionClient();
  const chainId = await client.getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Base protocol version reads require chain id ${BASE_SEPOLIA_CHAIN_ID}; RPC returned ${chainId}`
    );
  }

  const version = await client.readContract({
    address: contract,
    abi: AGENTVOUCH_EVM_PROTOCOL_ABI,
    functionName: "PROTOCOL_VERSION",
  });
  if (typeof version !== "string" || !version.trim()) {
    throw new Error(
      "Base AgentVouch contract returned an invalid protocol version"
    );
  }
  return version.trim();
}
