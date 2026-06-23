import type { Role } from "./types";

// SPIKE PENDING — see .agents/plans/base-poc-spike-v3.plan.md (todo: spike-7702-metamask).
//
// Intended flow once the spike confirms the signing path:
//   1. Connect the MetaMask EOA (window.ethereum / EIP-1193).
//   2. walletClient.signAuthorization(...) delegating the EOA to a 4337-compatible
//      implementation on Base Sepolia (EIP-7702 set-code).
//   3. Drive OUR CDP bundler/paymaster: sendUserOperation with the `authorization`
//      (plus factory/factoryData overrides) so the EOA's UserOps are sponsored.
//
// Open question the spike answers: does MetaMask expose dapp-initiated authorization
// signing AND let us drive our own bundler, or does it force its Smart Accounts toolkit?
// Until then this connector is disabled in the UI; use Local key or Passkey.
export async function createMetaMask7702Account(_role: Role): Promise<never> {
  throw new Error(
    "MetaMask + EIP-7702 connector is pending the 7702 spike. Use Local key or Passkey for now.",
  );
}
