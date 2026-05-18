import {
  createSolanaRpcClient,
  createTransactionHelper,
} from "@solana/client";

const ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

const WEBSOCKET_ENDPOINT = ENDPOINT.startsWith("https://")
  ? ENDPOINT.replace("https://", "wss://")
  : ENDPOINT.startsWith("http://")
  ? ENDPOINT.replace("http://", "ws://")
  : ENDPOINT;

let transactionHelper: ReturnType<typeof createTransactionHelper> | null = null;

export function getClientTransactionHelper() {
  transactionHelper ??= createTransactionHelper(
    createSolanaRpcClient({
      endpoint: ENDPOINT,
      websocketEndpoint: WEBSOCKET_ENDPOINT,
    }),
    () => "confirmed"
  );
  return transactionHelper;
}
