"use client";

import {
  createWebAuthnCredential,
  toCoinbaseSmartAccount,
  toWebAuthnAccount,
  type SmartAccount,
} from "viem/account-abstraction";
import { createPublicClient, http, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import {
  BASE_SEPOLIA_RPC_URL,
  BASE_WALLET_UNCONFIGURED_MESSAGE,
  getBaseWalletConfig,
} from "./baseWalletConfig";

const PASSKEY_STORAGE_KEY = "agentvouch:base-sepolia:passkey";
const PASSKEY_ACTIVE_STORAGE_KEY = "agentvouch:base-sepolia:passkey:active";

type StoredCredential = { id: string; publicKey: Hex };

export type BasePasskeySmartAccount = SmartAccount;

function readStoredCredential(): StoredCredential | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PASSKEY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCredential>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.publicKey !== "string" ||
      !/^0x[0-9a-fA-F]+$/.test(parsed.publicKey)
    ) {
      return null;
    }
    return { id: parsed.id, publicKey: parsed.publicKey as Hex };
  } catch {
    return null;
  }
}

function saveCredential(credential: StoredCredential): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(credential));
}

function setPasskeyActive(active: boolean): void {
  if (typeof window === "undefined") return;
  if (active) {
    window.localStorage.setItem(PASSKEY_ACTIVE_STORAGE_KEY, "1");
    return;
  }
  window.localStorage.removeItem(PASSKEY_ACTIVE_STORAGE_KEY);
}

function isPasskeyActive(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PASSKEY_ACTIVE_STORAGE_KEY) === "1";
}

async function accountForCredential(
  credential: StoredCredential
): Promise<BasePasskeySmartAccount> {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC_URL),
  });
  const owner = toWebAuthnAccount({ credential });
  return toCoinbaseSmartAccount({
    client: publicClient,
    owners: [owner],
    version: "1.1",
  });
}

export async function restoreBasePasskeyAccount(): Promise<BasePasskeySmartAccount | null> {
  if (!getBaseWalletConfig().configured) return null;
  if (!isPasskeyActive()) return null;
  const credential = readStoredCredential();
  if (!credential) return null;
  return accountForCredential(credential);
}

export async function createBasePasskeyAccount(): Promise<BasePasskeySmartAccount> {
  if (!getBaseWalletConfig().configured) {
    throw new Error(BASE_WALLET_UNCONFIGURED_MESSAGE);
  }

  const stored = readStoredCredential();
  if (stored) {
    setPasskeyActive(true);
    return accountForCredential(stored);
  }

  // Shows the OS passkey prompt, so callers must invoke this from a user gesture.
  const credential = await createWebAuthnCredential({
    name: "AgentVouch Base Sepolia",
  });
  const next: StoredCredential = {
    id: credential.id,
    publicKey: credential.publicKey,
  };
  saveCredential(next);
  setPasskeyActive(true);
  return accountForCredential(next);
}

export function disconnectBasePasskeyAccount(): void {
  setPasskeyActive(false);
}
