import { AGENTVOUCH_PROGRAM_ID } from "@agentvouch/protocol";
import anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type Commitment,
} from "@solana/web3.js";
import agentvouchIdl from "../../../../web/agentvouch.json";

const { AnchorProvider, Program, Wallet, web3 } = anchor;
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
const MIN_SKILL_PRICE_USDC_MICROS = 10_000n;

function toPublicKey(value: PublicKey | string): PublicKey {
  return value instanceof PublicKey ? value : new PublicKey(value);
}

function toMicrosBigInt(
  value: number | bigint | string,
  fieldName: string
): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${fieldName} must be non-negative.`);
    }
    return value;
  }

  if (typeof value === "string") {
    if (!/^\d+$/.test(value)) {
      throw new Error(`${fieldName} must be a non-negative integer.`);
    }
    return BigInt(value);
  }

  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${fieldName} exceeds JavaScript's safe integer range.`);
  }

  return BigInt(value);
}

function toMicrosBn(value: number | bigint | string, fieldName: string) {
  return new anchor.BN(toMicrosBigInt(value, fieldName).toString());
}

function assertSupportedListingPrice(priceUsdcMicros: bigint) {
  if (priceUsdcMicros !== 0n && priceUsdcMicros < MIN_SKILL_PRICE_USDC_MICROS) {
    throw new Error(
      `priceUsdcMicros must be 0 or at least ${MIN_SKILL_PRICE_USDC_MICROS.toString()} micro-USDC.`
    );
  }
}

export class AgentVouchSolanaClient {
  readonly connection: web3.Connection;
  readonly provider: anchor.AnchorProvider;
  readonly program: anchor.Program<anchor.Idl>;

  constructor(
    private readonly keypair: Keypair,
    rpcUrl: string,
    commitment: Commitment = "confirmed"
  ) {
    this.connection = new web3.Connection(rpcUrl, commitment);
    this.provider = new AnchorProvider(this.connection, new Wallet(keypair), {
      commitment,
    });
    this.program = new Program(agentvouchIdl as anchor.Idl, this.provider);
  }

  get authority(): PublicKey {
    return this.keypair.publicKey;
  }

  getConfigAddress(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getAgentProfileAddress(authority: PublicKey | string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), toPublicKey(authority).toBuffer()],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getAuthorBondAddress(authority: PublicKey | string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("author_bond"), toPublicKey(authority).toBuffer()],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getSkillListingAddress(
    skillId: string,
    author: PublicKey | string = this.authority
  ) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("skill"),
        toPublicKey(author).toBuffer(),
        Buffer.from(skillId),
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getPurchaseAddress(
    skillListing: PublicKey | string,
    buyer: PublicKey | string = this.authority,
    revision: number | bigint = 0
  ): PublicKey {
    const revisionBytes = Buffer.alloc(8);
    revisionBytes.writeBigUInt64LE(BigInt(revision));
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("purchase"),
        toPublicKey(buyer).toBuffer(),
        toPublicKey(skillListing).toBuffer(),
        revisionBytes,
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getListingSettlementAddress(
    skillListing: PublicKey | string,
    revision: number | bigint = 0
  ): PublicKey {
    const revisionBytes = Buffer.alloc(8);
    revisionBytes.writeBigUInt64LE(BigInt(revision));
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("listing_settlement"),
        toPublicKey(skillListing).toBuffer(),
        revisionBytes,
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getAuthorProceedsVaultAuthorityAddress(
    listingSettlement: PublicKey | string
  ): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("author_proceeds_vault_authority"),
        toPublicKey(listingSettlement).toBuffer(),
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getAuthorProceedsVaultAddress(
    listingSettlement: PublicKey | string
  ): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("author_proceeds_vault"),
        toPublicKey(listingSettlement).toBuffer(),
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getAssociatedTokenAddress(
    owner: PublicKey | string,
    mint: PublicKey | string
  ) {
    return PublicKey.findProgramAddressSync(
      [
        toPublicKey(owner).toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        toPublicKey(mint).toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
  }

  getVouchAddress(vouchee: PublicKey | string): PublicKey {
    const voucherProfile = this.getAgentProfileAddress(this.authority);
    const voucheeProfile = this.getAgentProfileAddress(vouchee);
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("vouch"),
        voucherProfile.toBuffer(),
        voucheeProfile.toBuffer(),
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getVouchVaultAuthorityAddress(vouchee: PublicKey | string): PublicKey {
    const voucherProfile = this.getAgentProfileAddress(this.authority);
    const voucheeProfile = this.getAgentProfileAddress(vouchee);
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("vouch_vault_authority"),
        voucherProfile.toBuffer(),
        voucheeProfile.toBuffer(),
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getVouchVaultAddress(vouchee: PublicKey | string): PublicKey {
    const voucherProfile = this.getAgentProfileAddress(this.authority);
    const voucheeProfile = this.getAgentProfileAddress(vouchee);
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("vouch_vault"),
        voucherProfile.toBuffer(),
        voucheeProfile.toBuffer(),
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getAuthorRewardVaultAuthorityAddress(
    authorProfile: PublicKey | string
  ): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("author_reward_vault_authority"),
        toPublicKey(authorProfile).toBuffer(),
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getAuthorRewardVaultAddress(authorProfile: PublicKey | string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("author_reward_vault"),
        toPublicKey(authorProfile).toBuffer(),
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getRewardVaultAuthorityAddress(skillListing: PublicKey | string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("listing_reward_vault_authority"),
        toPublicKey(skillListing).toBuffer(),
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getRewardVaultAddress(skillListing: PublicKey | string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("listing_reward_vault"),
        toPublicKey(skillListing).toBuffer(),
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  getListingVouchPositionAddress(
    skillListing: PublicKey | string,
    vouch: PublicKey | string
  ): PublicKey {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("listing_vouch_position"),
        toPublicKey(skillListing).toBuffer(),
        toPublicKey(vouch).toBuffer(),
      ],
      new PublicKey(AGENTVOUCH_PROGRAM_ID)
    )[0];
  }

  async accountExists(address: PublicKey): Promise<boolean> {
    return (await this.connection.getAccountInfo(address)) !== null;
  }

  async registerAgent(metadataUri: string) {
    const agentProfile = this.getAgentProfileAddress(this.authority);
    if (await this.accountExists(agentProfile)) {
      return {
        tx: null as string | null,
        alreadyRegistered: true,
        agentProfile: agentProfile.toBase58(),
      };
    }

    const tx = await this.program.methods
      .registerAgent(metadataUri)
      .accounts({
        agentProfile,
        authority: this.authority,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.keypair])
      .rpc();

    return {
      tx,
      alreadyRegistered: false,
      agentProfile: agentProfile.toBase58(),
    };
  }

  async vouch(vouchee: string, stakeUsdcMicros: number | bigint) {
    const voucherProfile = this.getAgentProfileAddress(this.authority);
    const voucheeProfile = this.getAgentProfileAddress(vouchee);
    const vouch = this.getVouchAddress(vouchee);
    const config = this.getConfigAddress();
    const usdcMint = DEVNET_USDC_MINT;
    const voucherUsdcAccount = this.getAssociatedTokenAddress(
      this.authority,
      usdcMint
    );
    const vouchVaultAuthority = this.getVouchVaultAuthorityAddress(vouchee);
    const vouchVault = this.getVouchVaultAddress(vouchee);
    const authorRewardVaultAuthority =
      this.getAuthorRewardVaultAuthorityAddress(voucheeProfile);
    const authorRewardVault = this.getAuthorRewardVaultAddress(voucheeProfile);

    if (await this.accountExists(vouch)) {
      return {
        tx: null as string | null,
        alreadyExists: true,
        vouch: vouch.toBase58(),
      };
    }

    const stakeMicros = toMicrosBigInt(stakeUsdcMicros, "stakeUsdcMicros");
    if (stakeMicros <= 0n) {
      throw new Error("stakeUsdcMicros must be greater than zero.");
    }
    const tx = await this.program.methods
      .vouch(toMicrosBn(stakeMicros, "stakeUsdcMicros"))
      .accounts({
        vouch,
        voucherProfile,
        voucheeProfile,
        config,
        usdcMint,
        voucherUsdcAccount,
        vouchVaultAuthority,
        vouchVault,
        authorRewardVaultAuthority,
        authorRewardVault,
        voucher: this.authority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.keypair])
      .rpc();

    return {
      tx,
      alreadyExists: false,
      vouch: vouch.toBase58(),
      stakeUsdcMicros: Number(stakeMicros),
    };
  }

  async purchaseSkill(skillListingAddress: string, authorAddress: string) {
    const skillListingKey = new PublicKey(skillListingAddress);
    const listing = await this.program.account.skillListing.fetch(
      skillListingKey
    );
    const purchase = this.getPurchaseAddress(
      skillListingAddress,
      this.authority,
      listing.currentRevision.toNumber()
    );
    if (await this.accountExists(purchase)) {
      return {
        tx: null as string | null,
        alreadyPurchased: true,
        purchase: purchase.toBase58(),
      };
    }

    const authorProfile = this.getAgentProfileAddress(authorAddress);
    const config = this.getConfigAddress();
    const usdcMint = DEVNET_USDC_MINT;
    const buyerUsdcAccount = this.getAssociatedTokenAddress(
      this.authority,
      usdcMint
    );
    const authorRewardVaultAuthority =
      this.getAuthorRewardVaultAuthorityAddress(authorProfile);
    const authorRewardVault = this.getAuthorRewardVaultAddress(authorProfile);
    const listingSettlement = listing.currentSettlement;
    const authorProceedsVaultAuthority =
      this.getAuthorProceedsVaultAuthorityAddress(listingSettlement);
    const tx = await this.program.methods
      .purchaseSkill()
      .accounts({
        skillListing: skillListingKey,
        purchase,
        author: new PublicKey(authorAddress),
        authorProfile,
        config,
        usdcMint,
        buyerUsdcAccount,
        listingSettlement,
        authorProceedsVaultAuthority,
        authorProceedsVault: listing.currentAuthorProceedsVault,
        authorRewardVaultAuthority,
        authorRewardVault,
        buyer: this.authority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.keypair])
      .rpc();

    return {
      tx,
      alreadyPurchased: false,
      purchase: purchase.toBase58(),
    };
  }

  async claimVoucherRevenue(
    skillListingAddress: string,
    authorAddress: string
  ) {
    const voucherProfile = this.getAgentProfileAddress(this.authority);
    const authorProfile = this.getAgentProfileAddress(authorAddress);
    const vouch = this.getVouchAddress(authorAddress);
    const config = this.getConfigAddress();
    const usdcMint = DEVNET_USDC_MINT;
    const authorRewardVaultAuthority =
      this.getAuthorRewardVaultAuthorityAddress(authorProfile);
    const authorRewardVault = this.getAuthorRewardVaultAddress(authorProfile);
    const voucherUsdcAccount = this.getAssociatedTokenAddress(
      this.authority,
      usdcMint
    );

    const tx = await this.program.methods
      .claimVoucherRevenue()
      .accounts({
        authorProfile,
        vouch,
        voucherProfile,
        config,
        usdcMint,
        authorRewardVaultAuthority,
        authorRewardVault,
        voucherUsdcAccount,
        voucher: this.authority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([this.keypair])
      .rpc();

    return {
      tx,
      skillListing: skillListingAddress,
      vouch: vouch.toBase58(),
      voucherProfile: voucherProfile.toBase58(),
      authorProfile: authorProfile.toBase58(),
    };
  }

  async createSkillListing(input: {
    skillId: string;
    skillUri: string;
    name: string;
    description: string;
    priceUsdcMicros: number | bigint | string;
  }) {
    const priceUsdcMicros = toMicrosBigInt(
      input.priceUsdcMicros,
      "priceUsdcMicros"
    );
    assertSupportedListingPrice(priceUsdcMicros);
    const skillListing = this.getSkillListingAddress(input.skillId);
    if (await this.accountExists(skillListing)) {
      return {
        tx: null as string | null,
        alreadyExists: true,
        skillListing: skillListing.toBase58(),
      };
    }

    const authorProfile = this.getAgentProfileAddress(this.authority);
    const config = this.getConfigAddress();
    const usdcMint = DEVNET_USDC_MINT;
    const authorBond =
      priceUsdcMicros === 0n ? this.getAuthorBondAddress(this.authority) : null;
    const listingSettlement = this.getListingSettlementAddress(skillListing);
    const authorProceedsVaultAuthority =
      this.getAuthorProceedsVaultAuthorityAddress(listingSettlement);
    const authorProceedsVault =
      this.getAuthorProceedsVaultAddress(listingSettlement);

    const tx = await this.program.methods
      .createSkillListing(
        input.skillId,
        input.skillUri,
        input.name,
        input.description,
        toMicrosBn(priceUsdcMicros, "priceUsdcMicros")
      )
      .accounts({
        skillListing,
        authorProfile,
        config,
        authorBond,
        usdcMint,
        listingSettlement,
        authorProceedsVaultAuthority,
        authorProceedsVault,
        author: this.authority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.keypair])
      .rpc();

    return {
      tx,
      alreadyExists: false,
      skillListing: skillListing.toBase58(),
    };
  }
}
