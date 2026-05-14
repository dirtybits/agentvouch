import { NextRequest, NextResponse } from "next/server";
import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { initializeDatabase, sql } from "@/lib/db";
import { fetchOnChainSkillListing, getOnChainUsdcPrice } from "@/lib/onchain";
import {
  verifyWalletSignature,
  buildDownloadRawMessage,
  normalizeProtocolNewlines,
  type AuthPayload,
} from "@/lib/auth";
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
  type X402PaymentRequiredBody,
  type X402SettleResponse,
} from "@/lib/x402";
import { getErrorMessage } from "@/lib/errors";
import {
  hasUsdcPurchaseEntitlement,
  recordUsdcPurchaseReceipt,
} from "@/lib/usdcPurchases";
import {
  AGENTVOUCH_PROTOCOL_VERSION,
  getAgentVouchChainContext,
  getAgentVouchProgramId,
} from "@/lib/protocolMetadata";
import { normalizeUsdcMicros } from "@/lib/listingContract";

const CHAIN_PREFIX = "chain-";

type RawSkillContentRow = {
  id: string;
  on_chain_address: string | null;
  author_pubkey: string;
  skill_id: string;
  name: string;
  content: string;
  price_usdc_micros: string | null;
  currency_mint: string | null;
  chain_context: string | null;
  on_chain_protocol_version: string | null;
  on_chain_program_id: string | null;
};

const TOKEN_PROGRAM_ID = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ASSOCIATED_TOKEN_PROGRAM_ID = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

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

function serveContent(content: string, extraHeaders?: Record<string, string>) {
  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="SKILL.md"',
      ...(extraHeaders ?? {}),
    },
  });
}

async function incrementInstalls(skillDbId: string) {
  await sql()`
    UPDATE skills SET total_installs = total_installs + 1 WHERE id = ${skillDbId}::uuid
  `;
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
      on_chain_program_id: skill.on_chain_program_id ?? getAgentVouchProgramId(),
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

function buildPaymentResponseHeaders(value: X402SettleResponse) {
  const encoded = encodeX402PaymentResponseHeader(value);
  return {
    "PAYMENT-RESPONSE": encoded,
    "X-PAYMENT-RESPONSE": encoded,
  };
}

function validateDownloadAuth(
  authHeader: string,
  skillDbId: string,
  listingAddress?: string | null
): { buyerPubkey: string } | { response: NextResponse } {
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

  const verification = verifyWalletSignature(auth);
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

async function fetchSkillUriContent(skillUri: string) {
  const res = await fetch(skillUri);
  if (!res.ok) {
    throw new Error(`Skill URI fetch failed with status ${res.status}`);
  }
  return res.text();
}

async function handleChainOnlyRaw(request: NextRequest, id: string) {
  const onChainAddress = id.slice(CHAIN_PREFIX.length);
  const listing = await fetchOnChainSkillListing(onChainAddress);
  if (!listing) {
    return new NextResponse("Skill not found", { status: 404 });
  }
  if (!listing.data.skillUri) {
    return NextResponse.json(
      { error: "Chain-only skill has no skill_uri" },
      { status: 404 }
    );
  }

  const priceMicros = BigInt(listing.data.priceUsdcMicros);
  if (priceMicros <= 0n) {
    return serveContent(await fetchSkillUriContent(listing.data.skillUri));
  }

  const authHeader = request.headers.get("x-agentvouch-auth");
  if (authHeader) {
    const authResult = validateDownloadAuth(authHeader, id, listing.publicKey);
    if ("response" in authResult) {
      return authResult.response;
    }

    const entitled = await hasOnChainPurchase(
      authResult.buyerPubkey,
      listing.publicKey
    ).catch(() => false);
    if (entitled) {
      return serveContent(await fetchSkillUriContent(listing.data.skillUri));
    }
  }

  return NextResponse.json(
    {
      error: "Direct purchase required",
      message:
        "This chain-only skill requires the on-chain purchase_skill flow. After the wallet transaction confirms, sign to download again.",
      payment_flow: "direct-purchase-skill",
      amount_micros: priceMicros.toString(),
      currency_mint: getConfiguredUsdcMint(),
      chain_context: getAgentVouchChainContext(),
      on_chain_program_id: getAgentVouchProgramId(),
      protocol_version: AGENTVOUCH_PROTOCOL_VERSION,
      on_chain_address: listing.publicKey,
    },
    { status: 402 }
  );
}

async function handleUsdcDirect(
  request: NextRequest,
  skillDbId: string,
  skill: RawSkillContentRow
) {
  if (!skill.currency_mint || !skill.price_usdc_micros) {
    return NextResponse.json(
      { error: "USDC listing is missing currency mint or price" },
      { status: 500 }
    );
  }

  let priceMicros: bigint;
  try {
    priceMicros = BigInt(skill.price_usdc_micros);
  } catch {
    return NextResponse.json(
      { error: "USDC listing has invalid price_usdc_micros" },
      { status: 500 }
    );
  }

  if (priceMicros <= 0n) {
    return NextResponse.json(
      { error: "USDC listing has invalid price_usdc_micros" },
      { status: 500 }
    );
  }

  if (!skill.on_chain_address) {
    const authHeader = request.headers.get("x-agentvouch-auth");
    if (authHeader) {
      const authResult = validateDownloadAuth(authHeader, skillDbId, null);
      if ("response" in authResult) {
        return authResult.response;
      }

      const entitled = await hasUsdcPurchaseEntitlement(
        skillDbId,
        authResult.buyerPubkey
      ).catch(() => false);
      if (entitled) {
        await incrementInstalls(skillDbId);
        return serveContent(skill.content);
      }
    }

    return listingRequired402(skill, priceMicros);
  }

  if (isProtocolListedUsdcSkill(skill, priceMicros)) {
    const authHeader = request.headers.get("x-agentvouch-auth");
    if (authHeader) {
      const authResult = validateDownloadAuth(
        authHeader,
        skillDbId,
        skill.on_chain_address
      );
      if ("response" in authResult) {
        return authResult.response;
      }

      const entitled = await hasUsdcPurchaseEntitlement(
        skillDbId,
        authResult.buyerPubkey
      ).catch(() => false);
      if (entitled) {
        await incrementInstalls(skillDbId);
        return serveContent(skill.content);
      }
    }

    return NextResponse.json(
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
    );
  }

  const authorUsdcAta = await deriveAssociatedTokenAccount(
    skill.author_pubkey,
    skill.currency_mint
  );
  const requirement = await generateX402UsdcRequirement({
    priceUsdcMicros: priceMicros,
    payTo: skill.author_pubkey,
    usdcMint: skill.currency_mint,
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
    const authResult = validateDownloadAuth(
      authHeader,
      skillDbId,
      skill.on_chain_address
    );
    if ("response" in authResult) {
      return authResult.response;
    }

    const entitled = await hasUsdcPurchaseEntitlement(
      skillDbId,
      authResult.buyerPubkey
    ).catch(() => false);
    if (entitled) {
      await incrementInstalls(skillDbId);
      return serveContent(skill.content);
    }

    paymentRequired.error = "USDC purchase not found for this wallet";
  }

  const paymentHeader = request.headers.get("payment-signature");
  if (!paymentHeader) {
    return paymentRequired402(paymentRequired);
  }

  const payload = decodeX402PaymentSignatureHeader(paymentHeader);
  if (!payload) {
    return paymentRequired402({
      ...paymentRequired,
      error: "Malformed PAYMENT-SIGNATURE header",
    });
  }

  try {
    const verify = await verifyX402Payment(payload, requirement);
    if (!verify.isValid) {
      return paymentRequired402({
        ...paymentRequired,
        error:
          verify.invalidMessage ||
          verify.invalidReason ||
          "Payment verification failed",
      });
    }

    const settle = await settleX402Payment(payload, requirement);
    if (!settle.success) {
      return paymentRequired402({
        ...paymentRequired,
        error:
          settle.errorMessage ||
          settle.errorReason ||
          "Payment settlement failed",
      });
    }

    const payer = settle.payer || verify.payer;
    if (!payer) {
      return paymentRequired402({
        ...paymentRequired,
        error: "Facilitator did not return the payer wallet",
      });
    }

    const transferCheck = await verifySettledUsdcTransfer({
      signature: settle.transaction,
      destinationAta: authorUsdcAta,
      currencyMint: skill.currency_mint,
      minimumAmountMicros: priceMicros,
    });

    await recordUsdcPurchaseReceipt({
      skillDbId,
      buyerPubkey: payer,
      paymentTxSignature: settle.transaction,
      recipientAta: authorUsdcAta,
      currencyMint: skill.currency_mint,
      amountMicros: transferCheck.settledAmountMicros.toString(),
      paymentFlow: "repo-x402-usdc",
    });

    console.info(
      `[x402] settled direct USDC purchase: skill=${skillDbId} tx=${settle.transaction} payer=${payer}`
    );

    await incrementInstalls(skillDbId);

    const settleResponse: X402SettleResponse = {
      success: true,
      transaction: settle.transaction,
      network: settle.network,
      payer,
      ...(settle.amount ? { amount: settle.amount } : {}),
      ...(settle.extensions ? { extensions: settle.extensions } : {}),
    };

    return serveContent(skill.content, buildPaymentResponseHeaders(settleResponse));
  } catch (error: unknown) {
    return paymentRequired402({
      ...paymentRequired,
      error: `Facilitator error: ${getErrorMessage(error)}`,
    });
  }
}

async function handleUnpricedSkill(
  skillDbId: string,
  skill: RawSkillContentRow,
  onChainPriceResolved: boolean
) {
  if (!skill.on_chain_address) {
    await incrementInstalls(skillDbId);
    return serveContent(skill.content);
  }

  if (onChainPriceResolved && !normalizeUsdcMicros(skill.price_usdc_micros)) {
    await incrementInstalls(skillDbId);
    return serveContent(skill.content);
  }

  return NextResponse.json(
    {
      error: "Legacy paid download disabled",
      message:
        "This listing is linked on-chain but has no readable USDC price. Legacy SOL payment fallback is disabled for v0.2.0; the author must relink or republish the listing with price_usdc_micros.",
      payment_flow: "unpriced-linked-listing",
      on_chain_address: skill.on_chain_address,
    },
    { status: 409 }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await initializeDatabase();

    if (id.startsWith(CHAIN_PREFIX)) {
      return handleChainOnlyRaw(request, id);
    }

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
        sv.content
      FROM skill_versions sv
      JOIN skills s ON s.id = sv.skill_id
      WHERE s.id = ${id}::uuid
      ORDER BY sv.version DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      return new NextResponse("Skill not found", { status: 404 });
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
      skill.currency_mint ??= getConfiguredUsdcMint();
      return handleUsdcDirect(request, id, skill);
    }

    return handleUnpricedSkill(id, skill, onChainPriceResolved);
  } catch (error: unknown) {
    console.error("GET /api/skills/[id]/raw error:", error);
    return new NextResponse(getErrorMessage(error, "Internal server error"), {
      status: 500,
    });
  }
}
