import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("wallet detection source", () => {
  const providerSource = readFileSync(
    join(process.cwd(), "components", "WalletContextProvider.tsx"),
    "utf8"
  );
  const buttonSource = readFileSync(
    join(process.cwd(), "components", "ClientWalletButton.tsx"),
    "utf8"
  );
  const legacySource = readFileSync(
    join(process.cwd(), "lib", "phantomLegacyWalletStandard.ts"),
    "utf8"
  );
  const transactionSignerSource = readFileSync(
    join(process.cwd(), "hooks", "useAgentVouchTransactionSigner.ts"),
    "utf8"
  );

  it("adds Phantom legacy injection as a Wallet Standard fallback", () => {
    expect(providerSource).toContain("getPhantomLegacyProvider");
    expect(providerSource).toContain("createPhantomLegacyWallet");
    expect(providerSource).toContain(
      "...(phantomLegacy ? [phantomLegacy.wallet] : [])"
    );
    expect(legacySource).toContain("window as PhantomWindow");
    expect(legacySource).toContain("phantom?.solana");
    expect(legacySource).toContain("provider.isPhantom === true");
    expect(legacySource).toContain("provider,");
  });

  it("remounts ConnectorKit when late Phantom detection changes config", () => {
    expect(providerSource).toContain("connectorConfigKey");
    expect(providerSource).toContain("key={connectorConfigKey}");
  });

  it("owns silent reconnect for the previously selected wallet", () => {
    expect(providerSource).toContain("StoredWalletAutoConnectBridge");
    expect(providerSource).toContain("autoConnect: false");
    expect(providerSource).toContain("agentvouch:v1:wallet");
    expect(providerSource).toContain("connector-kit:v1:wallet");
    expect(providerSource).toContain("const [initialWalletName]");
    expect(providerSource).toContain("initialWalletName={initialWalletName}");
    expect(providerSource).toContain("wasConnectedRef");
    expect(providerSource).toContain(
      "connectors.find((c) => c.name === storedWalletName)"
    );
    expect(providerSource).toContain("silent: true");
    expect(providerSource).toContain("allowInteractiveFallback: false");
  });

  it("prefers an app-owned Phantom extension session for critical flows", () => {
    expect(providerSource).toContain("AgentVouchWalletBridge");
    expect(providerSource).toContain("connectPhantomExtension");
    expect(providerSource).toContain("PHANTOM_LEGACY_WALLET_NAME");
    expect(providerSource).toContain("connectFeature.connect(");
    expect(providerSource).toContain("silent: true");
    expect(providerSource).toContain('source === "phantom-extension"');
    expect(buttonSource).toContain("useAgentVouchWallet");
    expect(buttonSource).toContain("wallet.connectPhantomExtension()");
    expect(transactionSignerSource).toContain("useAgentVouchWalletSigner");
    expect(transactionSignerSource).toContain("direct.kitSigner");
  });

  it("invalidates a stale Base passkey restore before switching to Solana", () => {
    expect(providerSource).toContain("baseRestoreGenerationRef");
    expect(providerSource).toContain(
      "baseRestoreGenerationRef.current !== restoreGeneration"
    );
    expect(providerSource).toContain("baseRestoreGenerationRef.current += 1");
    expect(buttonSource).toContain("baseWallet.disconnect()");
    expect(buttonSource).toContain(
      ".then(() => wallet.connectPhantomExtension())"
    );
    expect(buttonSource).toContain("onPointerDownCapture");
  });

  it("deduplicates extension wallet entries by display name", () => {
    expect(buttonSource).toContain("dedupeConnectorsByName");
    expect(buttonSource).toContain("connector.name.toLowerCase()");
  });

  it("shows a copyable full address in the connected wallet menu", () => {
    expect(buttonSource).toContain("navigator.clipboard.writeText(address)");
    expect(buttonSource).toContain('aria-label="Copy wallet address"');
    expect(buttonSource).toContain("FiCopy");
    expect(buttonSource).toContain("{address}");
    expect(buttonSource).toContain("addressMenuSection");
    expect(buttonSource).toContain("baseWallet.account");
    expect(buttonSource).toContain("solanaUsdcBalance");
  });

  it("shows USDC balances in the connected wallet menu", () => {
    expect(buttonSource).toContain("fetchBaseUsdcBalance(account)");
    expect(buttonSource).toContain("formatBaseUsdc(balance)");
    expect(buttonSource).toContain("fetchAssociatedTokenAccountState");
    expect(buttonSource).toContain("formatUsdcMicrosValue");
    expect(buttonSource).toContain("{balance.value} USDC");
  });
});
