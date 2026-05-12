"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useWalletConnection } from "@solana/react-hooks";
import { address, type Address } from "@solana/kit";
import Link from "next/link";
import { AgentIdentityPanel } from "@/components/AgentIdentityPanel";
import { AgentProfileSetupCard } from "@/components/AgentProfileSetupCard";
import { ClientWalletButton } from "@/components/ClientWalletButton";
import type { AuthPayload } from "@/lib/auth";
import type { AuthorDisputeRecord } from "@/lib/authorDisputes";
import {
  navButtonPrimaryFlexClass,
  navButtonPrimaryInlineClass,
  navButtonSecondaryInlineClass,
} from "@/lib/buttonStyles";
import { useReputationOracle } from "@/hooks/useReputationOracle";
import type { AgentIdentitySummary } from "@/lib/agentIdentity";
import { encodeBase64 } from "@/lib/base64";
import { getConfiguredSolanaFmTxUrl } from "@/lib/chains";
import { getErrorMessage } from "@/lib/errors";
import {
  countsTowardAuthorWideReportSnapshot,
  getVouchStatusLabel,
} from "@/lib/disputes";
import {
  AuthorDisputeReason,
  VouchStatus,
} from "@/generated/agentvouch/src/generated";
import type { SolanaRegistryCandidate } from "@/lib/solanaAgentRegistry";
import TrustBadge, { type TrustData } from "@/components/TrustBadge";
import { formatUsdcMicros } from "@/lib/pricing";
import {
  FiAlertTriangle,
  FiArrowLeft,
  FiCalendar,
  FiCopy,
  FiCheck,
  FiDownload,
  FiExternalLink,
  FiFlag,
  FiLoader,
  FiPackage,
  FiShield,
  FiTag,
  FiTrendingUp,
  FiUsers,
  FiX,
  FiZap,
} from "react-icons/fi";

function getSolanaFmTxUrl(tx: string): string {
  return getConfiguredSolanaFmTxUrl(tx);
}

function shortAddr(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function formatUsdc(micros: number | bigint | string | null | undefined): string {
  return formatUsdcMicros(micros) ?? "0";
}

function formatDate(isoOrTimestamp: string | number): string {
  const d =
    typeof isoOrTimestamp === "number"
      ? new Date(isoOrTimestamp * 1000)
      : new Date(isoOrTimestamp);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RepoSkill {
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
  on_chain_address?: string;
  source?: "repo" | "chain";
  created_at: string;
  author_trust: TrustData | null;
}

type ReputationOracle = ReturnType<typeof useReputationOracle>;
type AgentProfileData = NonNullable<
  Awaited<ReturnType<ReputationOracle["getAgentProfile"]>>
>;
type VouchRecord = Awaited<
  ReturnType<ReputationOracle["getAllVouchesForAgent"]>
>[number];
type SkillListingRecord = Awaited<
  ReturnType<ReputationOracle["getSkillListingsByAuthor"]>
>[number];

export default function AuthorProfilePage() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pubkey = params.pubkey as string;

  const { wallet, status: walletStatus } = useWalletConnection();
  const connected = walletStatus === "connected" && !!wallet;
  const myPubkey = wallet?.account.address ?? null;
  const signMessage = wallet?.signMessage ?? null;
  const oracle = useReputationOracle();

  const [profile, setProfile] = useState<AgentProfileData | null>(null);
  const [vouchesReceived, setVouchesReceived] = useState<VouchRecord[]>([]);
  const [vouchesGiven, setVouchesGiven] = useState<VouchRecord[]>([]);
  const [repoSkills, setRepoSkills] = useState<RepoSkill[]>([]);
  const [chainSkills, setChainSkills] = useState<RepoSkill[]>([]);
  const [authorSkillListings, setAuthorSkillListings] = useState<
    SkillListingRecord[]
  >([]);
  const [authorTrust, setAuthorTrust] = useState<TrustData | null>(null);
  const [authorIdentity, setAuthorIdentity] =
    useState<AgentIdentitySummary | null>(null);
  const [authorDisputes, setAuthorDisputes] = useState<AuthorDisputeRecord[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [vouchAmount, setVouchAmount] = useState("0.1");
  const [vouching, setVouching] = useState(false);
  const [vouchStatus, setVouchStatus] = useState("");
  const [vouchTx, setVouchTx] = useState<string | null>(null);
  const [myProfile, setMyProfile] = useState<AgentProfileData | null>(null);
  const [myProfileLoading, setMyProfileLoading] = useState(false);
  const [myProfileChecked, setMyProfileChecked] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerStatus, setRegisterStatus] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [showProfileGate, setShowProfileGate] = useState(false);
  const [pendingVouchAfterRegister, setPendingVouchAfterRegister] =
    useState(false);
  const [registryProgramAddress, setRegistryProgramAddress] = useState("");
  const [registryAssetPubkey, setRegistryAssetPubkey] = useState("");
  const [operationalWalletPubkey, setOperationalWalletPubkey] = useState("");
  const [registryCandidates, setRegistryCandidates] = useState<
    SolanaRegistryCandidate[]
  >([]);
  const [discoveringRegistryCandidates, setDiscoveringRegistryCandidates] =
    useState(false);
  const [registryCandidatesLoaded, setRegistryCandidatesLoaded] =
    useState(false);
  const [showManualRegistryLink, setShowManualRegistryLink] = useState(false);
  const [registryLinkAuth, setRegistryLinkAuth] = useState<AuthPayload | null>(
    null
  );
  const [linkingIdentity, setLinkingIdentity] = useState(false);
  const [linkIdentityStatus, setLinkIdentityStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [profileAuthorityByPda, setProfileAuthorityByPda] = useState<
    Record<string, string>
  >({});
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimReason, setClaimReason] = useState("malicious-skill");
  const [claimSkillContext, setClaimSkillContext] = useState("");
  const [claimEvidenceUri, setClaimEvidenceUri] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimStatus, setClaimStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [claimRouteDismissed, setClaimRouteDismissed] = useState(false);
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [claimingRevenueListing, setClaimingRevenueListing] = useState<
    string | null
  >(null);
  const [claimRevenueStatus, setClaimRevenueStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [claimRevenueTx, setClaimRevenueTx] = useState<string | null>(null);
  const myProfileFetchId = useRef(0);

  const isOwnProfile = myPubkey === pubkey;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const agentAddr = address(pubkey);
      const [prof, received, given, onChainListings, repoRes, authorRes] =
        await Promise.all([
        oracle.getAgentProfile(agentAddr).catch(() => null),
        oracle.getAllVouchesReceivedByAgent(agentAddr).catch(() => []),
        oracle.getAllVouchesForAgent(agentAddr).catch(() => []),
        oracle.getSkillListingsByAuthor(agentAddr).catch(() => []),
        fetch(`/api/skills?author=${pubkey}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
          fetch(`/api/author/${pubkey}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);
      const relatedProfileKeys = Array.from(
        new Set(
          [
            ...received.map((vouch) => String(vouch.account.voucher ?? "")),
            ...given.map((vouch) => String(vouch.account.vouchee ?? "")),
          ].filter(Boolean)
        )
      );
      const relatedProfiles = await Promise.all(
        relatedProfileKeys.map(async (profileKey) => {
          const relatedProfile = await oracle
            .getAgentProfileByAddress(address(profileKey))
            .catch(() => null);
          return [
            profileKey,
            relatedProfile?.authority ? String(relatedProfile.authority) : null,
          ] as const;
        })
      );
      const nextProfileAuthorityByPda = relatedProfiles.reduce<
        Record<string, string>
      >((acc, [profileKey, authority]) => {
        if (authority) acc[profileKey] = authority;
        return acc;
      }, {});
      setProfile(prof);
      setVouchesReceived(received);
      setVouchesGiven(given);
      setAuthorSkillListings(onChainListings);
      const apiSkills = (repoRes?.skills ?? []) as RepoSkill[];
      setRepoSkills(apiSkills.filter((skill) => skill.source !== "chain"));
      setChainSkills(apiSkills.filter((skill) => skill.source === "chain"));
      setAuthorTrust(authorRes?.author_trust ?? null);
      setAuthorIdentity(authorRes?.author_identity ?? null);
      setAuthorDisputes(authorRes?.author_disputes ?? []);
      setProfileAuthorityByPda(nextProfileAuthorityByPda);
    } catch (e) {
      console.error("Failed to load author profile:", e);
      setAuthorTrust(null);
      setAuthorDisputes([]);
      setProfileAuthorityByPda({});
    } finally {
      setLoading(false);
    }
    // oracle is intentionally omitted — it changes reference every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!connected || !myPubkey || isOwnProfile) {
      setMyProfile(null);
      setMyProfileLoading(false);
      setMyProfileChecked(false);
      return;
    }

    const fetchId = ++myProfileFetchId.current;
    setMyProfileLoading(true);
    setMyProfileChecked(false);
    oracle
      .getAgentProfile(address(myPubkey))
      .then((agentProfile) => {
        if (fetchId === myProfileFetchId.current) setMyProfile(agentProfile);
      })
      .catch(() => {
        if (fetchId === myProfileFetchId.current) setMyProfile(null);
      })
      .finally(() => {
        if (fetchId === myProfileFetchId.current) {
          setMyProfileLoading(false);
          setMyProfileChecked(true);
        }
      });
    // oracle is intentionally omitted — it changes reference every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, myPubkey, isOwnProfile]);

  useEffect(() => {
    setRegistryLinkAuth(null);
    setRegistryCandidates([]);
    setRegistryCandidatesLoaded(false);
    setLinkIdentityStatus(null);
  }, [myPubkey, pubkey]);

  const copyPubkey = () => {
    navigator.clipboard.writeText(pubkey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const submitVouch = useCallback(async () => {
    if (!connected) return;
    const amount = parseFloat(vouchAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setVouchStatus("Error: Enter a valid stake amount in USDC.");
      setVouchTx(null);
      setPendingVouchAfterRegister(false);
      return;
    }

    setVouching(true);
    setVouchStatus("Creating vouch...");
    setVouchTx(null);
    try {
      const { tx } = await oracle.vouch(address(pubkey), amount);
      setVouchStatus("Vouch created!");
      setVouchTx(tx);
      setTimeout(loadData, 2000);
    } catch (error: unknown) {
      setVouchStatus(`Error: ${getErrorMessage(error)}`);
      setVouchTx(null);
    } finally {
      setVouching(false);
      setPendingVouchAfterRegister(false);
    }
  }, [connected, loadData, oracle, pubkey, vouchAmount]);

  const waitForReadableProfile = useCallback(
    async (agentKey: Address, attempts = 8) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const viewerProfile = await oracle.getAgentProfile(agentKey);
        if (viewerProfile) return viewerProfile;
        await sleep(500 * (attempt + 1));
      }
      return null;
    },
    [oracle]
  );

  const handleVouch = async () => {
    if (!connected) {
      setVouchStatus("Connect your wallet to vouch for this author.");
      setVouchTx(null);
      return;
    }

    if (!myProfile) {
      setPendingVouchAfterRegister(true);
      setRegisterError(null);
      setShowProfileGate(true);
      return;
    }

    await submitVouch();
  };

  const handleRegister = async () => {
    if (!connected || !myPubkey) return;

    setRegistering(true);
    setRegisterStatus("Waiting for wallet confirmation…");
    setRegisterError(null);

    try {
      await oracle.registerAgent("");
      setRegisterStatus("Profile created on-chain. Finalizing registration…");

      const viewerProfile = await waitForReadableProfile(address(myPubkey));
      if (!viewerProfile) {
        throw new Error(
          "Profile transaction confirmed, but the account is not readable yet. Please wait a moment and try again."
        );
      }

      setMyProfile(viewerProfile);
      setMyProfileChecked(true);
      setShowProfileGate(false);

      if (pendingVouchAfterRegister) {
        setVouchStatus("Profile created. Waiting for vouch confirmation…");
        await sleep(800);
        await submitVouch();
      } else {
        setVouchStatus("Profile created. You can now vouch for this author.");
      }
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      const alreadyExists =
        /already in use|already exists|0x0|account already initialized/i.test(
          msg
        );

      if (alreadyExists) {
        setRegisterStatus("Profile already exists. Finalizing registration…");
        const viewerProfile = await waitForReadableProfile(
          address(myPubkey)
        ).catch(() => null);
        if (viewerProfile) {
          setMyProfile(viewerProfile);
          setMyProfileChecked(true);
          setShowProfileGate(false);
          if (pendingVouchAfterRegister) {
            setVouchStatus(
              "Profile already exists. Waiting for vouch confirmation…"
            );
            await sleep(800);
            await submitVouch();
          } else {
            setVouchStatus(
              "Profile already exists. You can now vouch for this author."
            );
          }
          return;
        }
      }

      setRegisterError(`Profile creation failed: ${msg}`);
    } finally {
      setRegisterStatus(null);
      setRegistering(false);
    }
  };

  const authorizeRegistryLinking =
    useCallback(async (): Promise<AuthPayload> => {
      if (!connected || !myPubkey || myPubkey !== pubkey || !signMessage) {
        throw new Error(
          "Connect the author wallet with message signing enabled to link registry identity."
        );
      }

      if (
        registryLinkAuth &&
        Date.now() - registryLinkAuth.timestamp < 4 * 60_000
      ) {
        return registryLinkAuth;
      }

      const timestamp = Date.now();
      const message = `AgentVouch Author Profile\nAction: author-registry-link\nAuthor: ${pubkey}\nTimestamp: ${timestamp}`;
      const sigBytes = await signMessage(new TextEncoder().encode(message));
      const auth = {
        pubkey: myPubkey,
        signature: encodeBase64(sigBytes),
        message,
        timestamp,
      };
      setRegistryLinkAuth(auth);
      return auth;
    }, [connected, myPubkey, pubkey, registryLinkAuth, signMessage]);

  const handleDiscoverRegistryIdentities = async () => {
    setDiscoveringRegistryCandidates(true);
    setLinkIdentityStatus(null);

    try {
      const auth = await authorizeRegistryLinking();
      const response = await fetch(`/api/author/${pubkey}/discover-registry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to discover registry identities");
      }

      const candidates = data.candidates ?? [];
      setRegistryCandidates(candidates);
      setRegistryCandidatesLoaded(true);
      setLinkIdentityStatus(
        candidates.length === 0
          ? {
              success: false,
              message:
                "No registry identities were found for this wallet on the configured Solana network.",
            }
          : null
      );
    } catch (error: unknown) {
      setRegistryCandidates([]);
      setRegistryCandidatesLoaded(true);
      setLinkIdentityStatus({
        success: false,
        message: getErrorMessage(
          error,
          "Failed to discover registry identities"
        ),
      });
    } finally {
      setDiscoveringRegistryCandidates(false);
    }
  };

  const handleLinkRegistryIdentity = async (
    candidate?: SolanaRegistryCandidate
  ) => {
    if (
      !candidate &&
      (!registryProgramAddress.trim() || !registryAssetPubkey.trim())
    ) {
      setLinkIdentityStatus({
        success: false,
        message:
          "Enter both the registry program address and registry asset pubkey.",
      });
      return;
    }

    setLinkingIdentity(true);
    setLinkIdentityStatus(null);

    try {
      const auth = await authorizeRegistryLinking();
      const response = await fetch(`/api/author/${pubkey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          candidate
            ? {
                auth,
                selected_registry_asset_pubkey: candidate.coreAssetPubkey,
              }
            : {
                auth,
                registry_address: registryProgramAddress.trim(),
                core_asset_pubkey: registryAssetPubkey.trim(),
                operational_wallet_pubkey:
                  operationalWalletPubkey.trim() || undefined,
              }
        ),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to link registry identity");
      }

      setAuthorIdentity(data.author_identity ?? null);
      setLinkIdentityStatus({
        success: true,
        message: "Registry identity linked.",
      });
      setShowManualRegistryLink(false);
    } catch (error: unknown) {
      setLinkIdentityStatus({
        success: false,
        message: getErrorMessage(error, "Failed to link registry identity"),
      });
    } finally {
      setLinkingIdentity(false);
    }
  };

  const totalOnChainDownloads = chainSkills.reduce(
    (sum, skill) => sum + (skill.total_downloads ?? 0),
    0
  );
  const totalRepoInstalls = repoSkills.reduce(
    (sum, s) => sum + (s.total_installs ?? 0) + (s.total_downloads ?? 0),
    0
  );
  const totalDownloads = totalOnChainDownloads + totalRepoInstalls;
  const totalRevenue = chainSkills.reduce(
    (sum, skill) => sum + (skill.total_revenue ?? 0),
    0
  );
  const skillsPublished =
    chainSkills.length +
    repoSkills.filter(
      (s) =>
        !s.on_chain_address ||
        !chainSkills.some((c) => c.on_chain_address === s.on_chain_address)
    ).length;

  const trustData: TrustData | null =
    authorTrust ??
    (profile
      ? {
          reputationScore: Number(profile.reputationScore ?? 0),
          totalVouchesReceived: Number(profile.totalVouchesReceived ?? 0),
          totalStakedFor: Number(profile.totalVouchStakeUsdcMicros ?? 0),
          authorBondLamports: Number(profile.authorBondUsdcMicros ?? 0),
          totalStakeAtRisk:
            Number(profile.totalVouchStakeUsdcMicros ?? 0) +
            Number(profile.authorBondUsdcMicros ?? 0),
          disputesAgainstAuthor: 0,
          disputesUpheldAgainstAuthor: 0,
          activeDisputesAgainstAuthor: 0,
          registeredAt: Number(profile.registeredAt ?? 0),
          isRegistered: true,
        }
      : null);

  const authorWideBackingVouches = vouchesReceived.filter((vouch) =>
    countsTowardAuthorWideReportSnapshot(vouch.account.status)
  );
  const viewerVouch = useMemo(() => {
    if (!myPubkey) return null;
    return (
      vouchesReceived.find(
        (vouch) => profileAuthorityByPda[String(vouch.account.voucher)] === myPubkey
      ) ?? null
    );
  }, [myPubkey, profileAuthorityByPda, vouchesReceived]);
  const viewerVouchIsActive =
    viewerVouch?.account.status === VouchStatus.Active;
  const claimableVoucherRevenue = useMemo(() => {
    if (!viewerVouch || !viewerVouchIsActive || !profile) {
      return [];
    }

    const totalStaked = BigInt(profile.totalVouchStakeUsdcMicros ?? 0);
    const voucherStake = BigInt(viewerVouch.account.stakeUsdcMicros ?? 0);

    return authorSkillListings
      .map((listing) => {
        const listingAddress = String(listing.publicKey);
        const unclaimedRevenueUsdcMicros = BigInt(
          listing.account.unclaimedVoucherRevenueUsdcMicros ?? 0
        );
        const estimatedShareUsdcMicros =
          totalStaked > 0n
            ? (unclaimedRevenueUsdcMicros * voucherStake) / totalStaked
            : 0n;
        const matchedSkill =
          repoSkills.find(
            (skill) => skill.on_chain_address === listingAddress
          ) ??
          chainSkills.find((skill) => skill.on_chain_address === listingAddress);

        return {
          listingAddress,
          name:
            matchedSkill?.name ??
            listing.account.name ??
            `Skill ${shortAddr(listingAddress)}`,
          listingLamports: listing.lamports,
          unclaimedRevenueUsdcMicros: Number(unclaimedRevenueUsdcMicros),
          estimatedShareUsdcMicros: Number(estimatedShareUsdcMicros),
          accountingMismatch: false,
        };
      })
      .filter((listing) => listing.unclaimedRevenueUsdcMicros > 0);
  }, [
    authorSkillListings,
    chainSkills,
    profile,
    repoSkills,
    viewerVouch,
    viewerVouchIsActive,
  ]);
  const claimSkillOptions = useMemo(
    () => [
      ...repoSkills
        .filter((skill) => !!skill.on_chain_address)
        .map((skill) => ({
          value: `skill:${skill.on_chain_address}`,
          label: skill.name,
        })),
      ...chainSkills
        .filter(
          (skill) =>
            !!skill.on_chain_address &&
            !repoSkills.some(
              (repoSkill) =>
                repoSkill.on_chain_address === skill.on_chain_address
            )
        )
        .map((skill) => ({
          value: `skill:${skill.on_chain_address}`,
          label:
            skill.name ||
            `On-chain skill ${shortAddr(String(skill.on_chain_address ?? ""))}`,
        })),
    ],
    [chainSkills, repoSkills]
  );
  const selectedClaimSkillLabel = claimSkillOptions.find(
    (skill) => skill.value === claimSkillContext
  )?.label;
  const selectedClaimSkillValue =
    claimSkillOptions.find((skill) => skill.value === claimSkillContext)
      ?.value ??
    claimSkillOptions[0]?.value ??
    "";
  const registeredAt = Number(profile?.registeredAt ?? 0);

  const clearClaimRouteParams = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    const hadClaimRoute =
      nextParams.has("report") || nextParams.has("skill");
    if (!hadClaimRoute) return;

    nextParams.delete("report");
    nextParams.delete("skill");
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [pathname, router, searchParams]);

  const openClaimModal = useCallback(() => {
    setClaimRouteDismissed(false);
    const requestedSkill = searchParams.get("skill") ?? "";
    const nextSkill = claimSkillOptions.some(
      (skill) => skill.value === requestedSkill
    )
      ? requestedSkill
      : claimSkillOptions[0]?.value ?? "";
    setClaimStatus(null);
    setClaimTx(null);
    setClaimReason("malicious-skill");
    setClaimSkillContext(nextSkill);
    setClaimEvidenceUri("");
    setShowClaimModal(true);
  }, [claimSkillOptions, searchParams]);

  const closeClaimModal = useCallback(() => {
    if (claiming) return;
    setClaimRouteDismissed(true);
    setShowClaimModal(false);
    clearClaimRouteParams();
  }, [claiming, clearClaimRouteParams]);

  const handleClaimVoucherRevenue = useCallback(
    async (skillListingAddress: string) => {
      if (!connected) {
        setClaimRevenueStatus({
          success: false,
          message: "Connect your wallet to claim voucher revenue.",
        });
        setClaimRevenueTx(null);
        return;
      }

      setClaimingRevenueListing(skillListingAddress);
      setClaimRevenueStatus(null);
      setClaimRevenueTx(null);

      try {
        const { tx } = await oracle.claimVoucherRevenue(
          address(skillListingAddress),
          address(pubkey)
        );
        setClaimRevenueStatus({
          success: true,
          message: "Voucher revenue claimed.",
        });
        setClaimRevenueTx(tx);
        setTimeout(loadData, 2000);
      } catch (error: unknown) {
        const message = getErrorMessage(error, "Failed to claim voucher revenue.");
        setClaimRevenueStatus({
          success: false,
          message: /Insufficient funds in skill listing/i.test(message)
            ? "This listing's recorded voucher revenue is higher than its actual on-chain balance, so the claim would fail. This looks like stale devnet accounting on an older listing."
            : message,
        });
        setClaimRevenueTx(null);
      } finally {
        setClaimingRevenueListing(null);
      }
    },
    [connected, loadData, oracle, pubkey]
  );

  const handleSubmitClaim = async () => {
    if (!connected) {
      setClaimStatus({
        success: false,
        message: "Connect your wallet to report this author.",
      });
      setClaimTx(null);
      return;
    }

    const evidenceUri = claimEvidenceUri.trim();
    if (!evidenceUri) {
      setClaimStatus({
        success: false,
        message: "Add an evidence URI for this report.",
      });
      setClaimTx(null);
      return;
    }

    if (!selectedClaimSkillValue) {
      setClaimStatus({
        success: false,
        message: "Choose the listed skill this report is about.",
      });
      setClaimTx(null);
      return;
    }

    if (evidenceUri.length > 200) {
      setClaimStatus({
        success: false,
        message: "Evidence URI must be 200 characters or fewer.",
      });
      setClaimTx(null);
      return;
    }

    setClaiming(true);
    setClaimStatus(null);
    setClaimTx(null);

    try {
      const selectedSkillListing = address(
        selectedClaimSkillValue.slice("skill:".length)
      );
      const reason =
        claimReason === "fraudulent-claims"
          ? AuthorDisputeReason.FraudulentClaims
          : claimReason === "failed-delivery"
          ? AuthorDisputeReason.FailedDelivery
          : claimReason === "other"
          ? AuthorDisputeReason.Other
          : AuthorDisputeReason.MaliciousSkill;
      const { tx } = await oracle.openAuthorDispute(address(pubkey), {
        reason,
        evidenceUri,
        skillListing: selectedSkillListing,
      });
      const contextLabel = selectedClaimSkillLabel
        ? ` for ${selectedClaimSkillLabel}`
        : "";
      setClaimStatus({
        success: true,
        message: `Report opened${contextLabel}. Free-skill disputes snapshot voucher backing for transparency but cap slashing at author bond; paid-skill disputes can continue into vouchers after author bond.`,
      });
      setClaimTx(tx);
      setClaimRouteDismissed(true);
      setShowClaimModal(false);
      clearClaimRouteParams();
      setClaimReason("malicious-skill");
      setClaimSkillContext("");
      setClaimEvidenceUri("");
      setTimeout(loadData, 2000);
    } catch (error: unknown) {
      setClaimStatus({
        success: false,
        message: getErrorMessage(error, "Failed to open report."),
      });
      setClaimTx(null);
    } finally {
      setClaiming(false);
    }
  };

  useEffect(() => {
    if (!profile || isOwnProfile) return;
    if (searchParams.get("report") !== "1") return;
    if (claimRouteDismissed) return;
    if (showClaimModal) return;
    openClaimModal();
  }, [
    claimRouteDismissed,
    isOwnProfile,
    openClaimModal,
    profile,
    searchParams,
    showClaimModal,
  ]);

  useEffect(() => {
    if (searchParams.get("report") !== "1") {
      setClaimRouteDismissed(false);
    }
  }, [searchParams]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <div className="animate-pulse text-gray-400 dark:text-gray-500">
            Loading author profile...
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {showProfileGate &&
          connected &&
          !myProfileLoading &&
          !myProfile &&
          !isOwnProfile && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="relative">
                <button
                  onClick={() => {
                    setShowProfileGate(false);
                    setPendingVouchAfterRegister(false);
                  }}
                  className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 z-10"
                >
                  <FiX className="w-4 h-4" />
                </button>
                <AgentProfileSetupCard
                  registering={registering}
                  status={registerStatus}
                  onRegister={handleRegister}
                  error={registerError}
                  title="Create your profile to vouch"
                  description="Before you stake behind an author you trust, set up your on-chain profile. This one-time step links your wallet to the reputation system, then returns you straight to vouching."
                  primaryStepLabel="Create profile"
                  secondaryStepLabel="Vouch"
                  className="max-w-md mx-auto"
                />
              </div>
            </div>
          )}

        {showClaimModal && !isOwnProfile && profile && (
          <div
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            role="presentation"
            onClick={closeClaimModal}
          >
            <div
              className="relative w-full max-w-2xl rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="report-author-title"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={closeClaimModal}
                aria-label="Close report dialog"
                className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <FiX className="w-4 h-4" />
              </button>

              <div className="mb-5 pr-8">
                <h2
                  id="report-author-title"
                  className="text-xl font-heading font-bold text-gray-900 dark:text-white"
                >
                  Report this author
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Open a skill-linked author dispute. The protocol always
                  snapshots the author&apos;s current backing set for
                  visibility. Free-skill disputes cap slashing at author bond;
                  paid-skill disputes can continue into vouchers after author
                  bond.
                </p>
              </div>

              {!connected ? (
                <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-6 text-center">
                  <FiShield className="w-8 h-8 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Connect your wallet to report this author and post the
                    dispute bond.
                  </p>
                  <ClientWalletButton />
                </div>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Report reason
                      </label>
                      <select
                        value={claimReason}
                        onChange={(e) => setClaimReason(e.target.value)}
                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-gray-900 dark:focus:ring-white focus:border-transparent outline-none"
                      >
                        <option value="malicious-skill">
                          Malicious skill or payload
                        </option>
                        <option value="fraudulent-claims">
                          Fraudulent or deceptive claims
                        </option>
                        <option value="failed-delivery">
                          Paid skill failed to deliver
                        </option>
                        <option value="other">Other misconduct</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Related skill
                      </label>
                      <select
                        value={claimSkillContext}
                        onChange={(e) => setClaimSkillContext(e.target.value)}
                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-gray-900 dark:focus:ring-white focus:border-transparent outline-none"
                      >
                        {claimSkillOptions.map((skill) => (
                          <option key={skill.value} value={skill.value}>
                            {skill.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Author-wide backing snapshot
                      </label>
                      <div className="rounded-sm border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4 space-y-2">
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          This report records the offending listed skill and the
                          author&apos;s full backing snapshot. You cannot choose
                          individual backers.
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {authorWideBackingVouches.length > 0
                            ? `The protocol will snapshot ${
                                authorWideBackingVouches.length
                              } current backing ${
                                authorWideBackingVouches.length === 1
                                  ? "voucher"
                                  : "vouchers"
                              } when you open the report. Free-skill disputes keep that snapshot for transparency only; paid-skill disputes may also slash it after author bond.`
                            : "This author has no live backing vouchers right now, so only author bond can be economically in scope."}
                        </p>
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Evidence URI
                      </label>
                      <input
                        type="url"
                        value={claimEvidenceUri}
                        onChange={(e) => setClaimEvidenceUri(e.target.value)}
                        placeholder="https://github.com/... or ipfs://..."
                        className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-gray-900 dark:focus:ring-white focus:border-transparent outline-none"
                      />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        The skill listing is required. Purchase is optional
                        evidence for delivery claims.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-sm border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-900/20 p-4">
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                      <span className="inline-flex items-center gap-1">
                        <FiAlertTriangle className="w-4 h-4" />
                      </span>{" "}
                      Opening a report posts the dispute bond. If the dispute is
                      dismissed, the bond may be forfeited.
                    </p>
                  </div>

                  {claimStatus && !claimStatus.success && (
                    <div className="mt-4 rounded-sm border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
                      <p className="text-sm text-red-700 dark:text-red-300">
                        {claimStatus.message}
                      </p>
                    </div>
                  )}

                  <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={closeClaimModal}
                      className={navButtonSecondaryInlineClass}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmitClaim}
                      disabled={claiming}
                      className={`sm:min-w-[13rem] ${navButtonPrimaryFlexClass}`}
                    >
                      {claiming ? "Opening report..." : "Open report"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <Link
              href="/skills"
              className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white transition"
            >
              <FiArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-2xl md:text-3xl font-heading font-bold text-gray-900 dark:text-white">
                Author Trust Record
              </h1>
              <button
                onClick={copyPubkey}
                className="flex items-center gap-1.5 font-mono text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition mt-1"
              >
                {shortAddr(pubkey)}
                {copied ? (
                  <FiCheck className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <FiCopy className="w-3.5 h-3.5" />
                )}
              </button>
              <p className="mt-3 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
                Review this author&apos;s on-chain trust record, backing stake,
                disputes, and published skills before giving them work, access,
                or payment. Need context? Read{" "}
                <Link
                  href="/docs/verify-ai-agents"
                  className="text-[var(--lobster-accent)] hover:underline"
                >
                  how to verify an AI agent
                </Link>
                .
              </p>
            </div>
          </div>
        </div>

        {/* Trust Badge */}
        {!profile ? (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6 text-center">
            <FiShield className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              This author is not registered on-chain yet.
            </p>
          </div>
        ) : (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
            <TrustBadge trust={trustData} />
            {registeredAt > 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 flex items-center gap-1">
                <FiCalendar className="w-3 h-3" />
                Member since {formatDate(registeredAt)}
              </p>
            )}
          </div>
        )}

        {authorDisputes.length > 0 && (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
            <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <FiAlertTriangle className="text-[var(--lobster-accent)]" />{" "}
              Author Disputes
            </h2>
            <div className="space-y-3">
              {authorDisputes.map((dispute) => (
                <div
                  key={dispute.publicKey}
                  className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
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
                  <div className="space-y-1 text-sm text-gray-500 dark:text-gray-400">
                    <p>Opened {formatDate(dispute.createdAt)}</p>
                    <p className="font-mono text-xs break-all">
                      Dispute: {dispute.publicKey}
                    </p>
                    <p className="font-mono text-xs break-all">
                      Evidence: {dispute.evidenceUri}
                    </p>
                    <p>Liability: {dispute.liabilityScopeLabel}</p>
                    <p>
                      Skill price at dispute open:{" "}
                      {formatUsdc(dispute.skillPriceUsdcMicrosSnapshot)} USDC
                    </p>
                    <p>
                      Snapshot scope: {dispute.linkedVouchCount} backing{" "}
                      {dispute.linkedVouchCount === 1 ? "voucher" : "vouchers"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {authorIdentity && (
          <div className="mb-6">
            <AgentIdentityPanel
              identity={authorIdentity}
              title={
                authorIdentity.registryAsset
                  ? "Registry Identity"
                  : "Author Identity"
              }
            />
          </div>
        )}

        {isOwnProfile && profile && (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
            <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-2">
              Link Solana Agent Registry
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Add a registry asset above your existing AgentProfile. Vouching,
              payouts, and authorization stay unchanged.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleDiscoverRegistryIdentities}
                disabled={
                  discoveringRegistryCandidates ||
                  linkingIdentity ||
                  !connected ||
                  !signMessage
                }
                className={navButtonPrimaryInlineClass}
              >
                {discoveringRegistryCandidates
                  ? "Finding identities..."
                  : "Find my registry identities"}
              </button>
              <button
                onClick={() => setShowManualRegistryLink((value) => !value)}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
              >
                {showManualRegistryLink
                  ? "Hide manual entry"
                  : "Enter manually instead"}
              </button>
              {!signMessage && (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  Wallet must support message signing.
                </span>
              )}
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
              One wallet signature authorizes discovery and linking for the next
              few minutes.
            </p>

            {registryCandidates.length > 0 && (
              <div className="mt-4 grid gap-3">
                {registryCandidates.map((candidate) => (
                  <div
                    key={candidate.coreAssetPubkey}
                    className="rounded-sm border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div>
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">
                            {candidate.displayName ||
                              `Agent ${shortAddr(candidate.coreAssetPubkey)}`}
                          </div>
                          {candidate.description && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {candidate.description}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400 font-mono">
                          <div>Asset: {candidate.coreAssetPubkey}</div>
                          <div>Owner: {candidate.ownerWallet}</div>
                          {candidate.operationalWallet && (
                            <div>
                              Operational: {candidate.operationalWallet}
                            </div>
                          )}
                        </div>

                        <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                          Match:{" "}
                          {candidate.matchType === "both"
                            ? "owner + operational wallet"
                            : candidate.matchType}
                        </div>
                      </div>

                      <button
                        onClick={() => handleLinkRegistryIdentity(candidate)}
                        disabled={linkingIdentity}
                        className={navButtonPrimaryInlineClass}
                      >
                        {linkingIdentity ? "Linking..." : "Link this identity"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {registryCandidatesLoaded &&
              registryCandidates.length === 0 &&
              !discoveringRegistryCandidates && (
                <div className="mt-4 rounded-sm border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No public registry identities were found for this wallet on
                    the configured Solana network.
                  </p>
                </div>
              )}

            {showManualRegistryLink && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Registry Program Address
                  </label>
                  <input
                    type="text"
                    value={registryProgramAddress}
                    onChange={(e) => setRegistryProgramAddress(e.target.value)}
                    placeholder="Agent registry program address"
                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-gray-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-gray-900 dark:focus:ring-white focus:border-transparent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Registry Asset Pubkey
                  </label>
                  <input
                    type="text"
                    value={registryAssetPubkey}
                    onChange={(e) => setRegistryAssetPubkey(e.target.value)}
                    placeholder="Metaplex Core asset pubkey"
                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-gray-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-gray-900 dark:focus:ring-white focus:border-transparent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Operational Wallet
                  </label>
                  <input
                    type="text"
                    value={operationalWalletPubkey}
                    onChange={(e) => setOperationalWalletPubkey(e.target.value)}
                    placeholder="Optional agent wallet"
                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-gray-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-gray-900 dark:focus:ring-white focus:border-transparent outline-none"
                  />
                </div>

                <div className="md:col-span-2">
                  <button
                    onClick={() => handleLinkRegistryIdentity()}
                    disabled={linkingIdentity || !connected || !signMessage}
                    className={navButtonPrimaryInlineClass}
                  >
                    {linkingIdentity
                      ? "Linking..."
                      : "Link registry identity manually"}
                  </button>
                </div>
              </div>
            )}

            {linkIdentityStatus && (
              <p
                className={`mt-3 text-sm ${
                  linkIdentityStatus.success
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {linkIdentityStatus.message}
              </p>
            )}
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            {
              label: "Skills Published",
              value: skillsPublished.toString(),
              icon: <FiPackage />,
            },
            {
              label: "Total Downloads",
              value: totalDownloads.toLocaleString(),
              icon: <FiDownload />,
            },
            {
              label: "Total Revenue",
              value: `${formatUsdc(totalRevenue)} USDC`,
              icon: <FiTrendingUp />,
            },
            {
              label: "Vouches Received",
              value: Number(
                profile?.totalVouchesReceived ?? vouchesReceived.length
              ).toString(),
              icon: <FiUsers />,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 text-center"
            >
              <div className="flex items-center justify-center text-[var(--lobster-accent)] mb-1">
                {stat.icon}
              </div>
              <div className="text-xl font-heading font-bold text-gray-900 dark:text-white">
                {stat.value}
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Vouch for this author */}
        {!isOwnProfile && (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
            <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <FiZap className="text-[var(--lobster-accent)]" /> Vouch for this
              Author
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Stake USDC behind this author&apos;s reputation. Vouchers earn 40%
              of author revenue.
            </p>

            {!profile ? (
              <div className="rounded-sm border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-900/20 p-4">
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  This author needs an on-chain profile before anyone can vouch
                  for them.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Stake Amount (USDC)
                    </label>
                    <input
                      type="number"
                      value={vouchAmount}
                      onChange={(e) => setVouchAmount(e.target.value)}
                      min="0.01"
                      step="0.01"
                      className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-gray-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-gray-900 dark:focus:ring-white focus:border-transparent outline-none"
                    />
                  </div>

                  {!connected ? (
                    <div className="sm:self-end">
                      <ClientWalletButton />
                    </div>
                  ) : !myProfileChecked || myProfileLoading ? (
                    <button
                      disabled
                      className={`sm:self-end opacity-70 cursor-wait ${navButtonPrimaryInlineClass}`}
                    >
                      <FiLoader className="w-4 h-4 animate-spin" />
                      Checking profile...
                    </button>
                  ) : !myProfile ? (
                    <button
                      onClick={handleVouch}
                      disabled={registering}
                      className={`sm:self-end ${navButtonPrimaryInlineClass}`}
                    >
                      {registering
                        ? "Preparing..."
                        : `Vouch with ${vouchAmount} USDC`}
                    </button>
                  ) : (
                    <button
                      onClick={handleVouch}
                      disabled={vouching}
                      className={`sm:self-end ${navButtonPrimaryInlineClass}`}
                    >
                      {vouching
                        ? "Vouching..."
                        : `Vouch with ${vouchAmount} USDC`}
                    </button>
                  )}
                </div>

                {connected && myProfileChecked && !myProfile && (
                  <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                    First vouch from this wallet? We&apos;ll ask you to create a
                    one-time on-chain profile, then continue to the vouch.
                  </p>
                )}
              </>
            )}

            {vouchStatus && (
              <div className="mt-3 space-y-1">
                <p
                  className={`text-sm ${
                    vouchStatus.includes("Error")
                      ? "text-red-600 dark:text-red-400"
                      : "text-green-600 dark:text-green-400"
                  }`}
                >
                  {vouchStatus}
                </p>
                {vouchTx && (
                  <a
                    href={getSolanaFmTxUrl(vouchTx)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-[var(--sea-accent)] hover:text-[var(--sea-accent-strong)] hover:underline"
                  >
                    View transaction on Solana FM
                    <FiExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {!isOwnProfile && connected && viewerVouch && (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
            <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <FiTrendingUp className="text-[var(--lobster-accent)]" /> Voucher
              Revenue
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              You are backing this author with{" "}
              {formatUsdc(viewerVouch.account.stakeUsdcMicros)} USDC.
              Claiming uses the existing on-chain `claim_voucher_revenue`
              instruction.
            </p>

            {!viewerVouchIsActive ? (
              <div className="rounded-sm border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-900/20 p-4">
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  This backing vouch is not active, so it is not eligible to
                  claim voucher revenue.
                </p>
              </div>
            ) : claimableVoucherRevenue.length === 0 ? (
              <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No claimable USDC voucher revenue is available for this
                  author&apos;s listings right now.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {claimableVoucherRevenue.map((listing) => (
                  <div
                    key={listing.listingAddress}
                    className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">
                          {listing.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono break-all">
                          Listing: {listing.listingAddress}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Unclaimed pool:{" "}
                          <span className="font-mono text-gray-900 dark:text-white">
                            {formatUsdc(listing.unclaimedRevenueUsdcMicros)} USDC
                          </span>
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Your estimated share:{" "}
                          <span className="font-mono text-gray-900 dark:text-white">
                            {formatUsdc(listing.estimatedShareUsdcMicros)} USDC
                          </span>
                        </div>
                        {listing.accountingMismatch && (
                          <div className="text-xs text-amber-700 dark:text-amber-300">
                            This listing&apos;s stored voucher revenue exceeds its
                            actual on-chain balance. Claiming would fail until
                            the devnet listing accounting is repaired.
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() =>
                          handleClaimVoucherRevenue(listing.listingAddress)
                        }
                        disabled={
                          claimingRevenueListing === listing.listingAddress ||
                          listing.estimatedShareUsdcMicros <= 0 ||
                          listing.accountingMismatch
                        }
                        className={navButtonPrimaryInlineClass}
                      >
                        {claimingRevenueListing === listing.listingAddress
                          ? "Claiming..."
                          : "Claim revenue"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {claimRevenueStatus && (
              <div
                className={`mt-4 rounded-sm border p-4 ${
                  claimRevenueStatus.success
                    ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20"
                    : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
                }`}
              >
                <div className="space-y-1">
                  <p
                    className={`text-sm ${
                      claimRevenueStatus.success
                        ? "text-green-700 dark:text-green-300"
                        : "text-red-700 dark:text-red-300"
                    }`}
                  >
                    {claimRevenueStatus.message}
                  </p>
                  {claimRevenueTx && (
                    <a
                      href={getSolanaFmTxUrl(claimRevenueTx)}
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
        )}

        {/* Skills */}
        <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
          <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <FiPackage className="text-[var(--lobster-accent)]" /> Published
            Skills
          </h2>

          {repoSkills.length === 0 && chainSkills.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No skills published yet.
            </p>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {repoSkills.map((skill) => {
                const downloads =
                  (skill.total_installs ?? 0) + (skill.total_downloads ?? 0);
                return (
                  <Link
                    key={skill.id}
                    href={`/skills/${skill.id}`}
                    className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition block"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-heading font-bold text-gray-900 dark:text-white text-sm truncate">
                        {skill.name}
                      </h3>
                      {skill.price_usdc_micros ? (
                        <span className="text-xs font-semibold text-gray-900 dark:text-white shrink-0">
                          {formatUsdc(skill.price_usdc_micros)} USDC
                        </span>
                      ) : skill.price_lamports && skill.price_lamports > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300 shrink-0">
                          Legacy SOL
                        </span>
                      ) : null}
                    </div>
                    {skill.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">
                        {skill.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                      <span className="flex items-center gap-1">
                        <FiDownload className="w-3 h-3" />
                        {downloads}
                      </span>
                      {skill.tags?.length > 0 && (
                        <span className="flex items-center gap-1">
                          <FiTag className="w-3 h-3" />
                          {skill.tags.slice(0, 2).join(", ")}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}

              {chainSkills
                .filter(
                  (c) =>
                    !repoSkills.some(
                      (r) => r.on_chain_address === c.on_chain_address
                    )
                )
                .map((skill) => {
                  const downloads = skill.total_downloads ?? 0;
                  const legacySolPrice = skill.price_lamports ?? 0;
                  const priceUsdcMicros = skill.price_usdc_micros ?? null;
                  return (
                    <Link
                      key={skill.id}
                      href={`/skills/${skill.id}`}
                      className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition block"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-heading font-bold text-gray-900 dark:text-white text-sm truncate">
                          {skill.name || "Untitled"}
                        </h3>
                        {priceUsdcMicros ? (
                          <span className="text-xs font-semibold text-gray-900 dark:text-white shrink-0">
                            {formatUsdc(priceUsdcMicros)} USDC
                          </span>
                        ) : legacySolPrice > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300 shrink-0">
                            Legacy SOL
                          </span>
                        ) : null}
                      </div>
                      {skill.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">
                          {skill.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                        <span className="flex items-center gap-1">
                          <FiDownload className="w-3 h-3" />
                          {downloads}
                        </span>
                        <span className="px-1.5 py-0.5 bg-[var(--lobster-accent-soft)] text-[var(--lobster-accent)] rounded text-[10px] font-medium">
                          on-chain
                        </span>
                      </div>
                    </Link>
                  );
                })}
            </div>
          )}
        </div>

        {/* Vouchers (who vouches for this author) */}
        {vouchesReceived.length > 0 && (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
            <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <FiUsers className="text-[var(--lobster-accent)]" /> Vouchers
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {vouchesReceived.length}{" "}
              {vouchesReceived.length === 1
                ? "backing voucher is"
                : "backing vouchers are"}{" "}
              currently recorded for this author.
            </p>
            <div className="space-y-2">
              {vouchesReceived.map((vouch) => {
                const voucherProfile = String(vouch.account.voucher);
                const voucherAuthority = profileAuthorityByPda[voucherProfile];
                const stakeAmount = vouch.account.stakeUsdcMicros;
                const statusLabel = getVouchStatusLabel(vouch.account.status);
                const includedInAuthorWideReports =
                  countsTowardAuthorWideReportSnapshot(vouch.account.status);
                return (
                  <div
                    key={vouch.publicKey}
                    className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {voucherAuthority ? (
                            <Link
                              href={`/author/${voucherAuthority}`}
                              className="font-mono text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
                            >
                              {shortAddr(voucherAuthority)}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                              {shortAddr(voucherProfile)}
                            </span>
                          )}
                          <span className="rounded-full bg-gray-200/70 dark:bg-gray-700/70 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:text-gray-300">
                            {statusLabel}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500">
                          Voucher profile:{" "}
                          <span className="font-mono">
                            {shortAddr(voucherProfile)}
                          </span>
                        </p>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono break-all">
                          Vouch account: {vouch.publicKey}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <span className="text-sm font-bold text-green-600 dark:text-green-400 font-mono">
                          {formatUsdc(stakeAmount)} USDC
                        </span>
                        {includedInAuthorWideReports && !isOwnProfile && (
                          <span className="text-[11px] text-gray-400 dark:text-gray-500 text-right max-w-[11rem]">
                            Included automatically in author-wide reports while
                            this backing stays live.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Vouching for (who this author vouches for) */}
        {vouchesGiven.length > 0 && (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
            <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <FiZap className="text-[var(--lobster-accent)]" /> Vouching For
            </h2>
            <div className="space-y-2">
              {vouchesGiven.map((vouch) => {
                const voucheeProfile = String(vouch.account.vouchee);
                const voucheeAuthority = profileAuthorityByPda[voucheeProfile];
                const stakeAmount = vouch.account.stakeUsdcMicros;
                const statusLabel = getVouchStatusLabel(vouch.account.status);
                return (
                  <div
                    key={vouch.publicKey}
                    className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {voucheeAuthority ? (
                            <Link
                              href={`/author/${voucheeAuthority}`}
                              className="font-mono text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
                            >
                              {shortAddr(voucheeAuthority)}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                              {shortAddr(voucheeProfile)}
                            </span>
                          )}
                          <span className="rounded-full bg-gray-200/70 dark:bg-gray-700/70 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:text-gray-300">
                            {statusLabel}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500">
                          Vouchee profile:{" "}
                          <span className="font-mono">
                            {shortAddr(voucheeProfile)}
                          </span>
                        </p>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono break-all">
                          Vouch account: {vouch.publicKey}
                        </p>
                      </div>

                      <span className="text-sm font-bold text-green-600 dark:text-green-400 font-mono">
                        {formatUsdc(stakeAmount)} USDC
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!isOwnProfile && profile && (
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <h2 className="text-lg font-heading font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <FiShield className="text-[var(--lobster-accent)]" /> Report
                  this author
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Open a skill-linked author dispute. The protocol records the
                  disputed listing and snapshots the author&apos;s live voucher
                  backing automatically for visibility.
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {claimSkillOptions.length === 0
                    ? "This author has no on-chain skill listings to dispute yet."
                    : authorWideBackingVouches.length > 0
                    ? `${authorWideBackingVouches.length} live backing ${
                        authorWideBackingVouches.length === 1
                          ? "voucher is"
                          : "vouchers are"
                      } snapshotted for each report. Free-skill disputes cap slashing at author bond; paid-skill disputes may continue into vouchers after author bond.`
                    : "No live backing vouchers are currently recorded, so only author bond can be economically in scope."}
                </p>
              </div>

              <button
                onClick={() => openClaimModal()}
                disabled={claimSkillOptions.length === 0}
                className={navButtonPrimaryInlineClass}
              >
                <FiFlag className="w-4 h-4" />
                Report
              </button>
            </div>

            {claimStatus && (
              <div
                className={`mt-4 rounded-sm border p-4 ${
                  claimStatus.success
                    ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20"
                    : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
                }`}
              >
                <div className="space-y-1">
                  <p
                    className={`text-sm ${
                      claimStatus.success
                        ? "text-green-700 dark:text-green-300"
                        : "text-red-700 dark:text-red-300"
                    }`}
                  >
                    {claimStatus.message}
                  </p>
                  {claimTx && (
                    <a
                      href={getSolanaFmTxUrl(claimTx)}
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
        )}
      </div>
    </main>
  );
}
