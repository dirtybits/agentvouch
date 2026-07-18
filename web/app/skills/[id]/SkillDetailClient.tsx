"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { AgentIdentityPanel } from "@/components/AgentIdentityPanel";
import { type TrustData } from "@/components/TrustBadge";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import SkillFileTree, {
  type SkillFileTreeEntry,
} from "@/components/SkillFileTree";
import type { SkillSecurityScan } from "@/lib/securityScan";
import {
  recommendedActionFromSignals,
  type TrustSignal,
} from "@/lib/trustSignals";
import TrustSignalChecklist from "@/components/TrustSignalChecklist";
import InfoTip from "@/components/InfoTip";
import { ClientWalletButton } from "@/components/ClientWalletButton";
import { SolAmount } from "@/components/SolAmount";
import { UsdcIcon } from "@/components/UsdcIcon";
import {
  buildDownloadRawMessage,
  buildPublisherAuthMessage,
  buildStripeCheckoutMessage,
  createSignedDownloadAuthPayload,
} from "@/lib/authPayload";
import { encodeBase64 } from "@/lib/base64";
import { buildPaidSkillDownloadRequiredMessage } from "@/lib/skillFlowMessages";
import { RESERVED_SKILL_TAGS } from "@/lib/skillDraft";
import {
  navButtonPrimaryInlineClass,
  navButtonSecondaryInlineClass,
  navButtonSizeClass,
} from "@/lib/buttonStyles";
import {
  useAgentVouchWallet,
  useChainWallet,
} from "@/components/WalletContextProvider";
import { useReputationOracle } from "@/hooks/useReputationOracle";
import { useAgentVouchTransactionSigner } from "@/hooks/useAgentVouchTransactionSigner";
import { useWritableChainWallet } from "@/hooks/useWritableChainWallet";
import { shortenChainAddress } from "@/lib/chainAddress";
import { PHANTOM_EMBEDDED_WALLET_NAME } from "@/lib/phantomEmbeddedWalletStandard";
import type { AgentIdentitySummary } from "@/lib/agentIdentity";
import { address, type Address } from "@solana/kit";
import {
  PRICING,
  formatUsdcMicros,
  formatMinPrice,
  toUsdcMicros,
  fromLamports,
  fromUsdcMicros,
  isValidListingPriceLamports,
} from "@/lib/pricing";
import type { PurchasePreflightStatus } from "@/lib/purchasePreflight";
import { getErrorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/formatDate";
import {
  fetchSkillWithBrowserX402,
  walletSupportsBrowserX402,
} from "@/lib/browserX402";
import {
  BASE_SEPOLIA_CHAIN_CONTEXT,
  getChainDisplayLabel,
  getConfiguredSolanaExplorerAddressUrl,
  getConfiguredSolanaExplorerTxUrl,
} from "@/lib/chains";
import { BASE_SEPOLIA_EXPLORER_URL } from "@/lib/adapters/baseWalletConfig";
import PaidPurchaseReportPanel, {
  type BasePaidPurchaseSummary,
} from "./PaidPurchaseReportPanel";
import { sanitizeSyncedRepoUrl } from "@/lib/repoUrls";
import { getCanonicalSkillRawUrl } from "@/lib/skillUrls";
import {
  FiAlertTriangle,
  FiInfo,
  FiArrowLeft,
  FiCheckCircle,
  FiDownload,
  FiClock,
  FiShield,
  FiCopy,
  FiCheck,
  FiLoader,
  FiExternalLink,
  FiFileText,
  FiGitCommit,
  FiGithub,
  FiEdit2,
  FiTrash2,
  FiTerminal,
  FiChevronDown,
  FiCreditCard,
  FiLock,
} from "react-icons/fi";

interface SkillVersion {
  id: string;
  version: number;
  ipfs_cid: string | null;
  changelog: string | null;
  created_at: string;
}

interface ContentVerification {
  has_ipfs: boolean;
  all_versions_pinned: boolean;
  current_cid_consistent: boolean;
  status: "verified" | "drift_detected" | "unverified";
}

function isBaseListingExistsError(error: unknown): boolean {
  return getErrorMessage(error, "").includes("ListingExists");
}

function isBaseListingMissingError(error: unknown): boolean {
  return /not found on-chain|was not found/i.test(getErrorMessage(error, ""));
}

function hasPositiveStoredUsdcPrice(value: string | null | undefined): boolean {
  return getPositiveStoredUsdcMicros(value) !== null;
}

function getPositiveStoredUsdcMicros(
  value: string | null | undefined
): bigint | null {
  try {
    const micros = BigInt(value ?? "0");
    return micros > 0n ? micros : null;
  } catch {
    return null;
  }
}

function getPositiveStoredUsdcMicrosNumber(
  value: string | null | undefined
): number | null {
  const micros = getPositiveStoredUsdcMicros(value);
  return micros === null ? null : Number(micros);
}

interface SkillDetail {
  id: string;
  skill_id: string;
  public_slug?: string | null;
  public_author_slug?: string | null;
  author_pubkey: string | null;
  author_kind?: string | null;
  author_handle?: string | null;
  author_display_name?: string | null;
  publisher_identity_key?: string | null;
  publisher_tier?: string | null;
  mirror_source_key?: string | null;
  synced_repo_url?: string | null;
  name: string;
  description: string | null;
  tags: string[];
  current_version: number;
  summary?: string | null;
  summary_capabilities?: string[] | null;
  ipfs_cid: string | null;
  on_chain_address: string | null;
  chain_context?: string | null;
  evm_listing_id?: string | null;
  evm_contract_address?: string | null;
  evm_tx_hash?: string | null;
  total_installs: number;
  total_downloads?: number;
  price_lamports?: number;
  price_usdc_micros?: string | null;
  currency_mint?: string | null;
  payment_flow?:
    | "free"
    | "legacy-sol"
    | "listing-required"
    | "x402-usdc"
    | "direct-purchase-skill";
  contact: string | null;
  created_at: string;
  updated_at: string;
  source?: "repo" | "chain";
  skill_uri?: string;
  versions: SkillVersion[];
  author_trust: TrustData | null;
  author_identity: AgentIdentitySummary | null;
  content_verification: ContentVerification | null;
  content?: string | null;
  files: SkillFileTreeEntry[] | null;
  tree_hash: string | null;
  storage_backend: string | null;
  has_executable: boolean;
  security_scan: SkillSecurityScan | null;
  signals: TrustSignal[];
  legacySolLamports?: number;
  estimatedPurchaseRentLamports?: number;
  feeBufferLamports?: number;
  estimatedBuyerTotalLamports?: number;
  purchasePreflightStatus?: PurchasePreflightStatus;
  purchasePreflightMessage?: string | null;
  purchaseRiskWarning?: string | null;
  priceDisclosure?: string | null;
  buyerHasPurchased?: boolean;
  buyerPurchaseSummary?:
    | {
        kind?: "solana-purchase";
        purchasePda: string | null;
        listingRevision: string | null;
        settlementPda: string | null;
        refundStatus: string;
        legacyRefundEligible: boolean;
      }
    | BasePaidPurchaseSummary
    | null;
}

function shortAddr(addr: string): string {
  // Chain-independent 6/4 short form via the shared Phase 7 helper (generic path).
  return shortenChainAddress({ chainContext: null, value: addr });
}

function isBlockingPurchaseStatus(
  status: PurchasePreflightStatus | null | undefined
) {
  return (
    status === "buyerInsufficientBalance" ||
    status === "buyerMissingUsdcAccount" ||
    status === "authorPayoutRentBlocked"
  );
}

function buildCanonicalSkillUri(skillId: string): string {
  return getCanonicalSkillRawUrl(skillId);
}

function stripMarkdown(value: string): string {
  return value
    .replace(/^[-*+]\s+/, "")
    .replace(/`/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .trim();
}

function extractCapabilityBullets(content: string | null): string[] {
  if (!content) return [];

  const lines = content.split("\n");
  const whenToUseIndex = lines.findIndex((line) =>
    /^##+\s+when to use/i.test(line.trim())
  );
  const bullets: string[] = [];

  for (
    let i = whenToUseIndex >= 0 ? whenToUseIndex + 1 : 0;
    i < lines.length;
    i += 1
  ) {
    const line = lines[i].trim();

    if (whenToUseIndex >= 0 && /^##+\s+/.test(line)) break;
    if (!/^[-*+]\s+/.test(line)) continue;

    const cleaned = stripMarkdown(line);
    if (!cleaned) continue;

    bullets.push(cleaned);
    if (bullets.length === 3) break;
  }

  return bullets;
}

function extractCapabilitySummary(
  content: string | null,
  description: string | null
): string | null {
  if (description) return description;
  if (!content) return null;

  const blocks = content
    .split(/\n\s*\n/)
    .map((block) => stripMarkdown(block.replace(/\n/g, " ")))
    .filter(Boolean);

  return (
    blocks.find(
      (block) =>
        !block.startsWith("---") &&
        !block.startsWith("#") &&
        !block.startsWith("```") &&
        !/^title:/i.test(block) &&
        !/^description:/i.test(block) &&
        !/^when to use/i.test(block)
    ) ?? null
  );
}

async function fetchSignedSkill({
  id,
  walletAddress,
  signMessage,
  skill,
  format,
}: {
  id: string;
  walletAddress: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array | string>;
  skill: SkillDetail;
  format: "raw" | "zip";
}): Promise<Response> {
  const authHeader = JSON.stringify(
    await createSignedDownloadAuthPayload({
      walletAddress,
      signMessage,
      skillId: skill.id,
      listingAddress:
        skill.evm_listing_id ?? skill.on_chain_address ?? undefined,
    })
  );
  const res = await fetch(`/api/skills/${id}/${format}`, {
    headers: {
      "X-AgentVouch-Auth": authHeader,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(
      body?.error || body?.message || "Purchase verified, but download failed"
    );
  }
  return res;
}

export default function SkillDetailPage({
  id,
  initialSkill = null,
  stripeCheckoutEnabled = false,
  buyerCardAccessEnabled = false,
}: {
  id: string;
  initialSkill?: SkillDetail | null;
  stripeCheckoutEnabled?: boolean;
  buyerCardAccessEnabled?: boolean;
}) {
  const { status, account, walletName } = useAgentVouchWallet();
  const {
    signer: protocolTransactionSigner,
    partialSigner: kitSigner,
    capabilities,
    signMessage,
  } = useAgentVouchTransactionSigner();
  const connected = status === "connected" && !!account;
  const walletAddress = account ?? null;
  const isPhantomEmbeddedWallet =
    connected && walletName === PHANTOM_EMBEDDED_WALLET_NAME;
  const oracle = useReputationOracle();
  const chainWalletSession = useChainWallet();
  // Writable wallet facade: the provider's Base passkey ChainWallet when Base is connected,
  // or the Solana ChainWallet composed from the connected session (Phase 2 circle-back).
  const activeChainWallet = useWritableChainWallet();
  const activeChainContext = chainWalletSession.chainContext;
  const activeWalletAddress = chainWalletSession.account ?? walletAddress;

  const [skill, setSkill] = useState<SkillDetail | null>(initialSkill);
  const [content, setContent] = useState<string | null>(
    initialSkill?.content ?? null
  );
  const [loading, setLoading] = useState(!initialSkill);
  const [copied, setCopied] = useState<string | null>(null);

  const [listPrice, setListPrice] = useState(String(PRICING.USDC.defaultPrice));
  const [listing, setListing] = useState(false);
  const [listResult, setListResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeResult, setRemoveResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [purchasingUsdc, setPurchasingUsdc] = useState(false);
  const [startingStripeCheckout, setStartingStripeCheckout] = useState(false);
  const [usdcPurchaseTx, setUsdcPurchaseTx] = useState<string | null>(null);
  const [usdcPurchaseExplorerUrl, setUsdcPurchaseExplorerUrl] = useState<
    string | null
  >(null);
  const [installResult, setInstallResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadResult, setDownloadResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editUri, setEditUri] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [settlementSummary, setSettlementSummary] = useState<{
    pda: string;
    withdrawableUsdcMicros: bigint;
    withdrawnUsdcMicros: bigint;
    refundedUsdcMicros: bigint;
    locked: boolean;
  } | null>(null);
  const [withdrawingProceeds, setWithdrawingProceeds] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [versionDraft, setVersionDraft] = useState("");
  const [versionChangelog, setVersionChangelog] = useState("");
  const [versionComposerOpen, setVersionComposerOpen] = useState(false);
  const [publishingVersion, setPublishingVersion] = useState(false);
  const [versionResult, setVersionResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const handledAuthorActionRef = useRef<string | null>(null);
  const currentWalletAddressRef = useRef<string | null>(activeWalletAddress);
  const currentBuyerChainContextRef = useRef<string | null>(activeChainContext);
  const lastWalletAddressRef = useRef<string | null>(activeWalletAddress);
  const lastBuyerChainContextRef = useRef<string | null>(activeChainContext);
  const skillRefreshSeqRef = useRef(0);
  const capabilitySummary = extractCapabilitySummary(
    content,
    skill?.description ?? null
  );
  const capabilityBullets = extractCapabilityBullets(content);
  // Prefer the AI summary (generated once at publish from the content, no leak)
  // as the "what it does" decision layer. Paid skills wall their content, so the
  // AI capabilities replace the content-derived bullets; free skills fall back to
  // content-derived text when no summary exists yet.
  const aiSummaryLine = skill?.summary?.trim() || null;
  const aiCapabilities = (skill?.summary_capabilities ?? []).filter(
    (c): c is string => typeof c === "string" && c.trim().length > 0
  );
  const displaySummaryLine = aiSummaryLine ?? capabilitySummary;
  const displayCapabilities =
    aiCapabilities.length > 0 ? aiCapabilities : capabilityBullets;
  // Author deep-link actions (e.g. ?authorAction=edit-listing) are read on the
  // client only. useSearchParams() would bail this page out of static/ISR
  // rendering (the CSR-bailout build error), so read window.location.search
  // after mount instead — the consuming effect below already runs post-hydration.
  const [requestedAuthorAction, setRequestedAuthorAction] = useState<
    string | null
  >(null);
  const [stripeCheckoutStatus, setStripeCheckoutStatus] = useState<
    string | null
  >(null);
  const [buyerAccountAuthenticated, setBuyerAccountAuthenticated] =
    useState(false);
  const [buyerAccountHasAccess, setBuyerAccountHasAccess] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedAuthorAction(params.get("authorAction"));
    setStripeCheckoutStatus(params.get("stripe"));
  }, []);

  useEffect(() => {
    currentWalletAddressRef.current = activeWalletAddress;
    currentBuyerChainContextRef.current = activeChainContext;
  }, [activeChainContext, activeWalletAddress]);

  const refreshSkill = useCallback(
    async (options?: {
      includeBuyer?: boolean;
      buyerAddress?: string | null;
      buyerChainContext?: string | null;
    }) => {
      const requestSeq = ++skillRefreshSeqRef.current;
      const buyerForRequest =
        options?.buyerAddress ??
        (options?.includeBuyer ? currentWalletAddressRef.current : null);
      const buyerChainContextForRequest =
        options?.buyerChainContext ??
        (options?.includeBuyer ? currentBuyerChainContextRef.current : null);
      try {
        const params = new URLSearchParams();
        params.set("trust", "live");
        const includeBuyer = options?.includeBuyer ?? Boolean(buyerForRequest);
        if (includeBuyer && buyerForRequest) {
          params.set("buyer", String(buyerForRequest));
          if (buyerChainContextForRequest) {
            params.set("buyerChainContext", buyerChainContextForRequest);
          }
        }
        const query = params.toString();
        const detailRes = await fetch(
          `/api/skills/${id}${query ? `?${query}` : ""}`,
          {
            cache: "no-store",
          }
        );
        if (!detailRes.ok) throw new Error("Skill not found");
        const data = await detailRes.json();
        if (requestSeq !== skillRefreshSeqRef.current) return;
        setSkill(data);
        if (data.content) {
          setContent(data.content);
        }
      } catch (err) {
        console.error("Error fetching skill:", err);
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  const refreshBuyerAccountAccess = useCallback(async () => {
    if (!buyerCardAccessEnabled) {
      setBuyerAccountAuthenticated(false);
      setBuyerAccountHasAccess(false);
      return;
    }
    const response = await fetch(
      `/api/account/access-grants/${encodeURIComponent(id)}`,
      { cache: "no-store" }
    );
    const body = (await response.json().catch(() => null)) as {
      authenticated?: boolean;
      hasAccess?: boolean;
    } | null;
    setBuyerAccountAuthenticated(Boolean(body?.authenticated));
    setBuyerAccountHasAccess(Boolean(body?.hasAccess));
  }, [buyerCardAccessEnabled, id]);

  useEffect(() => {
    const refresh = () =>
      void refreshBuyerAccountAccess().catch(() => {
        setBuyerAccountAuthenticated(false);
        setBuyerAccountHasAccess(false);
      });
    refresh();
    // Clerk's development-browser handshake can finish after the first client
    // render. Retry a bounded number of times so an already signed-in buyer is
    // not incorrectly offered only the wallet-bound checkout path.
    const timers = [750, 2_000, 5_000].map((delay) =>
      window.setTimeout(refresh, delay)
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [refreshBuyerAccountAccess]);

  useEffect(() => {
    // SSR already hydrated the snapshot (incl. cached author trust), so skip the
    // on-mount refresh for anonymous views — it otherwise forces
    // /api/skills/[id]?trust=live (the on-chain trust path) on every page load.
    // Chain skills / SSR misses (initialSkill == null) still need this fetch; a
    // connected wallet is covered by the buyer-refresh effect below.
    if (initialSkill) return;
    void refreshSkill({ includeBuyer: false });
  }, [refreshSkill, initialSkill]);

  const loadedSkillId = skill?.id ?? null;

  useEffect(() => {
    if (
      lastWalletAddressRef.current === activeWalletAddress &&
      lastBuyerChainContextRef.current === activeChainContext
    )
      return;
    lastWalletAddressRef.current = activeWalletAddress;
    lastBuyerChainContextRef.current = activeChainContext;
    skillRefreshSeqRef.current += 1;
    setSkill((current) =>
      current
        ? {
            ...current,
            buyerHasPurchased: false,
            buyerPurchaseSummary: null,
          }
        : current
    );
    setDownloadResult(null);
    setInstallResult(null);
    setUsdcPurchaseTx(null);
    setUsdcPurchaseExplorerUrl(null);
  }, [activeChainContext, activeWalletAddress]);

  useEffect(() => {
    if (!activeWalletAddress || !loadedSkillId) return;
    void refreshSkill({
      includeBuyer: true,
      buyerAddress: activeWalletAddress,
      buyerChainContext: activeChainContext,
    });
  }, [activeChainContext, activeWalletAddress, refreshSkill, loadedSkillId]);

  useEffect(() => {
    if (!stripeCheckoutStatus) return;

    // One-shot: strip the query param and clear the trigger state so wallet
    // reconnects or refreshSkill identity changes cannot re-fire this effect
    // and clobber newer result messages.
    const url = new URL(window.location.href);
    url.searchParams.delete("stripe");
    window.history.replaceState(null, "", url.toString());
    setStripeCheckoutStatus(null);

    if (stripeCheckoutStatus === "success") {
      setInstallResult({
        success: true,
        message: buyerAccountAuthenticated
          ? "Card checkout complete. When Stripe confirms the payment, this account can download without a wallet."
          : "Card checkout complete. When Stripe confirms the payment, this wallet can Sign & Download.",
      });
      if (walletAddress) {
        // Webhook delivery lags the redirect; refresh a few times so the
        // page picks up the entitlement without a manual reload.
        const timers = [1500, 5000, 15000].map((delay) =>
          window.setTimeout(() => {
            if (walletAddress) {
              void refreshSkill({
                includeBuyer: true,
                buyerAddress: walletAddress,
              });
            }
            void refreshBuyerAccountAccess();
          }, delay)
        );
        return () => timers.forEach((timer) => window.clearTimeout(timer));
      }
      const timers = [1500, 5000, 15000].map((delay) =>
        window.setTimeout(() => void refreshBuyerAccountAccess(), delay)
      );
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }

    if (stripeCheckoutStatus === "cancelled") {
      setInstallResult({
        success: false,
        message: "Card checkout was cancelled.",
      });
    }
  }, [
    refreshBuyerAccountAccess,
    refreshSkill,
    stripeCheckoutStatus,
    buyerAccountAuthenticated,
    walletAddress,
  ]);

  useEffect(() => {
    if (
      skill?.price_usdc_micros &&
      hasPositiveStoredUsdcPrice(skill.price_usdc_micros)
    ) {
      const formatted = formatUsdcMicros(skill.price_usdc_micros);
      if (formatted) {
        setListPrice(formatted);
      }
    }
  }, [skill?.id, skill?.price_usdc_micros]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const triggerBrowserDownload = useCallback((filename: string, blob: Blob) => {
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(href);
  }, []);

  const downloadSkillFile = useCallback(
    (filename: string, text: string) => {
      triggerBrowserDownload(
        `${filename || "SKILL"}.md`,
        new Blob([text], { type: "text/markdown;charset=utf-8" })
      );
    },
    [triggerBrowserDownload]
  );

  // Download an entitled skill via signed auth: the full tree as a .zip for
  // multi-file skills, otherwise SKILL.md. Returns true when the archive was
  // delivered (used to phrase the success message).
  const downloadEntitledSkill = useCallback(async (): Promise<boolean> => {
    if (!skill) throw new Error("Skill is not loaded.");
    const isMultiFile = (skill.files?.length ?? 0) > 1;

    if (buyerAccountHasAccess) {
      const response = await fetch(
        `/api/skills/${id}/${isMultiFile ? "zip" : "raw"}`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        throw new Error(
          body?.error || body?.message || "Account download failed"
        );
      }
      if (isMultiFile) {
        triggerBrowserDownload(
          `${skill.skill_id || "skill"}.zip`,
          await response.blob()
        );
      } else {
        downloadSkillFile(skill.skill_id, await response.text());
      }
      return isMultiFile;
    }

    const downloadWalletAddress = activeWalletAddress ?? walletAddress;
    const downloadSignMessage =
      activeChainContext === BASE_SEPOLIA_CHAIN_CONTEXT &&
      activeChainWallet?.signMessage
        ? async (message: Uint8Array) =>
            activeChainWallet.signMessage!(new TextDecoder().decode(message))
        : signMessage;

    if (!downloadWalletAddress || !downloadSignMessage) {
      throw new Error("Connect a wallet to download this skill.");
    }
    const res = await fetchSignedSkill({
      id,
      walletAddress: downloadWalletAddress,
      signMessage: downloadSignMessage,
      skill,
      format: isMultiFile ? "zip" : "raw",
    });
    if (isMultiFile) {
      triggerBrowserDownload(
        `${skill.skill_id || "skill"}.zip`,
        await res.blob()
      );
    } else {
      downloadSkillFile(skill.skill_id, await res.text());
    }
    return isMultiFile;
  }, [
    skill,
    buyerAccountHasAccess,
    activeChainContext,
    activeChainWallet,
    activeWalletAddress,
    signMessage,
    walletAddress,
    id,
    triggerBrowserDownload,
    downloadSkillFile,
  ]);

  const handleListOnMarketplace = async () => {
    if (!skill) return;
    setListing(true);
    setListResult(null);
    try {
      const storedPriceUsdcMicros = getPositiveStoredUsdcMicrosNumber(
        skill.price_usdc_micros
      );
      const priceUsdcMicros =
        storedPriceUsdcMicros ?? toUsdcMicros(parseFloat(listPrice || "0"));
      if (!isValidListingPriceLamports(priceUsdcMicros)) {
        setListResult({
          success: false,
          message: `Price must be 0 for a free listing or at least ${formatMinPrice()}.`,
        });
        setListing(false);
        return;
      }
      const skillUri = buildCanonicalSkillUri(id);
      const isBaseListingAuthor =
        skill.chain_context === BASE_SEPOLIA_CHAIN_CONTEXT &&
        activeChainContext === BASE_SEPOLIA_CHAIN_CONTEXT &&
        Boolean(activeChainWallet && activeWalletAddress) &&
        Boolean(skill.author_pubkey) &&
        activeWalletAddress?.toLowerCase() ===
          skill.author_pubkey?.toLowerCase();

      if (isBaseListingAuthor) {
        if (!activeChainWallet || !activeWalletAddress) {
          setListResult({
            success: false,
            message: "Connect the Base wallet to list this skill.",
          });
          return;
        }

        if (!activeChainWallet.signMessage) {
          setListResult({
            success: false,
            message:
              "This Base wallet cannot sign the listing-link authorization message.",
          });
          return;
        }
        const signBaseAuth =
          activeChainWallet.signMessage.bind(activeChainWallet);

        const patchBaseListing = async (
          baseListing:
            | {
                txHash: string;
                authorAddress: string;
                chainContext: typeof BASE_SEPOLIA_CHAIN_CONTEXT;
                expectedPriceUsdcMicros: string;
              }
            | {
                relinkExisting: true;
                authorAddress: string;
                chainContext: typeof BASE_SEPOLIA_CHAIN_CONTEXT;
              }
        ) => {
          // Author-signed link auth (Bugbot #78 parity with the Solana PATCH path).
          const timestamp = Date.now();
          const message = `AgentVouch Skill Repo\nAction: link-base-listing\nSkill id: ${id}\nTimestamp: ${timestamp}`;
          const signature = await signBaseAuth(message);
          const auth = {
            pubkey: activeWalletAddress,
            signature,
            message,
            timestamp,
          };
          const patchRes = await fetch(`/api/skills/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ auth, baseListing }),
          });
          if (!patchRes.ok) {
            const patchBody = (await patchRes.json().catch(() => null)) as {
              error?: string;
            } | null;
            throw new Error(
              patchBody?.error || "Base listing was created but not linked"
            );
          }
          return (await patchRes.json()) as SkillDetail;
        };

        const existingListingPatch = {
          relinkExisting: true,
          authorAddress: activeWalletAddress,
          chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        } as const;

        if (hasPositiveStoredUsdcPrice(skill.price_usdc_micros)) {
          try {
            const updated = await patchBaseListing(existingListingPatch);
            setSkill(updated);
            setListResult({
              success: true,
              message: "Linked existing Base marketplace listing successfully!",
            });
            await refreshSkill();
            return;
          } catch (error) {
            if (!isBaseListingMissingError(error)) {
              throw error;
            }
          }
        }

        let baseListing:
          | {
              txHash: string;
              authorAddress: string;
              chainContext: typeof BASE_SEPOLIA_CHAIN_CONTEXT;
              expectedPriceUsdcMicros: string;
            }
          | {
              relinkExisting: true;
              authorAddress: string;
              chainContext: typeof BASE_SEPOLIA_CHAIN_CONTEXT;
            };

        try {
          const listingResult = await activeChainWallet.createSkillListing({
            skillId: skill.skill_id,
            uri: skillUri,
            name: skill.name,
            description: skill.description ?? "",
            priceUsdcMicros: BigInt(priceUsdcMicros),
          });
          baseListing = {
            txHash: listingResult.ref,
            authorAddress: activeWalletAddress,
            chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
            expectedPriceUsdcMicros: String(priceUsdcMicros),
          };
        } catch (error) {
          if (!isBaseListingExistsError(error)) {
            throw error;
          }
          baseListing = existingListingPatch;
        }
        const updated = await patchBaseListing(baseListing);
        setSkill(updated);
        setListResult({
          success: true,
          message:
            "relinkExisting" in baseListing
              ? "Linked existing Base marketplace listing successfully!"
              : "Listed on Base marketplace successfully!",
        });
        await refreshSkill();
        return;
      }

      if (!connected || !walletAddress || !signMessage) {
        setListResult({
          success: false,
          message: "Connect the author wallet to list this skill.",
        });
        return;
      }
      await oracle.createSkillListing(
        skill.skill_id,
        skillUri,
        skill.name,
        skill.description ?? "",
        priceUsdcMicros
      );
      const onChainAddress = await oracle.getSkillListingPDA(
        walletAddress as Address,
        skill.skill_id
      );

      const timestamp = Date.now();
      const message = buildPublisherAuthMessage({
        action: "publish-skill",
        timestamp,
        skillId: id,
      });
      const msgBytes = new TextEncoder().encode(message);
      const sigBytes = await signMessage(msgBytes);
      const signature = encodeBase64(sigBytes);

      await fetch(`/api/skills/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: { pubkey: walletAddress, signature, message, timestamp },
          on_chain_address: onChainAddress,
        }),
      });

      await refreshSkill();
      setSkill((s) => (s ? { ...s, on_chain_address: onChainAddress } : s));
      setListResult({
        success: true,
        message: "Listed on marketplace successfully!",
      });
    } catch (error: unknown) {
      setListResult({
        success: false,
        message: getErrorMessage(error, "Failed to create listing"),
      });
    } finally {
      setListing(false);
    }
  };

  const handleRemoveListing = async () => {
    if (!skill?.skill_id) return;
    if (
      !window.confirm(
        "Remove this skill from the marketplace? Existing purchases are unaffected but no new purchases will be possible."
      )
    )
      return;
    setRemoving(true);
    setRemoveResult(null);
    try {
      if (isBaseAuthor) {
        if (
          !activeChainWallet ||
          !activeWalletAddress ||
          !activeChainWallet.signMessage ||
          !skill.evm_listing_id
        ) {
          setRemoveResult({
            success: false,
            message: "Connect the Base author wallet to remove this listing.",
          });
          setRemoving(false);
          return;
        }
        const removeTx = await activeChainWallet.removeSkillListing({
          listingId: skill.evm_listing_id,
        });
        const timestamp = Date.now();
        const message = `AgentVouch Skill Repo\nAction: remove-base-listing\nSkill id: ${skill.id}\nTimestamp: ${timestamp}`;
        const signature = await activeChainWallet.signMessage(message);
        const patchRes = await fetch(`/api/skills/${skill.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: {
              pubkey: activeWalletAddress,
              signature,
              message,
              timestamp,
            },
            baseListing: {
              mode: "remove",
              txHash: removeTx.ref,
              authorAddress: activeWalletAddress,
              chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
            },
          }),
        });
        if (!patchRes.ok) {
          const patchBody = (await patchRes.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            patchBody?.error ||
              "Listing removed on-chain but failed to update the skill row"
          );
        }
        const updated = (await patchRes.json()) as SkillDetail;
        setSkill(updated);
        await refreshSkill();
        setRemoveResult({ success: true, message: "Base listing removed." });
      } else {
        if (!connected || !walletAddress) {
          setRemoveResult({
            success: false,
            message: "Connect the author wallet to remove this listing.",
          });
          setRemoving(false);
          return;
        }
        await oracle.removeSkillListing(skill.skill_id);
        await refreshSkill();
        // Solana path: clear Solana listing PDA only — never Base EVM fields.
        setSkill((s) => (s ? { ...s, on_chain_address: null } : s));
        setRemoveResult({ success: true, message: "Listing removed." });
      }
    } catch (error: unknown) {
      setRemoveResult({
        success: false,
        message: getErrorMessage(error, "Failed to remove listing"),
      });
    } finally {
      setRemoving(false);
    }
  };

  const handleFreeDownload = async () => {
    if (!skill) return;
    setInstalling(true);
    setInstallResult(null);
    try {
      // Multi-file browser downloads use a zip archive; a lone
      // SKILL.md still downloads as plain markdown.
      const isMultiFile = (skill.files?.length ?? 0) > 1;
      const res = await fetch(
        `/api/skills/${id}/${isMultiFile ? "zip" : "raw"}`
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        setInstallResult({
          success: false,
          message: data?.error || data?.message || "Download failed",
        });
        return;
      }
      if (isMultiFile) {
        triggerBrowserDownload(
          `${skill.skill_id || "skill"}.zip`,
          await res.blob()
        );
        setInstallResult({
          success: true,
          message: `Downloaded full skill (${skill.files?.length ?? 0} files).`,
        });
      } else {
        downloadSkillFile(skill.skill_id, await res.text());
        setInstallResult({
          success: true,
          message: "Downloaded SKILL.md.",
        });
      }
      setSkill((s) =>
        s ? { ...s, total_installs: (s.total_installs ?? 0) + 1 } : s
      );
    } catch (error: unknown) {
      setInstallResult({
        success: false,
        message: getErrorMessage(error, "Download failed"),
      });
    } finally {
      setInstalling(false);
    }
  };

  const handleUsdcPurchase = async () => {
    if (!skill) {
      return;
    }
    const isBasePurchaseSkill =
      skill.chain_context === BASE_SEPOLIA_CHAIN_CONTEXT &&
      Boolean(skill.evm_listing_id);
    if (isBasePurchaseSkill) {
      if (
        activeChainContext !== BASE_SEPOLIA_CHAIN_CONTEXT ||
        !activeChainWallet ||
        !activeWalletAddress
      ) {
        setInstallResult({
          success: false,
          message: "Connect the Base wallet to pay with Base Sepolia USDC.",
        });
        return;
      }
      if (!skill.price_usdc_micros || BigInt(skill.price_usdc_micros) <= 0n) {
        setInstallResult({
          success: false,
          message: "This Base listing is missing its USDC price.",
        });
        return;
      }

      setPurchasingUsdc(true);
      setInstallResult(null);
      setDownloadResult(null);
      setUsdcPurchaseTx(null);
      setUsdcPurchaseExplorerUrl(null);

      try {
        const purchaseResult = await activeChainWallet.purchaseSkill({
          listingId: skill.evm_listing_id as string,
          expectedPriceUsdcMicros: BigInt(skill.price_usdc_micros),
        });

        const verifyBody = purchaseResult.alreadyPurchased
          ? {
              buyer: activeWalletAddress,
              chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
              listingId: skill.evm_listing_id,
              expectedPriceUsdcMicros: skill.price_usdc_micros,
            }
          : {
              txHash: purchaseResult.ref,
              buyer: activeWalletAddress,
              chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
              listingId: skill.evm_listing_id,
              expectedPriceUsdcMicros: skill.price_usdc_micros,
            };
        const verifyRes = await fetch(`/api/skills/${id}/purchase/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(verifyBody),
        });
        if (!verifyRes.ok) {
          const verifyBody = (await verifyRes.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            verifyBody?.error ||
              "Purchase confirmed, but Base entitlement verification failed"
          );
        }

        if (!purchaseResult.alreadyPurchased) {
          setUsdcPurchaseTx(purchaseResult.ref);
          setUsdcPurchaseExplorerUrl(purchaseResult.explorerUrl);
        }
        const fullTree = await downloadEntitledSkill();
        const downloaded = fullTree ? "the full skill" : "SKILL.md";
        await refreshSkill({
          includeBuyer: true,
          buyerAddress: activeWalletAddress,
          buyerChainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
        });
        setSkill((current) =>
          current ? { ...current, buyerHasPurchased: true } : current
        );
        setInstallResult({
          success: true,
          message: purchaseResult.alreadyPurchased
            ? `Base entitlement already active. Downloaded ${downloaded}.`
            : `Base USDC purchase confirmed and verified. Downloaded ${downloaded}.`,
        });
      } catch (error: unknown) {
        setInstallResult({
          success: false,
          message: getErrorMessage(error, "Base USDC purchase failed"),
        });
        setUsdcPurchaseTx(null);
        setUsdcPurchaseExplorerUrl(null);
      } finally {
        setPurchasingUsdc(false);
      }
      return;
    }

    if (!connected || !walletAddress) {
      setInstallResult({
        success: false,
        message: "Connect a wallet to pay with USDC.",
      });
      return;
    }
    if (!signMessage) {
      setInstallResult({
        success: false,
        message: "This wallet cannot sign the download authorization message.",
      });
      return;
    }
    if (isPhantomEmbeddedWallet) {
      setInstallResult({
        success: false,
        message:
          "Embedded Phantom checkout is temporarily unavailable. Connect the Phantom extension or another Solana wallet to purchase.",
      });
      return;
    }

    setPurchasingUsdc(true);
    setInstallResult(null);
    setDownloadResult(null);
    setUsdcPurchaseTx(null);
    setUsdcPurchaseExplorerUrl(null);

    try {
      if (skill.on_chain_address) {
        if (!skill.author_pubkey) {
          setInstallResult({
            success: false,
            message:
              "This skill is missing an author wallet, so it cannot be purchased on-chain.",
          });
          return;
        }
        if (!activeChainWallet) {
          setInstallResult({
            success: false,
            message: "This wallet cannot send the USDC purchase transaction.",
          });
          return;
        }
        if (!skill.price_usdc_micros || BigInt(skill.price_usdc_micros) <= 0n) {
          setInstallResult({
            success: false,
            message: "This listing is missing its USDC price.",
          });
          return;
        }

        const purchaseResult = await activeChainWallet.purchaseSkill({
          listingId: skill.on_chain_address,
          expectedPriceUsdcMicros: BigInt(skill.price_usdc_micros),
        });

        if (!purchaseResult.alreadyPurchased) {
          const verifyRes = await fetch(`/api/skills/${id}/purchase/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signature: purchaseResult.ref,
              buyer: walletAddress,
              listingAddress: skill.on_chain_address,
            }),
          });
          if (!verifyRes.ok) {
            const verifyBody = (await verifyRes.json().catch(() => null)) as {
              error?: string;
            } | null;
            throw new Error(
              verifyBody?.error ||
                "Purchase confirmed, but entitlement verification failed"
            );
          }
          setUsdcPurchaseTx(purchaseResult.ref);
          setUsdcPurchaseExplorerUrl(purchaseResult.explorerUrl);
        }

        const fullTree = await downloadEntitledSkill();
        const downloaded = fullTree ? "the full skill" : "SKILL.md";
        await refreshSkill();
        setSkill((current) =>
          current ? { ...current, buyerHasPurchased: true } : current
        );
        setInstallResult({
          success: true,
          message: !purchaseResult.alreadyPurchased
            ? `USDC purchase confirmed and verified. Downloaded ${downloaded}.`
            : `USDC entitlement already active. Downloaded ${downloaded}.`,
        });
        return;
      }

      if (!kitSigner) {
        setInstallResult({
          success: false,
          message: "This wallet cannot sign the USDC payment transaction.",
        });
        return;
      }

      const isMultiFile = (skill.files?.length ?? 0) > 1;
      const purchaseResult = await fetchSkillWithBrowserX402({
        signer: kitSigner,
        walletAddress,
        signMessage,
        skillId: skill.id,
        listingAddress: skill.on_chain_address ?? undefined,
        path: `/api/skills/${id}/${isMultiFile ? "zip" : "raw"}`,
      });

      if (isMultiFile) {
        triggerBrowserDownload(
          `${skill.skill_id || "skill"}.zip`,
          purchaseResult.blob
        );
      } else {
        downloadSkillFile(skill.skill_id, await purchaseResult.blob.text());
      }
      const downloaded = isMultiFile ? "the full skill" : "SKILL.md";
      await refreshSkill();
      setSkill((current) =>
        current ? { ...current, buyerHasPurchased: true } : current
      );
      setInstallResult({
        success: true,
        message: purchaseResult.paymentResponse
          ? `USDC payment complete. Downloaded ${downloaded}.`
          : `USDC entitlement already active. Downloaded ${downloaded}.`,
      });
      setUsdcPurchaseTx(purchaseResult.paymentResponse?.transaction ?? null);
      setUsdcPurchaseExplorerUrl(
        purchaseResult.paymentResponse?.transaction
          ? getConfiguredSolanaExplorerTxUrl(
              purchaseResult.paymentResponse.transaction
            )
          : null
      );
    } catch (error: unknown) {
      setInstallResult({
        success: false,
        message: getErrorMessage(error, "USDC purchase failed"),
      });
      setUsdcPurchaseTx(null);
      setUsdcPurchaseExplorerUrl(null);
    } finally {
      setPurchasingUsdc(false);
    }
  };

  const handleStripeCheckout = async () => {
    if (!skill) return;
    const useAccountCheckout =
      buyerCardAccessEnabled && buyerAccountAuthenticated;
    if (!useAccountCheckout && (!connected || !walletAddress || !signMessage)) {
      return;
    }

    setStartingStripeCheckout(true);
    setInstallResult(null);
    setDownloadResult(null);
    try {
      let auth:
        | {
            pubkey: string;
            signature: string;
            message: string;
            timestamp: number;
          }
        | undefined;
      if (!useAccountCheckout) {
        const timestamp = Date.now();
        const message = buildStripeCheckoutMessage(
          skill.id,
          String(skill.price_usdc_micros ?? 0),
          timestamp
        );
        const signatureBytes = await signMessage!(
          new TextEncoder().encode(message)
        );
        auth = {
          pubkey: walletAddress!,
          signature: encodeBase64(signatureBytes),
          message,
          timestamp,
        };
      }
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId: skill.id, ...(auth ? { auth } : {}) }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        url?: string | null;
      } | null;
      if (!response.ok) {
        throw new Error(body?.error || "Card checkout is unavailable");
      }
      if (!body?.url) {
        throw new Error("Stripe did not return a checkout URL");
      }

      window.location.assign(body.url);
    } catch (error: unknown) {
      setInstallResult({
        success: false,
        message: getErrorMessage(error, "Card checkout failed"),
      });
      setStartingStripeCheckout(false);
    }
  };

  const handleSignedDownload = async () => {
    const canSignActiveDownload =
      buyerAccountHasAccess ||
      (activeChainContext === BASE_SEPOLIA_CHAIN_CONTEXT &&
        Boolean(activeWalletAddress && activeChainWallet?.signMessage)) ||
      Boolean(connected && walletAddress && signMessage);
    if (!canSignActiveDownload || !skill) {
      return;
    }

    const priceUsdcMicros = BigInt(skill.price_usdc_micros ?? 0);
    if (
      priceUsdcMicros > 0n &&
      !skill.buyerHasPurchased &&
      !buyerAccountHasAccess
    ) {
      setDownloadResult({
        success: false,
        message: buildPaidSkillDownloadRequiredMessage(),
      });
      return;
    }

    setDownloading(true);
    setDownloadResult(null);
    try {
      await downloadEntitledSkill();

      setDownloadResult({
        success: true,
        message: buyerAccountHasAccess
          ? "Account download complete."
          : "Signed download complete.",
      });
    } catch (error: unknown) {
      setDownloadResult({
        success: false,
        message: getErrorMessage(error, "Signed download failed"),
      });
    } finally {
      setDownloading(false);
    }
  };

  const isEvmAuthor = Boolean(
    skill?.author_pubkey && skill.chain_context?.startsWith("eip155:")
  );
  const evmAuthorChainLabel = isEvmAuthor
    ? getChainDisplayLabel(skill?.chain_context)
    : null;
  const isSolanaAuthor =
    !!skill &&
    !isEvmAuthor &&
    !!walletAddress &&
    walletAddress === skill.author_pubkey;
  const isBaseAuthor =
    !!skill &&
    isEvmAuthor &&
    skill.chain_context === BASE_SEPOLIA_CHAIN_CONTEXT &&
    activeChainContext === BASE_SEPOLIA_CHAIN_CONTEXT &&
    !!activeWalletAddress &&
    !!skill.author_pubkey &&
    activeWalletAddress.toLowerCase() === skill.author_pubkey.toLowerCase();
  const isAuthor = isSolanaAuthor || isBaseAuthor;

  const startEditing = useCallback(() => {
    if (!skill) return;
    const canonicalUri =
      skill.source !== "chain"
        ? buildCanonicalSkillUri(skill.id)
        : skill.skill_uri ?? "";
    setEditName(skill.name);
    setEditDescription(skill.description ?? "");
    setEditPrice(
      skill.price_usdc_micros
        ? fromUsdcMicros(Number(skill.price_usdc_micros)).toString()
        : String(PRICING.USDC.defaultPrice)
    );
    setEditUri(canonicalUri);
    setUpdateResult(null);
    setEditing(true);
  }, [skill]);

  const openVersionComposer = useCallback(() => {
    setVersionDraft(content ?? "");
    setVersionChangelog("");
    setVersionResult(null);
    setVersionComposerOpen(true);
  }, [content]);

  const handleUpdateListing = async () => {
    if (!skill) return;
    setUpdating(true);
    setUpdateResult(null);
    try {
      const nextSkillUri =
        skill.source !== "chain" ? buildCanonicalSkillUri(skill.id) : editUri;
      const priceUsdcMicros = toUsdcMicros(parseFloat(editPrice || "0"));
      if (!isValidListingPriceLamports(priceUsdcMicros)) {
        setUpdateResult({
          success: false,
          message: `Price must be 0 for a free listing or at least ${formatMinPrice()}.`,
        });
        setUpdating(false);
        return;
      }
      if (isBaseAuthor) {
        if (
          !activeChainWallet ||
          !activeWalletAddress ||
          !activeChainWallet.signMessage ||
          !skill.evm_listing_id
        ) {
          setUpdateResult({
            success: false,
            message: "Connect the Base author wallet to update this listing.",
          });
          setUpdating(false);
          return;
        }
        const updateTx = await activeChainWallet.updateSkillListing({
          listingId: skill.evm_listing_id,
          skillId: skill.skill_id,
          uri: nextSkillUri,
          name: editName,
          description: editDescription,
          priceUsdcMicros: BigInt(priceUsdcMicros),
        });
        const timestamp = Date.now();
        const message = `AgentVouch Skill Repo\nAction: update-base-listing\nSkill id: ${skill.id}\nTimestamp: ${timestamp}`;
        const signature = await activeChainWallet.signMessage(message);
        const patchRes = await fetch(`/api/skills/${skill.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: {
              pubkey: activeWalletAddress,
              signature,
              message,
              timestamp,
            },
            baseListing: {
              mode: "update",
              txHash: updateTx.ref,
              authorAddress: activeWalletAddress,
              chainContext: BASE_SEPOLIA_CHAIN_CONTEXT,
              expectedName: editName,
              expectedDescription: editDescription,
              expectedUri: nextSkillUri,
              expectedPriceUsdcMicros: String(priceUsdcMicros),
            },
          }),
        });
        if (!patchRes.ok) {
          const patchBody = (await patchRes.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            patchBody?.error || "Base listing updated on-chain but not synced"
          );
        }
        const updated = (await patchRes.json()) as SkillDetail;
        setSkill(updated);
        await refreshSkill({
          includeBuyer: true,
          buyerAddress: activeWalletAddress,
          buyerChainContext: activeChainContext,
        });
        setUpdateResult({
          success: true,
          message: "Listing updated on-chain!",
        });
        setEditing(false);
        return;
      }
      if (!connected || !walletAddress) {
        setUpdateResult({
          success: false,
          message: "Connect the author wallet to update this listing.",
        });
        setUpdating(false);
        return;
      }
      await oracle.updateSkillListing(
        skill.skill_id,
        nextSkillUri,
        editName,
        editDescription,
        priceUsdcMicros
      );
      await refreshSkill();
      setSkill((s) =>
        s
          ? {
              ...s,
              name: editName,
              description: editDescription,
              price_usdc_micros: String(priceUsdcMicros),
              skill_uri: nextSkillUri,
            }
          : s
      );
      setUpdateResult({ success: true, message: "Listing updated on-chain!" });
      setEditing(false);
    } catch (error: unknown) {
      setUpdateResult({
        success: false,
        message: getErrorMessage(error, "Failed to update listing"),
      });
    } finally {
      setUpdating(false);
    }
  };

  const handlePublishVersion = async () => {
    if (!skill || skill.source === "chain") return;
    if (
      !(
        (isBaseAuthor &&
          activeChainWallet?.signMessage &&
          activeWalletAddress) ||
        (isSolanaAuthor && walletAddress && signMessage)
      )
    ) {
      setVersionResult({
        success: false,
        message: "Connect your wallet to publish a new version.",
      });
      return;
    }
    if (!versionDraft.trim()) {
      setVersionResult({
        success: false,
        message: "Updated skill content is required.",
      });
      return;
    }

    setPublishingVersion(true);
    setVersionResult(null);
    try {
      const timestamp = Date.now();
      const message = buildPublisherAuthMessage({
        action: "publish-skill",
        timestamp,
        skillId: skill.id,
      });
      let auth: {
        pubkey: string;
        signature: string;
        message: string;
        timestamp: number;
      } | null = null;

      if (
        isBaseAuthor &&
        activeChainWallet?.signMessage &&
        activeWalletAddress
      ) {
        auth = {
          pubkey: activeWalletAddress,
          signature: await activeChainWallet.signMessage(message),
          message,
          timestamp,
        };
      } else if (isSolanaAuthor && walletAddress && signMessage) {
        const signatureBytes = await signMessage(
          new TextEncoder().encode(message)
        );
        auth = {
          pubkey: walletAddress,
          signature: encodeBase64(signatureBytes),
          message,
          timestamp,
        };
      }
      if (!auth)
        throw new Error("Connect your wallet to publish a new version.");
      const response = await fetch(`/api/skills/${skill.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth,
          content: versionDraft,
          changelog: versionChangelog.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Failed to publish new version");
      }

      await refreshSkill();
      setContent(versionDraft);
      setVersionResult({
        success: true,
        message: `Published version v${data?.version ?? "new"}.`,
      });
      setVersionComposerOpen(false);
    } catch (error: unknown) {
      setVersionResult({
        success: false,
        message: getErrorMessage(error, "Failed to publish new version"),
      });
    } finally {
      setPublishingVersion(false);
    }
  };

  const isChainOnly = skill?.source === "chain";
  const isMirror = Boolean(skill?.mirror_source_key);
  const syncedRepoUrl = !isMirror
    ? sanitizeSyncedRepoUrl(skill?.synced_repo_url)
    : null;
  const visibleTags =
    skill?.tags?.filter((tag) => !RESERVED_SKILL_TAGS.has(tag)) ?? [];
  const authorLabel =
    isMirror && skill?.author_handle
      ? `Mirrored from @${skill.author_handle}`
      : skill?.author_handle
      ? `@${skill.author_handle}`
      : skill?.author_pubkey
      ? shortAddr(skill.author_pubkey)
      : "Unverified publisher";
  const authorHref =
    skill?.author_pubkey && !isEvmAuthor
      ? `/author/${skill.author_pubkey}`
      : skill?.author_kind === "github" && skill.author_handle
      ? `https://github.com/${skill.author_handle}`
      : null;
  const authorTitle = isEvmAuthor
    ? `${
        evmAuthorChainLabel ?? "EVM"
      } author address. Chain-aware author pages are not enabled for this address yet.`
    : skill?.author_pubkey
    ? "Author wallet that published this skill"
    : isMirror
    ? "Community mirror of a public GitHub skill, published by AgentVouch — not posted here by the upstream author."
    : skill?.author_kind === "github"
    ? "GitHub identity that published this unverified skill"
    : "Unverified publisher identity";

  useEffect(() => {
    if (!skill || !isAuthor) {
      handledAuthorActionRef.current = null;
      return;
    }
    if (
      !requestedAuthorAction ||
      requestedAuthorAction === handledAuthorActionRef.current
    ) {
      return;
    }

    if (
      requestedAuthorAction === "edit-listing" &&
      isSolanaAuthor &&
      skill.on_chain_address
    ) {
      startEditing();
      handledAuthorActionRef.current = requestedAuthorAction;
      return;
    }

    if (
      requestedAuthorAction === "publish-version" &&
      skill.source !== "chain" &&
      content !== null
    ) {
      openVersionComposer();
      handledAuthorActionRef.current = requestedAuthorAction;
    }
  }, [
    content,
    openVersionComposer,
    requestedAuthorAction,
    skill,
    startEditing,
    isAuthor,
    isSolanaAuthor,
  ]);

  const CANONICAL_ORIGIN =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://agentvouch.xyz";
  const paidSkillDocsHref = "/docs#paid-skill-download";

  const refreshSettlementSummary = useCallback(async () => {
    if (!skill?.on_chain_address || !isSolanaAuthor) {
      setSettlementSummary(null);
      return;
    }
    const settlement = await oracle
      .getListingSettlement(address(skill.on_chain_address))
      .catch(() => null);
    if (!settlement) {
      setSettlementSummary(null);
      return;
    }
    setSettlementSummary({
      pda: String(settlement.publicKey),
      withdrawableUsdcMicros:
        settlement.account.withdrawableAuthorProceedsUsdcMicros,
      withdrawnUsdcMicros: settlement.account.withdrawnAuthorProceedsUsdcMicros,
      refundedUsdcMicros: settlement.account.refundedAuthorProceedsUsdcMicros,
      locked: !!settlement.account.lockedByDispute,
    });
  }, [isSolanaAuthor, oracle, skill?.on_chain_address]);

  useEffect(() => {
    void refreshSettlementSummary();
  }, [refreshSettlementSummary]);

  const handleWithdrawAuthorProceeds = useCallback(async () => {
    if (!skill?.on_chain_address) return;
    setWithdrawingProceeds(true);
    setWithdrawResult(null);
    try {
      await oracle.withdrawAuthorProceeds(address(skill.on_chain_address));
      await refreshSettlementSummary();
      setWithdrawResult({
        success: true,
        message: "Author proceeds withdrawn.",
      });
    } catch (error: unknown) {
      setWithdrawResult({
        success: false,
        message: getErrorMessage(error, "Failed to withdraw author proceeds"),
      });
    } finally {
      setWithdrawingProceeds(false);
    }
  }, [oracle, refreshSettlementSummary, skill?.on_chain_address]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <FiLoader className="w-6 h-6 animate-spin text-gray-400" />
      </main>
    );
  }

  if (!skill) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Skill not found
          </p>
          <Link
            href="/skills"
            className="text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
          >
            ← Back to skills
          </Link>
        </div>
      </main>
    );
  }

  const legacySolLamports =
    skill.price_usdc_micros || skill.payment_flow === "direct-purchase-skill"
      ? 0
      : skill.legacySolLamports ?? skill.price_lamports ?? 0;
  const primaryUsdcPrice = formatUsdcMicros(skill.price_usdc_micros);
  const estimatedPurchaseRentLamports =
    skill.estimatedPurchaseRentLamports ?? 0;
  const hasBaseListing =
    skill.chain_context === BASE_SEPOLIA_CHAIN_CONTEXT &&
    Boolean(skill.evm_listing_id);
  const needsBaseListingSync =
    skill.chain_context === BASE_SEPOLIA_CHAIN_CONTEXT &&
    !hasBaseListing &&
    hasPositiveStoredUsdcPrice(skill.price_usdc_micros);
  const isBaseProtocolSkill = hasBaseListing;
  const activeBaseWalletReady =
    activeChainContext === BASE_SEPOLIA_CHAIN_CONTEXT &&
    Boolean(activeChainWallet && activeWalletAddress);
  const paymentFlow =
    skill.payment_flow ??
    (skill.price_usdc_micros
      ? skill.on_chain_address || skill.evm_listing_id
        ? "direct-purchase-skill"
        : "listing-required"
      : "free");
  const isListingRequired = paymentFlow === "listing-required";
  const hasUsdcPrimary =
    Boolean(primaryUsdcPrice) ||
    isListingRequired ||
    paymentFlow === "x402-usdc" ||
    paymentFlow === "direct-purchase-skill";
  const hasLegacySolPrice = legacySolLamports > 0;
  const purchasePreflightStatus =
    skill.purchasePreflightStatus ??
    (hasUsdcPrimary ? "estimateUnavailable" : "ok");
  const purchaseBlocked =
    !isBaseProtocolSkill &&
    !isListingRequired &&
    hasUsdcPrimary &&
    isBlockingPurchaseStatus(purchasePreflightStatus);
  const isPaidSkill = hasUsdcPrimary;
  const buyerHasPurchased = Boolean(
    skill.buyerHasPurchased || buyerAccountHasAccess
  );
  const accountCanAuthorizeStripeCheckout = Boolean(
    buyerCardAccessEnabled && buyerAccountAuthenticated
  );
  // Account checkout can grant off-chain marketplace access for Base Sepolia
  // without claiming a protocol purchase. Legacy wallet checkout remains
  // unavailable for Base protocol listings because it cannot redeem there.
  const stripeCheckoutAvailable = Boolean(
    stripeCheckoutEnabled &&
      primaryUsdcPrice &&
      !buyerHasPurchased &&
      !isAuthor &&
      (!isBaseProtocolSkill || accountCanAuthorizeStripeCheckout)
  );
  const walletCanAuthorizeStripeCheckout = Boolean(
    !isBaseProtocolSkill &&
      connected &&
      walletAddress &&
      signMessage &&
      stripeCheckoutAvailable
  );
  const canAuthorizeStripeCheckout = Boolean(
    accountCanAuthorizeStripeCheckout || walletCanAuthorizeStripeCheckout
  );
  const cardAccessSubject = accountCanAuthorizeStripeCheckout
    ? "AgentVouch account"
    : "wallet";
  const walletCanAuthorizeDirectUsdc = Boolean(
    protocolTransactionSigner && signMessage && !isPhantomEmbeddedWallet
  );
  const walletCanAuthorizeBrowserX402 = Boolean(
    kitSigner &&
      signMessage &&
      !isPhantomEmbeddedWallet &&
      walletSupportsBrowserX402(capabilities)
  );
  const embeddedWalletCheckoutBlocked =
    isPaidSkill &&
    !isBaseProtocolSkill &&
    isPhantomEmbeddedWallet &&
    !buyerHasPurchased;
  const walletCanAuthorizeBaseUsdc =
    isBaseProtocolSkill && activeBaseWalletReady;
  const browserCanUseUsdc =
    !isListingRequired &&
    hasUsdcPrimary &&
    (isBaseProtocolSkill
      ? walletCanAuthorizeBaseUsdc
      : paymentFlow === "direct-purchase-skill"
      ? walletCanAuthorizeDirectUsdc
      : walletCanAuthorizeBrowserX402);
  const signedRedownloadAvailable =
    hasUsdcPrimary || Boolean(skill.on_chain_address);
  const apiPath = `/api/skills/${skill.id}/raw`;
  const installUrl =
    isChainOnly && skill?.skill_uri
      ? skill.skill_uri
      : `${CANONICAL_ORIGIN}${apiPath}`;
  const usdcPriceLabel = primaryUsdcPrice ? `${primaryUsdcPrice} USDC` : "USDC";
  const signedDownloadMessage = buildDownloadRawMessage(
    skill.id,
    skill.on_chain_address ? "{skillListingAddress}" : undefined,
    1709234567890
  ).replace("1709234567890", "{unix_ms}");
  const signedDownloadHeader = `{
  "pubkey": "YOUR_PUBKEY",
  "signature": "BASE64_ED25519_SIGNATURE",
  "message": ${JSON.stringify(signedDownloadMessage)},
  "timestamp": 1709234567890
}`;
  const installCommand = hasUsdcPrimary
    ? isListingRequired
      ? stripeCheckoutEnabled
        ? `# Primary price: ${usdcPriceLabel} via off-chain card checkout (browser only)\n# A human can pay by card on this page to create an account- or wallet-scoped marketplace entitlement.\ncurl -sL ${installUrl}`
        : `# Primary price: ${usdcPriceLabel}\n# This paid repo skill is not purchasable until the author links an on-chain SkillListing.\ncurl -sL ${installUrl}`
      : paymentFlow === "direct-purchase-skill"
      ? isBaseProtocolSkill
        ? `# Primary price: ${usdcPriceLabel} via Base AgentVouch\n# Call purchaseSkill on Base, then POST the confirmed tx hash to /api/skills/${skill.id}/purchase/verify.\ncurl -sL ${installUrl}`
        : `# Primary price: ${usdcPriceLabel} via purchase_skill\n# Call purchase_skill on-chain, POST the confirmed signature to /api/skills/${skill.id}/purchase/verify, then retry with X-AgentVouch-Auth.\ncurl -sL ${installUrl}`
      : `# Primary price: ${usdcPriceLabel} via x402\n# Browser checkout is available on this page for wallets with partial transaction signing.\n# Agents can call the raw endpoint directly and respond to PAYMENT-REQUIRED / PAYMENT-SIGNATURE.\ncurl -sL ${installUrl}`
    : `curl -sL ${installUrl} -o SKILL.md`;
  const purchaseTitle = primaryUsdcPrice
    ? isListingRequired
      ? stripeCheckoutEnabled
        ? "Card checkout (off-chain)"
        : "On-chain listing required"
      : "USDC primary pricing"
    : isPaidSkill
    ? "Paid Skill"
    : "Free Skill";
  const purchaseDescription = !isPaidSkill
    ? "Download this free skill without connecting a wallet. Downloads are counted, but anonymous downloads are not wallet-attributed."
    : isListingRequired
    ? isAuthor
      ? `This paid skill is priced at ${usdcPriceLabel}, but it is not purchasable until you create and link its on-chain SkillListing.`
      : stripeCheckoutAvailable
      ? `This paid skill is priced at ${usdcPriceLabel}. Card checkout can unlock this ${cardAccessSubject} now while on-chain listing setup is pending.`
      : `This paid skill is priced at ${usdcPriceLabel}, but purchases are unavailable while the author links the on-chain listing.`
    : isAuthor
    ? primaryUsdcPrice
      ? `This listing is priced at ${usdcPriceLabel}.`
      : "This connected wallet is the author for this skill. Use the author actions below to manage the listing instead of purchasing it."
    : buyerHasPurchased
    ? buyerAccountHasAccess
      ? "This skill is purchased for your AgentVouch account. Download it without connecting or signing with a wallet."
      : signedRedownloadAvailable
      ? "This skill is already purchased for your connected wallet. Sign to download the file."
      : isBaseProtocolSkill
      ? "This Base purchase is verified for your connected wallet. Base signed re-download authorization is not enabled yet."
      : "This skill is already purchased for your connected wallet. The file is delivered at checkout."
    : embeddedWalletCheckoutBlocked
    ? "Embedded Phantom checkout is temporarily unavailable. Connect the Phantom extension or another Solana wallet to purchase."
    : primaryUsdcPrice
    ? browserCanUseUsdc
      ? isBaseProtocolSkill
        ? `Pay ${usdcPriceLabel} from this page with Base Sepolia USDC.`
        : stripeCheckoutAvailable
        ? `Pay ${usdcPriceLabel} through protocol USDC settlement, or use card checkout for an off-chain ${cardAccessSubject} entitlement.`
        : `Pay ${usdcPriceLabel} from this page. After checkout, SKILL.md downloads immediately and future re-downloads use Sign & Download.`
      : stripeCheckoutAvailable
      ? `This listing is priced in ${usdcPriceLabel}. Card checkout can unlock this ${cardAccessSubject} and is recorded separately from protocol USDC settlement.`
      : `This listing is priced in ${usdcPriceLabel}. This wallet cannot use browser x402; use direct purchase or the agent/API fallback below.`
    : hasLegacySolPrice
    ? "This historical SOL-priced listing is not available for new USDC checkout."
    : "Download this free skill without connecting a wallet.";
  const connectWalletLabel = primaryUsdcPrice
    ? isListingRequired
      ? stripeCheckoutEnabled
        ? "Connect AgentVouch wallet to pay by card"
        : "Listing setup required before purchase"
      : isBaseProtocolSkill
      ? "Connect Base wallet to pay with USDC"
      : "Connect wallet to pay with USDC"
    : isPaidSkill
    ? "Connect wallet to buy and unlock"
    : "Wallet optional for free downloads";

  const trustVerdict = (() => {
    const sigs = skill.signals ?? [];
    if (sigs.length === 0) return null;
    const action = recommendedActionFromSignals(sigs);

    if (action === "avoid") {
      return {
        word: "Avoid",
        text: "text-red-700 dark:text-red-300",
        box: "border-red-200 bg-red-50 dark:border-red-800/60 dark:bg-red-900/10",
        sub: "A trust signal failed. Review the signals before installing.",
      };
    }

    if (action === "allow") {
      return {
        word: "Trusted",
        text: "text-emerald-700 dark:text-emerald-300",
        box: "border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-900/10",
        sub: "Staked on-chain trust and clean advisory checks back this listing.",
      };
    }

    return {
      word: "Review",
      text: "text-amber-700 dark:text-amber-300",
      box: "border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-900/10",
      sub:
        action === "unknown"
          ? "Trust data is incomplete. Review the signals before installing."
          : "Advisory findings or unestablished signals to weigh before installing.",
    };
  })();

  const renderPayByCardButton = (buttonClass: string) => (
    <button
      onClick={handleStripeCheckout}
      disabled={startingStripeCheckout || !canAuthorizeStripeCheckout}
      className={`${buttonClass} w-full justify-center`}
    >
      {startingStripeCheckout ? (
        <>
          <FiLoader className="w-4 h-4 animate-spin" />
          Opening…
        </>
      ) : (
        <>
          <FiCreditCard className="w-4 h-4" />
          Pay by Card
        </>
      )}
    </button>
  );

  return (
    <main className="font-heading min-h-screen bg-[var(--background)] text-[var(--foreground)] transition-colors">
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
        {/* ===== HERO ===== */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {/* Header */}
            <div className="mb-8">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <Link
                    href="/skills"
                    className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white transition flex items-center gap-1"
                  >
                    <FiArrowLeft className="w-3.5 h-3.5" />
                    Skills
                  </Link>
                  <span className="text-gray-300 dark:text-gray-700">/</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {skill.name}
                  </span>
                </div>
                <h1 className="font-display text-4xl leading-[1.05] tracking-tight text-gray-900 dark:text-white sm:text-5xl">
                  {skill.name}
                </h1>
                {skill.description && (
                  <p className="font-article mt-3 max-w-2xl text-lg leading-relaxed text-gray-600 dark:text-gray-300">
                    {skill.description}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2.5 text-sm text-gray-500 dark:text-gray-400">
                  <span
                    aria-hidden
                    className="h-7 w-7 shrink-0 rounded-md ring-1 ring-black/10 dark:ring-white/10"
                    style={{
                      background:
                        "conic-gradient(from 210deg at 60% 40%, var(--lobster-accent), var(--lobster-accent-strong), var(--sea-accent), var(--lobster-accent))",
                    }}
                  />
                  <span className="font-medium text-gray-700 dark:text-gray-200">
                    {authorLabel}
                  </span>
                  {isMirror ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--sea-accent-strong)]"
                      title="Community mirror of a public GitHub skill, published by AgentVouch — not posted here by the upstream author."
                    >
                      <FiGithub className="h-3 w-3" />
                      Mirror
                    </span>
                  ) : null}
                  {syncedRepoUrl ? (
                    <a
                      href={syncedRepoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--sea-accent-strong)] transition hover:underline"
                      title="Kept in sync from this author's GitHub repo"
                    >
                      <FiGithub className="h-3 w-3" />
                      Synced
                    </a>
                  ) : null}
                  {skill.author_trust?.registeredAt ? (
                    <span className="rounded-full border border-[var(--sea-accent-border)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--sea-accent-strong)]">
                      Registered
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            {/* Tags */}
            {visibleTags.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {visibleTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[var(--lobster-accent-border)] bg-[var(--lobster-accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--lobster-accent)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          {trustVerdict && (
            <div
              className={`shrink-0 rounded-xl border p-5 backdrop-blur-sm sm:w-72 ${trustVerdict.box}`}
            >
              <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                Recommended action
                <InfoTip label="How the recommended action is derived">
                  Rolled up from the independent trust signals below. Only
                  staked on-chain trust earns &ldquo;Trusted&rdquo; — the
                  automated scan can flag risk but never grants it.
                </InfoTip>
              </div>
              <div
                className={`font-display text-3xl leading-none ${trustVerdict.text}`}
              >
                {trustVerdict.word}
              </div>
              <div className="mt-2.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {trustVerdict.sub}
              </div>
            </div>
          )}
        </div>

        {/* ===== QUICK STATS ===== */}
        {/* Meta Row */}
        <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span className="text-gray-700 dark:text-gray-300">
            v{skill.current_version}
          </span>
          <span className="text-gray-300 dark:text-gray-700">·</span>
          <span className="inline-flex items-center gap-1">
            <FiDownload className="h-3.5 w-3.5" />
            {(skill.total_installs ?? 0) + (skill.total_downloads ?? 0)}{" "}
            installs
          </span>
          <span className="text-gray-300 dark:text-gray-700">·</span>
          <span>Published {formatDate(skill.created_at)}</span>
          {primaryUsdcPrice ? (
            <>
              <span className="text-gray-300 dark:text-gray-700">·</span>
              <span className="inline-flex items-center gap-1 font-medium text-[var(--lobster-accent)]">
                <UsdcIcon className="h-3.5 w-3.5" />
                {primaryUsdcPrice} USDC
              </span>
            </>
          ) : null}
          {hasLegacySolPrice ? (
            <>
              <span className="text-gray-300 dark:text-gray-700">·</span>
              <span>Legacy SOL price</span>
            </>
          ) : null}
        </div>

        {/* ===== MAIN + RAIL ===== */}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            {(displayCapabilities.length > 0 ||
              (displaySummaryLine &&
                displaySummaryLine !== skill.description)) && (
              <div className="mb-6 rounded-lg border border-gray-200 bg-white/70 p-6 dark:border-gray-800 dark:bg-gray-900/50">
                <h2 className="mb-4 flex items-center gap-2 text-[11px] font-normal uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                  <FiFileText className="h-4 w-4 text-[var(--sea-accent)]" />
                  What it does
                </h2>
                {displaySummaryLine &&
                  displaySummaryLine !== skill.description && (
                    <p className="font-article mb-4 text-lg leading-relaxed text-gray-700 dark:text-gray-200">
                      {displaySummaryLine}
                    </p>
                  )}
                {displayCapabilities.length > 0 && (
                  <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                    {displayCapabilities.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-2.5">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--lobster-accent)]" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {/* Skill Tree / SKILL.md Content */}
            {skill.files?.length ? (
              <div className="mb-6">
                <SkillFileTree
                  skillId={skill.id}
                  skillName={skill.name}
                  files={skill.files}
                  treeHash={skill.tree_hash}
                  hasExecutable={skill.has_executable}
                  securityScan={skill.security_scan}
                  initialContent={content}
                  walled={!content && isPaidSkill}
                  priceLabel={
                    primaryUsdcPrice ? `${primaryUsdcPrice} USDC` : undefined
                  }
                />
              </div>
            ) : content ? (
              <div className="mb-6 rounded-lg border border-gray-200 bg-white/70 p-6 dark:border-gray-800 dark:bg-gray-900/50">
                <div className="mb-4 flex items-center gap-2 border-b border-gray-100 pb-4 dark:border-gray-800">
                  <FiFileText className="h-4 w-4 text-gray-400" />
                  <span className="text-xs font-normal uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    SKILL.md Content
                  </span>
                </div>
                <MarkdownRenderer content={content} variant="skill" />
              </div>
            ) : (
              isChainOnly &&
              skill.skill_uri &&
              (isPaidSkill ? (
                <div className="mb-6 rounded-lg border border-gray-200 bg-white/70 p-6 text-center dark:border-gray-800 dark:bg-gray-900/50">
                  <FiLock className="mx-auto h-6 w-6 text-gray-400" />
                  <h2 className="font-display mt-3 text-xl text-gray-900 dark:text-white">
                    Paid content
                  </h2>
                  <p className="font-article mx-auto mt-2 max-w-lg text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                    {buyerHasPurchased
                      ? "Purchase verified. Use Sign & Download in the purchase panel to retrieve SKILL.md."
                      : `Complete the ${usdcPriceLabel} purchase, then sign with the buyer wallet to retrieve SKILL.md.`}
                  </p>
                </div>
              ) : (
                <div className="mb-6 rounded-sm border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800/50 dark:bg-yellow-900/10">
                  <p className="text-sm text-yellow-700 dark:text-yellow-400">
                    Content could not be loaded from the source URL. The file
                    may have been moved or is temporarily unavailable.
                  </p>
                </div>
              ))
            )}
            {/* Developer & API (collapsed by default) */}
            <details className="group/dev mb-6 rounded-lg border border-gray-200 bg-white/70 dark:border-gray-800 dark:bg-gray-900/50">
              <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-[11px] font-normal uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                <span className="flex items-center gap-2">
                  <FiTerminal className="h-4 w-4 text-[var(--sea-accent)]" />
                  Developer &amp; API
                </span>
                <FiChevronDown className="h-4 w-4 transition-transform group-open/dev:rotate-180" />
              </summary>
              <div className="space-y-5 border-t border-gray-100 px-5 py-5 dark:border-gray-800">
                {/* Install Command */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Install
                    </span>
                    <button
                      onClick={() => copyToClipboard(installCommand, "install")}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-[var(--sea-accent)] transition"
                    >
                      {copied === "install" ? (
                        <FiCheck className="w-3.5 h-3.5 text-[var(--sea-accent)]" />
                      ) : (
                        <FiCopy className="w-3.5 h-3.5" />
                      )}
                      {copied === "install" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <pre className="text-sm bg-gray-50 dark:bg-gray-800 rounded-sm p-3 overflow-x-auto border border-gray-100 dark:border-gray-700">
                    <code>{installCommand}</code>
                  </pre>
                </div>
                {/* Agent API */}
                <div className="border-t border-gray-100 pt-5 dark:border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Agent API
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <pre className="flex-1 text-sm bg-gray-50 dark:bg-gray-800 rounded-sm p-3 overflow-x-auto border border-gray-100 dark:border-gray-700">
                      <code>{`GET /api/skills/${skill.id}/raw`}</code>
                    </pre>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          `${
                            typeof window !== "undefined"
                              ? window.location.origin
                              : ""
                          }/api/skills/${skill.id}/raw`,
                          "api"
                        )
                      }
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-[var(--sea-accent)] transition shrink-0"
                    >
                      {copied === "api" ? (
                        <FiCheck className="w-3.5 h-3.5 text-[var(--sea-accent)]" />
                      ) : (
                        <FiCopy className="w-3.5 h-3.5" />
                      )}
                      {copied === "api" ? "Copied!" : "Copy URL"}
                    </button>
                  </div>
                  {isPaidSkill && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Signed Message
                          </span>
                          <button
                            onClick={() =>
                              copyToClipboard(
                                signedDownloadMessage,
                                "api-message"
                              )
                            }
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-[var(--sea-accent)] transition"
                          >
                            {copied === "api-message" ? (
                              <FiCheck className="w-3.5 h-3.5 text-[var(--sea-accent)]" />
                            ) : (
                              <FiCopy className="w-3.5 h-3.5" />
                            )}
                            {copied === "api-message" ? "Copied!" : "Copy"}
                          </button>
                        </div>
                        <pre className="text-sm bg-gray-50 dark:bg-gray-800 rounded-sm p-3 overflow-x-auto border border-gray-100 dark:border-gray-700">
                          <code>{signedDownloadMessage}</code>
                        </pre>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            X-AgentVouch-Auth
                          </span>
                          <button
                            onClick={() =>
                              copyToClipboard(signedDownloadHeader, "api-auth")
                            }
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-[var(--sea-accent)] transition"
                          >
                            {copied === "api-auth" ? (
                              <FiCheck className="w-3.5 h-3.5 text-[var(--sea-accent)]" />
                            ) : (
                              <FiCopy className="w-3.5 h-3.5" />
                            )}
                            {copied === "api-auth" ? "Copied!" : "Copy"}
                          </button>
                        </div>
                        <pre className="text-sm bg-gray-50 dark:bg-gray-800 rounded-sm p-3 overflow-x-auto border border-gray-100 dark:border-gray-700">
                          <code>{signedDownloadHeader}</code>
                        </pre>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                    Auth:{" "}
                    <code className="text-gray-500 dark:text-gray-400">
                      Authorization: Bearer sk_...
                    </code>{" "}
                    or wallet signature.{" "}
                    <Link
                      href="/settings"
                      className="text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                    >
                      Get API key →
                    </Link>
                  </p>
                </div>
              </div>
            </details>
            {/* Version History */}
            {(skill.versions?.length > 0 || (isAuthor && !isChainOnly)) && (
              <div className="rounded-lg border border-gray-200 bg-white/70 dark:border-gray-800 dark:bg-gray-900/50 p-6">
                <div className="flex items-center justify-between gap-4 mb-4 pb-4 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <FiGitCommit className="w-4 h-4 text-gray-400" />
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Version History
                    </span>
                  </div>
                  {isAuthor && !isChainOnly && !versionComposerOpen && (
                    <button
                      onClick={openVersionComposer}
                      className={`${navButtonSecondaryInlineClass} gap-1.5 font-medium`}
                    >
                      <FiGitCommit className="w-3.5 h-3.5" />
                      Publish New Version
                    </button>
                  )}
                </div>
                {isAuthor && !isChainOnly && versionComposerOpen && (
                  <div className="mb-4 p-4 rounded-sm border border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)]">
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <div>
                        <h3 className="text-sm font-normal text-gray-900 dark:text-white">
                          Publish New Version
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          This publishes updated repo-backed skill content and
                          changelog only. Listing edits stay on the on-chain
                          path.
                        </p>
                      </div>
                      <button
                        onClick={() => setVersionComposerOpen(false)}
                        disabled={publishingVersion}
                        className={`${navButtonSizeClass} text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition`}
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                          Updated SKILL.md content
                        </label>
                        <textarea
                          value={versionDraft}
                          onChange={(e) => setVersionDraft(e.target.value)}
                          rows={14}
                          className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-sm text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                          Changelog
                        </label>
                        <input
                          type="text"
                          value={versionChangelog}
                          onChange={(e) => setVersionChangelog(e.target.value)}
                          placeholder="Summarize what changed in this version"
                          className="w-full px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                        />
                      </div>
                      {versionResult && (
                        <p
                          className={`text-xs ${
                            versionResult.success
                              ? "text-green-600 dark:text-green-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {versionResult.message}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handlePublishVersion}
                          disabled={publishingVersion}
                          className={navButtonPrimaryInlineClass}
                        >
                          {publishingVersion ? (
                            <>
                              <FiLoader className="w-4 h-4 animate-spin" />
                              Publishing…
                            </>
                          ) : (
                            <>
                              <FiGitCommit className="w-4 h-4" />
                              Publish New Version
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {skill.versions?.length > 0 ? (
                  <div className="space-y-3">
                    {skill.versions.map((ver) => (
                      <div
                        key={ver.id}
                        className="flex items-start justify-between p-3 rounded-sm bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gray-900 dark:text-white">
                              v{ver.version}
                            </span>
                            {ver.version === skill.current_version && (
                              <span className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs">
                                latest
                              </span>
                            )}
                          </div>
                          {ver.changelog && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                              {ver.changelog}
                            </p>
                          )}
                          {ver.ipfs_cid && (
                            <span className="text-xs font-mono text-gray-400 dark:text-gray-500 mt-1 block">
                              CID: {ver.ipfs_cid.slice(0, 16)}...
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                          <FiClock className="w-3 h-3" />
                          {formatDate(ver.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  isAuthor &&
                  !isChainOnly && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Publish the first repo-backed version update for this
                      skill.
                    </p>
                  )
                )}
              </div>
            )}
          </div>

          <aside className="self-start lg:sticky lg:top-6">
            {/* Install / Buy action */}
            {(!hasLegacySolPrice || hasUsdcPrimary) && (
              <div className="mb-6 rounded-lg border border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    {primaryUsdcPrice ? (
                      <>
                        <span className="font-display text-3xl font-bold leading-none text-gray-900 dark:text-white">
                          {primaryUsdcPrice}
                        </span>
                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          USDC
                        </span>
                      </>
                    ) : hasLegacySolPrice ? (
                      <span className="font-display text-2xl font-bold leading-none text-gray-900 dark:text-white">
                        Legacy SOL
                      </span>
                    ) : (
                      <span className="font-display text-3xl font-bold leading-none text-gray-900 dark:text-white">
                        Free
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isPaidSkill && buyerHasPurchased && !isAuthor && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300">
                        <FiCheckCircle className="h-3 w-3" />
                        Purchased
                      </span>
                    )}
                    <InfoTip label={`${purchaseTitle} details`} align="right">
                      {purchaseDescription}
                    </InfoTip>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <span>
                    {(skill.total_installs ?? 0) + (skill.total_downloads ?? 0)}{" "}
                    installs
                  </span>
                  {estimatedPurchaseRentLamports > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      · +
                      <SolAmount
                        amount={fromLamports(
                          estimatedPurchaseRentLamports
                        ).toFixed(4)}
                        iconClassName="w-3 h-3"
                      />
                      rent
                    </span>
                  ) : null}
                  <span>· {isPaidSkill ? "paid skill" : "free skill"}</span>
                  {isPaidSkill ? (
                    <Link
                      href={paidSkillDocsHref}
                      className="text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                    >
                      · paid download docs
                    </Link>
                  ) : null}
                </div>

                <div className="mt-4">
                  {!isPaidSkill ? (
                    <button
                      onClick={handleFreeDownload}
                      disabled={installing}
                      className={`${navButtonPrimaryInlineClass} w-full justify-center`}
                    >
                      {installing ? (
                        <>
                          <FiLoader className="w-4 h-4 animate-spin" />
                          Downloading…
                        </>
                      ) : (
                        <>
                          <FiDownload className="w-4 h-4" />
                          {(skill.files?.length ?? 0) > 1
                            ? "Download skill (.zip)"
                            : "Download SKILL.md"}
                        </>
                      )}
                    </button>
                  ) : connected ||
                    activeBaseWalletReady ||
                    accountCanAuthorizeStripeCheckout ||
                    buyerAccountHasAccess ? (
                    isAuthor ? (
                      <Link
                        href="#author-actions"
                        className={`${navButtonSecondaryInlineClass} w-full justify-center`}
                      >
                        Manage Listing
                      </Link>
                    ) : buyerHasPurchased ? (
                      signedRedownloadAvailable ? (
                        <button
                          onClick={handleSignedDownload}
                          disabled={downloading}
                          className={`${navButtonPrimaryInlineClass} w-full justify-center`}
                        >
                          {downloading ? (
                            <>
                              <FiLoader className="w-4 h-4 animate-spin" />
                              {buyerAccountHasAccess
                                ? "Downloading…"
                                : "Signing…"}
                            </>
                          ) : (
                            <>
                              <FiDownload className="w-4 h-4" />
                              {buyerAccountHasAccess
                                ? "Download"
                                : "Sign & Download"}
                            </>
                          )}
                        </button>
                      ) : (
                        <p className="text-center text-xs text-gray-400 dark:text-gray-500">
                          Purchased. Signed re-downloads require an on-chain
                          link.
                        </p>
                      )
                    ) : embeddedWalletCheckoutBlocked ? (
                      <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-[var(--lobster-accent)]">
                        <FiAlertTriangle className="w-3.5 h-3.5" />
                        Use an extension wallet
                      </p>
                    ) : isListingRequired && stripeCheckoutAvailable ? (
                      renderPayByCardButton(navButtonPrimaryInlineClass)
                    ) : isListingRequired ? (
                      <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                        <FiAlertTriangle className="w-3.5 h-3.5" />
                        Listing setup required
                      </p>
                    ) : isBaseProtocolSkill && !activeBaseWalletReady ? (
                      <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                        <FiAlertTriangle className="w-3.5 h-3.5" />
                        Connect Base wallet
                      </p>
                    ) : primaryUsdcPrice && browserCanUseUsdc ? (
                      <div className="flex flex-col items-stretch gap-2">
                        <button
                          onClick={handleUsdcPurchase}
                          disabled={purchasingUsdc || purchaseBlocked}
                          className={`${navButtonPrimaryInlineClass} w-full justify-center`}
                        >
                          {purchasingUsdc ? (
                            <>
                              <FiLoader className="w-4 h-4 animate-spin" />
                              Processing…
                            </>
                          ) : (
                            <>
                              <UsdcIcon className="w-4 h-4" />
                              {purchaseBlocked
                                ? purchasePreflightStatus ===
                                  "buyerMissingUsdcAccount"
                                  ? "Set Up USDC Account"
                                  : "Need More USDC"
                                : "Pay with USDC"}
                            </>
                          )}
                        </button>
                        {stripeCheckoutAvailable && canAuthorizeStripeCheckout
                          ? renderPayByCardButton(navButtonSecondaryInlineClass)
                          : null}
                      </div>
                    ) : stripeCheckoutAvailable &&
                      canAuthorizeStripeCheckout ? (
                      renderPayByCardButton(navButtonPrimaryInlineClass)
                    ) : (
                      <p className="text-center text-xs text-gray-400 dark:text-gray-500">
                        USDC checkout is required for new purchases.
                      </p>
                    )
                  ) : (
                    <div className="flex flex-col items-stretch gap-1.5 [&_button]:w-full [&_button]:justify-center">
                      <ClientWalletButton />
                      <span className="text-center text-[11px] text-gray-400 dark:text-gray-500">
                        {connectWalletLabel}
                      </span>
                    </div>
                  )}
                </div>
                {isPaidSkill && !buyerHasPurchased && !isAuthor && (
                  <p className="mt-2.5 text-center text-[11px] text-gray-400 dark:text-gray-500">
                    {isBaseProtocolSkill
                      ? "Base purchase · per-buyer receipt · native USDC · "
                      : "on-chain purchase · per-buyer receipt · refund-eligible · "}
                    <Link
                      href={paidSkillDocsHref}
                      className="text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                    >
                      docs
                    </Link>
                  </p>
                )}
                {buyerHasPurchased &&
                  skill.buyerPurchaseSummary &&
                  skill.buyerPurchaseSummary.kind !== "evm-paid-purchase" &&
                  !isAuthor && (
                    <div className="mt-3 rounded-sm border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-950/40 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Refund status
                      </div>
                      <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        {skill.buyerPurchaseSummary.refundStatus === "refunded"
                          ? "Refund claimed for this purchase."
                          : skill.buyerPurchaseSummary.legacyRefundEligible
                          ? "Legacy purchase metadata is present; refund eligibility depends on a mapped refund pool."
                          : "No active refund claim is recorded for this purchase."}
                      </p>
                      {skill.buyerPurchaseSummary.purchasePda && (
                        <p className="mt-1 font-mono text-[11px] text-gray-400">
                          Purchase{" "}
                          {shortAddr(skill.buyerPurchaseSummary.purchasePda)}
                          {skill.buyerPurchaseSummary.listingRevision
                            ? ` · revision ${skill.buyerPurchaseSummary.listingRevision}`
                            : ""}
                        </p>
                      )}
                    </div>
                  )}
                {buyerHasPurchased &&
                  skill.buyerPurchaseSummary?.kind === "evm-paid-purchase" &&
                  !isAuthor && (
                    <PaidPurchaseReportPanel
                      skillId={skill.id}
                      purchase={skill.buyerPurchaseSummary}
                    />
                  )}
                {skill.priceDisclosure &&
                  hasLegacySolPrice &&
                  !hasUsdcPrimary && (
                    <p className="text-xs mt-3 text-gray-500 dark:text-gray-400">
                      {skill.priceDisclosure}
                    </p>
                  )}
                {primaryUsdcPrice &&
                  isListingRequired &&
                  (stripeCheckoutEnabled ? (
                    <p className="text-xs mt-2 text-gray-500 dark:text-gray-400">
                      Card checkout records an off-chain marketplace grant for
                      this {cardAccessSubject} while on-chain listing setup is
                      pending.
                    </p>
                  ) : (
                    <p className="text-xs mt-2 text-gray-500 dark:text-gray-400">
                      New paid purchases are disabled until this repo skill is
                      linked to an on-chain listing.
                    </p>
                  ))}
                {primaryUsdcPrice &&
                  !isListingRequired &&
                  stripeCheckoutAvailable && (
                    <p className="text-xs mt-2 text-gray-500 dark:text-gray-400">
                      Protocol USDC purchases settle through purchase_skill,
                      Base, or x402; card checkout records a separate off-chain
                      marketplace grant for this {cardAccessSubject}.
                    </p>
                  )}
                {skill.purchaseRiskWarning &&
                  hasUsdcPrimary &&
                  !isListingRequired &&
                  !buyerHasPurchased &&
                  !isAuthor && (
                    <div className="mt-3 rounded-sm border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
                      <div className="mb-1 flex items-center gap-2 font-medium">
                        <FiInfo className="h-3.5 w-3.5" />
                        Limited dispute recovery
                      </div>
                      <p>{skill.purchaseRiskWarning}</p>
                    </div>
                  )}
                {skill.purchasePreflightMessage &&
                  hasUsdcPrimary &&
                  !isListingRequired && (
                    <p
                      className={`text-xs mt-2 ${
                        purchaseBlocked
                          ? "text-amber-700 dark:text-amber-300"
                          : purchasePreflightStatus === "estimateUnavailable"
                          ? "text-gray-500 dark:text-gray-400"
                          : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {skill.purchasePreflightMessage}
                    </p>
                  )}
                {installResult && (
                  <p
                    className={`text-xs mt-2 ${
                      installResult.success
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {installResult.message}
                  </p>
                )}
                {usdcPurchaseTx && (
                  <p className="text-xs mt-2 text-green-600 dark:text-green-400">
                    Settlement tx:{" "}
                    <a
                      href={
                        usdcPurchaseExplorerUrl ??
                        getConfiguredSolanaExplorerTxUrl(usdcPurchaseTx)
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-mono"
                    >
                      {usdcPurchaseTx.slice(0, 8)}...{usdcPurchaseTx.slice(-8)}
                    </a>
                  </p>
                )}
                {downloadResult && (
                  <p
                    className={`text-xs mt-2 ${
                      downloadResult.success
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {downloadResult.message}
                  </p>
                )}
                {isSolanaAuthor &&
                  !hasUsdcPrimary &&
                  skill.on_chain_address && (
                    <p className="text-xs mt-2 text-amber-600 dark:text-amber-400">
                      This skill is listed for free. You can set a price via
                      Edit Listing above.
                    </p>
                  )}
              </div>
            )}
            <TrustSignalChecklist
              signals={skill.signals}
              scan={skill.security_scan}
            />
            {/* Trust Section */}
            <div className="rounded-lg border border-gray-200 bg-white/70 dark:border-gray-800 dark:bg-gray-900/50 p-6 mb-6">
              <h2 className="text-sm font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <FiShield className="w-4 h-4" />
                Author Trust Signals
              </h2>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Author:
                </span>
                {authorHref?.startsWith("http") ? (
                  <a
                    href={authorHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 font-mono text-sm text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline transition"
                    title={authorTitle}
                  >
                    <FiGithub className="w-3.5 h-3.5" />
                    {authorLabel}
                    <FiExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : authorHref ? (
                  <Link
                    href={authorHref}
                    className="flex items-center gap-1.5 font-mono text-sm text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline transition"
                    title={authorTitle}
                  >
                    {authorLabel}
                    <FiExternalLink className="w-3.5 h-3.5" />
                  </Link>
                ) : (
                  <span
                    className="font-mono text-sm text-gray-500 dark:text-gray-400"
                    title={authorTitle}
                  >
                    {authorLabel}
                  </span>
                )}
                {skill.author_pubkey && (
                  <button
                    onClick={() =>
                      copyToClipboard(skill.author_pubkey!, "author")
                    }
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
                    title="Copy address"
                  >
                    {copied === "author" ? (
                      <FiCheck className="w-3.5 h-3.5 text-[var(--sea-accent)]" />
                    ) : (
                      <FiCopy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
                {skill.author_trust?.registeredAt ? (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    Registered {formatDate(skill.author_trust.registeredAt)}
                  </span>
                ) : null}
              </div>
              {skill.contact && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Contact:{" "}
                  <span className="text-gray-900 dark:text-white">
                    {skill.contact}
                  </span>
                </p>
              )}
              {skill.author_trust ? (
                <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-gray-200 bg-gray-200 text-center dark:border-gray-800 dark:bg-gray-800">
                  <div className="bg-white px-2 py-3 dark:bg-gray-900">
                    <div className="font-display text-xl font-bold text-gray-900 dark:text-white">
                      {skill.author_trust.reputationScore ?? 0}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-400">
                      Reputation
                    </div>
                  </div>
                  <div className="bg-white px-2 py-3 dark:bg-gray-900">
                    <div className="font-display text-xl font-bold text-gray-900 dark:text-white">
                      {skill.author_trust.totalVouchesReceived ?? 0}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-400">
                      Vouches
                    </div>
                  </div>
                  <div className="bg-white px-2 py-3 dark:bg-gray-900">
                    <div className="font-display text-xl font-bold text-[var(--lobster-accent)]">
                      {formatUsdcMicros(
                        (skill.author_trust.totalStakeAtRisk ?? 0).toString()
                      ) ?? "0"}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-400">
                      USDC at stake
                    </div>
                  </div>
                </div>
              ) : null}
              {authorHref && !authorHref.startsWith("http") ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link
                    href={authorHref}
                    className="inline-flex items-center gap-1 text-sm font-medium text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                  >
                    View full author trust history{" "}
                    <FiExternalLink className="w-3.5 h-3.5" />
                  </Link>
                  {!isEvmAuthor && (
                    <Link
                      href={`${authorHref}?report=1${
                        skill.on_chain_address
                          ? `&skill=${encodeURIComponent(
                              `skill:${skill.on_chain_address}`
                            )}`
                          : ""
                      }`}
                      className={navButtonSecondaryInlineClass}
                    >
                      Report Author
                    </Link>
                  )}
                </div>
              ) : isEvmAuthor ? (
                <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                  This author is identified by a {evmAuthorChainLabel ?? "Base"}
                  address. Chain-aware reports and vouching are not enabled for
                  EVM authors yet.
                </p>
              ) : (
                <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                  This free listing is attributed to an unverified publisher. It
                  has no on-chain author wallet yet, so vouching, reports, and
                  paid settlement are unavailable until the publisher links one.
                </p>
              )}
            </div>
            {skill.author_identity && (
              <div className="mb-6">
                <AgentIdentityPanel
                  identity={skill.author_identity}
                  title={
                    skill.author_identity.registryAsset
                      ? "Registry Identity"
                      : "Author Identity"
                  }
                />
              </div>
            )}
            {(skill.content_verification ||
              skill.ipfs_cid ||
              skill.skill_uri) && (
              <details className="mb-6">
                <summary className="mb-3 cursor-pointer list-none select-none text-xs font-normal uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  On-chain provenance
                </summary>
                {/* Content Verification */}
                {skill.content_verification && (
                  <div
                    className={`rounded-sm border p-4 mb-6 ${
                      skill.content_verification.status === "verified"
                        ? "border-green-200 dark:border-green-800/50 bg-green-50 dark:bg-green-900/10"
                        : skill.content_verification.status === "drift_detected"
                        ? "border-yellow-200 dark:border-yellow-800/50 bg-yellow-50 dark:bg-yellow-900/10"
                        : "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {skill.content_verification.status === "verified" ? (
                        <>
                          <FiShield className="w-4 h-4 text-green-600 dark:text-green-400" />
                          <span className="text-sm font-medium text-green-700 dark:text-green-400">
                            Content hash verified
                          </span>
                          <span className="text-xs text-green-600 dark:text-green-500 ml-1">
                            — All versions pinned to IPFS, current CID
                            consistent
                          </span>
                        </>
                      ) : skill.content_verification.status ===
                        "drift_detected" ? (
                        <>
                          <FiShield className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                          <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                            Content updated since last pin
                          </span>
                          <span className="text-xs text-yellow-600 dark:text-yellow-500 ml-1">
                            — Current version may differ from previously vouched
                            content
                          </span>
                        </>
                      ) : (
                        <>
                          <FiShield className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            Content not yet pinned to IPFS
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {/* IPFS CID */}
                {skill.ipfs_cid && (
                  <div className="rounded-lg border border-gray-200 bg-white/70 dark:border-gray-800 dark:bg-gray-900/50 p-4 mb-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FiShield className="w-4 h-4 text-green-500" />
                        <span className="text-xs font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Content Hash (IPFS)
                        </span>
                      </div>
                      <a
                        href={`https://ipfs.io/ipfs/${skill.ipfs_cid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                      >
                        Verify on IPFS <FiExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <button
                      onClick={() => copyToClipboard(skill.ipfs_cid!, "cid")}
                      className="mt-2 font-mono text-sm text-gray-600 dark:text-gray-400 hover:text-[var(--sea-accent)] flex items-center gap-1.5 transition"
                    >
                      {skill.ipfs_cid}
                      {copied === "cid" ? (
                        <FiCheck className="w-3.5 h-3.5 text-[var(--sea-accent)]" />
                      ) : (
                        <FiCopy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                )}
                {/* Skill URI */}
                {skill.skill_uri && (
                  <div className="rounded-lg border border-gray-200 bg-white/70 dark:border-gray-800 dark:bg-gray-900/50 p-4 mb-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FiExternalLink className="w-4 h-4 text-[var(--sea-accent)]" />
                        <span className="text-xs font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Skill Source
                        </span>
                      </div>
                    </div>
                    <a
                      href={skill.skill_uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 block text-sm text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline break-all"
                    >
                      {skill.skill_uri}
                    </a>
                  </div>
                )}
              </details>
            )}
          </aside>
        </div>

        {/* ===== AUTHOR / ON-CHAIN LISTING ===== */}
        {/* On-chain listing section */}
        {skill.on_chain_address || hasBaseListing ? (
          <div
            id="author-actions"
            className="mt-6 rounded-sm border border-green-200 dark:border-green-800/50 bg-green-50 dark:bg-green-900/10 p-4 mb-6"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                <FiCheckCircle className="w-4 h-4" />
                {hasBaseListing ? "Base listing linked" : "Listed on-chain"}
                {hasBaseListing ? (
                  skill.evm_tx_hash && (
                    <a
                      href={`${BASE_SEPOLIA_EXPLORER_URL}/tx/${skill.evm_tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                      title={`View Base tx ${skill.evm_tx_hash}`}
                    >
                      View tx
                      <FiExternalLink className="w-3 h-3" />
                    </a>
                  )
                ) : (
                  <a
                    href={getConfiguredSolanaExplorerAddressUrl(
                      skill.on_chain_address as string
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                    title={`View listing PDA ${skill.on_chain_address}`}
                  >
                    View PDA
                    <FiExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              {(isSolanaAuthor || isBaseAuthor) && !editing && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={startEditing}
                    className={`${navButtonSecondaryInlineClass} gap-1.5 font-medium`}
                  >
                    <FiEdit2 className="w-3.5 h-3.5" />
                    Edit Listing
                  </button>
                  {!isChainOnly && (
                    <button
                      onClick={openVersionComposer}
                      className={`${navButtonSecondaryInlineClass} gap-1.5 font-medium`}
                    >
                      <FiGitCommit className="w-3.5 h-3.5" />
                      Publish New Version
                    </button>
                  )}
                  {(isSolanaAuthor || isBaseAuthor) && (
                    <button
                      onClick={handleRemoveListing}
                      disabled={removing}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/60 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                    >
                      <FiTrash2 className="w-3.5 h-3.5" />
                      {removing ? "Removing…" : "Remove"}
                    </button>
                  )}
                  {isBaseAuthor && skill.evm_listing_id && (
                    <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
                      {skill.evm_listing_id?.slice(0, 10)}...
                      {skill.evm_listing_id?.slice(-8)}
                    </span>
                  )}
                </div>
              )}
            </div>
            {updateResult && !editing && (
              <p
                className={`text-xs mt-2 ${
                  updateResult.success
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {updateResult.message}
              </p>
            )}
            {removeResult && (
              <p
                className={`text-xs mt-2 ${
                  removeResult.success
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {removeResult.message}
              </p>
            )}
            {isSolanaAuthor && settlementSummary && (
              <div className="mt-4 rounded-sm border border-green-200 dark:border-green-800/50 bg-white/70 dark:bg-gray-950/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                      Author proceeds escrow
                    </p>
                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                      Withdrawable{" "}
                      <span className="font-normal text-gray-900 dark:text-white">
                        {formatUsdcMicros(
                          settlementSummary.withdrawableUsdcMicros.toString()
                        ) ?? "0"}{" "}
                        USDC
                      </span>
                      {settlementSummary.locked ? (
                        <span className="ml-2 text-amber-600 dark:text-amber-400">
                          Locked by dispute
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Withdrawn{" "}
                      {formatUsdcMicros(
                        settlementSummary.withdrawnUsdcMicros.toString()
                      ) ?? "0"}{" "}
                      USDC · Refunded{" "}
                      {formatUsdcMicros(
                        settlementSummary.refundedUsdcMicros.toString()
                      ) ?? "0"}{" "}
                      USDC
                    </p>
                  </div>
                  <button
                    onClick={handleWithdrawAuthorProceeds}
                    disabled={
                      withdrawingProceeds ||
                      settlementSummary.locked ||
                      settlementSummary.withdrawableUsdcMicros <= 0n
                    }
                    className={`${navButtonSecondaryInlineClass} gap-1.5 font-medium disabled:opacity-50`}
                  >
                    {withdrawingProceeds ? (
                      <>
                        <FiLoader className="w-3.5 h-3.5 animate-spin" />
                        Withdrawing…
                      </>
                    ) : (
                      "Withdraw Proceeds"
                    )}
                  </button>
                </div>
                {withdrawResult && (
                  <p
                    className={`text-xs mt-2 ${
                      withdrawResult.success
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {withdrawResult.message}
                  </p>
                )}
              </div>
            )}
            {editing && (
              <div className="mt-4 pt-4 border-t border-green-200 dark:border-green-800/50 space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={64}
                    className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Description
                  </label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    maxLength={256}
                    rows={2}
                    className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)] resize-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Price (USDC)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={PRICING.USDC.step}
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Skill URI
                    </label>
                    {isChainOnly ? (
                      <input
                        type="text"
                        value={editUri}
                        onChange={(e) => setEditUri(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                      />
                    ) : (
                      <>
                        <input
                          type="text"
                          value={editUri}
                          readOnly
                          className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-sm text-sm text-gray-500 dark:text-gray-400"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Repo-backed listings stay pinned to the canonical raw
                          endpoint.
                        </p>
                      </>
                    )}
                  </div>
                </div>
                {updateResult && (
                  <p
                    className={`text-xs ${
                      updateResult.success
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {updateResult.message}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleUpdateListing}
                    disabled={updating}
                    className={navButtonPrimaryInlineClass}
                  >
                    {updating ? (
                      <>
                        <FiLoader className="w-4 h-4 animate-spin" />
                        Updating…
                      </>
                    ) : (
                      <>Save Changes</>
                    )}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    disabled={updating}
                    className={`${navButtonSizeClass} text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          isAuthor && (
            <div className="mt-6 rounded-lg border border-gray-200 bg-white/70 dark:border-gray-800 dark:bg-gray-900/50 p-5 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <UsdcIcon className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-normal text-gray-900 dark:text-white">
                  {needsBaseListingSync
                    ? "Sync Base Listing"
                    : "List on Marketplace"}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                {needsBaseListingSync
                  ? "Link the existing Base SkillListing to this repo record. If no live listing is found, AgentVouch will create one."
                  : "Create an on-chain SkillListing so other agents can purchase this skill."}
              </p>

              {listResult && (
                <p
                  className={`text-xs mb-3 ${
                    listResult.success
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {listResult.message}
                </p>
              )}

              <div className="flex items-center gap-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Price (USDC)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={PRICING.USDC.step}
                    value={listPrice}
                    onChange={(e) => setListPrice(e.target.value)}
                    className="w-28 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                  />
                </div>
                <button
                  onClick={handleListOnMarketplace}
                  disabled={listing}
                  className={`mt-5 ${navButtonPrimaryInlineClass}`}
                >
                  {listing ? (
                    <>
                      <FiLoader className="w-4 h-4 animate-spin" />
                      {needsBaseListingSync ? "Syncing…" : "Creating listing…"}
                    </>
                  ) : (
                    <>
                      <UsdcIcon className="w-4 h-4" />
                      {needsBaseListingSync ? "Sync Now" : "List Now"}
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                {isBaseAuthor
                  ? "Base listings use native Base Sepolia USDC."
                  : "Set 0 for a free listing."}{" "}
                Otherwise the minimum paid USDC price is {formatMinPrice()}.
              </p>
            </div>
          )
        )}

        {isSolanaAuthor && !isChainOnly && !skill.on_chain_address && (
          <div
            id="author-actions"
            className="rounded-lg border border-gray-200 bg-white/70 dark:border-gray-800 dark:bg-gray-900/50 p-5 mb-6"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-normal text-gray-900 dark:text-white">
                  Author Actions
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Publish a new repo version without changing the on-chain
                  listing metadata.
                </p>
              </div>
              <button
                onClick={openVersionComposer}
                className={`${navButtonSecondaryInlineClass} gap-1.5 font-medium`}
              >
                <FiGitCommit className="w-3.5 h-3.5" />
                Publish New Version
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
