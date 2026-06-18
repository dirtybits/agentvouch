const WALLET_FALLBACK_USERNAME_LENGTH = 6;

export type WalletAuthorIdentity = {
  username?: string | null;
  usernameSource?: string | null;
};

export function buildWalletFallbackUsername(walletPubkey: string): string {
  const prefix = walletPubkey
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, WALLET_FALLBACK_USERNAME_LENGTH)
    .toLowerCase();
  return `wallet-${prefix || "agent"}`;
}

function isGeneratedWalletUsername(
  username: string,
  usernameSource: string | null | undefined
): boolean {
  return (
    usernameSource === "fallback" ||
    (!usernameSource && /^wallet-[a-z0-9]{6}$/.test(username.toLowerCase()))
  );
}

export function formatWalletAuthorLabel(
  walletPubkey: string,
  identity?: WalletAuthorIdentity | null
): string {
  const username = identity?.username?.trim();
  if (
    username &&
    !isGeneratedWalletUsername(username, identity?.usernameSource)
  ) {
    return `@${username}`;
  }
  return buildWalletFallbackUsername(walletPubkey);
}

export function shortWalletAddress(walletPubkey: string): string {
  return `${walletPubkey.slice(0, 4)}...${walletPubkey.slice(-4)}`;
}
