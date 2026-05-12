import {
  address,
  fetchEncodedAccount,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";

export const USDC_DECIMALS = 6;
export const USDC_MICROS_PER_USDC = 1_000_000n;
export const TOKEN_PROGRAM_ID = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
export const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

type Rpc = Parameters<typeof fetchEncodedAccount>[0];

export type SendInstructionAccount = {
  address: Address;
  role: number;
  signer?: TransactionSigner;
};

export type AgentVouchTransactionSummary = {
  action: string;
  token?: "USDC" | "SOL";
  amountUsdcMicros?: bigint;
  recipient?: Address | string;
  vault?: Address | string;
  feePayer: Address | string;
  cluster: string;
};

export type TokenAccountState =
  | {
      address: Address;
      exists: false;
      amount: 0n;
      mint: null;
      owner: null;
      validLayout: false;
    }
  | {
      address: Address;
      exists: true;
      amount: bigint;
      mint: Address;
      owner: Address;
      validLayout: boolean;
    };

export function usdcToMicros(amountUsdc: number): bigint {
  if (!Number.isFinite(amountUsdc) || amountUsdc < 0) {
    throw new Error("USDC amount must be a non-negative number");
  }
  return BigInt(Math.round(amountUsdc * Number(USDC_MICROS_PER_USDC)));
}

export function formatUsdcMicrosValue(
  micros: bigint | number | string | null | undefined,
  minimumFractionDigits = 2
) {
  if (micros === null || micros === undefined) return "0.00";
  const value = typeof micros === "bigint" ? micros : BigInt(micros);
  const whole = value / USDC_MICROS_PER_USDC;
  const fraction = value % USDC_MICROS_PER_USDC;
  const amount = Number(whole) + Number(fraction) / Number(USDC_MICROS_PER_USDC);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits,
    maximumFractionDigits: USDC_DECIMALS,
  }).format(amount);
}

export async function getAssociatedTokenAccount(
  owner: Address,
  mint: Address
): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [
      addressEncoder.encode(owner),
      addressEncoder.encode(TOKEN_PROGRAM_ID),
      addressEncoder.encode(mint),
    ],
  });
  return ata;
}

export async function fetchTokenAccountState(
  rpc: Rpc,
  tokenAccount: Address
): Promise<TokenAccountState> {
  const account = await fetchEncodedAccount(rpc, tokenAccount);
  if (!account.exists) {
    return {
      address: tokenAccount,
      exists: false,
      amount: 0n,
      mint: null,
      owner: null,
      validLayout: false,
    };
  }

  if (account.data.length < 72) {
    return {
      address: tokenAccount,
      exists: true,
      amount: 0n,
      mint: address("11111111111111111111111111111111"),
      owner: address("11111111111111111111111111111111"),
      validLayout: false,
    };
  }

  const mint = addressDecoder.decode(account.data.slice(0, 32));
  const owner = addressDecoder.decode(account.data.slice(32, 64));
  const amount = new DataView(
    account.data.buffer,
    account.data.byteOffset + 64,
    8
  ).getBigUint64(0, true);

  return {
    address: tokenAccount,
    exists: true,
    amount,
    mint,
    owner,
    validLayout: true,
  };
}

export async function fetchAssociatedTokenAccountState(
  rpc: Rpc,
  owner: Address,
  mint: Address
) {
  const tokenAccount = await getAssociatedTokenAccount(owner, mint);
  return fetchTokenAccountState(rpc, tokenAccount);
}

export async function assertUsdcAccountReady({
  rpc,
  owner,
  mint,
  purpose,
  minimumBalanceUsdcMicros = 0n,
}: {
  rpc: Rpc;
  owner: Address;
  mint: Address;
  purpose: string;
  minimumBalanceUsdcMicros?: bigint;
}) {
  const tokenAccount = await getAssociatedTokenAccount(owner, mint);
  const state = await fetchTokenAccountState(rpc, tokenAccount);
  const ownerLabel = `${String(owner).slice(0, 4)}...${String(owner).slice(-4)}`;

  if (!state.exists) {
    throw new Error(
      `${purpose} requires a USDC associated token account for ${ownerLabel} on the configured mint. Create or fund that token account and retry.`
    );
  }
  if (!state.validLayout || state.mint !== mint || state.owner !== owner) {
    throw new Error(
      `${purpose} found a token account that does not match the configured USDC mint and owner.`
    );
  }
  if (state.amount < minimumBalanceUsdcMicros) {
    throw new Error(
      `${purpose} needs ${formatUsdcMicrosValue(
        minimumBalanceUsdcMicros
      )} USDC, but the connected USDC account has ${formatUsdcMicrosValue(
        state.amount
      )} USDC.`
    );
  }

  return { tokenAccount, state };
}

export function getCreateAssociatedTokenAccountIdempotentInstruction({
  payer,
  associatedTokenAccount,
  owner,
  mint,
}: {
  payer: TransactionSigner;
  associatedTokenAccount: Address;
  owner: Address;
  mint: Address;
}) {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: new Uint8Array([1]) as ReadonlyUint8Array,
    accounts: [
      { address: payer.address, role: 3, signer: payer },
      { address: associatedTokenAccount, role: 1 },
      { address: owner, role: 0 },
      { address: mint, role: 0 },
      { address: SYSTEM_PROGRAM_ID, role: 0 },
      { address: TOKEN_PROGRAM_ID, role: 0 },
    ] satisfies SendInstructionAccount[],
  };
}

export function logTransactionSummary(summary: AgentVouchTransactionSummary) {
  console.info("[agentvouch:transaction]", {
    ...summary,
    amountUsdc: summary.amountUsdcMicros
      ? formatUsdcMicrosValue(summary.amountUsdcMicros)
      : undefined,
  });
}
