import { beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import {
  BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  BASE_NATIVE_USDC_ADDRESS,
} from "@/lib/adapters/baseConfig";
import { computeListingId, skillIdHashFrom } from "@/lib/adapters/baseListing";
import {
  type BaseSkillListingRow,
  verifyBaseSkillListing,
} from "@/lib/baseListingVerification";

const viemMocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
}));

const protocolMocks = vi.hoisted(() => ({
  fetchBaseAgentVouchProtocolVersion: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: viemMocks.createPublicClient,
  };
});

vi.mock("@/lib/baseProtocolVersion", () => protocolMocks);

const AUTHOR = "0x1111111111111111111111111111111111111111";
const SKILL_ID = "base-provenance-test";
const SKILL_DB_ID = "11111111-1111-1111-1111-111111111111";
const SKILL_NAME = "Base Provenance Test";
const SKILL_DESCRIPTION = "Exercises Base listing verification provenance";
const RAW_URI = `https://agentvouch.xyz/api/skills/${SKILL_DB_ID}/raw`;
const PRICE_MICROS = "1000000";
const SKILL_ID_HASH = skillIdHashFrom(SKILL_ID);
const LISTING_ID = computeListingId(AUTHOR, SKILL_ID_HASH);

function baseSkill(protocolVersion: string | null = null): BaseSkillListingRow {
  return {
    id: SKILL_DB_ID,
    skill_id: SKILL_ID,
    author_pubkey: AUTHOR,
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    price_usdc_micros: PRICE_MICROS,
    currency_mint: BASE_NATIVE_USDC_ADDRESS,
    chain_context: BASE_SEPOLIA_CHAIN_CONTEXT,
    on_chain_protocol_version: protocolVersion,
    on_chain_program_id: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
    evm_listing_id: LISTING_ID,
    evm_contract_address: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
  };
}

function mockListingClient() {
  const client = {
    getChainId: vi.fn().mockResolvedValue(84532),
    readContract: vi.fn().mockResolvedValue({
      author: AUTHOR,
      skillIdHash: SKILL_ID_HASH,
      uri: RAW_URI,
      name: SKILL_NAME,
      description: SKILL_DESCRIPTION,
      priceUsdcMicros: BigInt(PRICE_MICROS),
      currentRevision: 3n,
      totalDownloads: 0n,
      totalRevenueUsdcMicros: 0n,
      status: 0,
      lockedByDispute: false,
      exists: true,
    }),
  };
  viemMocks.createPublicClient.mockReturnValue(client);
  return client;
}

describe("verifyBaseSkillListing protocol provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    protocolMocks.fetchBaseAgentVouchProtocolVersion.mockResolvedValue(
      "base-v1-candidate"
    );
  });

  it("reads live contract protocol version when the DB row has no stored version", async () => {
    mockListingClient();

    const result = await verifyBaseSkillListing({
      skill: baseSkill(null),
      expectedUri: RAW_URI,
    });

    expect(result.protocolVersion).toBe("base-v1-candidate");
    expect(
      protocolMocks.fetchBaseAgentVouchProtocolVersion
    ).toHaveBeenCalledWith({
      contract: BASE_AGENTVOUCH_CONTRACT_ADDRESS,
    });
  });

  it("preserves stored protocol version without a live protocol read", async () => {
    mockListingClient();

    const result = await verifyBaseSkillListing({
      skill: baseSkill("base-poc-v0"),
      expectedUri: RAW_URI,
    });

    expect(result.protocolVersion).toBe("base-poc-v0");
    expect(
      protocolMocks.fetchBaseAgentVouchProtocolVersion
    ).not.toHaveBeenCalled();
  });
});
