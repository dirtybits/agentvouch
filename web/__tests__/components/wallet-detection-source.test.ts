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

  it("adds Phantom legacy injection as a Wallet Standard fallback", () => {
    expect(providerSource).toContain("getPhantomLegacyProvider");
    expect(providerSource).toContain("createPhantomLegacyWallet");
    expect(providerSource).toContain(
      "...(phantomLegacy ? [phantomLegacy.wallet] : [])"
    );
    expect(legacySource).toContain("window as PhantomWindow");
    expect(legacySource).toContain("phantom?.solana");
    expect(legacySource).toContain("provider.isPhantom === true");
  });

  it("remounts ConnectorKit when late Phantom detection changes config", () => {
    expect(providerSource).toContain("connectorConfigKey");
    expect(providerSource).toContain("key={connectorConfigKey}");
  });

  it("deduplicates extension wallet entries by display name", () => {
    expect(buttonSource).toContain("dedupeConnectorsByName");
    expect(buttonSource).toContain("connector.name.toLowerCase()");
  });
});
