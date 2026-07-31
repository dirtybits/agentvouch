export function buildCardRecourseConsentKey(input: {
  skillDbId: string | null;
  buyerAccountId?: string | null;
  walletChainContext?: string | null;
  walletAddress?: string | null;
}): string | null {
  const skillDbId = input.skillDbId?.trim();
  if (!skillDbId) return null;

  const buyerAccountId = input.buyerAccountId?.trim();
  if (buyerAccountId) return `${skillDbId}:account:${buyerAccountId}`;

  const walletAddress = input.walletAddress?.trim();
  const walletChainContext = input.walletChainContext?.trim();
  if (!walletAddress || !walletChainContext) return null;
  return `${skillDbId}:wallet:${walletChainContext}:${walletAddress}`;
}

export function hasCurrentCardRecourseConsent(
  acceptedKey: string | null,
  currentKey: string | null
): boolean {
  return currentKey !== null && acceptedKey === currentKey;
}
