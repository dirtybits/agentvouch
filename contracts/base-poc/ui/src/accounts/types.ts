import type { SmartAccount } from "viem/account-abstraction";

export type Role = "author" | "buyer";
export type AccountKind = "localKey" | "passkey" | "metamask7702";

export interface AccountKindMeta {
  kind: AccountKind;
  label: string;
  blurb: string;
  enabled: boolean;
}

export const ACCOUNT_KINDS: AccountKindMeta[] = [
  {
    kind: "localKey",
    label: "Local key",
    blurb: "Generated key in localStorage. No wallet install. Dev / fallback.",
    enabled: true,
  },
  {
    kind: "passkey",
    label: "Passkey (Coinbase Smart Wallet)",
    blurb: "Face / Touch ID, no extension. The real-flow demo.",
    enabled: true,
  },
  {
    kind: "metamask7702",
    label: "MetaMask + EIP-7702",
    blurb: "Your existing wallet, sponsored via 7702. Pending the 7702 spike.",
    enabled: false,
  },
];

export interface RoleAccount {
  role: Role;
  account: SmartAccount;
}
