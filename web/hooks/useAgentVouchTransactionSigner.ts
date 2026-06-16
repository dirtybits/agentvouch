import { useMemo } from "react";
import {
  useKitTransactionSigner,
  useTransactionSigner,
} from "@solana/connector/react";
import { useAgentVouchWalletSigner } from "@/components/WalletContextProvider";
import {
  address,
  getBase58Encoder,
  getTransactionEncoder,
  signatureBytes,
  type TransactionSendingSigner,
  type TransactionSigner,
} from "@solana/kit";

export function useAgentVouchTransactionSigner() {
  const direct = useAgentVouchWalletSigner();
  const { signer: kitSigner } = useKitTransactionSigner();
  const { signer: connectorSigner, capabilities } = useTransactionSigner();
  const activeConnectorSigner = direct.connectorSigner ?? connectorSigner;
  const activeCapabilities = direct.connectorSigner
    ? direct.capabilities
    : capabilities;

  const partialSigner =
    direct.kitSigner ?? (activeCapabilities.canSign ? kitSigner : null);

  const sendingSigner = useMemo<TransactionSigner | null>(() => {
    if (
      !activeConnectorSigner ||
      !activeCapabilities.canSend ||
      activeCapabilities.canSign
    ) {
      return null;
    }

    const signerAddress = address(activeConnectorSigner.address);
    const base58Encoder = getBase58Encoder();
    const transactionEncoder = getTransactionEncoder();
    const signer: TransactionSendingSigner = {
      address: signerAddress,
      async signAndSendTransactions(transactions, config) {
        const signatures = [];
        for (const transaction of transactions) {
          config?.abortSignal?.throwIfAborted();
          const transactionBytes = transactionEncoder.encode(transaction);
          const txSignature =
            await activeConnectorSigner.signAndSendTransaction(
              transactionBytes as unknown as Parameters<
                typeof activeConnectorSigner.signAndSendTransaction
              >[0]
            );
          signatures.push(signatureBytes(base58Encoder.encode(txSignature)));
        }
        config?.abortSignal?.throwIfAborted();
        return signatures;
      },
    };

    return signer;
  }, [
    activeCapabilities.canSend,
    activeCapabilities.canSign,
    activeConnectorSigner,
  ]);

  return useMemo(
    () => ({
      signer: sendingSigner ?? partialSigner,
      partialSigner,
      connectorSigner: activeConnectorSigner,
      capabilities: activeCapabilities,
      signMessage:
        direct.signMessage ?? activeConnectorSigner?.signMessage ?? null,
      source: direct.source,
      ready: Boolean(sendingSigner ?? partialSigner),
    }),
    [
      activeCapabilities,
      activeConnectorSigner,
      direct.signMessage,
      direct.source,
      partialSigner,
      sendingSigner,
    ]
  );
}
