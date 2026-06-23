import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import type { Hex } from "viem";
import { publicClient, prefundedOwnerPks } from "../config";
import type { Role } from "./types";

const lsKey = (role: Role) => `agentvouch-ui:localkey:${role}`;

// Resolve a stable owner key per role: prefer an env-baked pre-funded key, else reuse the
// one persisted in localStorage, else generate + persist one. Stability matters so the
// smart-account address (which you fund) doesn't change between reloads.
function ownerPkFor(role: Role): Hex {
  const prefunded = prefundedOwnerPks[role];
  if (prefunded) return prefunded as Hex;

  const existing = localStorage.getItem(lsKey(role));
  if (existing) return existing as Hex;

  const pk = generatePrivateKey();
  localStorage.setItem(lsKey(role), pk);
  return pk;
}

export function createLocalKeyAccount(role: Role) {
  const owner = privateKeyToAccount(ownerPkFor(role));
  return toCoinbaseSmartAccount({
    client: publicClient,
    owners: [owner],
    version: "1.1",
  });
}
