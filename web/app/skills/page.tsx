"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { address, type Address } from "@solana/kit";
import Link from "next/link";
import { useAgentVouchWallet } from "@/components/WalletContextProvider";
import { useMarketplaceOracle } from "@/hooks/useMarketplaceOracle";
import { getConfiguredSolanaExplorerTxUrl } from "@/lib/chains";
import { UsdcIcon } from "@/components/UsdcIcon";
import {
  navButtonFlexClass,
  navButtonInlineClass,
  navButtonPrimaryFlexClass,
  navButtonPrimaryInlineClass,
} from "@/lib/buttonStyles";
import { formatUsdcMicros } from "@/lib/pricing";
import SkillPreviewCard from "@/components/SkillPreviewCard";
import type { TrustData } from "@/components/TrustBadge";
import type { Purchase } from "../../generated/agentvouch/src/generated/accounts/purchase";
import type { SkillListing } from "../../generated/agentvouch/src/generated/accounts/skillListing";
import {
  FiActivity,
  FiAlertTriangle,
  FiBookOpen,
  FiBox,
  FiCheckCircle,
  FiClock,
  FiDownload,
  FiEdit2,
  FiGitCommit,
  FiLoader,
  FiPackage,
  FiPlus,
  FiSearch,
  FiShield,
  FiShoppingCart,
  FiTrendingUp,
  FiXCircle,
} from "react-icons/fi";
import { isRpcRateLimitError } from "@/lib/rpcErrors";
import type { PurchasePreflightStatus } from "@/lib/purchasePreflight";
import { getErrorMessage } from "@/lib/errors";

type PageTab = "browse" | "my-purchases" | "my-listings";

interface SkillRow {
  id: string;
  skill_id: string;
  author_pubkey: string;
  name: string;
  description: string | null;
  tags: string[];
  current_version: number;
  ipfs_cid: string | null;
  total_installs: number;
  total_downloads?: number;
  total_revenue?: number;
  price_lamports?: number;
  price_usdc_micros?: string | null;
  currency_mint?: string | null;
  payment_flow?:
    | "free"
    | "legacy-sol"
    | "listing-required"
    | "x402-usdc"
    | "direct-purchase-skill";
  on_chain_address?: string;
  skill_uri?: string | null;
  source?: "repo" | "chain";
  created_at: string;
  author_trust: TrustData | null;
  estimatedPurchaseRentLamports?: number;
  feeBufferLamports?: number;
  estimatedBuyerTotalLamports?: number;
  purchasePreflightStatus?: PurchasePreflightStatus;
  purchasePreflightMessage?: string | null;
  purchaseRiskWarning?: string | null;
  priceDisclosure?: string | null;
  buyerHasPurchased?: boolean;
}

interface ApiResponse {
  skills: SkillRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

type SkillListingData = { publicKey: Address; account: SkillListing };
type PurchaseData = { publicKey: Address; account: Purchase };
type ActivityRepoListing = {
  id: string;
  name: string;
  author_pubkey: string;
  on_chain_address: string | null;
  price_usdc_micros: string | null;
  currency_mint: string | null;
  payment_flow:
    | "free"
    | "legacy-sol"
    | "listing-required"
    | "x402-usdc"
    | "direct-purchase-skill";
  created_at: string;
};
type ActivityUsdcPurchase = {
  payment_tx_signature: string;
  buyer_pubkey: string;
  currency_mint: string;
  amount_micros: string;
  verified_at: string;
  skill_db_id: string;
  skill_name: string;
  author_pubkey: string;
  on_chain_address: string | null;
  price_usdc_micros: string | null;
  price_lamports: number | null;
};
type ActivityResponse = {
  repoListings: ActivityRepoListing[];
  usdcPurchases: ActivityUsdcPurchase[];
};
type FeedItem = {
  id: string;
  type: "purchase" | "listing";
  actor: string;
  skillListing: string | null;
  skillName: string;
  skillRepoId: string | null;
  author: string | null;
  timestamp: number;
  legacySolLamports: number | null;
  priceUsdcMicros: string | null;
};

type SortOption = "newest" | "installs" | "trusted" | "name";

function formatUsdc(
  micros: number | bigint | string | null | undefined
): string {
  return formatUsdcMicros(micros) ?? "0";
}

function shortAddr(addr: string): string {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString();
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

function getCapabilityFallback(tags: string[]): string | null {
  if (!tags.length) return null;
  return `Capabilities: ${tags.slice(0, 3).join(", ")}`;
}

function getAuthorActionHref(
  detailId: string,
  action: "edit-listing" | "publish-version"
): string {
  return `/skills/${detailId}?authorAction=${action}#author-actions`;
}

export default function MarketplacePage() {
  const { status, account } = useAgentVouchWallet();
  const connected = status === "connected" && !!account;
  const publicKey = account ?? null;
  const oracle = useMarketplaceOracle();

  const [activeTab, setActiveTab] = useState<PageTab>("browse");

  // Browse state
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("trusted");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Marketplace state
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [purchasedKeys, setPurchasedKeys] = useState<Set<string>>(new Set());
  const [txSuccess, setTxSuccess] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [purchaseStatusWarning, setPurchaseStatusWarning] = useState<
    string | null
  >(null);

  // My data
  const [myPurchases, setMyPurchases] = useState<PurchaseData[]>([]);
  const [myPurchaseListings, setMyPurchaseListings] = useState<
    SkillListingData[]
  >([]);
  const [myListings, setMyListings] = useState<SkillListingData[]>([]);
  const [myListingDetails, setMyListingDetails] = useState<
    Map<string, SkillRow>
  >(new Map());
  const purchaseStateWalletRef = useRef<string | null>(null);

  // Feed state
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const purchasedSkillListingKeys = useMemo(
    () =>
      new Set([
        ...purchasedKeys,
        ...myPurchases.map((purchase) => String(purchase.account.skillListing)),
      ]),
    [myPurchases, purchasedKeys]
  );

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      params.set("sort", sort);
      params.set("page", String(page));

      const res = await fetch(`/api/skills?${params}`);
      if (!res.ok) throw new Error("Failed to fetch skills");
      const data: ApiResponse = await res.json();

      setSkills(data.skills);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch (err) {
      console.error("Error fetching skills:", err);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, sort]);

  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    try {
      const activityRes = await fetch("/api/skills/activity");
      if (!activityRes.ok) {
        throw new Error("Failed to fetch marketplace activity");
      }
      const activity = (await activityRes.json()) as ActivityResponse;
      const listingItems: FeedItem[] = activity.repoListings.map((listing) => ({
        id: listing.on_chain_address ?? listing.id,
        type: "listing",
        actor: listing.author_pubkey,
        skillListing: listing.on_chain_address,
        skillName: listing.name,
        skillRepoId: listing.id,
        author: listing.author_pubkey,
        timestamp: Math.floor(new Date(listing.created_at).getTime() / 1000),
        legacySolLamports: null,
        priceUsdcMicros: listing.price_usdc_micros,
      }));
      const usdcPurchaseItems: FeedItem[] = activity.usdcPurchases.map(
        (purchase) => ({
          id: `usdc-${purchase.payment_tx_signature}`,
          type: "purchase",
          actor: purchase.buyer_pubkey,
          skillListing: purchase.on_chain_address,
          skillName: purchase.skill_name,
          skillRepoId: purchase.skill_db_id,
          author: purchase.author_pubkey,
          timestamp: Math.floor(
            new Date(purchase.verified_at).getTime() / 1000
          ),
          legacySolLamports: null,
          priceUsdcMicros: purchase.amount_micros,
        })
      );
      const items: FeedItem[] = [...listingItems, ...usdcPurchaseItems]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 20);
      setFeedItems(items);
    } catch (e) {
      console.error("Failed to load feed:", e);
    } finally {
      setFeedLoading(false);
    }
  }, []);

  const loadMyData = useCallback(async () => {
    if (!publicKey) {
      setMyPurchases([]);
      setMyPurchaseListings([]);
      setMyListings([]);
      setMyListingDetails(new Map());
      setPurchasedKeys(new Set());
      setPurchaseStatusWarning(null);
      purchaseStateWalletRef.current = null;
      return;
    }
    try {
      const [purchases, authorListings, authoredSkillsResponse] =
        await Promise.all([
          oracle.getPurchasesByBuyer(publicKey),
          oracle.getSkillListingsByAuthor(publicKey),
          fetch(
            `/api/skills?author=${encodeURIComponent(
              String(publicKey)
            )}&sort=newest`
          ),
        ]);
      const purchasedListingAddresses = [
        ...new Set(
          purchases.map((purchase) => String(purchase.account.skillListing))
        ),
      ].map((skillListing) => address(skillListing));
      const purchaseListings =
        purchasedListingAddresses.length > 0
          ? await oracle.getSkillListingsByAddresses(purchasedListingAddresses)
          : [];
      const authoredSkillsData: ApiResponse | null = authoredSkillsResponse.ok
        ? await authoredSkillsResponse.json()
        : null;
      setMyPurchases(purchases);
      setMyPurchaseListings(purchaseListings);
      setMyListings(authorListings);
      setMyListingDetails(
        new Map(
          (authoredSkillsData?.skills ?? [])
            .filter((skill) => !!skill.on_chain_address)
            .map((skill) => [String(skill.on_chain_address), skill])
        )
      );
      setPurchasedKeys(
        new Set(purchases.map((p) => String(p.account.skillListing)))
      );
      setPurchaseStatusWarning(null);
      purchaseStateWalletRef.current = String(publicKey);
    } catch (e) {
      console.error("Failed to load user data:", e);
      if (purchaseStateWalletRef.current !== String(publicKey)) {
        setMyPurchases([]);
        setMyPurchaseListings([]);
        setMyListings([]);
        setMyListingDetails(new Map());
        setPurchasedKeys(new Set());
      }
      setPurchaseStatusWarning(
        isRpcRateLimitError(e)
          ? "Purchase status is temporarily unavailable because the RPC is rate-limiting requests."
          : "Purchase status could not be refreshed right now."
      );
    }
  }, [oracle, publicKey]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);
  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);
  useEffect(() => {
    if (!publicKey) {
      void loadMyData();
      return;
    }
    if (activeTab === "my-purchases" || activeTab === "my-listings") {
      void loadMyData();
    }
  }, [activeTab, loadMyData, publicKey]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchSkills();
  };

  const handlePurchase = async (listingPubkey: Address, authorKey: Address) => {
    if (!connected) return;
    setPurchasing(listingPubkey as string);
    setTxError(null);
    setTxSuccess(null);
    try {
      const { tx, alreadyPurchased } = await oracle.purchaseSkill(
        listingPubkey,
        authorKey
      );
      if (alreadyPurchased) {
        setPurchasedKeys((prev) => new Set([...prev, String(listingPubkey)]));
        setPurchaseStatusWarning(null);
        setTxSuccess("Already purchased with this wallet.");
      } else if (tx) {
        setPurchasedKeys((prev) => new Set([...prev, String(listingPubkey)]));
        setPurchaseStatusWarning(null);
        setTxSuccess(tx);
      }
      await Promise.all([
        fetchSkills(),
        activeTab === "my-purchases" || activeTab === "my-listings"
          ? loadMyData()
          : Promise.resolve(),
      ]);
    } catch (error: unknown) {
      console.error("Purchase failed:", error);
      setTxError(getErrorMessage(error, "Transaction failed"));
    } finally {
      setPurchasing(null);
    }
  };

  const sortOptions: {
    value: SortOption;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      value: "trusted",
      label: "Most Trusted",
      icon: <FiShield className="w-3.5 h-3.5" />,
    },
    {
      value: "newest",
      label: "Newest",
      icon: <FiClock className="w-3.5 h-3.5" />,
    },
    {
      value: "installs",
      label: "Most Installed",
      icon: <FiTrendingUp className="w-3.5 h-3.5" />,
    },
    {
      value: "name",
      label: "Name",
      icon: <FiBookOpen className="w-3.5 h-3.5" />,
    },
  ];

  const tabs: { key: PageTab; label: string; icon: ReactNode }[] = [
    {
      key: "browse",
      label: "Browse",
      icon: <FiBookOpen className="inline-block mr-1" />,
    },
    {
      key: "my-purchases",
      label: "My Purchases",
      icon: <FiShoppingCart className="inline-block mr-1" />,
    },
    {
      key: "my-listings",
      label: "My Listings",
      icon: <FiPackage className="inline-block mr-1" />,
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        {/* Header */}
        <div className="mb-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 lg:pr-6">
            <h1 className="text-3xl md:text-4xl font-display text-gray-900 dark:text-white mb-1">
              Skills Marketplace
            </h1>
            <p className="max-w-3xl text-sm text-gray-500 dark:text-gray-400">
              Browse AI agent skills with on-chain author trust context. Inspect
              stake, peer vouches, and dispute history before you install or
              pay.
              {total > 0 && activeTab === "browse" && (
                <span className="ml-2 text-gray-400">({total} skills)</span>
              )}
            </p>
          </div>
        </div>

        {/* 
        <div className="mb-6 rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 text-sm text-gray-600 dark:text-gray-300">
          AgentVouch does not just list skills. It helps you evaluate the agent
          behind them. New here? Read{" "}
          <Link
            href="/docs/what-is-an-agent-reputation-oracle"
            className="text-[var(--lobster-accent)] hover:underline"
          >
            what an agent reputation oracle is
          </Link>{" "}
          or{" "}
          <Link
            href="/docs/verify-ai-agents"
            className="text-[var(--lobster-accent)] hover:underline"
          >
            how to verify an AI agent before delegation
          </Link>
          .
        </div>
        */}

        {/* Toast notifications */}
        {txSuccess && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-green-600 dark:text-green-400">
                <FiCheckCircle />
              </span>
              <span className="text-green-800 dark:text-green-200 text-sm">
                Transaction confirmed:{" "}
                <a
                  href={getConfiguredSolanaExplorerTxUrl(txSuccess)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-mono"
                >
                  {shortAddr(txSuccess)}
                </a>
              </span>
            </div>
            <button
              onClick={() => setTxSuccess(null)}
              className="text-green-600 dark:text-green-400 hover:text-green-800"
            >
              ✕
            </button>
          </div>
        )}
        {txError && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-red-600 dark:text-red-400">
                <FiXCircle />
              </span>
              <span className="text-red-800 dark:text-red-200 text-sm">
                {txError}
              </span>
            </div>
            <button
              onClick={() => setTxError(null)}
              className="text-red-600 dark:text-red-400 hover:text-red-800"
            >
              ✕
            </button>
          </div>
        )}
        {purchaseStatusWarning && connected && (
          <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-sm flex items-start gap-2">
            <span className="mt-0.5 text-amber-600 dark:text-amber-400">
              <FiAlertTriangle />
            </span>
            <span className="text-amber-800 dark:text-amber-200 text-sm">
              {purchaseStatusWarning} Purchased badges may be incomplete until
              the status refresh succeeds.
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-8 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-gray-200 pb-2 dark:border-gray-800">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 font-medium whitespace-nowrap transition text-sm border-b-2 -mb-[2px] ${
                  activeTab === tab.key
                    ? "border-[var(--sea-accent)] text-[var(--sea-accent-strong)]"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-[var(--sea-accent)]"
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 justify-start lg:justify-end">
            <Link
              href="/skills/publish"
              className={`${navButtonPrimaryFlexClass} whitespace-nowrap`}
            >
              <FiPlus className="w-4 h-4" />
              <span>Publish Skill</span>
            </Link>
          </div>
        </div>

        {/* ===== BROWSE TAB ===== */}
        {activeTab === "browse" && (
          <div className="flex gap-8 items-start">
            <div className="flex-1 min-w-0">
              {/* Search + Sort */}
              <div className="flex flex-col sm:flex-row gap-3 mb-8">
                <form onSubmit={handleSearch} className="flex-1 relative">
                  <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search skills..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sea-focus-ring)] focus:border-[var(--sea-accent)] transition"
                  />
                </form>
                <div className="flex items-center gap-2">
                  {sortOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setSort(opt.value);
                        setPage(1);
                      }}
                      className={`${navButtonFlexClass} font-medium ${
                        sort === opt.value
                          ? "bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)] border border-[var(--sea-accent-border)]"
                          : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
                      }`}
                    >
                      {opt.icon}
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Skill Cards */}
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <FiLoader className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : skills.length === 0 ? (
                <div className="text-center py-20">
                  <FiBookOpen className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-700 mb-4" />
                  <p className="text-gray-500 dark:text-gray-400 mb-2">
                    No skills found
                  </p>
                  <p className="text-sm text-gray-400 dark:text-gray-500">
                    {search
                      ? "Try a different search term"
                      : "Be the first to publish a skill"}
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {skills.map((skill) => {
                      const downloads =
                        (skill.total_installs ?? 0) +
                        (skill.total_downloads ?? 0);
                      const listingPubkey = skill.on_chain_address ?? null;
                      const hasPurchased =
                        Boolean(skill.buyerHasPurchased) ||
                        (listingPubkey
                          ? purchasedSkillListingKeys.has(listingPubkey)
                          : false);
                      const isOwn =
                        publicKey &&
                        skill.author_pubkey === (publicKey as string);
                      const isPurchasing = listingPubkey
                        ? purchasing === listingPubkey
                        : false;
                      const legacySolLamports =
                        skill.price_usdc_micros || listingPubkey
                          ? 0
                          : skill.price_lamports ?? 0;
                      const purchasePreflightStatus =
                        skill.purchasePreflightStatus ??
                        (skill.price_usdc_micros || listingPubkey
                          ? "estimateUnavailable"
                          : "ok");
                      const purchaseBlocked =
                        Boolean(skill.price_usdc_micros || listingPubkey) &&
                        isBlockingPurchaseStatus(purchasePreflightStatus);
                      const hasAccessPath =
                        skill.source === "repo" || Boolean(listingPubkey);
                      return (
                        <SkillPreviewCard
                          key={skill.id}
                          skill={skill}
                          hasAccessPath={hasAccessPath}
                          legacySolLamports={legacySolLamports}
                          downloads={downloads}
                          connected={connected}
                          isOwn={Boolean(isOwn)}
                          hasPurchased={hasPurchased}
                          isPurchasing={isPurchasing}
                          purchaseBlocked={purchaseBlocked}
                          purchasePreflightStatus={purchasePreflightStatus}
                          descriptionFallback={getCapabilityFallback(
                            skill.tags ?? []
                          )}
                          onPurchase={() => {
                            if (!listingPubkey) return;
                            handlePurchase(
                              address(listingPubkey),
                              address(skill.author_pubkey)
                            );
                          }}
                        />
                      );
                    })}
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-8">
                      <button
                        onClick={() => setPage(Math.max(1, page - 1))}
                        disabled={page === 1}
                        className="px-3 py-1.5 rounded-sm text-sm border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Page {page} of {totalPages}
                      </span>
                      <button
                        onClick={() => setPage(Math.min(totalPages, page + 1))}
                        disabled={page === totalPages}
                        className="px-3 py-1.5 rounded-sm text-sm border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Activity Feed sidebar */}
            <aside className="hidden lg:block w-72 flex-shrink-0">
              <div className="bg-white dark:bg-gray-900 rounded-sm border border-gray-200 dark:border-gray-800 overflow-hidden sticky top-6">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                  <FiActivity className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    Recent Activity
                  </span>
                  {feedLoading && (
                    <span className="ml-auto">
                      <FiLoader className="w-3 h-3 text-gray-400 animate-spin" />
                    </span>
                  )}
                </div>

                {feedItems.length === 0 && !feedLoading ? (
                  <div className="px-4 py-8 text-center">
                    <FiClock className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-700" />
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      No recent activity yet.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-50 dark:divide-gray-800/50 max-h-[520px] overflow-y-auto">
                    {feedItems.map((item) => (
                      <li
                        key={item.id}
                        className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition"
                      >
                        <p className="text-xs text-gray-900 dark:text-gray-100 leading-relaxed">
                          <Link
                            href={`/author/${item.actor}`}
                            className="font-mono font-medium text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                          >
                            {shortAddr(item.actor)}
                          </Link>{" "}
                          {item.type === "listing" ? "listed " : "bought "}
                          {item.skillRepoId ? (
                            <Link
                              href={`/skills/${item.skillRepoId}`}
                              className="font-semibold text-gray-900 dark:text-white hover:text-[var(--sea-accent)] transition"
                            >
                              &ldquo;{item.skillName}&rdquo;
                            </Link>
                          ) : (
                            <span className="font-semibold text-gray-900 dark:text-white">
                              &ldquo;{item.skillName}&rdquo;
                            </span>
                          )}{" "}
                          {item.type === "purchase" && item.author ? (
                            <>
                              from{" "}
                              <Link
                                href={`/author/${item.author}`}
                                className="font-mono font-medium text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                              >
                                {shortAddr(item.author)}
                              </Link>
                            </>
                          ) : null}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
                            <FiClock className="w-3 h-3" />
                            {timeAgo(item.timestamp)}
                          </span>
                          {item.priceUsdcMicros ? (
                            <span className="text-xs font-mono text-[var(--lobster-accent)] inline-flex items-center gap-1">
                              <UsdcIcon className="w-3 h-3" />
                              {formatUsdcMicros(item.priceUsdcMicros)} USDC
                            </span>
                          ) : item.legacySolLamports &&
                            item.legacySolLamports > 0 ? (
                            <span className="text-xs font-mono text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                              Legacy SOL
                            </span>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </div>
        )}

        {/* ===== MY PURCHASES TAB ===== */}
        {activeTab === "my-purchases" && (
          <div>
            {!connected ? (
              <div className="text-center py-20">
                <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gray-100 dark:bg-gray-900 flex items-center justify-center text-2xl text-gray-400 dark:text-gray-500">
                  <FiShoppingCart />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                  Connect Wallet
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Connect your wallet to see your purchases.
                </p>
              </div>
            ) : myPurchases.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gray-100 dark:bg-gray-900 flex items-center justify-center text-2xl text-gray-400 dark:text-gray-500">
                  <FiShoppingCart />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                  No purchases yet
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Browse the marketplace to find useful skills.
                </p>
                <button
                  onClick={() => setActiveTab("browse")}
                  className={navButtonPrimaryInlineClass}
                >
                  <span className="inline-flex items-center gap-2">
                    <FiBookOpen /> Browse Skills
                  </span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {myPurchases.map((purchase) => {
                  const listing = myPurchaseListings.find(
                    (l) => l.publicKey === purchase.account.skillListing
                  );
                  return (
                    <div
                      key={purchase.publicKey}
                      className="bg-white dark:bg-gray-900 rounded-sm p-5 border border-gray-200 dark:border-gray-800 flex items-center justify-between"
                    >
                      <div>
                        <h3 className="font-heading font-bold text-gray-900 dark:text-white">
                          {listing?.account.name || "Unknown Skill"}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Purchased{" "}
                          {formatDate(Number(purchase.account.purchasedAt))} ·{" "}
                          <span className="font-mono text-gray-900 dark:text-white">
                            {formatUsdc(purchase.account.pricePaidUsdcMicros)}{" "}
                            USDC
                          </span>
                        </p>
                      </div>
                      {listing?.account.skillUri && (
                        <a
                          href={listing.account.skillUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${navButtonInlineClass} font-semibold bg-green-600 hover:bg-green-700 text-white transition`}
                        >
                          <span className="inline-flex items-center gap-1">
                            <FiDownload /> Download
                          </span>
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ===== MY LISTINGS TAB ===== */}
        {activeTab === "my-listings" && (
          <div>
            {!connected ? (
              <div className="text-center py-20">
                <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gray-100 dark:bg-gray-900 flex items-center justify-center text-2xl text-gray-400 dark:text-gray-500">
                  <FiBox />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                  Connect Wallet
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Connect your wallet to see your listings.
                </p>
              </div>
            ) : myListings.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gray-100 dark:bg-gray-900 flex items-center justify-center text-2xl text-gray-400 dark:text-gray-500">
                  <FiBox />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                  No skills published
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Publish your first skill to start earning.
                </p>
                <Link
                  href="/skills/publish"
                  className={navButtonPrimaryInlineClass}
                >
                  <FiPlus /> Publish a Skill
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {myListings.map((listing) => {
                  const listingDetail = myListingDetails.get(
                    String(listing.publicKey)
                  );
                  const detailId =
                    listingDetail?.id ?? `chain-${String(listing.publicKey)}`;
                  const canPublishVersion =
                    !!listingDetail && detailId.indexOf("chain-") !== 0;
                  const price = Number(listing.account.priceUsdcMicros);
                  const downloads = Number(listing.account.totalDownloads);
                  const revenue = Number(
                    listing.account.totalRevenueUsdcMicros
                  );
                  const authorEarnings = Math.floor(revenue * 0.6);

                  return (
                    <div
                      key={listing.publicKey}
                      className="bg-white dark:bg-gray-900 rounded-sm p-5 border border-gray-200 dark:border-gray-800"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-heading font-bold text-gray-900 dark:text-white">
                          {listing.account.name}
                        </h3>
                        <span className="text-green-600 dark:text-green-400 font-mono font-bold">
                          <span className="inline-flex items-center gap-1">
                            <UsdcIcon className="w-3.5 h-3.5" />
                            {formatUsdc(price)} USDC
                          </span>
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                        {listing.account.description}
                      </p>
                      <div className="flex gap-4 text-sm">
                        <span className="text-gray-500 dark:text-gray-400">
                          <span className="inline-flex items-center gap-1">
                            <FiDownload /> {downloads} downloads
                          </span>
                        </span>
                        <span className="text-green-600 dark:text-green-400 font-mono">
                          <span className="inline-flex items-center gap-1">
                            <FiTrendingUp /> {formatUsdc(revenue)} USDC total (
                            {formatUsdc(authorEarnings)} your share)
                          </span>
                        </span>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Link
                          href={getAuthorActionHref(detailId, "edit-listing")}
                          className={navButtonInlineClass}
                        >
                          <FiEdit2 className="w-3.5 h-3.5" />
                          Edit Listing
                        </Link>
                        {canPublishVersion && (
                          <Link
                            href={getAuthorActionHref(
                              detailId,
                              "publish-version"
                            )}
                            className={navButtonInlineClass}
                          >
                            <FiGitCommit className="w-3.5 h-3.5" />
                            Publish New Version
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
