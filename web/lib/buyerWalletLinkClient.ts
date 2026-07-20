export const WALLET_OWNED_BY_OTHER_ACCOUNT_CODE =
  "wallet_owned_by_other_account";

export type PendingWalletLinkAction = "wait" | "already-linked" | "link";

export function resolvePendingWalletLinkAction(input: {
  hasPendingTarget: boolean;
  connecting: boolean;
  linking: boolean;
  canSign: boolean;
  targetConnected: boolean;
  currentWalletLinked: boolean;
}): PendingWalletLinkAction {
  if (
    !input.hasPendingTarget ||
    input.connecting ||
    input.linking ||
    !input.canSign ||
    !input.targetConnected
  ) {
    return "wait";
  }
  return input.currentWalletLinked ? "already-linked" : "link";
}

export async function walletLinkResponseError(
  response: Response
): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    code?: unknown;
    error?: unknown;
  } | null;
  if (body?.code === WALLET_OWNED_BY_OTHER_ACCOUNT_CODE) {
    return "This wallet is already linked to another AgentVouch account. Sign in to that account or connect a different wallet.";
  }
  return typeof body?.error === "string"
    ? body.error
    : `Request failed (${response.status}).`;
}
