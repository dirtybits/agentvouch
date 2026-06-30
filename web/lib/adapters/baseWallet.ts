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
  BASE_PASSKEY_WALLET_NAME,
  BASE_SEPOLIA_RPC_URL,
  getBaseWalletConfig,
} from "./baseWalletConfig";
import type { ChainWallet, TxResult, X402Payment } from "./types";

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
  if (!isPasskeyActive()) return null;
  const credential = readStoredCredential();
  if (!credential) return null;
  return accountForCredential(credential);
}

export async function createBasePasskeyAccount(): Promise<BasePasskeySmartAccount> {
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

function unsupportedPhase5(method: string): Promise<TxResult> {
  return Promise.reject(
    new Error(
      `${method} is part of AgentVouch Base Phase 5. Phase 4 only connects the ${BASE_PASSKEY_WALLET_NAME} passkey wallet.`
    )
  );
}

export function createBasePasskeyChainWallet(
  account: BasePasskeySmartAccount,
  disconnect: () => Promise<void>
): ChainWallet {
  const config = getBaseWalletConfig();
  return {
    chainContext: config.chainContext,
    address: account.address,
    disconnect,
    registerAgent: () => unsupportedPhase5("registerAgent"),
    createSkillListing: () => unsupportedPhase5("createSkillListing"),
    purchaseSkill: () => unsupportedPhase5("purchaseSkill"),
    buildX402Payment: (): Promise<X402Payment> =>
      Promise.reject(
        new Error(
          "buildX402Payment is part of AgentVouch Base Phase 5. Phase 4 only connects the passkey wallet."
        )
      ),
  };
}
