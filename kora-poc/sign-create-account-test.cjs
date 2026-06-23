// Rent-gate proof against the ENFORCING method (signTransaction calls validate_transaction;
// estimateTransactionFee does not). Sponsor funds a CreateAccount; the new account is
// partial-signed locally so the only missing signature is the fee payer's (Kora's).
//   allow_create_account = false -> Kora rejects with a CreateAccount policy error
//   allow_create_account = true  -> Kora returns a signed transaction
const web3 = require('@solana/web3.js');

const KORA_URL = process.env.KORA_URL || 'http://localhost:8080';
const FEE_PAYER = '89CGD862LLSPDHef7mLg78vtiwLy19mwMfH3UePurd9n';

async function rpc(method, params) {
  const res = await fetch(KORA_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json();
}

(async () => {
  const conn = new web3.Connection('https://api.devnet.solana.com', 'confirmed');
  const { blockhash } = await conn.getLatestBlockhash();
  const feePayer = new web3.PublicKey(FEE_PAYER);
  const newAcct = web3.Keypair.generate();

  const tx = new web3.Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  tx.add(
    web3.SystemProgram.createAccount({
      fromPubkey: feePayer, // sponsor funds the rent = the gated action
      newAccountPubkey: newAcct.publicKey,
      lamports: await conn.getMinimumBalanceForRentExemption(0),
      space: 0,
      programId: web3.SystemProgram.programId,
    }),
  );
  tx.partialSign(newAcct); // only the fee payer signature is now missing (Kora's job)

  const b64 = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');

  const out = await rpc('signTransaction', { transaction: b64, sig_verify: false });
  const r = out.result ? 'SIGNED (policy allowed it)' : `REJECTED -> ${out.error?.message}`;
  console.log(r);
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
