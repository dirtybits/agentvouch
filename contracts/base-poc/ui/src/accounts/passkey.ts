import {
  createWebAuthnCredential,
  toWebAuthnAccount,
  toCoinbaseSmartAccount,
} from "viem/account-abstraction";
import type { Hex } from "viem";
import { publicClient } from "../config";
import type { Role } from "./types";

const lsKey = (role: Role) => `agentvouch-ui:passkey:${role}`;

type StoredCredential = { id: string; publicKey: Hex };

// A WebAuthn passkey is the smart-account owner. We persist {id, publicKey} so the same
// passkey -> same smart-account address across reloads. createWebAuthnCredential() shows
// the OS passkey prompt, so it MUST be called from within a user gesture (button click).
async function credentialFor(role: Role): Promise<StoredCredential> {
  const raw = localStorage.getItem(lsKey(role));
  if (raw) return JSON.parse(raw) as StoredCredential;

  const credential = await createWebAuthnCredential({
    name: `AgentVouch Demo — ${role}`,
  });
  const stored: StoredCredential = {
    id: credential.id,
    publicKey: credential.publicKey,
  };
  localStorage.setItem(lsKey(role), JSON.stringify(stored));
  return stored;
}

export async function createPasskeyAccount(role: Role) {
  const credential = await credentialFor(role);
  const owner = toWebAuthnAccount({ credential });
  return toCoinbaseSmartAccount({
    client: publicClient,
    owners: [owner],
    version: "1.1",
  });
}
