import { NextRequest, NextResponse } from "next/server";
import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { initializeDatabase, sql } from "@/lib/db";
import { getOnChainUsdcPrice } from "@/lib/onchain";
import {
  verifyWalletSignature,
  buildDownloadRawMessage,
  normalizeProtocolNewlines,
  type AuthPayload,
} from "@/lib/auth";
import { verifyEvmWalletSignature } from "@/lib/evmAuth";
import {
  buildX402PaymentRequiredBody,
  decodeX402PaymentSignatureHeader,
  encodeX402PaymentRequiredHeader,
  encodeX402PaymentResponseHeader,
  generateX402UsdcRequirement,
  getConfiguredUsdcMint,
  hasOnChainPurchase,
  settleX402Payment,
  verifySettledUsdcTransfer,
  verifyX402Payment,
  type X402PaymentPayload,
  type X402PaymentRequiredBody,
  type X402SettleResponse,
} from "@/lib/x402";
import { getErrorMessage } from "@/lib/errors";
import {
  hasChainUsdcPurchaseEntitlement,
  hasUsdcPurchaseEntitlement,
  recordUsdcPurchaseReceipt,
} from "@/lib/usdcPurchases";
import { BASE_SEPOLIA_CHAIN_CONTEXT } from "@/lib/chains";
import { BASE_NATIVE_USDC_ADDRESS } from "@/lib/adapters/baseConfig";
import {
  BASE_X402_PURCHASE_PAYMENT_FLOW,
  buildBaseX402PaymentRequirement,
  relayAndRecordBaseX402Purchase,
  verifyBaseX402PaymentPayload,
  type BaseX402Skill,
} from "@/lib/baseX402";
import { isProtocolX402BridgeEnabled } from "@/lib/x402BridgePoc";
import {
  buildProtocolX402BridgeRequirement,
  createProtocolX402BridgeNonce,
  extractProtocolX402BridgeNonce,
  settleProtocolX402Purchase,
  validateProtocolX402PaymentPayload,
  X402_BRIDGE_PURCHASE_PAYMENT_FLOW,
  type ProtocolX402BridgeRequirement,
  type ProtocolX402SettlementResult,
} from "@/lib/x402ProtocolBridge";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchChainContext,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";
import { normalizeUsdcMicros } from "@/lib/listingContract";
import type { SkillFileManifestEntry } from "@/lib/skillStorage";
import { isEvmShapedAddress } from "@/lib/chainAddress";

const CHAIN_PREFIX = "chain-";
const TOKEN_PROGRAM_ID = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

export type RawSkillContentRow = {
  id: string;
  on_chain_address: string | null;
  author_pubkey: string | null;
  skill_id: string;
  name: string;
  content: string;
  version_id?: string | null;
  version?: number | null;
  files: SkillFileManifestEntry[] | null;
  tree_hash: string | null;
  storage_backend: string | null;
  has_executable: boolean;
  price_usdc_micros: string | null;
  currency_mint: string | null;
  chain_context: string | null;
  on_chain_protocol_version: string | null;
  on_chain_program_id: string | null;
  evm_listing_id: string | null;
  evm_contract_address: string | null;
  evm_tx_hash: string | null;
  download_bytes?: Buffer;
  download_path?: string;
  download_content_type?: string;
};

export type SkillAccessResult =
  | { ok: true; skill: RawSkillContentRow; headers?: Record<string, string> }
  | { ok: false; response: NextResponse };

type WalletBackedRawSkillContentRow = RawSkillContentRow & {
  author_pubkey: string;
  currency_mint: string;
};

type ProtocolListedRawSkillContentRow = WalletBackedRawSkillContentRow & {
  on_chain_address: string;
};

export type SkillDownloadEventKind = "raw" | "archive" | "install";

export type SkillDownloadEventInput = {
  kind: SkillDownloadEventKind;
  request?: NextRequest;
  requestedPath?: string | null;
  walletPubkey?: string | null;
  authPresent?: boolean;
  skillVersionId?: string | null;
  skillVersion?: number | null;
};

async function deriveAssociatedTokenAccount(
  owner: string,
  mint: string
): Promise<string> {
  const addressEncoder = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [
      addressEncoder.encode(owner as Address),
      addressEncoder.encode(TOKEN_PROGRAM_ID),
      addressEncoder.encode(mint as Address),
    ],
  });
  return ata.toString();
}

function accessGranted(
  skill: RawSkillContentRow,
  headers?: Record<string, string>
): SkillAccessResult {
  return { ok: true, skill, headers };
}

function accessDenied(response: NextResponse): SkillAccessResult {
  return { ok: false, response };
}

export async function incrementInstalls(skillDbId: string) {
  const rows = await sql()<{
    total_installs: number;
  }>`
    UPDATE skills
    SET total_installs = total_installs + 1,
        updated_at = NOW()
    WHERE id = ${skillDbId}::uuid
    RETURNING total_installs
  `;
  const updated = rows?.[0];
  return updated?.total_installs ?? null;
}

export async function recordSkillDownloadEvent(
  skillDbId: string,
  event: SkillDownloadEventInput
) {
  const request = event.request;
  await sql()`
    INSERT INTO skill_download_events (
      skill_db_id,
      skill_version_id,
      skill_version,
      event_kind,
      requested_path,
      wallet_pubkey,
      auth_present,
      user_agent,
      referrer
    )
    VALUES (
      ${skillDbId}::uuid,
      ${event.skillVersionId ?? null}::uuid,
      ${event.skillVersion ?? null},
      ${event.kind},
      ${event.requestedPath ?? null},
      ${event.walletPubkey ?? null},
      ${event.authPresent ?? false},
      ${request?.headers.get("user-agent") ?? null},
      ${request?.headers.get("referer") ?? null}
    )
  `;
}

export async function recordInstallAndDownloadEvent(
  skillDbId: string,
  event: SkillDownloadEventInput
) {
  const totalInstalls = await incrementInstalls(skillDbId);
  try {
    await recordSkillDownloadEvent(skillDbId, event);
  } catch (error) {
    console.error("Failed to record skill download event:", error);
  }
  return totalInstalls;
}

export async function getOptionalDownloadAuthPubkey(
  request: NextRequest,
  skillDbId: string,
  listingAddress?: string | null
) {
  const authHeader = request.headers.get("x-agentvouch-auth");
  if (!authHeader) return null;

  const authResult = await validateDownloadAuth(
    authHeader,
    skillDbId,
    listingAddress
  );
  if ("response" in authResult) return null;
  return authResult.buyerPubkey;
}

function getResourceInfo(request: NextRequest, skillName: string) {
  const resourceUrl = new URL(request.url);
  resourceUrl.search = "";
  return {
    url: resourceUrl.toString(),
    description: `AgentVouch skill: ${skillName}`,
    mimeType: "text/markdown; charset=utf-8",
  };
}

function paymentRequired402(body: X402PaymentRequiredBody) {
  return NextResponse.json(body, {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": encodeX402PaymentRequiredHeader(body),
    },
  });
}

function listingRequired402(skill: RawSkillContentRow, priceMicros: bigint) {
  return NextResponse.json(
    {
      error: "On-chain listing required",
      message:
        "This paid repo skill is not purchasable until the author links an on-chain SkillListing. New repo-only x402 purchases are disabled so voucher rewards and refund/dispute state stay in the protocol path.",
      payment_flow: "listing-required",
      amount_micros: priceMicros.toString(),
      currency_mint: skill.currency_mint ?? getConfiguredUsdcMint(),
      chain_context: skill.chain_context ?? getAgentVouchChainContext(),
      on_chain_program_id:
        skill.on_chain_program_id ?? getAgentVouchProgramId(),
      protocol_version:
        skill.on_chain_protocol_version ?? AGENTVOUCH_PROTOCOL_VERSION,
      on_chain_address: null,
    },
    {
      status: 402,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

function isProtocolListedUsdcSkill(
  skill: RawSkillContentRow,
  priceMicros: bigint
) {
  return Boolean(
    skill.on_chain_address &&
      priceMicros > 0n &&
      (skill.on_chain_program_id ?? getAgentVouchProgramId()) ===
        getAgentVouchProgramId() &&
      (skill.on_chain_protocol_version ?? AGENTVOUCH_PROTOCOL_VERSION) ===
        AGENTVOUCH_PROTOCOL_VERSION
  );
}

function isBaseProtocolListedUsdcSkill(
  skill: RawSkillContentRow,
  priceMicros: bigint
) {
  return Boolean(
    priceMicros > 0n &&
      skill.chain_context === BASE_SEPOLIA_CHAIN_CONTEXT &&
      skill.evm_listing_id
  );
}

function buildPaymentResponseHeaders(value: X402SettleResponse) {
  const encoded = encodeX402PaymentResponseHeader(value);
  return {
    "PAYMENT-RESPONSE": encoded,
    "X-PAYMENT-RESPONSE": encoded,
  };
}

function protocolBridgeAuthRequired402(
  skill: RawSkillContentRow,
  priceMicros: bigint
) {
  return NextResponse.json(
    {
      error: "Signed wallet auth required",
      message:
        "Protocol-listed x402 bridge purchases require X-AgentVouch-Auth before payment so the payment memo can bind buyer, listing, skill, amount, and nonce.",
      payment_flow: X402_BRIDGE_PURCHASE_PAYMENT_FLOW,
      amount_micros: priceMicros.toString(),
      currency_mint: skill.currency_mint,
      chain_context: skill.chain_context ?? getAgentVouchChainContext(),
      on_chain_program_id:
        skill.on_chain_program_id ?? getAgentVouchProgramId(),
      protocol_version:
        skill.on_chain_protocol_version ?? AGENTVOUCH_PROTOCOL_VERSION,
      on_chain_address: skill.on_chain_address,
    },
    { status: 401 }
  );
}

function protocolBridgeRetryable409(input: {
  message: string;
  skill: RawSkillContentRow;
  priceMicros: bigint;
  settlementTxSignature?: string | null;
  programSettlementSignature?: string | null;
  paymentRefHash?: string | null;
}) {
  return NextResponse.json(
    {
      error: "x402 bridge settlement incomplete",
      message: input.message,
      retryable: true,
      payment_flow: X402_BRIDGE_PURCHASE_PAYMENT_FLOW,
      amount_micros: input.priceMicros.toString(),
      currency_mint: input.skill.currency_mint,
      chain_context: input.skill.chain_context ?? getAgentVouchChainContext(),
      on_chain_program_id:
        input.skill.on_chain_program_id ?? getAgentVouchProgramId(),
      protocol_version:
        input.skill.on_chain_protocol_version ?? AGENTVOUCH_PROTOCOL_VERSION,
      on_chain_address: input.skill.on_chain_address,
      settlement_tx_signature: input.settlementTxSignature ?? null,
      program_settlement_signature: input.programSettlementSignature ?? null,
      x402_payment_ref_hash: input.paymentRefHash ?? null,
    },
    { status: 409 }
  );
}

function buildBridgePaymentRequiredBody(opts: {
  request: NextRequest;
  skill: RawSkillContentRow;
  bridge: ProtocolX402BridgeRequirement;
  error?: string;
}) {
  return buildX402PaymentRequiredBody({
    error: opts.error ?? "Payment required",
    resource: getResourceInfo(opts.request, opts.skill.name),
    requirement: opts.bridge.requirement,
    extensions: {
      payment_flow: X402_BRIDGE_PURCHASE_PAYMENT_FLOW,
      on_chain_address: opts.skill.on_chain_address,
      x402_payment_ref_hash: opts.bridge.paymentRefHashHex,
      protocol_version:
        opts.skill.on_chain_protocol_version ?? AGENTVOUCH_PROTOCOL_VERSION,
    },
  });
}

async function buildBasePaymentRequiredBody(opts: {
  request: NextRequest;
  skillDbId: string;
  skill: RawSkillContentRow;
  priceMicros: bigint;
  error?: string;
}) {
  const requirement = await buildBaseX402PaymentRequirement({
    skillDbId: opts.skillDbId,
    skill: opts.skill,
    priceUsdcMicros: opts.priceMicros,
  });
  return buildX402PaymentRequiredBody({
    error: opts.error ?? "Payment required",
    resource: getResourceInfo(opts.request, opts.skill.name),
    requirement,
    extensions: {
      payment_flow: BASE_X402_PURCHASE_PAYMENT_FLOW,
      chain_context: BASE_SEPOLIA_CHAIN_CONTEXT,
      evm_listing_id: opts.skill.evm_listing_id,
      evm_contract_address: opts.skill.evm_contract_address,
      protocol_version: opts.skill.on_chain_protocol_version,
    },
  });
}

export async function validateDownloadAuth(
  authHeader: string,
  skillDbId: string,
  listingAddress?: string | null
): Promise<{ buyerPubkey: string } | { response: NextResponse }> {
  let auth: AuthPayload;
  try {
    auth = JSON.parse(authHeader);
  } catch {
    return {
      response: NextResponse.json(
        { error: "Malformed X-AgentVouch-Auth header (invalid JSON)" },
        { status: 400 }
      ),
    };
  }

  const verification = isEvmShapedAddress(auth.pubkey)
    ? await verifyEvmWalletSignature(auth)
    : verifyWalletSignature(auth);
  if (!verification.valid || !verification.pubkey) {
    return {
      response: NextResponse.json(
        { error: verification.error || "Invalid signature" },
        { status: 401 }
      ),
    };
  }

  const expectedMessage = buildDownloadRawMessage(
    skillDbId,
    listingAddress,
    auth.timestamp
  );
  if (normalizeProtocolNewlines(auth.message) !== expectedMessage) {
    return {
      response: NextResponse.json(
        {
          error: "Message scope mismatch",
          expected_format:
            "AgentVouch Skill Download\\nAction: download-raw\\nSkill id: {id}\\nListing: {listing|x402-usdc-direct}\\nTimestamp: {ms}",
        },
        { status: 401 }
      ),
    };
  }

  return { buyerPubkey: verification.pubkey };
}

async function handleBaseX402Purchase(input: {
  request: NextRequest;
  skillDbId: string;
  skill: RawSkillContentRow & BaseX402Skill;
  priceMicros: bigint;
}): Promise<SkillAccessResult> {
  let paymentRequired = await buildBasePaymentRequiredBody({
    request: input.request,
    skillDbId: input.skillDbId,
    skill: input.skill,
    priceMicros: input.priceMicros,
  });

  const paymentHeader = input.request.headers.get("payment-signature");
  if (!paymentHeader) {
    return accessDenied(paymentRequired402(paymentRequired));
  }

  const payload = decodeX402PaymentSignatureHeader(paymentHeader);
  if (!payload) {
    return accessDenied(
      paymentRequired402({
        ...paymentRequired,
        error: "Malformed PAYMENT-SIGNATURE header",
      })
    );
  }

  let verified;
  try {
    verified = await verifyBaseX402PaymentPayload({
      skillDbId: input.skillDbId,
      skill: input.skill,
      priceUsdcMicros: input.priceMicros,
      payload,
    });
  } catch (error: unknown) {
    return accessDenied(
      paymentRequired402({
        ...paymentRequired,
        error: getErrorMessage(error, "Base x402 payment verification failed"),
      })
    );
  }

  const entitled = await hasChainUsdcPurchaseEntitlement(input.skillDbId, {
    buyerChainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
    buyerAddress: verified.buyerAddress,
  }).catch(() => false);
  if (entitled) {
    return accessGranted(input.skill);
  }

  try {
    const settlement = await relayAndRecordBaseX402Purchase({
      skillDbId: input.skillDbId,
      skill: input.skill,
      verified,
    });
    const settleResponse: X402SettleResponse = {
      success: true,
      transaction: settlement.transaction,
      network: BASE_SEPOLIA_CHAIN_CONTEXT,
      payer: settlement.payer,
      amount: input.priceMicros.toString(),
      extensions: {
        payment_flow: BASE_X402_PURCHASE_PAYMENT_FLOW,
        evm_listing_id: settlement.listingId,
        evm_purchase_id: settlement.purchaseId,
        listing_revision: settlement.listingRevision,
        x402_payment_ref_hash: settlement.paymentRefHashHex,
      },
    };

    return accessGranted(
      input.skill,
      buildPaymentResponseHeaders(settleResponse)
    );
  } catch (error: unknown) {
    paymentRequired = await buildBasePaymentRequiredBody({
      request: input.request,
      skillDbId: input.skillDbId,
      skill: input.skill,
      priceMicros: input.priceMicros,
      error: `Base x402 settlement failed: ${getErrorMessage(error)}`,
    });
    return accessDenied(paymentRequired402(paymentRequired));
  }
}

async function handleProtocolX402Bridge(input: {
  request: NextRequest;
  skillDbId: string;
  skill: ProtocolListedRawSkillContentRow;
  buyerPubkey: string;
  priceMicros: bigint;
}): Promise<SkillAccessResult> {
  const paymentHeader = input.request.headers.get("payment-signature");
  let nonce = createProtocolX402BridgeNonce();
  let payload: X402PaymentPayload | null = null;
  if (paymentHeader) {
    payload = decodeX402PaymentSignatureHeader(paymentHeader);
    if (!payload) {
      const bridge = await buildProtocolX402BridgeRequirement({
        skillDbId: input.skillDbId,
        skillListingAddress: input.skill.on_chain_address,
        buyerPubkey: input.buyerPubkey,
        priceUsdcMicros: input.priceMicros,
        usdcMint: input.skill.currency_mint,
        nonce,
      });
      return accessDenied(
        paymentRequired402(
          buildBridgePaymentRequiredBody({
            request: input.request,
            skill: input.skill,
            bridge,
            error: "Malformed PAYMENT-SIGNATURE header",
          })
        )
      );
    }

    const payloadNonce = extractProtocolX402BridgeNonce(payload);
    if (!payloadNonce) {
      const bridge = await buildProtocolX402BridgeRequirement({
        skillDbId: input.skillDbId,
        skillListingAddress: input.skill.on_chain_address,
        buyerPubkey: input.buyerPubkey,
        priceUsdcMicros: input.priceMicros,
        usdcMint: input.skill.currency_mint,
        nonce,
      });
      return accessDenied(
        paymentRequired402(
          buildBridgePaymentRequiredBody({
            request: input.request,
            skill: input.skill,
            bridge,
            error: "PAYMENT-SIGNATURE is missing the AgentVouch bridge nonce",
          })
        )
      );
    }
    nonce = payloadNonce;
  }

  const bridge = await buildProtocolX402BridgeRequirement({
    skillDbId: input.skillDbId,
    skillListingAddress: input.skill.on_chain_address,
    buyerPubkey: input.buyerPubkey,
    priceUsdcMicros: input.priceMicros,
    usdcMint: input.skill.currency_mint,
    nonce,
  });
  const paymentRequired = buildBridgePaymentRequiredBody({
    request: input.request,
    skill: input.skill,
    bridge,
  });

  if (!payload) {
    return accessDenied(paymentRequired402(paymentRequired));
  }

  const payloadMismatch = validateProtocolX402PaymentPayload(payload, bridge);
  if (payloadMismatch) {
    return accessDenied(
      paymentRequired402({
        ...paymentRequired,
        error: payloadMismatch,
      })
    );
  }

  let settle: X402SettleResponse;
  let payer: string;
  try {
    const verify = await verifyX402Payment(payload, bridge.requirement);
    if (!verify.isValid) {
      return accessDenied(
        paymentRequired402({
          ...paymentRequired,
          error:
            verify.invalidMessage ||
            verify.invalidReason ||
            "Payment verification failed",
        })
      );
    }

    settle = await settleX402Payment(payload, bridge.requirement);
    if (!settle.success) {
      return accessDenied(
        paymentRequired402({
          ...paymentRequired,
          error:
            settle.errorMessage ||
            settle.errorReason ||
            "Payment settlement failed",
        })
      );
    }

    payer = settle.payer || verify.payer || input.buyerPubkey;
    if (payer !== input.buyerPubkey) {
      return accessDenied(
        paymentRequired402({
          ...paymentRequired,
          error: "Facilitator payer does not match X-AgentVouch-Auth wallet",
        })
      );
    }

    await verifySettledUsdcTransfer({
      signature: settle.transaction,
      destinationAta: await deriveAssociatedTokenAccount(
        bridge.x402SettlementVaultAuthority,
        input.skill.currency_mint
      ),
      currencyMint: input.skill.currency_mint,
      minimumAmountMicros: input.priceMicros,
      exactAmountMicros: input.priceMicros,
      expectedPayer: input.buyerPubkey,
      expectedMemo: bridge.memo,
    });
  } catch (error: unknown) {
    return accessDenied(
      paymentRequired402({
        ...paymentRequired,
        error: `Facilitator error: ${getErrorMessage(error)}`,
      })
    );
  }

  let protocolSettlement: ProtocolX402SettlementResult | null = null;
  try {
    protocolSettlement = await settleProtocolX402Purchase({
      skillDbId: input.skillDbId,
      skillListingAddress: input.skill.on_chain_address,
      authorPubkey: input.skill.author_pubkey,
      buyerPubkey: input.buyerPubkey,
      amountUsdcMicros: input.priceMicros,
      usdcMint: input.skill.currency_mint,
      paymentRefHashBytes: bridge.paymentRefHashBytes,
      settlementTxSignature: settle.transaction,
    });

    await recordUsdcPurchaseReceipt({
      skillDbId: input.skillDbId,
      buyerPubkey: input.buyerPubkey,
      paymentTxSignature: settle.transaction,
      recipientAta: protocolSettlement.x402SettlementVault,
      currencyMint: input.skill.currency_mint,
      amountMicros: input.priceMicros.toString(),
      paymentFlow: X402_BRIDGE_PURCHASE_PAYMENT_FLOW,
      protocolVersion:
        input.skill.on_chain_protocol_version ?? AGENTVOUCH_PROTOCOL_VERSION,
      onChainProgramId:
        input.skill.on_chain_program_id ?? getAgentVouchProgramId(),
      chainContext: input.skill.chain_context ?? getAgentVouchChainContext(),
      onChainAddress: input.skill.on_chain_address,
      purchasePda: protocolSettlement.purchasePda,
      listingRevision: protocolSettlement.listingRevision,
      settlementPda: protocolSettlement.listingSettlementPda,
      authorProceedsVault: protocolSettlement.authorProceedsVault,
      x402PaymentRefHash: bridge.paymentRefHashHex,
      x402SettlementSignatureHash:
        protocolSettlement.x402SettlementSignatureHashHex,
      x402SettlementReceiptPda: protocolSettlement.x402SettlementReceiptPda,
      x402SettlementVault: protocolSettlement.x402SettlementVault,
      refundStatus: "none",
      legacyRefundEligible: false,
    });
  } catch (error: unknown) {
    return accessDenied(
      protocolBridgeRetryable409({
        message: getErrorMessage(error),
        skill: input.skill,
        priceMicros: input.priceMicros,
        settlementTxSignature: settle.transaction,
        programSettlementSignature:
          protocolSettlement?.programSettlementSignature ?? null,
        paymentRefHash: bridge.paymentRefHashHex,
      })
    );
  }

  if (!protocolSettlement) {
    return accessDenied(
      protocolBridgeRetryable409({
        message: "Protocol settlement did not return metadata",
        skill: input.skill,
        priceMicros: input.priceMicros,
        settlementTxSignature: settle.transaction,
        paymentRefHash: bridge.paymentRefHashHex,
      })
    );
  }

  console.info(
    `[x402-bridge] settled protocol purchase: skill=${
      input.skillDbId
    } listing=${input.skill.on_chain_address} buyer=${
      input.buyerPubkey
    } x402Tx=${settle.transaction} programTx=${
      protocolSettlement.programSettlementSignature ?? "existing"
    }`
  );

  const settleResponse: X402SettleResponse = {
    success: true,
    transaction: settle.transaction,
    network: settle.network,
    payer: input.buyerPubkey,
    ...(settle.amount ? { amount: settle.amount } : {}),
    extensions: {
      ...(settle.extensions ?? {}),
      payment_flow: X402_BRIDGE_PURCHASE_PAYMENT_FLOW,
      purchase_pda: protocolSettlement.purchasePda,
      x402_settlement_receipt_pda: protocolSettlement.x402SettlementReceiptPda,
      program_settlement_signature:
        protocolSettlement.programSettlementSignature,
    },
  };

  return accessGranted(
    input.skill,
    buildPaymentResponseHeaders(settleResponse)
  );
}

async function handleUsdcDirect(
  request: NextRequest,
  skillDbId: string,
  skill: RawSkillContentRow
): Promise<SkillAccessResult> {
  if (!skill.currency_mint || !skill.price_usdc_micros) {
    return accessDenied(
      NextResponse.json(
        { error: "USDC listing is missing currency mint or price" },
        { status: 500 }
      )
    );
  }

  if (!skill.author_pubkey) {
    return accessDenied(
      NextResponse.json(
        {
          error: "Paid skill is missing an author wallet",
          message:
            "Unverified repo-only publishers can publish free skills, but paid marketplace purchases require a linked author wallet and on-chain SkillListing.",
        },
        { status: 409 }
      )
    );
  }

  let priceMicros: bigint;
  try {
    priceMicros = BigInt(skill.price_usdc_micros);
  } catch {
    return accessDenied(
      NextResponse.json(
        { error: "USDC listing has invalid price_usdc_micros" },
        { status: 500 }
      )
    );
  }

  if (priceMicros <= 0n) {
    return accessDenied(
      NextResponse.json(
        { error: "USDC listing has invalid price_usdc_micros" },
        { status: 500 }
      )
    );
  }

  const walletBackedSkill: WalletBackedRawSkillContentRow = {
    ...skill,
    author_pubkey: skill.author_pubkey,
    currency_mint: skill.currency_mint,
  };

  if (isBaseProtocolListedUsdcSkill(skill, priceMicros)) {
    const authHeader = request.headers.get("x-agentvouch-auth");
    if (authHeader) {
      const authResult = await validateDownloadAuth(
        authHeader,
        skillDbId,
        skill.evm_listing_id
      );
      if ("response" in authResult) {
        return accessDenied(authResult.response);
      }

      const entitled = await hasChainUsdcPurchaseEntitlement(skillDbId, {
        buyerChainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        buyerAddress: authResult.buyerPubkey,
      }).catch(() => false);
      if (entitled) {
        return accessGranted(skill);
      }
    }

    return handleBaseX402Purchase({
      request,
      skillDbId,
      skill,
      priceMicros,
    });
  }

  if (skill.on_chain_address) {
    const liveListing = await getOnChainUsdcPrice(skill.on_chain_address, {
      useCache: false,
    });
    if (!liveListing) {
      skill.on_chain_address = null;
      skill.on_chain_protocol_version = null;
      skill.on_chain_program_id = null;
    }
  }

  if (!skill.on_chain_address) {
    const authHeader = request.headers.get("x-agentvouch-auth");
    if (authHeader) {
      const authResult = await validateDownloadAuth(
        authHeader,
        skillDbId,
        null
      );
      if ("response" in authResult) {
        return accessDenied(authResult.response);
      }

      const entitled = await hasUsdcPurchaseEntitlement(
        skillDbId,
        authResult.buyerPubkey
      ).catch(() => false);
      if (entitled) {
        return accessGranted(skill);
      }
    }

    return accessDenied(listingRequired402(skill, priceMicros));
  }

  if (isProtocolListedUsdcSkill(skill, priceMicros)) {
    const protocolSkill: ProtocolListedRawSkillContentRow = {
      ...walletBackedSkill,
      on_chain_address: skill.on_chain_address,
    };
    const authHeader = request.headers.get("x-agentvouch-auth");
    let buyerPubkey: string | null = null;
    if (authHeader) {
      const authResult = await validateDownloadAuth(
        authHeader,
        skillDbId,
        skill.on_chain_address
      );
      if ("response" in authResult) {
        return accessDenied(authResult.response);
      }
      buyerPubkey = authResult.buyerPubkey;

      const entitled = await hasUsdcPurchaseEntitlement(
        skillDbId,
        authResult.buyerPubkey
      ).catch(() => false);
      if (entitled) {
        return accessGranted(skill);
      }

      let onChainEntitled = false;
      try {
        onChainEntitled = Boolean(
          await hasOnChainPurchase(
            authResult.buyerPubkey,
            protocolSkill.on_chain_address
          )
        );
      } catch {
        onChainEntitled = false;
      }
      if (onChainEntitled) {
        return accessGranted(skill);
      }
    }

    if (isProtocolX402BridgeEnabled()) {
      if (!buyerPubkey) {
        return accessDenied(protocolBridgeAuthRequired402(skill, priceMicros));
      }

      return handleProtocolX402Bridge({
        request,
        skillDbId,
        skill: protocolSkill,
        buyerPubkey,
        priceMicros,
      });
    }

    return accessDenied(
      NextResponse.json(
        {
          error: "Direct purchase required",
          message:
            "This protocol-listed skill requires the on-chain purchase_skill flow. After the wallet transaction confirms, POST the signature to /api/skills/{id}/purchase/verify, then retry with X-AgentVouch-Auth. See /docs#paid-skill-download.",
          payment_flow: "direct-purchase-skill",
          amount_micros: priceMicros.toString(),
          currency_mint: skill.currency_mint,
          chain_context: skill.chain_context ?? getAgentVouchChainContext(),
          on_chain_program_id:
            skill.on_chain_program_id ?? getAgentVouchProgramId(),
          protocol_version:
            skill.on_chain_protocol_version ?? AGENTVOUCH_PROTOCOL_VERSION,
          on_chain_address: skill.on_chain_address,
        },
        { status: 402 }
      )
    );
  }

  const authorUsdcAta = await deriveAssociatedTokenAccount(
    walletBackedSkill.author_pubkey,
    walletBackedSkill.currency_mint
  );
  const requirement = await generateX402UsdcRequirement({
    priceUsdcMicros: priceMicros,
    payTo: walletBackedSkill.author_pubkey,
    usdcMint: walletBackedSkill.currency_mint,
    extra: {
      agentvouch_skill_id: skill.skill_id,
      agentvouch_skill_db_id: skillDbId,
    },
  });
  const paymentRequired = buildX402PaymentRequiredBody({
    error: "Payment required",
    resource: getResourceInfo(request, skill.name),
    requirement,
  });

  const authHeader = request.headers.get("x-agentvouch-auth");
  if (authHeader) {
    const authResult = await validateDownloadAuth(
      authHeader,
      skillDbId,
      skill.on_chain_address
    );
    if ("response" in authResult) {
      return accessDenied(authResult.response);
    }

    const entitled = await hasUsdcPurchaseEntitlement(
      skillDbId,
      authResult.buyerPubkey
    ).catch(() => false);
    if (entitled) {
      return accessGranted(skill);
    }

    paymentRequired.error = "USDC purchase not found for this wallet";
  }

  const paymentHeader = request.headers.get("payment-signature");
  if (!paymentHeader) {
    return accessDenied(paymentRequired402(paymentRequired));
  }

  const payload = decodeX402PaymentSignatureHeader(paymentHeader);
  if (!payload) {
    return accessDenied(
      paymentRequired402({
        ...paymentRequired,
        error: "Malformed PAYMENT-SIGNATURE header",
      })
    );
  }

  try {
    const verify = await verifyX402Payment(payload, requirement);
    if (!verify.isValid) {
      return accessDenied(
        paymentRequired402({
          ...paymentRequired,
          error:
            verify.invalidMessage ||
            verify.invalidReason ||
            "Payment verification failed",
        })
      );
    }

    const settle = await settleX402Payment(payload, requirement);
    if (!settle.success) {
      return accessDenied(
        paymentRequired402({
          ...paymentRequired,
          error:
            settle.errorMessage ||
            settle.errorReason ||
            "Payment settlement failed",
        })
      );
    }

    const payer = settle.payer || verify.payer;
    if (!payer) {
      return accessDenied(
        paymentRequired402({
          ...paymentRequired,
          error: "Facilitator did not return the payer wallet",
        })
      );
    }

    const transferCheck = await verifySettledUsdcTransfer({
      signature: settle.transaction,
      destinationAta: authorUsdcAta,
      currencyMint: walletBackedSkill.currency_mint,
      minimumAmountMicros: priceMicros,
    });

    await recordUsdcPurchaseReceipt({
      skillDbId,
      buyerPubkey: payer,
      paymentTxSignature: settle.transaction,
      recipientAta: authorUsdcAta,
      currencyMint: walletBackedSkill.currency_mint,
      amountMicros: transferCheck.settledAmountMicros.toString(),
      paymentFlow: "repo-x402-usdc",
    });

    console.info(
      `[x402] settled direct USDC purchase: skill=${skillDbId} tx=${settle.transaction} payer=${payer}`
    );

    const settleResponse: X402SettleResponse = {
      success: true,
      transaction: settle.transaction,
      network: settle.network,
      payer,
      ...(settle.amount ? { amount: settle.amount } : {}),
      ...(settle.extensions ? { extensions: settle.extensions } : {}),
    };

    return accessGranted(skill, buildPaymentResponseHeaders(settleResponse));
  } catch (error: unknown) {
    return accessDenied(
      paymentRequired402({
        ...paymentRequired,
        error: `Facilitator error: ${getErrorMessage(error)}`,
      })
    );
  }
}

function handleUnpricedSkill(
  skill: RawSkillContentRow,
  onChainPriceResolved: boolean
): SkillAccessResult {
  if (!skill.on_chain_address) {
    return accessGranted(skill);
  }

  if (onChainPriceResolved && !normalizeUsdcMicros(skill.price_usdc_micros)) {
    return accessGranted(skill);
  }

  return accessDenied(
    NextResponse.json(
      {
        error: "Legacy paid download disabled",
        message:
          "This listing is linked on-chain but has no readable USDC price. Legacy SOL payment fallback is disabled for v0.2.0; the author must relink or republish the listing with price_usdc_micros.",
        payment_flow: "unpriced-linked-listing",
        on_chain_address: skill.on_chain_address,
      },
      { status: 409 }
    )
  );
}

export async function resolveSkillAccess(
  request: NextRequest,
  id: string
): Promise<SkillAccessResult> {
  if (id.startsWith(CHAIN_PREFIX)) {
    return accessDenied(
      NextResponse.json(
        { error: "Archive access is only available for repo-backed skills" },
        { status: 404 }
      )
    );
  }

  await initializeDatabase();
  const rows = await sql()<RawSkillContentRow>`
    SELECT
      s.id,
      s.on_chain_address,
      s.author_pubkey,
      s.skill_id,
      s.name,
      s.price_usdc_micros,
      s.currency_mint,
      s.chain_context,
      s.on_chain_protocol_version,
      s.on_chain_program_id,
      s.evm_listing_id,
      s.evm_contract_address,
      s.evm_tx_hash,
      sv.id AS version_id,
      sv.version,
      sv.content,
      sv.files,
      sv.tree_hash,
      sv.storage_backend,
      sv.has_executable
    FROM skill_versions sv
    JOIN skills s ON s.id = sv.skill_id
    WHERE s.id = ${id}::uuid
    ORDER BY sv.version DESC
    LIMIT 1
  `;

  if (rows.length === 0) {
    return accessDenied(new NextResponse("Skill not found", { status: 404 }));
  }

  const skill = rows[0];
  let onChainPriceResolved = false;
  if (skill.on_chain_address && !normalizeUsdcMicros(skill.price_usdc_micros)) {
    const listing = await getOnChainUsdcPrice(skill.on_chain_address);
    if (listing) {
      onChainPriceResolved = true;
      skill.price_usdc_micros = listing.priceUsdcMicros;
      skill.currency_mint ??= getConfiguredUsdcMint();
      skill.on_chain_program_id ??= getAgentVouchProgramId();
      skill.on_chain_protocol_version ??= AGENTVOUCH_PROTOCOL_VERSION;
    }
  }

  if (normalizeUsdcMicros(skill.price_usdc_micros)) {
    skill.currency_mint ??=
      skill.chain_context === BASE_SEPOLIA_CHAIN_CONTEXT && skill.evm_listing_id
        ? BASE_NATIVE_USDC_ADDRESS
        : getConfiguredUsdcMint();
    return handleUsdcDirect(request, id, skill);
  }

  return handleUnpricedSkill(skill, onChainPriceResolved);
}
