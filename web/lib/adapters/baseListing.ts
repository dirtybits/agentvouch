import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

export type BaseLinkedSkill = {
  currency_mint?: string | null;
  evm_contract_address?: string | null;
  on_chain_program_id?: string | null;
};

export function requireBaseEvmAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label} is not a valid EVM address`);
  }
  return getAddress(value);
}

export function requireBaseBytes32(value: string, label: string): Hex {
  if (!BYTES32_RE.test(value)) {
    throw new Error(`${label} must be a 32-byte hex value`);
  }
  return value as Hex;
}

export function skillIdHashFrom(skillId: string): Hex {
  return keccak256(stringToHex(skillId));
}

export function computeListingId(author: Address, skillIdHash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("address, bytes32"), [
      author,
      skillIdHash,
    ])
  );
}

export function getExpectedBaseContract(input: {
  skill: BaseLinkedSkill;
  configuredContract: string;
}): Address {
  const configured = requireBaseEvmAddress(
    input.configuredContract,
    "Base AgentVouch contract address"
  );
  const linked = input.skill.evm_contract_address
    ? requireBaseEvmAddress(
        input.skill.evm_contract_address,
        "Skill Base contract"
      )
    : input.skill.on_chain_program_id?.startsWith("0x")
    ? requireBaseEvmAddress(
        input.skill.on_chain_program_id,
        "Skill Base contract"
      )
    : null;

  if (linked && linked !== configured) {
    throw new Error("Skill is linked to an unsupported Base contract");
  }

  return linked ?? configured;
}

export function getExpectedBaseCurrency(input: {
  skill: BaseLinkedSkill;
  configuredUsdc: string;
  nativeUsdc: string;
  usage: "listings" | "purchases" | "x402";
}): Address {
  const nativeUsdc = requireBaseEvmAddress(
    input.nativeUsdc,
    "Base native USDC address"
  );
  const configuredUsdc = requireBaseEvmAddress(
    input.configuredUsdc,
    "Base USDC address"
  );
  if (configuredUsdc !== nativeUsdc) {
    throw new Error(`Base ${input.usage} require native Circle USDC`);
  }

  const skillCurrency = input.skill.currency_mint
    ? requireBaseEvmAddress(input.skill.currency_mint, "Skill USDC address")
    : nativeUsdc;
  if (skillCurrency !== nativeUsdc) {
    throw new Error("Skill is linked to an unsupported Base USDC asset");
  }

  return skillCurrency;
}
