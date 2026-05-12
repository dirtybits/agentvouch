"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { address } from "@solana/kit";
import { useReputationOracle } from "@/hooks/useReputationOracle";
import { ClientWalletButton } from "@/components/ClientWalletButton";
import {
  navButtonInlineClass,
  navButtonPrimaryFlexClass,
  navButtonPrimaryInlineClass,
  navButtonSecondaryFlexClass,
  navButtonSecondaryInlineClass,
} from "@/lib/buttonStyles";
import { formatUsdcMicros } from "@/lib/pricing";
import type { PurchasePreflightStatus } from "@/lib/purchasePreflight";
import { getConfiguredSolanaFmTxUrl } from "@/lib/chains";
import { getAuthorDisputeLiabilityScopeLabel } from "@/lib/authorDisputes";
import Link from "next/link";
import { AuthorDisputeRuling } from "@/generated/agentvouch/src/generated";
import {
  FiAlertTriangle,
  FiCalendar,
  FiDollarSign,
  FiEdit2,
  FiExternalLink,
  FiGitCommit,
  FiSearch,
  FiShield,
  FiUser,
  FiUsers,
  FiZap,
} from "react-icons/fi";
import { isRpcRateLimitError } from "@/lib/rpcErrors";
import { getErrorMessage } from "@/lib/errors";
import { normalizeRegisteredAt } from "@/lib/registeredAt";

type Tab = "profile" | "vouch" | "explorer" | "disputes";

type MarketplaceListingRow = {
  id: string;
  name: string;
  description: string | null;
  on_chain_address?: string | null;
  price_usdc_micros?: string | null;
  purchasePreflightStatus?: PurchasePreflightStatus;
  purchasePreflightMessage?: string | null;
  total_installs: number;
  total_downloads?: number;
};

type ReputationOracle = ReturnType<typeof useReputationOracle>;
type AgentProfileData = NonNullable<
  Awaited<ReturnType<ReputationOracle["getAgentProfile"]>>
>;
type VouchRecord = Awaited<
  ReturnType<ReputationOracle["getAllVouchesForAgent"]>
>[number];
type PurchaseRecord = Awaited<
  ReturnType<ReputationOracle["getPurchasesByBuyer"]>
>[number];
type SkillListingRecord = Awaited<
  ReturnType<ReputationOracle["getAllSkillListings"]>
>[number];
type AgentListingRecord = Awaited<
  ReturnType<ReputationOracle["getAllAgents"]>
>[number];
type OracleAuthorDisputeRow = Awaited<
  ReturnType<ReputationOracle["getAllAuthorDisputes"]>
>[number];

function getSolanaFmTxUrl(tx: string): string {
  return getConfiguredSolanaFmTxUrl(tx);
}

function getAuthorActionHref(
  detailId: string,
  action: "edit-listing" | "publish-version"
): string {
  return `/skills/${detailId}?authorAction=${action}#author-actions`;
}

export default function DashboardPage() {
  const { wallet, status: walletStatus } = useWalletConnection();
  const connected = walletStatus === "connected" && !!wallet;
  const publicKey = wallet?.account.address ?? null;
  const oracle = useReputationOracle();

  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [metadataUri, setMetadataUri] = useState("");
  const [voucheeAddress, setVoucheeAddress] = useState("");
  const [vouchAmount, setVouchAmount] = useState("0.1");
  const [authorBondAmount, setAuthorBondAmount] = useState("0.1");
  const [searchAddress, setSearchAddress] = useState("");
  const [searchedAgent, setSearchedAgent] = useState<AgentProfileData | null>(
    null
  );
  const [agentProfile, setAgentProfile] = useState<AgentProfileData | null>(
    null
  );
  const [vouches, setVouches] = useState<VouchRecord[]>([]);
  const [vouchesReceived, setVouchesReceived] = useState<VouchRecord[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [purchaseListings, setPurchaseListings] = useState<
    Map<string, SkillListingRecord>
  >(new Map());
  const [purchaseWarning, setPurchaseWarning] = useState<string | null>(null);
  const [marketplaceListings, setMarketplaceListings] = useState<
    MarketplaceListingRow[]
  >([]);
  const [marketplaceListingWarning, setMarketplaceListingWarning] = useState<
    string | null
  >(null);
  const [allAgents, setAllAgents] = useState<AgentListingRecord[]>([]);
  const [authorDisputes, setAuthorDisputes] = useState<
    OracleAuthorDisputeRow[]
  >([]);
  const [configAuthority, setConfigAuthority] = useState<string | null>(null);
  const [resolvingAuthorDispute, setResolvingAuthorDispute] = useState<
    string | null
  >(null);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTx, setStatusTx] = useState<string | null>(null);
  const purchaseWalletRef = useRef<string | null>(null);

  useEffect(() => {
    if (connected && publicKey) {
      loadAgentProfile();
      loadVouches();
      loadPurchases();
    } else {
      setPurchases([]);
      setPurchaseListings(new Map());
      setPurchaseWarning(null);
      setMarketplaceListings([]);
      setMarketplaceListingWarning(null);
      purchaseWalletRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey]);

  const loadAgentProfile = async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const profile = await oracle.getAgentProfile(publicKey);
      setAgentProfile(profile);
    } catch (error) {
      console.error("Error loading profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadVouches = async () => {
    if (!publicKey) return;
    try {
      const vouchList = await oracle.getAllVouchesForAgent(publicKey);
      const vouchesReceivedList = await oracle.getAllVouchesReceivedByAgent(
        publicKey
      );
      setVouches(vouchList);
      setVouchesReceived(vouchesReceivedList);
    } catch (error) {
      console.error("Error loading vouches:", error);
    }
  };

  const loadPurchases = async () => {
    if (!publicKey) return;
    try {
      const [purchaseList, listings] = await Promise.all([
        oracle.getPurchasesByBuyer(publicKey),
        oracle.getAllSkillListings(),
      ]);
      let authoredMarketplaceSkills: MarketplaceListingRow[] = [];
      try {
        const response = await fetch(
          `/api/skills?author=${encodeURIComponent(
            String(publicKey)
          )}&sort=newest`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch marketplace listings");
        }
        const data = await response.json();
        authoredMarketplaceSkills = (data.skills ?? []).filter(
          (skill: MarketplaceListingRow) => !!skill.on_chain_address
        );
        setMarketplaceListingWarning(null);
      } catch (error) {
        console.error("Error loading authored marketplace listings:", error);
        authoredMarketplaceSkills = [];
        setMarketplaceListingWarning(
          "Marketplace listing health could not be refreshed right now."
        );
      }
      setPurchases(
        [...purchaseList].sort(
          (a, b) =>
            Number(b.account.purchasedAt) - Number(a.account.purchasedAt)
        )
      );
      setPurchaseListings(
        new Map<string, SkillListingRecord>(
          listings.map((listing) => [String(listing.publicKey), listing])
        )
      );
      setMarketplaceListings(authoredMarketplaceSkills);
      setPurchaseWarning(null);
      purchaseWalletRef.current = String(publicKey);
    } catch (error) {
      console.error("Error loading purchases:", error);
      if (purchaseWalletRef.current !== String(publicKey)) {
        setPurchases([]);
        setPurchaseListings(new Map());
        setMarketplaceListings([]);
      }
      setPurchaseWarning(
        isRpcRateLimitError(error)
          ? "Purchase history is temporarily unavailable because the RPC is rate-limiting requests."
          : "Purchase history could not be refreshed right now."
      );
    }
  };

  const loadAllAgents = async () => {
    setLoadingAgents(true);
    try {
      const agents = await oracle.getAllAgents();
      const sorted = agents.sort((a, b) => {
        const scoreA = Number(a.account.reputationScore ?? 0);
        const scoreB = Number(b.account.reputationScore ?? 0);
        return scoreB - scoreA;
      });
      setAllAgents(sorted);
    } catch (error) {
      console.error("Error loading agents:", error);
    } finally {
      setLoadingAgents(false);
    }
  };

  const loadAuthorDisputes = async () => {
    if (!publicKey) return;
    try {
      const [config, disputes] = await Promise.all([
        oracle.getConfig(),
        oracle.getAllAuthorDisputes(),
      ]);
      const resolverWallet = config?.authority
        ? String(config.authority)
        : null;
      setConfigAuthority(resolverWallet);
      setAuthorDisputes(
        resolverWallet === publicKey
          ? disputes
          : disputes.filter(
              (dispute) => String(dispute.account.author) === publicKey
            )
      );
    } catch (error) {
      console.error("Error loading author disputes:", error);
    }
  };

  useEffect(() => {
    if (activeTab === "explorer" && allAgents.length === 0) {
      loadAllAgents();
    } else if (activeTab === "vouch" && allAgents.length === 0) {
      loadAllAgents();
    } else if (activeTab === "disputes" && connected) {
      loadAuthorDisputes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, connected]);

  const searchAgent = async () => {
    if (!searchAddress) {
      setStatus("Please enter an agent address");
      setStatusTx(null);
      return;
    }
    setLoading(true);
    setStatus("Searching...");
    setStatusTx(null);
    try {
      const agentKey = address(searchAddress);
      const profile = await oracle.getAgentProfile(agentKey);
      if (profile) {
        setSearchedAgent(profile);
        setStatus("Agent found!");
      } else {
        setSearchedAgent(null);
        setStatus("Agent not found - they may not be registered yet");
      }
      setStatusTx(null);
    } catch (error: unknown) {
      setStatus(`Error: ${getErrorMessage(error)}`);
      setStatusTx(null);
      setSearchedAgent(null);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveAuthorDispute = async (
    dispute: OracleAuthorDisputeRow,
    ruling: AuthorDisputeRuling
  ) => {
    setResolvingAuthorDispute(dispute.publicKey);
    setStatus("");
    setStatusTx(null);
    try {
      const { tx } = await oracle.resolveAuthorDispute(
        address(String(dispute.account.author)),
        BigInt(dispute.account.disputeId),
        ruling,
        address(String(dispute.account.challenger))
      );
      setStatus(
        `Author dispute ${
          ruling === AuthorDisputeRuling.Upheld ? "upheld" : "dismissed"
        } successfully.`
      );
      setStatusTx(tx);
      await loadAuthorDisputes();
    } catch (error: unknown) {
      setStatus(`Error: ${getErrorMessage(error)}`);
    } finally {
      setResolvingAuthorDispute(null);
    }
  };

  const handleRegister = async () => {
    setLoading(true);
    setStatus("Registering agent...");
    setStatusTx(null);
    try {
      const { tx } = await oracle.registerAgent(metadataUri || "");
      setStatus("Agent registered!");
      setStatusTx(tx);
      setTimeout(loadAgentProfile, 2000);
    } catch (error: unknown) {
      setStatus(`Error: ${getErrorMessage(error)}`);
      setStatusTx(null);
    } finally {
      setLoading(false);
    }
  };

  const formatUsdc = (micros: number | bigint | string | null | undefined) =>
    `${formatUsdcMicros(micros) ?? "0"} USDC`;

  const parsePositiveUsdcInput = (value: string): number | null => {
    const amount = Number.parseFloat(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }
    return amount;
  };

  const handleDepositAuthorBond = async () => {
    const amount = parsePositiveUsdcInput(authorBondAmount);
    if (amount === null) {
      setStatus("Enter a USDC bond amount greater than 0.");
      setStatusTx(null);
      return;
    }
    setLoading(true);
    setStatus("Depositing author bond...");
    setStatusTx(null);
    try {
      const { tx } = await oracle.depositAuthorBond(amount);
      setStatus("Author bond deposited.");
      setStatusTx(tx);
      await loadAgentProfile();
    } catch (error: unknown) {
      setStatus(`Error: ${getErrorMessage(error)}`);
      setStatusTx(null);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawAuthorBond = async () => {
    const amount = parsePositiveUsdcInput(authorBondAmount);
    if (amount === null) {
      setStatus("Enter a USDC bond amount greater than 0.");
      setStatusTx(null);
      return;
    }
    setLoading(true);
    setStatus("Withdrawing author bond...");
    setStatusTx(null);
    try {
      const { tx } = await oracle.withdrawAuthorBond(amount);
      setStatus("Author bond withdrawn.");
      setStatusTx(tx);
      await loadAgentProfile();
    } catch (error: unknown) {
      setStatus(`Error: ${getErrorMessage(error)}`);
      setStatusTx(null);
    } finally {
      setLoading(false);
    }
  };

  const handleVouch = async () => {
    if (!voucheeAddress) {
      setStatus("Please enter a vouchee address");
      setStatusTx(null);
      return;
    }
    setLoading(true);
    setStatus("Creating vouch...");
    setStatusTx(null);
    try {
      const vouchee = address(voucheeAddress);
      const voucheeData = await oracle.getAgentProfile(vouchee);
      if (!voucheeData) {
        setStatus(
          "Error: That agent is not registered yet. They need to register before you can vouch for them."
        );
        setStatusTx(null);
        setLoading(false);
        return;
      }
      const amount = parsePositiveUsdcInput(vouchAmount);
      if (amount === null) {
        setStatus("Enter a USDC vouch amount greater than 0.");
        setStatusTx(null);
        setLoading(false);
        return;
      }
      const { tx } = await oracle.vouch(vouchee, amount);
      setStatus("Vouch created!");
      setStatusTx(tx);
      setTimeout(loadAgentProfile, 2000);
    } catch (error: unknown) {
      setStatus(`Error: ${getErrorMessage(error)}`);
      setStatusTx(null);
    } finally {
      setLoading(false);
    }
  };

  const formatScore = (score: number | string | bigint | null | undefined) => {
    if (!score) return "0";
    return Number(score).toLocaleString();
  };

  const formatTimestamp = (ts: number | string | bigint | null | undefined) => {
    const timestamp = Number(ts);
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatRegisteredTimestamp = (
    ts: number | string | bigint | null | undefined
  ) => {
    const timestamp = normalizeRegisteredAt(ts);
    return timestamp > 0
      ? new Date(timestamp * 1000).toLocaleString()
      : "Unknown";
  };

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    {
      id: "profile",
      label: "My Profile",
      icon: <FiUser className="inline-block mr-1" />,
    },
    {
      id: "vouch",
      label: "Vouch",
      icon: <FiZap className="inline-block mr-1" />,
    },
    {
      id: "explorer",
      label: "Explore",
      icon: <FiSearch className="inline-block mr-1" />,
    },
    {
      id: "disputes",
      label: "Disputes",
      icon: <FiShield className="inline-block mr-1" />,
    },
  ];

  const canVouchFromDashboard = connected && !!agentProfile;

  const renderRegisteredAgentsCard = () => (
    <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-heading font-bold text-gray-900 dark:text-white">
          Registered Agents
        </h3>
        <button
          onClick={loadAllAgents}
          disabled={loadingAgents}
          className={navButtonSecondaryInlineClass}
        >
          {loadingAgents
            ? "Loading..."
            : allAgents.length > 0
            ? "Refresh"
            : "Load Agents"}
        </button>
      </div>
      {loadingAgents ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Loading agents...
        </p>
      ) : allAgents.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No agents found. Be the first to register!
        </p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {allAgents.map((agent, idx: number) => {
            const agentKey = agent.publicKey;
            const isCurrentUser = agentKey === publicKey;
            return (
              <div
                key={idx}
                className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-700 transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base font-bold text-green-600 dark:text-green-400 font-mono">
                        {formatScore(agent.account.reputationScore)}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        reputation
                      </span>
                      {isCurrentUser && (
                        <span className="px-2 py-0.5 bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)] text-xs rounded font-medium border border-[var(--sea-accent-border)]">
                          You
                        </span>
                      )}
                    </div>
                    <Link
                      href={`/author/${agent.account.authority}`}
                      className="font-mono text-xs text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline truncate block mb-2"
                    >
                      {agent.account.authority}
                    </Link>
                    <div className="flex gap-4 text-xs text-gray-400 dark:text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <FiZap /> {String(agent.account.totalVouchesReceived)}{" "}
                        vouches
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <FiDollarSign />{" "}
                        {formatUsdc(agent.account.totalVouchStakeUsdcMicros)}
                      </span>
                    </div>
                  </div>
                  {!isCurrentUser && canVouchFromDashboard ? (
                    <button
                      onClick={() => {
                        setVoucheeAddress(agent.account.authority);
                        window.scrollTo({
                          top: 0,
                          behavior: "smooth",
                        });
                      }}
                      className={`${navButtonPrimaryInlineClass} whitespace-nowrap`}
                    >
                      Vouch
                    </button>
                  ) : (
                    <Link
                      href={`/author/${agent.account.authority}`}
                      className={`${navButtonSecondaryInlineClass} whitespace-nowrap`}
                    >
                      View
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-heading font-bold text-gray-900 dark:text-white mb-1">
              Dashboard
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Manage your agent profile, vouches, and disputes
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex gap-1 overflow-x-auto pb-2 border-b border-gray-200 dark:border-gray-800">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 font-medium whitespace-nowrap transition text-sm border-b-2 -mb-[2px] ${
                  activeTab === tab.id
                    ? "border-gray-900 dark:border-white text-gray-900 dark:text-white"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "profile" && !connected && (
            <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-2xl text-gray-400 dark:text-gray-500">
                <FiUser />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                Connect Wallet
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Connect your wallet to view and manage your agent profile.
              </p>
              <ClientWalletButton />
            </div>
          )}

          {activeTab === "profile" && connected && (
            <>
              <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white">
                    Your Agent Profile
                  </h2>
                  {publicKey && (
                    <Link
                      href={`/author/${publicKey}`}
                      className="text-sm text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                    >
                      View Public Profile →
                    </Link>
                  )}
                </div>

                {loading && !agentProfile ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Loading...
                  </p>
                ) : agentProfile ? (
                  <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-800">
                    <div className="flex justify-between py-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Reputation Score
                      </span>
                      <span className="font-bold text-xl text-green-600 dark:text-green-400">
                        {formatScore(agentProfile.reputationScore)}
                      </span>
                    </div>
                    <div className="flex justify-between py-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        External Backing
                      </span>
                      <span className="text-sm font-mono text-gray-900 dark:text-white">
                        {formatUsdc(agentProfile.totalVouchStakeUsdcMicros)}
                      </span>
                    </div>
                    <div className="flex justify-between py-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Author Bond
                      </span>
                      <span className="text-sm font-mono text-gray-900 dark:text-white">
                        {formatUsdc(agentProfile.authorBondUsdcMicros ?? 0)}
                      </span>
                    </div>
                    <div className="flex justify-between py-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Total Stake At Risk
                      </span>
                      <span className="text-sm font-mono text-gray-900 dark:text-white">
                        {formatUsdc(
                          Number(agentProfile.totalVouchStakeUsdcMicros) +
                            Number(agentProfile.authorBondUsdcMicros ?? 0)
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between py-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Vouches Received
                      </span>
                      <span className="text-sm font-mono text-gray-900 dark:text-white">
                        {String(agentProfile.totalVouchesReceived)}
                      </span>
                    </div>
                    <div className="flex justify-between py-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Vouches Given
                      </span>
                      <span className="text-sm font-mono text-gray-900 dark:text-white">
                        {String(agentProfile.totalVouchesGiven)}
                      </span>
                    </div>
                    <div className="flex justify-between py-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Open Author Reports
                      </span>
                      <span className="text-sm font-mono text-amber-600 dark:text-amber-400">
                        {String(agentProfile.openAuthorDisputes ?? 0)}
                      </span>
                    </div>
                    <div className="flex justify-between py-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Free Listings
                      </span>
                      <span className="text-sm font-mono text-gray-900 dark:text-white">
                        {String(agentProfile.activeFreeSkillListings ?? 0)}
                      </span>
                    </div>
                    <div className="flex justify-between py-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        Registered
                      </span>
                      <span className="text-sm text-gray-900 dark:text-white">
                        {formatRegisteredTimestamp(agentProfile.registeredAt)}
                      </span>
                    </div>
                    <div className="pt-3">
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        Manage Author Bond
                      </span>
                      <div className="mt-2 flex flex-col gap-3 rounded-sm border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-950/40 p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Free listings require enough self-stake, and open
                          author reports lock withdrawals until resolution.
                        </p>
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-[160px] flex-1">
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                              Amount (USDC)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step={0.001}
                              value={authorBondAmount}
                              onChange={(e) =>
                                setAuthorBondAmount(e.target.value)
                              }
                              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                            />
                          </div>
                          <button
                            onClick={handleDepositAuthorBond}
                            disabled={loading}
                            className={navButtonPrimaryInlineClass}
                          >
                            Deposit Bond
                          </button>
                          <button
                            onClick={handleWithdrawAuthorBond}
                            disabled={loading}
                            className={navButtonSecondaryInlineClass}
                          >
                            Withdraw Bond
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="pt-3">
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        Metadata
                      </span>
                      <a
                        href={agentProfile.metadataUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-sm text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline break-all mt-1"
                      >
                        {agentProfile.metadataUri}
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      You&apos;re not registered as an agent yet.
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Metadata URI (optional)
                      </label>
                      <input
                        type="text"
                        value={metadataUri}
                        onChange={(e) => setMetadataUri(e.target.value)}
                        placeholder="https://your-metadata.json or ipfs://..."
                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-gray-900 dark:focus:ring-white focus:border-transparent outline-none text-sm"
                      />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Leave empty or enter a URL to metadata describing your
                        agent
                      </p>
                    </div>
                    <button
                      onClick={handleRegister}
                      disabled={loading}
                      className={`w-full ${navButtonPrimaryFlexClass}`}
                    >
                      {loading ? "Registering..." : "Register as Agent"}
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                  <FiDollarSign className="text-[var(--sea-accent)]" />{" "}
                  Purchased Skills
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Skills this wallet has already bought on-chain.
                </p>
                {purchaseWarning && (
                  <div className="mb-4 rounded-sm border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
                    <FiAlertTriangle className="mt-0.5 shrink-0" />
                    <span>{purchaseWarning}</span>
                  </div>
                )}
                {purchases.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {purchaseWarning
                      ? "Purchased skills are unavailable right now."
                      : "No purchased skills yet."}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {purchases.map((purchase) => {
                      const listing = purchaseListings.get(
                        String(purchase.account.skillListing)
                      );
                      return (
                        <div
                          key={purchase.publicKey}
                          className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-700 transition"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-base font-bold text-gray-900 dark:text-white">
                                  {listing?.account.name ?? "Purchased skill"}
                                </span>
                                <span className="text-xs text-green-600 dark:text-green-400 font-mono">
                                  {formatUsdc(purchase.account.pricePaidUsdcMicros)}
                                </span>
                              </div>
                              {listing?.account.skillUri ? (
                                <a
                                  href={listing.account.skillUri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline truncate block mb-2"
                                >
                                  {listing.account.skillUri}
                                </a>
                              ) : (
                                <p className="font-mono text-xs text-gray-500 dark:text-gray-400 mb-2 break-all">
                                  Listing:{" "}
                                  {String(purchase.account.skillListing)}
                                </p>
                              )}
                              <div className="flex gap-4 text-xs text-gray-400 dark:text-gray-500">
                                <span className="inline-flex items-center gap-1">
                                  <FiCalendar />{" "}
                                  {formatTimestamp(
                                    purchase.account.purchasedAt
                                  )}
                                </span>
                              </div>
                            </div>
                            <span
                              className={`${navButtonInlineClass} bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 whitespace-nowrap`}
                            >
                              Purchased
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                  <FiDollarSign className="text-[var(--lobster-accent)]" /> Your
                  Marketplace Listings
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Author-facing health for listings this wallet has published.
                </p>
                {marketplaceListingWarning && (
                  <div className="mb-4 rounded-sm border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
                    <FiAlertTriangle className="mt-0.5 shrink-0" />
                    <span>{marketplaceListingWarning}</span>
                  </div>
                )}
                {marketplaceListings.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {marketplaceListingWarning
                      ? "Marketplace listings are unavailable right now."
                      : "No marketplace listings yet."}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {marketplaceListings.map((listing) => {
                      const canPublishVersion = !listing.id.startsWith("chain-");
                      const listingPriceUsdcMicros =
                        listing.price_usdc_micros ?? "0";
                      const downloads =
                        (listing.total_installs ?? 0) +
                        (listing.total_downloads ?? 0);
                      return (
                        <div
                          key={listing.id}
                          className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-700 transition"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <Link
                                  href={`/skills/${listing.id}`}
                                  className="text-base font-bold text-gray-900 dark:text-white hover:text-[var(--lobster-accent)] transition hover:underline"
                                >
                                  {listing.name}
                                </Link>
                                <span className="text-xs text-green-600 dark:text-green-400 font-mono">
                                  {formatUsdc(listingPriceUsdcMicros)} price
                                </span>
                              </div>
                              {listing.description && (
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                                  {listing.description}
                                </p>
                              )}
                              <div className="flex gap-4 text-xs text-gray-400 dark:text-gray-500">
                                <span className="inline-flex items-center gap-1">
                                  <FiZap /> {downloads} downloads
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <FiDollarSign />{" "}
                                  {formatUsdc(listingPriceUsdcMicros)} listed
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <Link
                                href={getAuthorActionHref(
                                  listing.id,
                                  "edit-listing"
                                )}
                                className={navButtonSecondaryInlineClass}
                              >
                                <FiEdit2 className="w-3.5 h-3.5" />
                                Edit Listing
                              </Link>
                              {canPublishVersion && (
                                <Link
                                  href={getAuthorActionHref(
                                    listing.id,
                                    "publish-version"
                                  )}
                                  className={navButtonSecondaryInlineClass}
                                >
                                  <FiGitCommit className="w-3.5 h-3.5" />
                                  Publish New Version
                                </Link>
                              )}
                              <Link
                                href={`/skills/${listing.id}`}
                                className={navButtonSecondaryInlineClass}
                              >
                                View
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {agentProfile && vouchesReceived.length > 0 && (
                <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                  <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                    <FiUsers className="text-[var(--lobster-accent)]" /> Agents
                    Vouching For You
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    {vouchesReceived.length}{" "}
                    {vouchesReceived.length === 1 ? "agent is" : "agents are"}{" "}
                    staking USDC to vouch for you.
                  </p>
                  <div className="space-y-3">
                    {vouchesReceived.map((vouch, idx: number) => {
                      const voucher = vouch.account.voucher;
                      const stakeAmount = vouch.account.stakeUsdcMicros;
                      const createdAt = vouch.account.createdAt;
                      return (
                        <div
                          key={idx}
                          className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-700 transition"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-base font-bold text-green-600 dark:text-green-400 font-mono">
                                  {formatUsdc(stakeAmount)}
                                </span>
                                <span className="text-xs text-gray-400 dark:text-gray-500">
                                  staked
                                </span>
                              </div>
                              <Link
                                href={`/author/${voucher}`}
                                className="font-mono text-xs text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline truncate block mb-2"
                              >
                                {voucher}
                              </Link>
                              <div className="flex gap-4 text-xs text-gray-400 dark:text-gray-500">
                                <span className="inline-flex items-center gap-1">
                                  <FiCalendar /> {formatTimestamp(createdAt)}
                                </span>
                              </div>
                            </div>
                            <Link
                              href={`/author/${voucher}`}
                              className={`${navButtonSecondaryInlineClass} whitespace-nowrap`}
                            >
                              View
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {agentProfile && vouches.length > 0 && (
                <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                  <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                    <FiZap className="text-[var(--lobster-accent)]" /> Agents
                    You&apos;re Vouching For
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    You&apos;re currently staking USDC to vouch for{" "}
                    {vouches.length} {vouches.length === 1 ? "agent" : "agents"}
                    .
                  </p>
                  <div className="space-y-3">
                    {vouches.map((vouch, idx: number) => {
                      const vouchee = vouch.account.vouchee;
                      const stakeAmount = vouch.account.stakeUsdcMicros;
                      const createdAt = vouch.account.createdAt;
                      return (
                        <div
                          key={idx}
                          className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-700 transition"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-base font-bold text-green-600 dark:text-green-400 font-mono">
                                  {formatUsdc(stakeAmount)}
                                </span>
                                <span className="text-xs text-gray-400 dark:text-gray-500">
                                  staked
                                </span>
                              </div>
                              <Link
                                href={`/author/${vouchee}`}
                                className="font-mono text-xs text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline truncate block mb-2"
                              >
                                {vouchee}
                              </Link>
                              <div className="flex gap-4 text-xs text-gray-400 dark:text-gray-500">
                                <span className="inline-flex items-center gap-1">
                                  <FiCalendar /> {formatTimestamp(createdAt)}
                                </span>
                              </div>
                            </div>
                            <Link
                              href={`/author/${vouchee}`}
                              className={`${navButtonSecondaryInlineClass} whitespace-nowrap`}
                            >
                              View
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === "vouch" && !connected && (
            <div className="space-y-6">
              <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-2xl text-gray-400 dark:text-gray-500">
                  <FiZap />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                  Connect Wallet
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Connect your wallet to vouch for agents.
                </p>
                <ClientWalletButton />
              </div>
              {renderRegisteredAgentsCard()}
            </div>
          )}

          {activeTab === "vouch" && connected && agentProfile && (
            <div className="space-y-6">
              <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-2">
                  Vouch for an Agent
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Stake USDC to vouch for another agent&apos;s reputation. If
                  they misbehave and lose a dispute, your stake gets slashed.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Agent Wallet Address
                    </label>
                    <input
                      type="text"
                      value={voucheeAddress}
                      onChange={(e) => setVoucheeAddress(e.target.value)}
                      placeholder="Enter agent's wallet address (not profile PDA)"
                      className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-gray-900 dark:focus:ring-white focus:border-transparent outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Stake Amount (USDC)
                    </label>
                    <input
                      type="number"
                      value={vouchAmount}
                      onChange={(e) => setVouchAmount(e.target.value)}
                      min="0.01"
                      step="0.01"
                      className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-gray-900 dark:focus:ring-white focus:border-transparent outline-none text-sm font-mono"
                    />
                  </div>
                  <button
                    onClick={handleVouch}
                    disabled={loading || !voucheeAddress}
                    className={`w-full ${navButtonPrimaryFlexClass}`}
                  >
                    {loading
                      ? "Creating Vouch..."
                      : `Vouch with ${vouchAmount} USDC`}
                  </button>
                </div>
              </div>

              {renderRegisteredAgentsCard()}
            </div>
          )}

          {activeTab === "vouch" && connected && !agentProfile && (
            <div className="space-y-6">
              <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-2">
                  Vouch for an Agent
                </h2>
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  You must register as an agent before you can vouch for others.
                  Go to the &quot;My Profile&quot; tab to register.
                </p>
              </div>
              {renderRegisteredAgentsCard()}
            </div>
          )}

          {activeTab === "explorer" && (
            <div className="space-y-6">
              <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                  <FiSearch className="text-[var(--sea-accent)]" /> Search
                  Agents
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Search for any agent by their Solana wallet address to view
                  their reputation and vouches.
                </p>
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchAddress}
                      onChange={(e) => setSearchAddress(e.target.value)}
                      placeholder="Enter agent's Solana public key"
                      className="flex-1 px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-[var(--sea-focus-ring)] focus:border-[var(--sea-accent)] outline-none text-sm"
                    />
                    <button
                      onClick={searchAgent}
                      disabled={loading}
                      className={`${navButtonSecondaryInlineClass} whitespace-nowrap`}
                    >
                      {loading ? "..." : "Search"}
                    </button>
                  </div>

                  {searchedAgent && (
                    <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-6 space-y-0 divide-y divide-gray-100 dark:divide-gray-700">
                      <h3 className="text-base font-heading font-bold text-green-600 dark:text-green-400 mb-3 pb-0">
                        Agent Found
                      </h3>
                      <div className="flex justify-between py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          Reputation Score
                        </span>
                        <span className="font-bold text-xl text-green-600 dark:text-green-400">
                          {formatScore(searchedAgent.reputationScore)}
                        </span>
                      </div>
                      <div className="flex justify-between py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          External Backing
                        </span>
                        <span className="text-sm font-mono text-gray-900 dark:text-white">
                          {formatUsdc(searchedAgent.totalVouchStakeUsdcMicros)}
                        </span>
                      </div>
                      <div className="flex justify-between py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          Author Bond
                        </span>
                        <span className="text-sm font-mono text-gray-900 dark:text-white">
                          {formatUsdc(searchedAgent.authorBondUsdcMicros ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          Total Stake At Risk
                        </span>
                        <span className="text-sm font-mono text-gray-900 dark:text-white">
                          {formatUsdc(
                            Number(searchedAgent.totalVouchStakeUsdcMicros) +
                              Number(searchedAgent.authorBondUsdcMicros ?? 0)
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          Vouches Received
                        </span>
                        <span className="text-sm font-mono text-gray-900 dark:text-white">
                          {String(searchedAgent.totalVouchesReceived)}
                        </span>
                      </div>
                      <div className="flex justify-between py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          Vouches Given
                        </span>
                        <span className="text-sm font-mono text-gray-900 dark:text-white">
                          {String(searchedAgent.totalVouchesGiven)}
                        </span>
                      </div>
                      <div className="flex justify-between py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          Open Author Reports
                        </span>
                        <span className="text-sm font-mono text-amber-600 dark:text-amber-400">
                          {String(searchedAgent.openAuthorDisputes ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          Free Listings
                        </span>
                        <span className="text-sm font-mono text-gray-900 dark:text-white">
                          {String(searchedAgent.activeFreeSkillListings ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          Registered
                        </span>
                        <span className="text-sm text-gray-900 dark:text-white">
                          {formatRegisteredTimestamp(
                            searchedAgent.registeredAt
                          )}
                        </span>
                      </div>
                      <div className="pt-3">
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          Metadata
                        </span>
                        <a
                          href={searchedAgent.metadataUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-sm text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline break-all mt-1"
                        >
                          {searchedAgent.metadataUri}
                        </a>
                      </div>

                      <div className="pt-4">
                        <Link
                          href={`/author/${searchAddress}`}
                          className={`w-full ${navButtonSecondaryFlexClass}`}
                        >
                          View Full Profile
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-heading font-bold text-gray-900 dark:text-white">
                    All Registered Agents
                  </h3>
                  <button
                    onClick={loadAllAgents}
                    disabled={loadingAgents}
                    className={navButtonSecondaryInlineClass}
                  >
                    {loadingAgents
                      ? "Loading..."
                      : allAgents.length > 0
                      ? "Refresh"
                      : "Load Agents"}
                  </button>
                </div>
                {loadingAgents ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Loading agents...
                  </p>
                ) : allAgents.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No agents found.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {allAgents.map((agent, idx: number) => {
                      const agentKey = agent.publicKey;
                      const isCurrentUser = agentKey === publicKey;
                      return (
                        <div
                          key={idx}
                          className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-700 transition"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-base font-bold text-green-600 dark:text-green-400 font-mono">
                                  {formatScore(agent.account.reputationScore)}
                                </span>
                                <span className="text-xs text-gray-400 dark:text-gray-500">
                                  reputation
                                </span>
                                {isCurrentUser && (
                                  <span className="px-2 py-0.5 bg-[var(--sea-accent-soft)] text-[var(--sea-accent-strong)] text-xs rounded font-medium border border-[var(--sea-accent-border)]">
                                    You
                                  </span>
                                )}
                              </div>
                              <Link
                                href={`/author/${agent.account.authority}`}
                                className="font-mono text-xs text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline truncate block mb-2"
                              >
                                {agent.account.authority}
                              </Link>
                              <div className="flex gap-4 text-xs text-gray-400 dark:text-gray-500">
                                <span className="inline-flex items-center gap-1">
                                  <FiZap />{" "}
                                  {String(agent.account.totalVouchesReceived)}{" "}
                                  vouches
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <FiDollarSign />{" "}
                                  {formatUsdc(agent.account.totalVouchStakeUsdcMicros)}
                                </span>
                              </div>
                            </div>
                            <Link
                              href={`/author/${agent.account.authority}`}
                              className={`${navButtonSecondaryInlineClass} whitespace-nowrap`}
                            >
                              View
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "disputes" && !connected && (
            <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-2xl text-gray-400 dark:text-gray-500">
                <FiShield />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                Connect Wallet
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Connect your wallet to review author-wide reports and
                lower-level vouch disputes.
              </p>
              <ClientWalletButton />
            </div>
          )}

          {activeTab === "disputes" && connected && (
            <div className="space-y-6">
              <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                  <FiShield className="text-[var(--lobster-accent)]" /> Author
                  Disputes
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  {configAuthority === publicKey
                    ? "You are the configured resolver, so this view shows every author-wide dispute plus resolution controls."
                    : "This view shows first-class, author-wide reports opened against your author wallet. Use author pages to open new reports."}
                </p>
                {authorDisputes.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No author disputes found.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {authorDisputes.map((dispute) => (
                      <div
                        key={dispute.publicKey}
                        className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-gray-200/70 dark:bg-gray-700/70 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-300">
                                {dispute.statusLabel}
                              </span>
                              <span className="rounded-full bg-[var(--lobster-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--lobster-accent)]">
                                {dispute.reasonLabel}
                              </span>
                              {dispute.rulingLabel && (
                                <span className="rounded-full bg-gray-200/70 dark:bg-gray-700/70 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-300">
                                  {dispute.rulingLabel}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Author:{" "}
                              <span className="font-mono">
                                {String(dispute.account.author)}
                              </span>
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Challenger:{" "}
                              <span className="font-mono">
                                {String(dispute.account.challenger)}
                              </span>
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono break-all">
                              Dispute: {dispute.publicKey}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono break-all">
                              Evidence: {dispute.account.evidenceUri}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Liability:{" "}
                              {getAuthorDisputeLiabilityScopeLabel(
                                dispute.account.liabilityScope
                              )}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Snapshot: {dispute.account.linkedVouchCount} of{" "}
                              {dispute.account.backingVouchCountSnapshot}{" "}
                              backing{" "}
                              {dispute.account.backingVouchCountSnapshot === 1
                                ? "voucher"
                                : "vouchers"}
                            </p>
                          </div>

                          {configAuthority === publicKey &&
                            dispute.statusLabel === "Open" && (
                              <div className="flex gap-2 shrink-0">
                                <button
                                  onClick={() =>
                                    handleResolveAuthorDispute(
                                      dispute,
                                      AuthorDisputeRuling.Upheld
                                    )
                                  }
                                  disabled={
                                    resolvingAuthorDispute === dispute.publicKey
                                  }
                                  className={navButtonPrimaryInlineClass}
                                >
                                  Uphold
                                </button>
                                <button
                                  onClick={() =>
                                    handleResolveAuthorDispute(
                                      dispute,
                                      AuthorDisputeRuling.Dismissed
                                    )
                                  }
                                  disabled={
                                    resolvingAuthorDispute === dispute.publicKey
                                  }
                                  className={navButtonSecondaryInlineClass}
                                >
                                  Dismiss
                                </button>
                              </div>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                  <FiShield className="text-[var(--lobster-accent)]" /> Your
                  Vouches
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Singular vouch disputes were removed. Use author-wide reports
                  from public author pages when you need to challenge a
                  publisher, and use this list to inspect your current backing
                  relationships.
                </p>
                {vouches.length > 0 ? (
                  <div className="space-y-2">
                    {vouches.map((vouch, idx) => (
                      <div
                        key={idx}
                        className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-3"
                      >
                        <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
                          Vouch Account
                        </p>
                        <p className="font-mono text-xs text-gray-900 dark:text-white break-all">
                          {vouch.publicKey}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No backing vouches found for this wallet yet.
                  </p>
                )}
              </div>
            </div>
          )}

          {status && (
            <div
              className={`rounded-xl p-4 ${
                status.includes("Error") || status.includes("not found")
                  ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                  : "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
              }`}
            >
              <div className="space-y-1">
                <p
                  className={`font-mono text-sm break-all ${
                    status.includes("Error") || status.includes("not found")
                      ? "text-red-700 dark:text-red-300"
                      : "text-green-700 dark:text-green-300"
                  }`}
                >
                  {status}
                </p>
                {statusTx && (
                  <a
                    href={getSolanaFmTxUrl(statusTx)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                  >
                    View transaction on Solana FM
                    <FiExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
