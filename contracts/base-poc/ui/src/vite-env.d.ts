/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CDP_RPC_URL?: string;
  readonly VITE_BASE_SEPOLIA_RPC_URL?: string;
  readonly VITE_AGENTVOUCH_ADDRESS?: string;
  readonly VITE_USDC_ADDRESS?: string;
  readonly VITE_AUTHOR_OWNER_PK?: string;
  readonly VITE_BUYER_OWNER_PK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
