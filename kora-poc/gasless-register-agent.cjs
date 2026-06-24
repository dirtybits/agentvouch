// Proves the redeployed register_agent is gasless for the user, end-to-end on devnet.
//
// A zero-SOL user (the `authority` being registered) signs a tx where:
//   - fee payer  = Kora sponsor (gas)
//   - rent_payer = Kora sponsor (funds the AgentProfile PDA rent — the new account seam)
//   - authority  = the zero-SOL user; also authorizes a USDC transfer reimbursing the sponsor
//
// Before the redeploy this was impossible: register_agent hard-coded `payer = authority`, so the
// user paid their own rent and needed SOL. Now `payer = rent_payer` lets the sponsor cover it.

const web3 = require("@solana/web3.js");
const fs = require("fs");
const {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} = require("@solana/spl-token");

const KORA_URL = process.env.KORA_URL || "http://localhost:8080";
const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new web3.PublicKey(
  "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg"
);
const USDC = new web3.PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const FEE_PAYER = new web3.PublicKey(
  "89CGD862LLSPDHef7mLg78vtiwLy19mwMfH3UePurd9n"
); // Kora sponsor
const SPONSOR_USDC_ATA = new web3.PublicKey(
  "cLe7n9oQmB2GJpWFvkE22Ves32F1ybV299ScYeigCNF"
);
const REGISTER_AGENT_DISC = Buffer.from([135, 157, 66, 195, 2, 113, 175, 30]); // from IDL

async function rpc(method, params) {
  const res = await fetch(KORA_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}
const loadKeypair = (p) =>
  web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p))));

// Borsh-encode register_agent(metadata_uri): 8-byte disc + u32-LE string length + utf8 bytes.
function registerAgentData(metadataUri) {
  const uri = Buffer.from(metadataUri, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(uri.length, 0);
  return Buffer.concat([REGISTER_AGENT_DISC, len, uri]);
}

function buildTx(blockhash, authority, agentProfile, reimburse, metadataUri) {
  const authorityAta = getAssociatedTokenAddressSync(USDC, authority.publicKey);
  const tx = new web3.Transaction();
  tx.feePayer = FEE_PAYER;
  tx.recentBlockhash = blockhash;
  // (1) register_agent — accounts in IDL order; rent_payer = sponsor funds the PDA rent.
  tx.add(
    new web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: agentProfile, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        { pubkey: FEE_PAYER, isSigner: true, isWritable: true }, // rent_payer = sponsor
        {
          pubkey: web3.SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
      ],
      data: registerAgentData(metadataUri),
    })
  );
  // (2) user reimburses the sponsor in USDC (authority signs).
  tx.add(
    createTransferCheckedInstruction(
      authorityAta,
      USDC,
      SPONSOR_USDC_ATA,
      authority.publicKey,
      reimburse,
      6
    )
  );
  tx.partialSign(authority); // only the sponsor (fee payer + rent_payer) signature is left for Kora
  return tx;
}
const b64 = (tx) =>
  tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

(async () => {
  const conn = new web3.Connection(RPC, "confirmed");
  const authority = loadKeypair(".agent-keys/kora/buyer.json"); // reuse the zero-SOL wallet as the new agent
  const authorityAta = getAssociatedTokenAddressSync(USDC, authority.publicKey);
  const [agentProfile] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), authority.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const metadataUri = "https://agentvouch.test/kora-gasless.json";

  const exists = await conn.getAccountInfo(agentProfile);
  if (exists)
    throw new Error(
      `agent_profile ${agentProfile.toBase58()} already exists — use a fresh authority to prove rent sponsorship`
    );
  const solBefore = await conn.getBalance(authority.publicKey);
  const usdcBefore = (await conn.getTokenAccountBalance(authorityAta)).value
    .amount;
  console.log(`new agent authority ${authority.publicKey.toBase58()}`);
  console.log(`  agent_profile PDA: ${agentProfile.toBase58()}`);
  console.log(`  before: SOL=${solBefore}  USDC=${usdcBefore} micros\n`);

  let { blockhash } = await conn.getLatestBlockhash();
  const est = await rpc("estimateTransactionFee", {
    transaction: b64(
      buildTx(blockhash, authority, agentProfile, 1, metadataUri)
    ),
    fee_token: USDC.toBase58(),
  });
  if (!est.result)
    throw new Error("estimate failed: " + JSON.stringify(est.error));
  const reimburse = Number(est.result.fee_in_token);
  console.log(
    `estimate: fee_in_lamports=${est.result.fee_in_lamports} fee_in_token=${est.result.fee_in_token}`
  );
  console.log(
    `user reimburses ${reimburse} micro-USDC (${(reimburse / 1e6).toFixed(
      4
    )} USDC)\n`
  );

  ({ blockhash } = await conn.getLatestBlockhash());
  const signed = await rpc("signTransaction", {
    transaction: b64(
      buildTx(blockhash, authority, agentProfile, reimburse, metadataUri)
    ),
    sig_verify: false,
  });
  if (!signed.result)
    throw new Error("signTransaction REJECTED -> " + signed.error?.message);
  console.log("signTransaction -> SIGNED by Kora");

  const sig = await conn.sendRawTransaction(
    Buffer.from(signed.result.signed_transaction, "base64")
  );
  await conn.confirmTransaction(sig, "confirmed");
  console.log(
    `submitted: https://explorer.solana.com/tx/${sig}?cluster=devnet\n`
  );

  const solAfter = await conn.getBalance(authority.publicKey);
  const usdcAfter = (await conn.getTokenAccountBalance(authorityAta)).value
    .amount;
  const profile = await conn.getAccountInfo(agentProfile);
  console.log(`after:  SOL=${solAfter}  USDC=${usdcAfter} micros`);
  console.log(`  SOL delta:  ${solAfter - solBefore} lamports (must be 0)`);
  console.log(`  USDC delta: ${usdcAfter - usdcBefore} micros (reimbursement)`);
  console.log(
    `agent_profile created: ${!!profile}, owner=${profile?.owner.toBase58()}, rent=${
      profile?.lamports
    } lamports (paid by sponsor)`
  );
  console.log(
    solAfter === solBefore && profile
      ? "\nPROVEN: a zero-SOL user registered an agent; Kora sponsored gas+rent, user paid only USDC."
      : "\nWARNING: not fully gasless."
  );
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
