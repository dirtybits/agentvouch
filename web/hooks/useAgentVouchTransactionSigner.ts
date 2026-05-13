import { useMemo } from "react";
import {
  useKitTransactionSigner,
  useTransactionSigner,
} from "@solana/connector/react";
import {
  address,
  getBase58Encoder,
  getTransactionEncoder,
  signatureBytes,
  type TransactionSendingSigner,
  type TransactionSigner,
} from "@solana/kit";

export function useAgentVouchTransactionSigner() {
  const { signer: kitSigner } = useKitTransactionSigner();
  const { signer: connectorSigner, capabilities } = useTransactionSigner();

  const partialSigner = capabilities.canSign ? kitSigner : null;

  const sendingSigner = useMemo<TransactionSigner | null>(() => {
    if (!connectorSigner || !capabilities.canSend || capabilities.canSign) {
      return null;
    }

    const signerAddress = address(connectorSigner.address);
    const base58Encoder = getBase58Encoder();
    const transactionEncoder = getTransactionEncoder();
    const signer: TransactionSendingSigner = {
      address: signerAddress,
      async signAndSendTransactions(transactions, config) {
        const signatures = [];
        for (const transaction of transactions) {
          config?.abortSignal?.throwIfAborted();
          const transactionBytes = transactionEncoder.encode(transaction);
          const txSignature = await connectorSigner.signAndSendTransaction(
            transactionBytes as unknown as Parameters<
              typeof connectorSigner.signAndSendTransaction
            >[0]
          );
          signatures.push(signatureBytes(base58Encoder.encode(txSignature)));
        }
        config?.abortSignal?.throwIfAborted();
        return signatures;
      },
    };

    return signer;
  }, [capabilities.canSend, capabilities.canSign, connectorSigner]);

  return useMemo(
    () => ({
      signer: sendingSigner ?? partialSigner,
      partialSigner,
      connectorSigner,
      capabilities,
      ready: Boolean(sendingSigner ?? partialSigner),
    }),
    [capabilities, connectorSigner, partialSigner, sendingSigner]
  );
}
