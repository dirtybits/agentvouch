// Fully-gasless-for-the-user round trip, proven end-to-end on devnet through Kora.
//
// Models the AgentVouch "buyer pays only USDC" claim in one transaction:
//   - fee payer  = Kora sponsor (pays SOL gas)
//   - rent payer = Kora sponsor (funds a new account's rent — the purchase_skill PDA shape)
//   - buyer      = a ZERO-SOL wallet that only signs a USDC transfer reimbursing the sponsor
//
// The buyer never holds or spends SOL. Gas + rent are sponsored; the buyer pays Kora back in
// USDC, which Kora enforces (verify_token_payment: a transfer to a sponsor-owned token account
// in an allowed paid token, >= the required amount). This is the same fee-payer / rent-payer /
// buyer-authority split that purchase_skill already exposes via its separate `rent_payer` signer.
//
// Flow: estimateTransactionFee -> set reimbursement = fee_in_token -> partial-sign (buyer + new
// account) -> signTransaction (Kora adds the fee-payer sig) -> submit raw to devnet -> verify the
// buyer's SOL is untouched and only USDC moved.

const web3 = require('@solana/web3.js');
const fs = require('fs');
const {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} = require('@solana/spl-token');

const KORA_URL = process.env.KORA_URL || 'http://localhost:8080';
const RPC = 'https://api.devnet.solana.com';
const USDC = new web3.PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const FEE_PAYER = new web3.PublicKey('89CGD862LLSPDHef7mLg78vtiwLy19mwMfH3UePurd9n');
const SPONSOR_USDC_ATA = new web3.PublicKey('cLe7n9oQmB2GJpWFvkE22Ves32F1ybV299ScYeigCNF');

async function rpc(method, params) {
  const res = await fetch(KORA_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json();
}

function loadKeypair(path) {
  return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path))));
}

// Build the gasless tx. `reimburse` = USDC micros the buyer pays the sponsor (0 = estimate pass).
function buildTx(blockhash, buyer, newAcct, rentLamports, reimburse) {
  const buyerAta = getAssociatedTokenAddressSync(USDC, buyer.publicKey);
  const tx = new web3.Transaction();
  tx.feePayer = FEE_PAYER;
  tx.recentBlockhash = blockhash;
  // (1) Sponsor funds a brand-new account's rent — stand-in for the purchase_skill PDA.
  tx.add(
    web3.SystemProgram.createAccount({
      fromPubkey: FEE_PAYER, // rent payer = sponsor (allow_create_account = true)
      newAccountPubkey: newAcct.publicKey,
      lamports: rentLamports,
      space: 0,
      programId: web3.SystemProgram.programId,
    }),
  );
  // (2) Buyer reimburses the sponsor in USDC. Authority = buyer (the only thing the user signs).
  tx.add(
    createTransferCheckedInstruction(
      buyerAta,
      USDC,
      SPONSOR_USDC_ATA,
      buyer.publicKey,
      reimburse,
      6,
    ),
  );
  tx.partialSign(newAcct, buyer); // only the fee-payer (sponsor) signature is left for Kora
  return tx;
}

const b64 = (tx) =>
  tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');

(async () => {
  const conn = new web3.Connection(RPC, 'confirmed');
  const buyer = loadKeypair('.agent-keys/kora/buyer.json');
  const buyerAta = getAssociatedTokenAddressSync(USDC, buyer.publicKey);
  const rentLamports = await conn.getMinimumBalanceForRentExemption(0);

  const solBefore = await conn.getBalance(buyer.publicKey);
  const usdcBefore = (await conn.getTokenAccountBalance(buyerAta)).value.amount;
  console.log(`buyer ${buyer.publicKey.toBase58()}`);
  console.log(`  before:  SOL=${solBefore}  USDC=${usdcBefore} micros\n`);

  // --- estimate (placeholder reimbursement; estimate does not enforce payment) ---
  let { blockhash } = await conn.getLatestBlockhash();
  const est = await rpc('estimateTransactionFee', {
    transaction: b64(buildTx(blockhash, buyer, web3.Keypair.generate(), rentLamports, 1)),
    fee_token: USDC.toBase58(),
  });
  if (!est.result) throw new Error('estimate failed: ' + JSON.stringify(est.error));
  const feeInToken = Number(est.result.fee_in_token);
  const reimburse = Math.ceil(feeInToken * 1.02); // 2% headroom over the quote
  console.log(`estimate: fee_in_lamports=${est.result.fee_in_lamports} fee_in_token=${feeInToken} micro-USDC`);
  console.log(`buyer will reimburse ${reimburse} micro-USDC (${(reimburse / 1e6).toFixed(4)} USDC)\n`);

  // --- sign (Kora enforces fee_payer_policy + token payment here) ---
  ({ blockhash } = await conn.getLatestBlockhash());
  const newAcct = web3.Keypair.generate();
  const signed = await rpc('signTransaction', {
    transaction: b64(buildTx(blockhash, buyer, newAcct, rentLamports, reimburse)),
    sig_verify: false,
  });
  if (!signed.result) throw new Error('signTransaction REJECTED -> ' + signed.error?.message);
  console.log('signTransaction -> SIGNED by Kora (sponsor added fee-payer signature)');

  // --- submit the Kora-signed tx to devnet ---
  const raw = Buffer.from(signed.result.signed_transaction, 'base64');
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false });
  await conn.confirmTransaction(sig, 'confirmed');
  console.log(`submitted: https://explorer.solana.com/tx/${sig}?cluster=devnet\n`);

  // --- verify: buyer paid ZERO SOL, only USDC moved; new account funded by sponsor ---
  const solAfter = await conn.getBalance(buyer.publicKey);
  const usdcAfter = (await conn.getTokenAccountBalance(buyerAta)).value.amount;
  const newAcctLamports = await conn.getBalance(newAcct.publicKey);
  console.log(`buyer after:  SOL=${solAfter}  USDC=${usdcAfter} micros`);
  console.log(`  SOL delta:  ${solAfter - solBefore} lamports  (must be 0 -> user paid no gas/rent)`);
  console.log(`  USDC delta: ${usdcAfter - usdcBefore} micros   (the reimbursement)`);
  console.log(`new account funded by sponsor: ${newAcctLamports} lamports rent`);
  console.log(
    solAfter === solBefore
      ? '\nPROVEN: zero-SOL buyer transacted; Kora sponsored gas+rent, buyer paid only USDC.'
      : '\nWARNING: buyer SOL changed — not fully gasless.',
  );
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
