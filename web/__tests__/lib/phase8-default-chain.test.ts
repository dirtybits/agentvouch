import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

// Phase 8a — Base Sepolia default (.agents/plans/base-port-chain-adapter-phase-8a.plan.md).
// Behavioral coverage for getDefaultChainContext lives in chains.test.ts; these source
// assertions lock the default-chain wiring across the wallet provider, connect menu,
// paid publish path, and publisher API.

describe("phase 8a: wallet precedence follows the default chain", () => {
  it("provider resolves a dual restore by default chain, not hard-coded Solana", () => {
    const source = read("components/WalletContextProvider.tsx");
    expect(source).toContain("isBaseSepoliaDefaultEnabled");
    // Base default drops the Solana session; rollback drops the Base session.
    expect(source).toContain("void disconnectBasePasskey();");
    expect(source).toContain("void disconnectBaseInjected();");
    // Strict Mode restore guard stays.
    expect(source).toContain("cancelled = true");
  });

  it("useChainWallet keeps one active wallet with default-chain precedence", () => {
    const source = read("components/WalletContextProvider.tsx");
    expect(source).toMatch(
      /solanaConnected && \(!baseSepoliaDefault \|\| !baseConnected\)/
    );
  });

  it("connect menu orders Base Sepolia by the default without hiding either chain", () => {
    const source = read("components/ClientWalletButton.tsx");
    expect(source).toContain("isBaseSepoliaDefaultEnabled");
    expect(source).toContain("{baseSepoliaDefault && baseSection}");
    expect(source).toContain("{!baseSepoliaDefault && baseSection}");
    // Base stays selectable under rollback: exactly one baseSection render per mode.
    expect(source).toContain("Base Sepolia");
    expect(source).toContain("BASE_INJECTED_WALLET_NAME");
  });
});

describe("phase 8a: paid publish goes through the ChainWallet seam", () => {
  it("publish page creates Base listings via ChainWallet.createSkillListing", () => {
    const source = read("app/skills/publish/page.tsx");
    expect(source).toContain("baseChainWallet.createSkillListing");
    expect(source).toContain("baseListing:");
    expect(source).toContain("expectedPriceUsdcMicros");
  });

  it("publish page keeps the Solana oracle path for rollback/Solana wallets", () => {
    const source = read("app/skills/publish/page.tsx");
    expect(source).toContain("oracle.createSkillListing");
    expect(source).toContain("getSkillListingPDA");
    expect(source).toContain("on_chain_address: onChainAddress");
  });

  it("Base paid publish is not gated on the Solana AgentProfile modal", () => {
    const source = read("app/skills/publish/page.tsx");
    // Every Solana profile-gate condition is disabled for the Base wallet.
    const gateChecks = source.match(
      /usdcPriceMicros &&\s*!baseWalletActive &&/g
    );
    expect(gateChecks?.length ?? 0).toBeGreaterThanOrEqual(2);
    // Base registration happens on Base rails instead.
    expect(source).toContain("ensureBaseAuthorRegistered");
    expect(source).toContain("registerAgent");
  });

  it("Base inline registration uses a non-empty author metadata URI", () => {
    const publishSource = read("app/skills/publish/page.tsx");
    const metadataSource = read("lib/adapters/baseAgentMetadata.ts");

    expect(publishSource).toContain("buildBaseAgentMetadataUri(address)");
    expect(publishSource).toContain("chainWallet.registerAgent(metadataUri)");
    expect(publishSource).toContain("isBaseAlreadyRegisteredError");
    expect(publishSource).toContain('includes("AlreadyRegistered")');
    expect(metadataSource).toContain("/api/author/");
    expect(metadataSource).toContain("BASE_SEPOLIA_CHAIN_CONTEXT");
  });

  it("Base publish retries link verification and detail repair relinks existing listings", () => {
    const publishSource = read("app/skills/publish/page.tsx");
    const detailSource = read("app/skills/[id]/SkillDetailClient.tsx");
    const routeSource = read("app/api/skills/[id]/route.ts");

    expect(publishSource).toContain("patchBaseListingWithRetry");
    expect(publishSource).toContain("isRetryableBaseListingLinkError");
    expect(publishSource).toContain("isBaseListingExistsError");
    expect(publishSource).toContain("relinkExisting: true");
    expect(detailSource).toContain("isBaseListingExistsError");
    expect(detailSource).toContain("relinkExisting: true");
    expect(routeSource).toContain("relinkExisting");
  });

  it("free GitHub publishing stays wallet-optional and un-stamped", () => {
    const source = read("app/api/skills/route.ts");
    // GitHub publishers keep the configured Solana context, not the global default.
    expect(source).toContain("configuredSolanaChainContext);");
    expect(source).not.toContain("getDefaultChainContext()");
  });

  it("Base paid rows default currency_mint to null, not the Solana mint (PR #74 P1)", () => {
    const source = read("app/api/skills/route.ts");
    // The currency-mint default must be chosen AFTER the chain context is known, and Base
    // rows must not fall back to getConfiguredUsdcMint() (a Solana mint) — that would make
    // the baseListing PATCH's getExpectedBaseCurrency throw and orphan the on-chain listing.
    expect(source).toContain("normalizeCurrencyMintForChain");
    expect(source).toContain("defaultCurrencyMintForChain");
    expect(source).toContain("currency_mint must be a valid Base USDC address");
    expect(source).toContain(
      "return input.chainContext === BASE_SEPOLIA_CHAIN_CONTEXT"
    );
    // The old unconditional default must be gone.
    expect(source).not.toContain(
      "normalizeCurrencyMint(currency_mint) ?? getConfiguredUsdcMint()"
    );
  });

  it("Base paid listings use the canonical raw URI even when IPFS pinning is unavailable", () => {
    const source = read("app/skills/publish/page.tsx");
    expect(source).toContain("getCanonicalSkillRawUrl(skillDbId)");
    expect(source).not.toContain("window.location.origin}/api/skills/");
    expect(source).not.toMatch(/const skillUri = ipfsCid[\s\S]+: ""/);
  });
});

describe("phase 8a: EVM publisher auth", () => {
  it("browse merges EVM author identities instead of discarding them (Bugbot #78)", () => {
    const source = read("app/api/skills/route.ts");
    // resolveSkillAuthorIdentities only covers Solana-shaped authors; its result must be
    // merged over live.identityMap (which includes EVM authors), never replace it.
    expect(source).toContain("...live.identityMap,");
    expect(source).toContain("...(await resolveSkillAuthorIdentities({");
    expect(source).not.toMatch(
      /const identityMap = fastMode\s*\? live\.identityMap\s*: await resolveSkillAuthorIdentities/
    );
  });

  it("browse resolves EVM author identities with the Base chain context", () => {
    const source = read("app/api/skills/route.ts");
    const liveTrustBlock = source.slice(
      source.indexOf("async function resolveLiveSkillTrust"),
      source.indexOf("function persistAuthorTrustSnapshots")
    );
    expect(liveTrustBlock).toContain("identity-base");
    expect(liveTrustBlock).toContain(
      "await resolveIdentityGroup(evmAuthors, BASE_SEPOLIA_CHAIN_CONTEXT)"
    );
    expect(liveTrustBlock).not.toMatch(
      /resolveManyAgentIdentitiesByWallet\(authorPubkeys,[\s\S]+hasAgentProfileByWallet/
    );
  });

  it("skills POST verifies EVM publishers via ERC-1271/6492 and stamps Base Sepolia", () => {
    const source = read("app/api/skills/route.ts");
    expect(source).toContain("verifyEvmWalletSignature");
    expect(source).toContain("walletChainContext: BASE_SEPOLIA_CHAIN_CONTEXT");
    expect(source).toContain("resolveBaseAuthorTrust");
  });

  it("Base passkey ChainWallet exposes signMessage for publisher auth", () => {
    const source = read("lib/adapters/baseWallet.ts");
    expect(source).toMatch(/signMessage: \(message\) =>/);
  });

  it("Base authors can route listing edits through ChainWallet updateSkillListing", () => {
    const detail = read("app/skills/[id]/SkillDetailClient.tsx");
    expect(detail).toContain("activeChainWallet.updateSkillListing");
    expect(detail).toContain('mode: "update"');
    expect(detail).toContain("expectedPriceUsdcMicros");
    expect(detail).toMatch(
      /if \(isBaseAuthor\)[\s\S]+activeChainWallet\.updateSkillListing/
    );
    expect(detail).not.toContain(
      "if (!connected || !walletAddress || !skill) return;"
    );
  });

  it("Base authors can route listing removal through ChainWallet removeSkillListing", () => {
    const detail = read("app/skills/[id]/SkillDetailClient.tsx");
    expect(detail).toContain("activeChainWallet.removeSkillListing");
    expect(detail).toContain('mode: "remove"');
    expect(detail).toContain("Action: remove-base-listing");
    expect(detail).toMatch(
      /if \(isBaseAuthor\)[\s\S]+activeChainWallet\.removeSkillListing/
    );
    expect(detail).toContain("(isSolanaAuthor || isBaseAuthor)");
  });

  it("version publishing accepts Base author signatures through EVM auth", () => {
    const route = read("app/api/skills/[id]/versions/route.ts");
    expect(route).toContain("verifyEvmWalletSignature");
    expect(route).toContain("verifyVersionPublisherAuth");
    expect(route).toMatch(
      /chainContext === BASE_SEPOLIA_CHAIN_CONTEXT[\s\S]+verifyEvmWalletSignature\(auth\)/
    );

    const detail = read("app/skills/[id]/SkillDetailClient.tsx");
    expect(detail).toMatch(
      /isBaseAuthor[\s\S]+activeChainWallet\?\.signMessage[\s\S]+activeChainWallet\.signMessage\(message\)/
    );
    expect(detail).toContain(
      "{isAuthor && !isChainOnly && !versionComposerOpen &&"
    );
    expect(detail).not.toContain(
      "{isSolanaAuthor && !isChainOnly && !versionComposerOpen &&"
    );
  });
});

describe("phase 8a: trust stays chain-qualified and honest after the flip", () => {
  it("trust snapshot joins never attach Solana trust to Base rows", () => {
    for (const file of [
      "lib/marketplaceBrowse.ts",
      "lib/skillDetailSnapshot.ts",
    ]) {
      const source = read(file);
      const joins = source.match(
        /ats\.chain_context = COALESCE\(s\.chain_context, \$\{configuredSolanaChainContext\}\)/g
      );
      expect(
        joins?.length ?? 0,
        `${file} author_trust_snapshots join must stay chain-qualified with a legacy Solana fallback`
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("null trust renders as unknown, never Trusted, and the trusted sort does not boost it", () => {
    const card = read("components/SkillPreviewCard.tsx");
    expect(card).toContain(
      'if (!trust || !trust.isRegistered) return "unknown"'
    );

    const browse = read("lib/marketplaceBrowse.ts");
    // Null trust scores 0 in the trusted sort — same cohort as unregistered
    // Solana authors, no synthesized boost.
    expect(browse).toContain("(b.author_trust?.reputationScore ?? 0)");
  });

  it("Base v1 report counters stay readable through the EVM trust ABI", () => {
    const abi = read("lib/adapters/agentVouchEvmAbi.ts");
    expect(abi).toContain("function PROTOCOL_VERSION() view returns (string)");
    expect(abi).toContain("AGENTVOUCH_EVM_AUTHOR_REPORT_TUPLE");
    expect(abi).toContain("function getAuthorReport(uint64 reportId)");
    expect(abi).toContain("event AuthorReportOpened");
    expect(abi).toContain("event AuthorReportResolved");

    const trust = read("lib/baseAuthorTrust.ts");
    expect(trust).toContain("openDisputes: bigint");
    expect(trust).toContain("upheldDisputes: bigint");
    expect(trust).toContain("dismissedDisputes: bigint");
    expect(trust).toContain(
      "activeDisputesAgainstAuthor +\n      disputesUpheldAgainstAuthor +\n      dismissedDisputes"
    );
  });

  it("Base detail rows resolve live EVM trust by default", () => {
    const route = read("app/api/skills/[id]/route.ts");
    const snapshot = read("lib/skillDetailSnapshot.ts");
    expect(route).toContain("shouldApplyLiveTrust");
    expect(route).toMatch(
      /snapshot\.chain_context\?\.startsWith\("eip155:"\)[\s\S]+isEvmAddress\(snapshot\.author_pubkey\)/
    );
    expect(route).toMatch(
      /const skillSnapshot = shouldApplyLiveTrust[\s\S]+await applyLiveAuthorTrust\(snapshot\)/
    );
    expect(route).toMatch(
      /"Cache-Control": shouldApplyLiveTrust[\s\S]+PRIVATE_NO_STORE_CACHE_CONTROL/
    );
    expect(snapshot).toContain("function applyLiveBaseTrust");
    expect(snapshot).toContain("resolveBaseAuthorTrust");
    expect(snapshot).toMatch(/return applyLiveBaseTrust\(snapshot\)/);
    expect(snapshot).toContain('chainContext?.startsWith("eip155:")');
    expect(snapshot).toContain("native USDC");
    expect(snapshot).toContain("paymaster policy");
  });
});
