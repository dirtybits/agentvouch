import { address, type TransactionSigner } from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  getCreateSkillListingInstructionAsync,
  getRevokeVouchInstructionAsync,
  getVouchInstructionAsync,
} from "@/generated/agentvouch/src/generated";
import {
  buildTransactionSendRequest,
  getConnectedAuthorAddress,
  getBondConfigClusterGuardError,
  getOpenAuthorDisputeClusterGuardError,
  getRegisterAgentClusterGuardError,
  getResolveAuthorDisputeClusterGuardError,
  getSkillListingClusterGuardError,
  getStakeClusterGuardError,
  normalizeInstructionForSend,
  resolveSkillListingAccounts,
} from "@/hooks/useReputationOracle";

const VOUCHER_ADDRESS = address("asuavUDGmrVHr4oD1b4QtnnXgtnEcBa8qdkfZz7WZgw");
const VOUCHEE_PROFILE = address("Es9vMFrzaCERmJfrN7kYMva9n32CuWHa3gwxMZ2y1k4f");
const USDC_MINT = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const VOUCHER_USDC_ACCOUNT = address(
  "2D5GQFYq2N75Y1AiMj8v4mLbo1g9kG2BvvJ252PW4U7N"
);
const VOUCH_VAULT = address("RHpPztPq8fCHhyjWAJfUWaiWsjGQtih5Vm8gCL3H6ma");

function createMockSigner(): TransactionSigner {
  return {
    address: VOUCHER_ADDRESS,
    signTransactions: async (transactions) => transactions,
  } as TransactionSigner;
}

function collectSignerRefs(
  request: ReturnType<typeof buildTransactionSendRequest>
) {
  const instructionSigners = request.instructions[0].accounts
    .map((account) => ("signer" in account ? account.signer : undefined))
    .filter(Boolean);

  return [request.authority, ...instructionSigners];
}

describe("useReputationOracle send helpers", () => {
  it("preserves signer metadata when normalizing a vouch instruction", async () => {
    const signer = createMockSigner();
    const ix = await getVouchInstructionAsync({
      voucheeProfile: VOUCHEE_PROFILE,
      voucher: signer,
      usdcMint: USDC_MINT,
      voucherUsdcAccount: VOUCHER_USDC_ACCOUNT,
      stakeUsdcMicros: 1_000_000n,
    });

    const normalizedIx = normalizeInstructionForSend(ix);
    const voucherAccount = normalizedIx.accounts[8];

    expect(voucherAccount.address).toBe(VOUCHER_ADDRESS);
    expect("signer" in voucherAccount && voucherAccount.signer).toBe(signer);
    expect(voucherAccount).not.toBe(ix.accounts[4]);
  });

  it("uses the same signer instance for vouch instruction and send authority", async () => {
    const signer = createMockSigner();
    const ix = await getVouchInstructionAsync({
      voucheeProfile: VOUCHEE_PROFILE,
      voucher: signer,
      usdcMint: USDC_MINT,
      voucherUsdcAccount: VOUCHER_USDC_ACCOUNT,
      stakeUsdcMicros: 2_000_000n,
    });

    const request = buildTransactionSendRequest(ix, signer);
    const signers = collectSignerRefs(request);

    expect(signers).toHaveLength(2);
    expect(new Set(signers).size).toBe(1);
    expect(request.authority).toBe(signer);
  });

  it("uses the same signer instance for revoke instruction and send authority", async () => {
    const signer = createMockSigner();
    const ix = await getRevokeVouchInstructionAsync({
      voucheeProfile: VOUCHEE_PROFILE,
      voucher: signer,
      usdcMint: USDC_MINT,
      vouchVault: VOUCH_VAULT,
      voucherUsdcAccount: VOUCHER_USDC_ACCOUNT,
    });

    const request = buildTransactionSendRequest(ix, signer);
    const signers = collectSignerRefs(request);

    expect(signers).toHaveLength(2);
    expect(new Set(signers).size).toBe(1);
    expect(request.authority).toBe(signer);
  });

  it("derives create skill listing accounts from the signer address", async () => {
    const signer = createMockSigner();
    const authorAddress = getConnectedAuthorAddress(VOUCHER_ADDRESS, signer);
    const { authorProfile, skillListing } = await resolveSkillListingAccounts(
      authorAddress,
      "frontenddesign"
    );
    const ix = await getCreateSkillListingInstructionAsync({
      skillListing,
      authorProfile,
      author: signer,
      usdcMint: USDC_MINT,
      skillId: "frontenddesign",
      skillUri: "https://agentvouch.xyz/api/skills/test/raw",
      name: "Frontend Design",
      description: "A test skill listing",
      priceUsdcMicros: 1_000_000n,
    });
    const normalizedIx = normalizeInstructionForSend(ix);

    expect(normalizedIx.accounts[0].address).toBe(skillListing);
    expect(normalizedIx.accounts[1].address).toBe(authorProfile);
    expect(normalizedIx.accounts[10].address).toBe(VOUCHER_ADDRESS);
  });

  it("rejects mismatched wallet and signer addresses before listing creation", () => {
    const signer = createMockSigner();

    expect(() => getConnectedAuthorAddress(VOUCHEE_PROFILE, signer)).toThrow(
      /does not match transaction signer/i
    );
  });

  it("reports a configured-network balance mismatch before sending a vouch", () => {
    const error = getStakeClusterGuardError({
      action: "vouch",
      walletAddress: VOUCHER_ADDRESS,
      voucheeProfileExists: true,
      walletUsdcBalanceMicros: 0n,
      hasUsdcAccount: true,
      requiredUsdcMicros: 1_000_000n,
      configuredChainLabel: "Solana Devnet",
      configuredRpcTarget: "devnet",
    });

    expect(error).toContain("configured Solana Devnet (devnet RPC)");
    expect(error).toContain("This vouch needs 1.00 USDC");
  });

  it("reports a missing live vouch on the configured network before revoke", () => {
    const error = getStakeClusterGuardError({
      action: "revoke",
      walletAddress: VOUCHER_ADDRESS,
      voucheeProfileExists: true,
      hasLiveVouch: false,
      configuredChainLabel: "Solana",
      configuredRpcTarget: "mainnet",
    });

    expect(error).toContain("No live vouch for this author was found");
    expect(error).toContain("configured Solana (mainnet RPC)");
    expect(error).toContain("switch Phantom and the app to the same cluster");
  });

  it("does not block when the configured network state is coherent", () => {
    const error = getStakeClusterGuardError({
      action: "vouch",
      walletAddress: VOUCHER_ADDRESS,
      voucheeProfileExists: true,
      walletBalanceLamports: 2_000_000_000n,
      requiredLamports: 1_000_000_000n,
      configuredChainLabel: "Solana Devnet",
      configuredRpcTarget: "devnet",
    });

    expect(error).toBeNull();
  });

  it("reports when agent registration already exists on the configured network", () => {
    const error = getRegisterAgentClusterGuardError({
      walletAddress: VOUCHER_ADDRESS,
      programExists: true,
      profileExists: true,
      walletBalanceLamports: 2_000_000_000n,
      requiredLamports: 2_500_000n,
      configuredChainLabel: "Solana Devnet",
      configuredRpcTarget: "devnet",
    });

    expect(error).toContain("already exists");
    expect(error).toContain("configured Solana Devnet (devnet RPC)");
  });

  it("reports when agent registration does not have enough SOL for rent", () => {
    const error = getRegisterAgentClusterGuardError({
      walletAddress: VOUCHER_ADDRESS,
      programExists: true,
      profileExists: false,
      walletBalanceLamports: 100_000n,
      requiredLamports: 2_500_000n,
      configuredChainLabel: "Solana Devnet",
      configuredRpcTarget: "devnet",
    });

    expect(error).toContain("has 0.0001 SOL");
    expect(error).toContain("Registering needs about 0.0025 SOL");
    expect(error).toContain("configured Solana Devnet (devnet RPC)");
  });

  it("does not block registration when profile is missing and balance is enough", () => {
    const error = getRegisterAgentClusterGuardError({
      walletAddress: VOUCHER_ADDRESS,
      programExists: true,
      profileExists: false,
      walletBalanceLamports: 3_000_000n,
      requiredLamports: 2_500_000n,
      configuredChainLabel: "Solana Devnet",
      configuredRpcTarget: "devnet",
    });

    expect(error).toBeNull();
  });

  it("does not block author bond actions when config data has trailing allocation bytes", () => {
    const error = getBondConfigClusterGuardError({
      configExists: true,
      configReadable: true,
      configDataLength: 465,
      expectedConfigDataLength: 457,
      configuredChainLabel: "Solana Devnet",
      configuredRpcTarget: "devnet",
    });

    expect(error).toBeNull();
  });

  it("reports undersized author bond config accounts as stale", () => {
    const error = getBondConfigClusterGuardError({
      configExists: true,
      configReadable: false,
      configDataLength: 449,
      expectedConfigDataLength: 457,
      configuredChainLabel: "Solana Devnet",
      configuredRpcTarget: "devnet",
    });

    expect(error).toContain("at least 457");
    expect(error).toContain("configured Solana Devnet (devnet RPC)");
  });

  it("reports when the AgentVouch program is not deployed", () => {
    const error = getRegisterAgentClusterGuardError({
      walletAddress: VOUCHER_ADDRESS,
      programExists: false,
      profileExists: false,
      walletBalanceLamports: 3_000_000n,
      requiredLamports: 2_500_000n,
      configuredChainLabel: "Solana Devnet",
      configuredRpcTarget: "devnet",
    });

    expect(error).toContain("AgentVouch program");
    expect(error).toContain("is not deployed");
    expect(error).toContain("configured Solana Devnet (devnet RPC)");
  });

  it("reports when creating a listing without a profile on the configured network", () => {
    const error = getSkillListingClusterGuardError({
      mode: "create",
      authorProfileExists: false,
      listingExists: false,
      skillId: "frontenddesign",
      configuredChainLabel: "Solana",
      configuredRpcTarget: "mainnet",
    });

    expect(error).toContain("not registered");
    expect(error).toContain("configured Solana (mainnet RPC)");
  });

  it("reports when updating a listing that does not exist on the configured network", () => {
    const error = getSkillListingClusterGuardError({
      mode: "update",
      authorProfileExists: true,
      listingExists: false,
      skillId: "frontenddesign",
      configuredChainLabel: "Solana Devnet",
      configuredRpcTarget: "devnet",
    });

    expect(error).toContain('Skill listing "frontenddesign" was not found');
    expect(error).toContain("configured Solana Devnet (devnet RPC)");
  });

  it("reports author dispute references that only exist on another network", () => {
    const error = getOpenAuthorDisputeClusterGuardError({
      walletAddress: VOUCHER_ADDRESS,
      authorProfileExists: true,
      disputeId: 7n,
      disputeExists: false,
      skillListingProvided: true,
      skillListingExists: false,
      skillListingMatchesAuthor: true,
      purchaseProvided: false,
      purchaseExists: false,
      purchaseMatchesSkillListing: true,
      walletBalanceLamports: 2_000_000_000n,
      disputeBondLamports: 500_000_000n,
      configuredChainLabel: "Solana",
      configuredRpcTarget: "mainnet",
    });

    expect(error).toContain("referenced skill listing was not found");
    expect(error).toContain("configured Solana (mainnet RPC)");
  });

  it("reports resolver mismatch on the configured network", () => {
    const error = getResolveAuthorDisputeClusterGuardError({
      walletAddress: VOUCHER_ADDRESS,
      authorProfileExists: true,
      disputeId: 42n,
      disputeExists: true,
      disputeOpen: true,
      resolverAuthorized: false,
      configuredChainLabel: "Solana Devnet",
      configuredRpcTarget: "devnet",
    });

    expect(error).toContain("not the configured resolver");
    expect(error).toContain("configured Solana Devnet (devnet RPC)");
  });
});
