import { getConfiguredSolanaChainContext } from "@/lib/chains";
import { AGENTVOUCH_PROGRAM_ADDRESS } from "../generated/agentvouch/src/generated/programs";

export const AGENTVOUCH_PROTOCOL_VERSION = "v0.2.0";

export function getAgentVouchProgramId(): string {
  return String(AGENTVOUCH_PROGRAM_ADDRESS);
}

export function getAgentVouchChainContext(): string {
  return getConfiguredSolanaChainContext();
}
