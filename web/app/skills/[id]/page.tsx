"use client";

import { useState, useEffect, use, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AgentIdentityPanel } from "@/components/AgentIdentityPanel";
import TrustBadge, { type TrustData } from "@/components/TrustBadge";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { SolAmount } from "@/components/SolAmount";
import { UsdcIcon } from "@/components/UsdcIcon";
import {
  buildDownloadRawMessage,
  buildSignMessage,
  createSignedDownloadAuthPayload,
} from "@/lib/auth";
import { encodeBase64 } from "@/lib/base64";
import {
  buildPaidSkillDownloadRequiredMessage,
} from "@/lib/skillFlowMessages";
import {
  navButtonPrimaryInlineClass,
  navButtonSecondaryInlineClass,
  navButtonSizeClass,
} from "@/lib/buttonStyles";
import { useWalletConnection } from "@solana/react-hooks";
import { useReputationOracle } from "@/hooks/useReputationOracle";
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
import {
  fetchSkillWithBrowserX402,
  walletSupportsBrowserX402,
} from "@/lib/browserX402";
import {
  getConfiguredSolanaExplorerAddressUrl,
  getConfiguredSolanaExplorerTxUrl,
} from "@/lib/chains";
import {
  FiAlertTriangle,
  FiArrowLeft,
  FiCheckCircle,
  FiDownload,
  FiTag,
  FiClock,
  FiShield,
  FiCopy,
  FiCheck,
  FiLoader,
  FiExternalLink,
  FiFileText,
  FiGitCommit,
  FiEdit2,
  FiTrash2,
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

interface SkillDetail {
  id: string;
  skill_id: string;
  author_pubkey: string;
  name: string;
  description: string | null;
  tags: string[];
  current_version: number;
  ipfs_cid: string | null;
  on_chain_address: string | null;
  total_installs: number;
  total_downloads?: number;
  price_lamports?: number;
  price_usdc_micros?: string | null;
  currency_mint?: string | null;
  payment_flow?: "free" | "legacy-sol" | "x402-usdc" | "direct-purchase-skill";
  contact: string | null;
  created_at: string;
  updated_at: string;
  source?: "repo" | "chain";
  skill_uri?: string;
  versions: SkillVersion[];
  author_trust: TrustData | null;
  author_identity: AgentIdentitySummary | null;
  content_verification: ContentVerification | null;
  legacySolLamports?: number;
  estimatedPurchaseRentLamports?: number;
  feeBufferLamports?: number;
  estimatedBuyerTotalLamports?: number;
  purchasePreflightStatus?: PurchasePreflightStatus;
  purchasePreflightMessage?: string | null;
  purchaseRiskWarning?: string | null;
  priceDisclosure?: string | null;
  buyerHasPurchased?: boolean;
  buyerPurchaseSummary?: {
    purchasePda: string | null;
    listingRevision: string | null;
    settlementPda: string | null;
    refundStatus: string;
    legacyRefundEligible: boolean;
  } | null;
}

function shortAddr(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
  if (typeof window === "undefined") {
    return "";
  }
  return `${window.location.origin}/api/skills/${skillId}/raw`;
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

async function fetchSignedRawSkill({
  id,
  walletAddress,
  signMessage,
  skill,
}: {
  id: string;
  walletAddress: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  skill: SkillDetail;
}): Promise<string> {
  const authHeader = JSON.stringify(
    await createSignedDownloadAuthPayload({
      walletAddress,
      signMessage,
      skillId: skill.id,
      listingAddress: skill.on_chain_address ?? undefined,
    })
  );
  const rawRes = await fetch(`/api/skills/${id}/raw`, {
    headers: {
      "X-AgentVouch-Auth": authHeader,
    },
  });
  if (!rawRes.ok) {
    const rawBody = (await rawRes.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(
      rawBody?.error ||
        rawBody?.message ||
        "Purchase verified, but download failed"
    );
  }

  return rawRes.text();
}

export default function SkillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const { wallet, status } = useWalletConnection();
  const connected = status === "connected" && !!wallet;
  const walletAddress = wallet?.account.address ?? null;
  const signMessage = wallet?.signMessage ?? null;
  const oracle = useReputationOracle();

  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [usdcPurchaseTx, setUsdcPurchaseTx] = useState<string | null>(null);
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
  const capabilitySummary = extractCapabilitySummary(
    content,
    skill?.description ?? null
  );
  const capabilityBullets = extractCapabilityBullets(content);
  const requestedAuthorAction = searchParams.get("authorAction");

  const refreshSkill = useCallback(async () => {
    try {
      const params = new URLSearchParams({ include: "trust" });
      if (walletAddress) params.set("buyer", String(walletAddress));
      const detailRes = await fetch(`/api/skills/${id}?${params}`);
      if (!detailRes.ok) throw new Error("Skill not found");
      const data = await detailRes.json();
      setSkill(data);
      if (data.content) {
        setContent(data.content);
      }
    } catch (err) {
      console.error("Error fetching skill:", err);
    } finally {
      setLoading(false);
    }
  }, [id, walletAddress]);

  useEffect(() => {
    void refreshSkill();
  }, [refreshSkill]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const downloadSkillFile = useCallback((filename: string, text: string) => {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${filename || "SKILL"}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(href);
  }, []);

  const handleListOnMarketplace = async () => {
    if (!connected || !walletAddress || !signMessage || !skill) return;
    setListing(true);
    setListResult(null);
    try {
      const priceUsdcMicros = toUsdcMicros(parseFloat(listPrice || "0"));
      if (!isValidListingPriceLamports(priceUsdcMicros)) {
        setListResult({
          success: false,
          message: `Price must be 0 for a free listing or at least ${formatMinPrice()}.`,
        });
        setListing(false);
        return;
      }
      const skillUri = `${window.location.origin}/api/skills/${id}/raw`;
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
      const message = `AgentVouch Skill Repo\nAction: publish-skill\nTimestamp: ${timestamp}`;
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
    if (!connected || !walletAddress || !skill?.skill_id) return;
    if (
      !window.confirm(
        "Remove this skill from the marketplace? Existing purchases are unaffected but no new purchases will be possible."
      )
    )
      return;
    setRemoving(true);
    setRemoveResult(null);
    try {
      await oracle.removeSkillListing(skill.skill_id);
      await refreshSkill();
      setSkill((s) => (s ? { ...s, on_chain_address: null } : s));
      setRemoveResult({ success: true, message: "Listing removed." });
    } catch (error: unknown) {
      setRemoveResult({
        success: false,
        message: getErrorMessage(error, "Failed to remove listing"),
      });
    } finally {
      setRemoving(false);
    }
  };

  const handleFreeInstall = async () => {
    if (!connected || !walletAddress || !signMessage || !skill) return;
    setInstalling(true);
    setInstallResult(null);
    try {
      const timestamp = Date.now();
      const message = `AgentVouch Skill Repo\nAction: install-skill\nTimestamp: ${timestamp}`;
      const msgBytes = new TextEncoder().encode(message);
      const sigBytes = await signMessage(msgBytes);
      const signature = encodeBase64(sigBytes);

      const res = await fetch(`/api/skills/${id}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: { pubkey: walletAddress, signature, message, timestamp },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInstallResult({
          success: false,
          message: data.error || "Install failed",
        });
        return;
      }
      setInstallResult({
        success: true,
        message: "Skill installed successfully!",
      });
      setSkill((s) => (s ? { ...s, total_installs: data.total_installs } : s));
    } catch (error: unknown) {
      setInstallResult({
        success: false,
        message: getErrorMessage(error, "Install failed"),
      });
    } finally {
      setInstalling(false);
    }
  };

  const handleUsdcPurchase = async () => {
    if (!connected || !wallet || !walletAddress || !signMessage || !skill) {
      return;
    }

    setPurchasingUsdc(true);
    setInstallResult(null);
    setDownloadResult(null);
    setUsdcPurchaseTx(null);

    try {
      if (skill.on_chain_address) {
        const purchaseResult = await oracle.purchaseSkill(
          address(skill.on_chain_address),
          address(skill.author_pubkey)
        );

        if (purchaseResult.tx) {
          const verifyRes = await fetch(`/api/skills/${id}/purchase/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signature: purchaseResult.tx,
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
          setUsdcPurchaseTx(purchaseResult.tx);
        }

        const markdown = await fetchSignedRawSkill({
          id,
          walletAddress,
          signMessage,
          skill,
        });

        downloadSkillFile(skill.skill_id, markdown);
        await refreshSkill();
        setSkill((current) =>
          current ? { ...current, buyerHasPurchased: true } : current
        );
        setInstallResult({
          success: true,
          message: purchaseResult.tx
            ? "USDC purchase confirmed and verified. Downloaded SKILL.md."
            : "USDC entitlement already active. Downloaded SKILL.md.",
        });
        return;
      }

      const purchaseResult = await fetchSkillWithBrowserX402({
        wallet,
        walletAddress,
        signMessage,
        skillId: skill.id,
        listingAddress: skill.on_chain_address ?? undefined,
        rawPath: `/api/skills/${id}/raw`,
      });

      downloadSkillFile(skill.skill_id, purchaseResult.content);
      await refreshSkill();
      setSkill((current) =>
        current ? { ...current, buyerHasPurchased: true } : current
      );
      setInstallResult({
        success: true,
        message: purchaseResult.paymentResponse
          ? "USDC payment complete. Downloaded SKILL.md."
          : "USDC entitlement already active. Downloaded SKILL.md.",
      });
      setUsdcPurchaseTx(purchaseResult.paymentResponse?.transaction ?? null);
    } catch (error: unknown) {
      setInstallResult({
        success: false,
        message: getErrorMessage(error, "USDC purchase failed"),
      });
      setUsdcPurchaseTx(null);
    } finally {
      setPurchasingUsdc(false);
    }
  };

  const handleSignedDownload = async () => {
    if (!connected || !walletAddress || !signMessage || !skill) {
      return;
    }

    const priceUsdcMicros = BigInt(skill.price_usdc_micros ?? 0);
    if (priceUsdcMicros > 0n && !skill.buyerHasPurchased) {
      setDownloadResult({
        success: false,
        message: buildPaidSkillDownloadRequiredMessage(),
      });
      return;
    }

    setDownloading(true);
    setDownloadResult(null);
    try {
      const markdown = await fetchSignedRawSkill({
        id,
        walletAddress,
        signMessage,
        skill,
      });
      downloadSkillFile(skill.skill_id, markdown);

      setDownloadResult({
        success: true,
        message: "Signed download complete.",
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
    if (!connected || !walletAddress || !skill) return;
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
    if (!connected || !walletAddress || !signMessage) {
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
      const message = buildSignMessage("publish-skill", timestamp);
      const signatureBytes = await signMessage(
        new TextEncoder().encode(message)
      );
      const signature = encodeBase64(signatureBytes);
      const response = await fetch(`/api/skills/${skill.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth: { pubkey: walletAddress, signature, message, timestamp },
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

  useEffect(() => {
    if (!skill || !walletAddress || walletAddress !== skill.author_pubkey) {
      handledAuthorActionRef.current = null;
      return;
    }
    if (
      !requestedAuthorAction ||
      requestedAuthorAction === handledAuthorActionRef.current
    ) {
      return;
    }

    if (requestedAuthorAction === "edit-listing" && skill.on_chain_address) {
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
    walletAddress,
  ]);

  const isChainOnly = skill?.source === "chain";
  const isAuthor =
    !!skill && !!walletAddress && walletAddress === skill.author_pubkey;
  const CANONICAL_ORIGIN =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://agentvouch.xyz";
  const paidSkillDocsHref = "/docs#paid-skill-download";

  const refreshSettlementSummary = useCallback(async () => {
    if (!skill?.on_chain_address || !isAuthor) {
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
  }, [isAuthor, oracle, skill?.on_chain_address]);

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
  const paymentFlow =
    skill.payment_flow ??
    (skill.price_usdc_micros
      ? skill.on_chain_address
        ? "direct-purchase-skill"
        : "x402-usdc"
      : "free");
  const hasUsdcPrimary =
    Boolean(primaryUsdcPrice) ||
    paymentFlow === "x402-usdc" ||
    paymentFlow === "direct-purchase-skill";
  const hasLegacySolPrice = legacySolLamports > 0;
  const purchasePreflightStatus =
    skill.purchasePreflightStatus ??
    (hasUsdcPrimary ? "estimateUnavailable" : "ok");
  const purchaseBlocked =
    hasUsdcPrimary && isBlockingPurchaseStatus(purchasePreflightStatus);
  const isPaidSkill = hasUsdcPrimary;
  const browserCanUseUsdc =
    hasUsdcPrimary &&
    (paymentFlow === "direct-purchase-skill" ||
      walletSupportsBrowserX402(wallet));
  const signedRedownloadAvailable =
    hasUsdcPrimary || Boolean(skill.on_chain_address);
  const buyerHasPurchased = Boolean(skill.buyerHasPurchased);
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
    ? paymentFlow === "direct-purchase-skill"
      ? `# Primary price: ${usdcPriceLabel} via purchase_skill\n# Call purchase_skill on-chain, POST the confirmed signature to /api/skills/${skill.id}/purchase/verify, then retry with X-AgentVouch-Auth.\ncurl -sL ${installUrl}`
      : `# Primary price: ${usdcPriceLabel} via x402\n# Browser checkout is available on this page for wallets with partial transaction signing.\n# Agents can call the raw endpoint directly and respond to PAYMENT-REQUIRED / PAYMENT-SIGNATURE.\ncurl -sL ${installUrl}`
    : `curl -sL ${installUrl} -o SKILL.md`;
  const purchaseTitle = primaryUsdcPrice
    ? "USDC primary pricing"
    : isPaidSkill
    ? "Paid Skill"
    : "Free Skill";
  const purchaseDescription = !isPaidSkill
    ? "Install with a wallet signature — no transaction fee."
    : isAuthor
    ? primaryUsdcPrice
      ? `This listing is priced at ${usdcPriceLabel}.`
      : "This connected wallet is the author for this skill. Use the author actions below to manage the listing instead of purchasing it."
    : buyerHasPurchased
    ? signedRedownloadAvailable
      ? "This skill is already purchased for your connected wallet. Sign to download the file."
      : "This skill is already purchased for your connected wallet. The file is delivered at checkout."
    : primaryUsdcPrice
    ? browserCanUseUsdc
      ? `Pay ${usdcPriceLabel} from this page. After checkout, SKILL.md downloads immediately and future re-downloads use Sign & Download.`
      : `This listing is priced in ${usdcPriceLabel}. This wallet cannot use browser x402; use direct purchase or the agent/API fallback below.`
    : hasLegacySolPrice
    ? "This historical SOL-priced listing is not available for new USDC checkout."
    : "Install with a wallet signature.";
  const connectWalletLabel = primaryUsdcPrice
    ? "Connect wallet to pay with USDC"
    : isPaidSkill
    ? "Connect wallet to buy and unlock"
    : "Connect wallet to install";

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">
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
            <h1 className="text-3xl font-heading font-bold text-gray-900 dark:text-white">
              {skill.name}
            </h1>
            {skill.description && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {skill.description}
              </p>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
              Before you install or pay, inspect the author&apos;s trust record.
              See{" "}
              <Link
                href="/docs/verify-ai-agents"
                className="text-[var(--lobster-accent)] hover:underline"
              >
                how to verify an AI agent
              </Link>{" "}
              and{" "}
              <Link
                href="/docs/skill-md-security"
                className="text-[var(--lobster-accent)] hover:underline"
              >
                why `skill.md` needs trust context
              </Link>
              .
            </p>
          </div>
        </div>

        {/* Trust Section */}
        <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <FiShield className="w-4 h-4" />
            Author Trust Signals
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Reputation, USDC backing, and author-wide dispute history help show
            how much accountability sits behind this author.
          </p>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Author:
            </span>
            <Link
              href={`/author/${skill.author_pubkey}`}
              className="flex items-center gap-1.5 font-mono text-sm text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline transition"
            >
              {shortAddr(skill.author_pubkey)}
              <FiExternalLink className="w-3.5 h-3.5" />
            </Link>
            <button
              onClick={() => copyToClipboard(skill.author_pubkey, "author")}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
              title="Copy address"
            >
              {copied === "author" ? (
                <FiCheck className="w-3.5 h-3.5 text-[var(--sea-accent)]" />
              ) : (
                <FiCopy className="w-3.5 h-3.5" />
              )}
            </button>
            {skill.author_trust?.registeredAt ? (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Registered{" "}
                {formatDate(
                  new Date(skill.author_trust.registeredAt * 1000).toISOString()
                )}
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
          <TrustBadge trust={skill.author_trust} />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={`/author/${skill.author_pubkey}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
            >
              View full author trust history{" "}
              <FiExternalLink className="w-3.5 h-3.5" />
            </Link>
            <Link
              href={`/author/${skill.author_pubkey}?report=1${
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
          </div>
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

        {/* Meta Row */}
        <div
          className={`grid grid-cols-2 ${
            hasLegacySolPrice || primaryUsdcPrice
              ? "sm:grid-cols-5"
              : "sm:grid-cols-4"
          } gap-3 mb-6`}
        >
          {primaryUsdcPrice && (
            <div className="rounded-sm border border-[var(--lobster-accent-border)] bg-[var(--lobster-accent-soft)] p-3 text-center">
              <div className="text-lg font-bold text-[var(--lobster-accent)] font-mono flex items-center justify-center gap-2">
                <UsdcIcon className="w-4 h-4" />
                {primaryUsdcPrice}
              </div>
              <div className="text-xs text-[var(--lobster-accent)]">
                Primary price (USDC)
              </div>
            </div>
          )}
          {hasLegacySolPrice && (
            <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-center">
              <div className="text-lg font-bold text-gray-700 dark:text-gray-300 font-mono flex items-center justify-center">
                Legacy
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Legacy SOL price
              </div>
            </div>
          )}
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-center">
            <div className="text-lg font-bold text-gray-900 dark:text-white">
              v{skill.current_version}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Version
            </div>
          </div>
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-center">
            <div className="text-lg font-bold text-gray-900 dark:text-white flex items-center justify-center gap-1">
              <FiDownload className="w-4 h-4" />
              {(skill.total_installs ?? 0) + (skill.total_downloads ?? 0)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Downloads
            </div>
          </div>
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-center">
            <div className="text-sm font-bold text-gray-900 dark:text-white">
              {formatDate(skill.created_at)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Published
            </div>
          </div>
        </div>

        {/* Tags */}
        {skill.tags?.length > 0 && (
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <FiTag className="w-4 h-4 text-gray-400" />
            {skill.tags.map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {(capabilitySummary ||
          capabilityBullets.length > 0 ||
          skill.tags?.length > 0) && (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <FiFileText className="w-4 h-4 text-[var(--sea-accent)]" />
              Capability Preview
            </h2>
            {capabilitySummary && (
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                {capabilitySummary}
              </p>
            )}
            {skill.tags?.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {skill.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)] text-xs font-medium border border-[var(--sea-accent-border)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {capabilityBullets.length > 0 && (
              <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                {capabilityBullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--sea-accent)] shrink-0" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Install / Buy action */}
        {(!hasLegacySolPrice || hasUsdcPrimary) && (
          <div className="rounded-sm border border-[var(--sea-accent-border)] bg-[var(--sea-accent-soft)] p-4 mb-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white mb-0.5">
                  {purchaseTitle}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {purchaseDescription}
                </p>
              </div>
              {connected ? (
                <div className="flex items-center gap-2">
                  {!isPaidSkill ? (
                    <button
                      onClick={handleFreeInstall}
                      disabled={installing}
                      className={navButtonPrimaryInlineClass}
                    >
                      {installing ? (
                        <>
                          <FiLoader className="w-4 h-4 animate-spin" />
                          Installing…
                        </>
                      ) : (
                        <>
                          <FiDownload className="w-4 h-4" />
                          Install
                        </>
                      )}
                    </button>
                  ) : isAuthor ? (
                    <Link
                      href="#author-actions"
                      className={navButtonSecondaryInlineClass}
                    >
                      Manage Listing
                    </Link>
                  ) : buyerHasPurchased ? (
                    signedRedownloadAvailable ? (
                      <button
                        onClick={handleSignedDownload}
                        disabled={downloading}
                        className={navButtonPrimaryInlineClass}
                      >
                        {downloading ? (
                          <>
                            <FiLoader className="w-4 h-4 animate-spin" />
                            Signing…
                          </>
                        ) : (
                          <>
                            <FiDownload className="w-4 h-4" />
                            Sign & Download
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        Purchased. Signed re-downloads require an on-chain link.
                      </span>
                    )
                  ) : primaryUsdcPrice && browserCanUseUsdc ? (
                    <button
                      onClick={handleUsdcPurchase}
                      disabled={purchasingUsdc || purchaseBlocked}
                      className={navButtonPrimaryInlineClass}
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
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      USDC checkout is required for new purchases.
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {connectWalletLabel}
                </span>
              )}
            </div>
            {(primaryUsdcPrice || estimatedPurchaseRentLamports > 0) && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {primaryUsdcPrice && (
                  <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-950/40 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Primary price
                    </div>
                    <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white font-mono inline-flex items-center gap-2">
                      <UsdcIcon className="w-3.5 h-3.5 text-[var(--lobster-accent)]" />
                      {primaryUsdcPrice} USDC
                    </div>
                  </div>
                )}
                {estimatedPurchaseRentLamports > 0 && (
                  <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-950/40 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Receipt rent
                    </div>
                    <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white font-mono">
                      <SolAmount
                        amount={fromLamports(
                          estimatedPurchaseRentLamports
                        ).toFixed(4)}
                        iconClassName="w-3.5 h-3.5"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            {buyerHasPurchased && skill.buyerPurchaseSummary && !isAuthor && (
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
                    Purchase {shortAddr(skill.buyerPurchaseSummary.purchasePda)}
                    {skill.buyerPurchaseSummary.listingRevision
                      ? ` · revision ${skill.buyerPurchaseSummary.listingRevision}`
                      : ""}
                  </p>
                )}
              </div>
            )}
            {skill.priceDisclosure && hasLegacySolPrice && !hasUsdcPrimary && (
              <p className="text-xs mt-3 text-gray-500 dark:text-gray-400">
                {skill.priceDisclosure}
              </p>
            )}
            {primaryUsdcPrice && (
              <p className="text-xs mt-2 text-gray-500 dark:text-gray-400">
                USDC is the default app-layer price. The button above settles
                the x402 flow directly and signed re-downloads stay
                wallet-bound.
              </p>
            )}
            {skill.purchaseRiskWarning &&
              hasUsdcPrimary &&
              !buyerHasPurchased &&
              !isAuthor && (
                <div className="mt-3 rounded-sm border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  <div className="mb-1 flex items-center gap-2 font-semibold">
                    <FiAlertTriangle className="h-3.5 w-3.5" />
                    No Slashable Backing
                  </div>
                  <p>{skill.purchaseRiskWarning}</p>
                </div>
              )}
            {skill.purchasePreflightMessage && hasUsdcPrimary && (
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
                  href={getConfiguredSolanaExplorerTxUrl(usdcPurchaseTx)}
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
            {connected &&
              walletAddress === skill.author_pubkey &&
              !hasUsdcPrimary &&
              skill.on_chain_address && (
                <p className="text-xs mt-2 text-amber-600 dark:text-amber-400">
                  This skill is listed for free. You can set a price via Edit
                  Listing above.
                </p>
              )}
          </div>
        )}

        {/* Install Command */}
        <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
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
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {isPaidSkill ? (
              primaryUsdcPrice ? (
                browserCanUseUsdc ? (
                  <>
                    This listing is USDC-primary. The button above handles the
                    browser checkout flow, while the command below documents the
                    agent/API path against the same raw endpoint.
                  </>
                ) : (
                  <>
                    This listing is USDC-primary. Use the agent/API x402 flow
                    below if you are not checking out through the browser UI.
                  </>
                )
              ) : (
                <>
                  Paid skills require an on-chain purchase first, then a signed{" "}
                  <code className="text-amber-600 dark:text-amber-400">
                    X-AgentVouch-Auth
                  </code>{" "}
                  header on the raw download request. Full instructions are
                  below and in{" "}
                  <Link
                    href={paidSkillDocsHref}
                    className="text-[var(--sea-accent)] hover:underline"
                  >
                    docs
                  </Link>
                  .
                </>
              )
            ) : (
              <>
                Free skills can be downloaded directly with the command below.
              </>
            )}
          </p>
          <pre className="text-sm bg-gray-50 dark:bg-gray-800 rounded-sm p-3 overflow-x-auto border border-gray-100 dark:border-gray-700">
            <code>{installCommand}</code>
          </pre>
        </div>

        {/* Agent API Access */}
        <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Agent API (x402)
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {isPaidSkill ? (
              primaryUsdcPrice ? (
                <>
                  This listing is USDC-primary. Agents should use the x402 raw
                  endpoint directly; browser checkout uses the same USDC
                  entitlement path.
                </>
              ) : (
                <>
                  This is a paid skill. Requests return{" "}
                  <code className="text-amber-600 dark:text-amber-400">
                    402
                  </code>{" "}
                  until you purchase on-chain and provide a signed{" "}
                  <code className="text-amber-600 dark:text-amber-400">
                    X-AgentVouch-Auth
                  </code>{" "}
                  header. See{" "}
                  <Link
                    href={paidSkillDocsHref}
                    className="text-[var(--sea-accent)] hover:underline"
                  >
                    docs
                  </Link>
                  .
                </>
              )
            ) : (
              <>
                This is a free skill. Agents receive content directly — no
                payment required.
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <pre className="flex-1 text-sm bg-gray-50 dark:bg-gray-800 rounded-sm p-3 overflow-x-auto border border-gray-100 dark:border-gray-700">
              <code>{`GET /api/skills/${skill.id}/raw`}</code>
            </pre>
            <button
              onClick={() =>
                copyToClipboard(
                  `${
                    typeof window !== "undefined" ? window.location.origin : ""
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
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Signed Message
                  </span>
                  <button
                    onClick={() =>
                      copyToClipboard(signedDownloadMessage, "api-message")
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
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
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

        {/* IPFS CID */}
        {skill.ipfs_cid && (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FiShield className="w-4 h-4 text-green-500" />
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
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
                    — All versions pinned to IPFS, current CID consistent
                  </span>
                </>
              ) : skill.content_verification.status === "drift_detected" ? (
                <>
                  <FiShield className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                  <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                    Content updated since last pin
                  </span>
                  <span className="text-xs text-yellow-600 dark:text-yellow-500 ml-1">
                    — Current version may differ from previously vouched content
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

        {/* On-chain listing section */}
        {skill.on_chain_address ? (
          <div
            id="author-actions"
            className="rounded-sm border border-green-200 dark:border-green-800/50 bg-green-50 dark:bg-green-900/10 p-4 mb-6"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                <FiCheckCircle className="w-4 h-4" />
                Listed on-chain
                <a
                  href={getConfiguredSolanaExplorerAddressUrl(
                    skill.on_chain_address
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                  title={`View listing PDA ${skill.on_chain_address}`}
                >
                  View PDA
                  <FiExternalLink className="w-3 h-3" />
                </a>
              </div>
              {isAuthor && !editing && (
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
                  <button
                    onClick={handleRemoveListing}
                    disabled={removing}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/60 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  >
                    <FiTrash2 className="w-3.5 h-3.5" />
                    {removing ? "Removing…" : "Remove"}
                  </button>
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
            {isAuthor && settlementSummary && (
              <div className="mt-4 rounded-sm border border-green-200 dark:border-green-800/50 bg-white/70 dark:bg-gray-950/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                      Author proceeds escrow
                    </p>
                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                      Withdrawable{" "}
                      <span className="font-semibold text-gray-900 dark:text-white">
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
          connected &&
          walletAddress === skill.author_pubkey && (
            <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <UsdcIcon className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  List on Marketplace
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Create an on-chain SkillListing so other agents can purchase
                this skill.
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
                      Creating listing…
                    </>
                  ) : (
                    <>
                      <UsdcIcon className="w-4 h-4" />
                      List Now
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Set 0 for a free listing. Otherwise the minimum paid USDC price
                is {formatMinPrice()}.
              </p>
            </div>
          )
        )}

        {isAuthor && !isChainOnly && !skill.on_chain_address && (
          <div
            id="author-actions"
            className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 mb-6"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">
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

        {/* Skill URI */}
        {skill.skill_uri && (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FiExternalLink className="w-4 h-4 text-[var(--sea-accent)]" />
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
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

        {/* SKILL.md Content */}
        {content ? (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
            <div className="flex items-center gap-2 mb-4 pb-4 border-b border-gray-100 dark:border-gray-800">
              <FiFileText className="w-4 h-4 text-gray-400" />
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                SKILL.md Content
              </span>
            </div>
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          isChainOnly &&
          skill.skill_uri && (
            <div className="rounded-sm border border-yellow-200 dark:border-yellow-800/50 bg-yellow-50 dark:bg-yellow-900/10 p-4 mb-6">
              <p className="text-sm text-yellow-700 dark:text-yellow-400">
                Content could not be loaded from the source URL. The file may
                have been moved or is temporarily unavailable.
              </p>
            </div>
          )
        )}

        {/* Version History */}
        {(skill.versions?.length > 0 || (isAuthor && !isChainOnly)) && (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <div className="flex items-center justify-between gap-4 mb-4 pb-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <FiGitCommit className="w-4 h-4 text-gray-400" />
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
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
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Publish New Version
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      This publishes updated repo-backed skill content and
                      changelog only. Listing edits stay on the on-chain path.
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
                  Publish the first repo-backed version update for this skill.
                </p>
              )
            )}
          </div>
        )}
      </div>
    </main>
  );
}
