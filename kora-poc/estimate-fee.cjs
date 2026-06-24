// Spike probe: build a minimal allowed tx (sponsor as fee payer) and ask the
// local Kora node to quote the fee in USDC via Margin pricing.
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

  const tx = new web3.Transaction();
  tx.feePayer = new web3.PublicKey(FEE_PAYER);
  tx.recentBlockhash = blockhash;
  // Only ComputeBudget instructions -> touches an allowlisted program, no transfers,
  // fee payer is not a source of value (passes the anti-drain fee_payer_policy).
  tx.add(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(
    web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })
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
