// Rent-question probe: a tx where the FEE PAYER (Kora sponsor) funds a new account
// via System CreateAccount. This is the same gate (fee_payer_policy.system.allow_create_account)
// that fires on the CPI'd Purchase-PDA rent inside purchase_skill.
//   allow_create_account = false -> Kora rejects (validation error mentioning CreateAccount)
//   allow_create_account = true  -> passes validation (only the on-chain sim may complain)
const web3 = require("@solana/web3.js");

const KORA_URL = process.env.KORA_URL || "http://localhost:8080";
const FEE_PAYER = "89CGD862LLSPDHef7mLg78vtiwLy19mwMfH3UePurd9n";
const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

async function rpc(method, params) {
  const res = await fetch(KORA_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

(async () => {
  const conn = new web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );
  const { blockhash } = await conn.getLatestBlockhash();
  const feePayer = new web3.PublicKey(FEE_PAYER);
  const newAcct = web3.Keypair.generate();

  const tx = new web3.Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  tx.add(
    web3.SystemProgram.createAccount({
      fromPubkey: feePayer, // <-- sponsor funds the new account = the gated action
      newAccountPubkey: newAcct.publicKey,
      lamports: await conn.getMinimumBalanceForRentExemption(0),
      space: 0,
      programId: web3.SystemProgram.programId,
    })
  );

  const b64 = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

  const out = await rpc("estimateTransactionFee", {
    transaction: b64,
    fee_token: USDC_DEVNET,
    sig_verify: false,
  });
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
