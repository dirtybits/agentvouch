import { createLocalKeyAccount } from "./localKey";
import { createPasskeyAccount } from "./passkey";
import { createMetaMask7702Account } from "./metamask7702";
import type { AccountKind, Role } from "./types";

export function createAccount(kind: AccountKind, role: Role) {
  switch (kind) {
    case "localKey":
      return createLocalKeyAccount(role);
    case "passkey":
      return createPasskeyAccount(role);
    case "metamask7702":
      return createMetaMask7702Account(role);
  }
}

export * from "./types";
