"use client";

import { Suspense, useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AgentProfileSetupCard } from "@/components/AgentProfileSetupCard";
import { useAgentVouchWallet } from "@/components/WalletContextProvider";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { UsdcIcon } from "@/components/UsdcIcon";
import { encodeBase64 } from "@/lib/base64";
import {
  navButtonPrimaryInlineClass,
  navButtonSecondaryInlineClass,
} from "@/lib/buttonStyles";
import {
  deriveDraftMetadataFromContent,
  finalizeSlug,
  normalizeSkillContact,
  normalizeSkillDescription,
  normalizeSkillName,
  slugify,
} from "@/lib/skillDraft";
import { getPublicSkillPath } from "@/lib/skillUrls";
import { useReputationOracle } from "@/hooks/useReputationOracle";
import { useAgentVouchTransactionSigner } from "@/hooks/useAgentVouchTransactionSigner";
import { formatMinPrice, isValidListingPriceMicros } from "@/lib/pricing";
import { getErrorMessage } from "@/lib/errors";
import {
  FiUpload,
  FiEye,
  FiEdit3,
  FiTag,
  FiLoader,
  FiCheckCircle,
  FiXCircle,
  FiX,
  FiDollarSign,
  FiGithub,
} from "react-icons/fi";
import type { Address } from "@solana/kit";

type ReputationOracle = ReturnType<typeof useReputationOracle>;
type AgentProfileData = NonNullable<
  Awaited<ReturnType<ReputationOracle["getAgentProfile"]>>
>;
type GithubPublisherSession = {
  authenticated: boolean;
  user: {
    provider: "github";
    id: string;
    login: string;
    name: string | null;
    avatarUrl: string | null;
  } | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseUsdcPriceToMicros(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    return null;
  }

  const [wholePart, fractionalPart = ""] = normalized.split(".");
  const micros = `${wholePart}${fractionalPart.padEnd(6, "0")}`.replace(
    /^0+(?=\d)/,
    ""
  );

  if (!micros || BigInt(micros) <= 0n) {
    return null;
  }

  return micros;
}

function isValidFreeOrPaidUsdcPrice(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) return false;
  return true;
}

function getUploadRelativePath(file: File): string {
  const raw =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name;
  const parts = raw.split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join("/") : raw;
}

function PublishReadiness({
  connected,
  githubConnected,
  isPaidPublish,
  profileLoading,
  hasProfile,
  hasContent,
  hasName,
  hasSkillId,
}: {
  connected: boolean;
  githubConnected: boolean;
  isPaidPublish: boolean;
  profileLoading: boolean;
  hasProfile: boolean;
  hasContent: boolean;
  hasName: boolean;
  hasSkillId: boolean;
}) {
  if (isPaidPublish && !connected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
        Connect wallet for paid publishing
      </span>
    );
  }

  if (!isPaidPublish && !connected && !githubConnected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
        Sign in with GitHub or connect wallet
      </span>
    );
  }

  if (isPaidPublish && profileLoading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
        <FiLoader className="w-3 h-3 animate-spin" />
        Checking profile…
      </span>
    );
  }

  const issues: string[] = [];
  if (!hasContent) issues.push("skill content");
  if (!hasName) issues.push("name");
  if (!hasSkillId) issues.push("skill ID");
  if (isPaidPublish && !hasProfile) issues.push("author profile");

  if (issues.length > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Needs {issues.join(", ")}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
      <FiCheckCircle className="w-3 h-3" />
      Ready to publish
    </span>
  );
}

export default function PublishSkillPage() {
  return (
    <Suspense>
      <PublishSkillPageInner />
    </Suspense>
  );
}

function PublishSkillPageInner() {
  const { status, account } = useAgentVouchWallet();
  const { signMessage } = useAgentVouchTransactionSigner();
  const connected = status === "connected" && !!account;
  const publicKey = account ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const oracle = useReputationOracle();

  const [content, setContent] = useState("");
  const [treeFiles, setTreeFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [skillId, setSkillId] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>(() => {
    const initial = searchParams.get("tag");
    return initial ? [initial.toLowerCase()] : [];
  });
  const [tagInput, setTagInput] = useState("");
  const [contact, setContact] = useState("");
  const [usdcPrice, setUsdcPrice] = useState("0");
  const [showPreview, setShowPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishStep, setPublishStep] = useState<"idle" | "repo" | "chain">(
    "idle"
  );
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    id?: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [agentProfile, setAgentProfile] = useState<AgentProfileData | null>(
    null
  );
  const [githubSession, setGithubSession] =
    useState<GithubPublisherSession | null>(null);
  const [githubLoading, setGithubLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileChecked, setProfileChecked] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerStatus, setRegisterStatus] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [showProfileGate, setShowProfileGate] = useState(false);
  const [pendingPublishAfterRegister, setPendingPublishAfterRegister] =
    useState(false);
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [skillIdManuallyEdited, setSkillIdManuallyEdited] = useState(false);
  const [descriptionManuallyEdited, setDescriptionManuallyEdited] =
    useState(false);
  const profileFetchId = useRef(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const parsedUsdcPriceMicros = parseUsdcPriceToMicros(usdcPrice);
  const priceIsValid = isValidFreeOrPaidUsdcPrice(usdcPrice);
  const isPaidPublish = Boolean(parsedUsdcPriceMicros);
  const githubUser = githubSession?.user ?? null;
  const githubConnected = Boolean(githubSession?.authenticated && githubUser);
  const hasPublisherAuth = connected || githubConnected;
  const showInlineResult =
    !!result &&
    !(
      showProfileGate &&
      !result.success &&
      /author profile/i.test(result.message)
    );

  useEffect(() => {
    if (!connected || !publicKey) {
      setAgentProfile(null);
      setProfileLoading(false);
      setProfileChecked(false);
      return;
    }
    const fetchId = ++profileFetchId.current;
    setProfileLoading(true);
    oracle
      .getAgentProfile(publicKey)
      .then((p) => {
        if (fetchId === profileFetchId.current) setAgentProfile(p);
      })
      .catch(() => {
        if (fetchId === profileFetchId.current) setAgentProfile(null);
      })
      .finally(() => {
        if (fetchId === profileFetchId.current) {
          setProfileLoading(false);
          setProfileChecked(true);
          setResult((prev) =>
            prev &&
            !prev.success &&
            /author profile|Checking your author/i.test(prev.message)
              ? null
              : prev
          );
        }
      });
  }, [connected, oracle, publicKey]);

  useEffect(() => {
    let cancelled = false;
    setGithubLoading(true);
    fetch("/api/auth/github/session", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: GithubPublisherSession | null) => {
        if (!cancelled) setGithubSession(data);
      })
      .catch(() => {
        if (!cancelled) setGithubSession(null);
      })
      .finally(() => {
        if (!cancelled) setGithubLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function publishSkill(skipProfileCheck = false) {
    const cleanId = finalizeSlug(skillId);
    const cleanName = normalizeSkillName(name);
    const cleanDescription = normalizeSkillDescription(description);
    const cleanContact = normalizeSkillContact(contact);
    setSkillId(cleanId);
    setName(cleanName);
    setDescription(cleanDescription);
    setContact(cleanContact);
    if (!cleanId || !cleanName || !content) {
      setResult({
        success: false,
        message: "Skill ID, name, and content are required",
      });
      return;
    }

    if (!hasPublisherAuth) {
      setResult({
        success: false,
        message:
          "Sign in with GitHub or connect a wallet to publish this free skill.",
      });
      return;
    }

    if (!priceIsValid) {
      setResult({
        success: false,
        message: "USDC price must be 0 or a paid amount with up to 6 decimals.",
      });
      return;
    }
    const usdcPriceMicros = parsedUsdcPriceMicros;
    const onChainPriceUsdcMicros = usdcPriceMicros
      ? Number(usdcPriceMicros)
      : 0;

    if (usdcPriceMicros && !isValidListingPriceMicros(onChainPriceUsdcMicros)) {
      setResult({
        success: false,
        message: `On-chain USDC price must be 0 for a free listing or at least ${formatMinPrice()}.`,
      });
      return;
    }

    if (usdcPriceMicros && (!connected || !publicKey || !signMessage)) {
      setResult({
        success: false,
        message: "Connect a wallet to publish a paid marketplace listing.",
      });
      return;
    }

    if (
      usdcPriceMicros &&
      !skipProfileCheck &&
      (!profileChecked || profileLoading)
    ) {
      setResult(null);
      return;
    }

    if (usdcPriceMicros && !skipProfileCheck && !agentProfile) {
      setPendingPublishAfterRegister(true);
      setShowProfileGate(true);
      setResult(null);
      return;
    }

    setPublishing(true);
    setPublishStep("repo");
    setResult(null);

    try {
      let auth:
        | {
            pubkey: string;
            signature: string;
            message: string;
            timestamp: number;
          }
        | undefined;
      if (connected && publicKey && signMessage) {
        const timestamp = Date.now();
        const message = `AgentVouch Skill Repo\nAction: publish-skill\nTimestamp: ${timestamp}`;
        const messageBytes = new TextEncoder().encode(message);
        const signatureBytes = await signMessage(messageBytes);
        const signature = encodeBase64(signatureBytes);
        auth = { pubkey: publicKey, signature, message, timestamp };
      }

      const payload = {
        ...(auth ? { auth } : {}),
        skill_id: cleanId,
        name: cleanName,
        description: cleanDescription,
        tags,
        content,
        contact: cleanContact || undefined,
        price_usdc_micros: usdcPriceMicros ?? "0",
      };
      const res =
        treeFiles.length > 0
          ? await fetch("/api/skills", {
              method: "POST",
              body: (() => {
                const form = new FormData();
                for (const [key, value] of Object.entries(payload)) {
                  if (value === undefined) continue;
                  form.set(
                    key,
                    typeof value === "string" ? value : JSON.stringify(value)
                  );
                }
                for (const file of treeFiles) {
                  form.append("files", file, getUploadRelativePath(file));
                }
                return form;
              })(),
            })
          : await fetch("/api/skills", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

      const data = await res.json();

      if (!res.ok) {
        setResult({
          success: false,
          message: data.error || "Failed to publish",
        });
        return;
      }

      const skillDbId: string = data.id;
      const publicSkillPath = getPublicSkillPath(data);
      const ipfsCid: string | null = data.ipfs_cid;
      const skillUri = ipfsCid
        ? `${window.location.origin}/api/skills/${skillDbId}/raw`
        : "";

      if (!usdcPriceMicros) {
        setResult({
          success: true,
          message:
            "Free skill published. It will appear as unverified until you link a wallet or add protocol backing.",
          id: skillDbId,
        });
        setTimeout(() => router.push(publicSkillPath), 1500);
        return;
      }

      setPublishStep("chain");
      const paidAuthorPubkey = publicKey!;
      const paidSignMessage = signMessage!;
      try {
        await oracle.createSkillListing(
          cleanId,
          skillUri,
          cleanName,
          cleanDescription,
          onChainPriceUsdcMicros
        );

        const onChainAddress = await oracle.getSkillListingPDA(
          paidAuthorPubkey as Address,
          cleanId
        );

        const patchTimestamp = Date.now();
        const patchMessage = `AgentVouch Skill Repo\nAction: publish-skill\nTimestamp: ${patchTimestamp}`;
        const patchMsgBytes = new TextEncoder().encode(patchMessage);
        const patchSigBytes = await paidSignMessage(patchMsgBytes);
        const patchSignature = encodeBase64(patchSigBytes);

        const patchRes = await fetch(`/api/skills/${skillDbId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth: {
              pubkey: paidAuthorPubkey,
              signature: patchSignature,
              message: patchMessage,
              timestamp: patchTimestamp,
            },
            on_chain_address: onChainAddress,
          }),
        });

        if (!patchRes.ok) {
          const patchData = await patchRes.json().catch(() => null);
          throw new Error(
            patchData?.error ||
              "Skill saved, but failed to link the on-chain listing"
          );
        }
      } catch (error: unknown) {
        setResult({
          success: true,
          message: `Skill saved to repo — on-chain listing failed: ${getErrorMessage(
            error
          )}. Visit the skill page to retry.`,
          id: skillDbId,
        });
        setTimeout(() => router.push(publicSkillPath), 3000);
        return;
      }

      setResult({
        success: true,
        message: `Skill published with ${usdcPriceMicros} USDC micros as the on-chain price.`,
        id: skillDbId,
      });

      setTimeout(() => router.push(publicSkillPath), 1500);
    } catch (error: unknown) {
      setResult({ success: false, message: getErrorMessage(error) });
    } finally {
      setPublishing(false);
      setPublishStep("idle");
      setPendingPublishAfterRegister(false);
    }
  }

  const waitForReadableProfile = useCallback(
    async (agentKey: Address, attempts = 8) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const profile = await oracle.getAgentProfile(agentKey);
        if (profile) return profile;
        await sleep(500 * (attempt + 1));
      }
      return null;
    },
    [oracle]
  );

  const handleRegister = async () => {
    if (!connected || !publicKey) return;
    setRegistering(true);
    setRegisterStatus("Waiting for wallet confirmation…");
    setRegisterError(null);
    try {
      await oracle.registerAgent("");
      setRegisterStatus("Profile created on-chain. Finalizing registration…");
      const profile = await waitForReadableProfile(publicKey);
      if (!profile) {
        throw new Error(
          "Profile transaction confirmed, but the account is not readable yet. Please wait a moment and try again."
        );
      }
      setAgentProfile(profile);
      setProfileChecked(true);
      setShowProfileGate(false);
      if (profile && pendingPublishAfterRegister) {
        setResult({
          success: true,
          message: "Profile created. Publishing skill…",
        });
        await new Promise((r) => setTimeout(r, 800));
        await publishSkill(true);
      } else if (profile) {
        setResult({ success: true, message: "Author profile created." });
      }
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      const alreadyExists =
        /already in use|already exists|0x0|account already initialized/i.test(
          msg
        );
      if (alreadyExists) {
        setRegisterStatus("Profile already exists. Finalizing registration…");
        const profile = await waitForReadableProfile(publicKey).catch(
          () => null
        );
        if (profile) {
          setAgentProfile(profile);
          setProfileChecked(true);
          setShowProfileGate(false);
          if (pendingPublishAfterRegister) {
            setResult({
              success: true,
              message: "Profile already exists. Publishing skill…",
            });
            await new Promise((r) => setTimeout(r, 800));
            await publishSkill(true);
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

  const handleContentChange = useCallback(
    (text: string) => {
      setContent(text);
      const derived = deriveDraftMetadataFromContent({
        content: text,
        currentName: name,
        currentSkillId: skillId,
        currentDescription: description,
        nameManuallyEdited,
        skillIdManuallyEdited,
        descriptionManuallyEdited,
      });

      setName(derived.name);
      setSkillId(derived.skillId);
      setDescription(derived.description);
    },
    [
      description,
      descriptionManuallyEdited,
      name,
      nameManuallyEdited,
      skillId,
      skillIdManuallyEdited,
    ]
  );

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (
        file &&
        (file.name.endsWith(".md") || file.type === "text/markdown")
      ) {
        const reader = new FileReader();
        reader.onload = () => {
          setTreeFiles([]);
          handleContentChange(reader.result as string);
        };
        reader.readAsText(file);
      }
    },
    [handleContentChange]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          setTreeFiles([]);
          handleContentChange(reader.result as string);
        };
        reader.readAsText(file);
      }
    },
    [handleContentChange]
  );

  const handleDirectorySelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const skillFile = files.find(
        (file) => getUploadRelativePath(file) === "SKILL.md"
      );
      if (!skillFile) {
        setResult({
          success: false,
          message: "Folder upload must include a top-level SKILL.md.",
        });
        return;
      }
      setTreeFiles(files);
      handleContentChange(await skillFile.text());
    },
    [handleContentChange]
  );

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag) && tags.length < 5) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handlePublish = async () => {
    await publishSkill();
  };

  const handleGithubLogout = async () => {
    setGithubLoading(true);
    try {
      await fetch("/api/auth/github/logout", { method: "POST" });
      setGithubSession({ authenticated: false, user: null });
    } finally {
      setGithubLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors">
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link
                href="/skills"
                className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white transition"
              >
                ← Skills
              </Link>
              <span className="text-gray-300 dark:text-gray-700">/</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                Publish
              </span>
            </div>
            <h1 className="text-3xl font-display text-gray-900 dark:text-white mb-1">
              Publish a Skill
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Upload a SKILL.md file. Free skills can start as unverified
              GitHub-attributed listings; paid marketplace listings require a
              wallet and on-chain protocol economics.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {!connected && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Use GitHub for free listings or a wallet for paid listings.
              </p>
            )}
          </div>
        </div>

        {/* Result toast */}
        {showInlineResult && (
          <div
            className={`mb-6 p-4 rounded-sm border flex items-center justify-between ${
              result.success
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
            }`}
          >
            <div className="flex items-center gap-2">
              {result.success ? (
                <FiCheckCircle className="text-green-600 dark:text-green-400" />
              ) : (
                <FiXCircle className="text-red-600 dark:text-red-400" />
              )}
              <span
                className={`text-sm ${
                  result.success
                    ? "text-green-800 dark:text-green-200"
                    : "text-red-800 dark:text-red-200"
                }`}
              >
                {result.message}
              </span>
            </div>
            <button
              onClick={() => setResult(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <FiX className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Profile setup modal — shown inline when user tries to publish without a profile */}
        {showProfileGate && connected && !profileLoading && !agentProfile && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="relative">
              <button
                onClick={() => setShowProfileGate(false)}
                className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 z-10"
              >
                <FiX className="w-4 h-4" />
              </button>
              <AgentProfileSetupCard
                registering={registering}
                status={registerStatus}
                onRegister={handleRegister}
                error={registerError}
                title="Create your author profile"
                description="Before publishing, set up your on-chain author profile. This links your skills to the reputation system so others can vouch for your work."
                primaryStepLabel="Create profile"
                secondaryStepLabel="Publish skill"
              />
            </div>
          </div>
        )}

        {/* Publish form — always visible so users can fill it before connecting */}
        <>
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleFileDrop}
            onClick={() => !content && fileInputRef.current?.click()}
            className={`mb-6 rounded-sm border-2 border-dashed p-8 text-center transition cursor-pointer ${
              dragOver
                ? "border-[var(--lobster-accent-border)] bg-[var(--lobster-accent-soft)]"
                : content
                ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/10"
                : "border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,text/markdown"
              onChange={handleFileSelect}
              className="hidden"
            />
            <input
              ref={directoryInputRef}
              type="file"
              multiple
              onChange={handleDirectorySelect}
              className="hidden"
              {...({ webkitdirectory: "", directory: "" } as Record<
                string,
                string
              >)}
            />
            {content ? (
              <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400">
                <FiCheckCircle className="w-5 h-5" />
                <span className="text-sm font-medium">
                  {treeFiles.length > 0
                    ? `Folder loaded (${treeFiles.length} files)`
                    : `SKILL.md loaded (${content.length} characters)`}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setContent("");
                    setTreeFiles([]);
                    setName("");
                    setSkillId("");
                    setDescription("");
                    setNameManuallyEdited(false);
                    setSkillIdManuallyEdited(false);
                    setDescriptionManuallyEdited(false);
                  }}
                  className="ml-2 text-gray-400 hover:text-red-500 transition"
                >
                  <FiX className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <FiUpload className="w-8 h-8 mx-auto text-gray-400 mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                  Drop SKILL.md here, click to select, or upload a folder
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Folder format: SKILL.md with optional scripts/, references/,
                  assets/
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    directoryInputRef.current?.click();
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-sm border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                >
                  <FiUpload className="h-3.5 w-3.5" />
                  Select folder
                </button>
              </>
            )}
          </div>

          {/* Content editor / preview toggle */}
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 mb-6 overflow-hidden">
            <div className="flex items-center border-b border-gray-200 dark:border-gray-800">
              <button
                onClick={() => setShowPreview(false)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition ${
                  !showPreview
                    ? "text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <FiEdit3 className="w-3.5 h-3.5" />
                Edit
              </button>
              <button
                onClick={() => setShowPreview(true)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition ${
                  showPreview
                    ? "text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <FiEye className="w-3.5 h-3.5" />
                Preview
              </button>
            </div>
            <div className="p-4">
              {showPreview ? (
                content ? (
                  <MarkdownRenderer content={content} variant="skill" />
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
                    Nothing to preview yet
                  </p>
                )
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="# My Skill\n\nDescribe what this skill does...\n\n## When to Use\n\n- Use when..."
                  className="w-full min-h-[300px] bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none resize-y font-mono"
                />
              )}
            </div>
          </div>

          {/* Metadata form */}
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6 space-y-4">
            <h3 className="text-sm font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              Skill Metadata
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Skill Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    const nextName = normalizeSkillName(e.target.value);
                    setNameManuallyEdited(true);
                    setName(nextName);
                    if (!skillIdManuallyEdited) {
                      setSkillId(slugify(nextName));
                    }
                  }}
                  placeholder="Solana Developer Skill"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Skill ID *
                </label>
                <input
                  type="text"
                  value={skillId}
                  onChange={(e) => {
                    setSkillIdManuallyEdited(true);
                    setSkillId(slugify(e.target.value, false));
                  }}
                  onBlur={() => setSkillId(finalizeSlug(skillId))}
                  placeholder="solana-dev-skill"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => {
                  setDescriptionManuallyEdited(true);
                  setDescription(normalizeSkillDescription(e.target.value));
                }}
                placeholder="Brief description of what this skill teaches agents..."
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                maxLength={256}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Tags (up to 5)
              </label>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="hover:text-red-500 transition"
                    >
                      <FiX className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              {tags.length < 5 && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && (e.preventDefault(), addTag())
                    }
                    placeholder="Add a tag..."
                    className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                  />
                  <button
                    onClick={addTag}
                    className={navButtonSecondaryInlineClass}
                  >
                    <FiTag className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Contact Handle{" "}
                <span className="text-gray-400 dark:text-gray-500">
                  (optional)
                </span>
              </label>
              <input
                type="text"
                value={contact}
                onChange={(e) =>
                  setContact(normalizeSkillContact(e.target.value))
                }
                placeholder="@twitter, discord#1234, t.me/handle, etc."
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                maxLength={128}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                So we can reach you about competitions, features, or issues.
              </p>
            </div>
          </div>

          {/* Price + publish */}
          <div className="rounded-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
            <div className="mb-4 grid gap-4 md:grid-cols-[1.1fr_0.9fr] md:items-start">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <UsdcIcon className="w-4 h-4 text-[var(--lobster-accent)]" />
                  <span className="text-sm font-normal text-gray-900 dark:text-white">
                    Listing Mode
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Set price to 0 for a free Unverified listing. Any paid price
                  becomes a protocol-listed marketplace skill and requires a
                  registered wallet author.
                </p>
              </div>
              <div className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FiGithub className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                      <span className="text-sm font-normal text-gray-900 dark:text-white">
                        GitHub publisher
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {githubConnected && githubUser
                        ? `Signed in as @${githubUser.login}`
                        : "Free skills can be attributed to your GitHub handle."}
                    </p>
                  </div>
                  {githubLoading ? (
                    <FiLoader className="mt-0.5 h-4 w-4 animate-spin text-gray-400" />
                  ) : githubConnected ? (
                    <button
                      type="button"
                      onClick={handleGithubLogout}
                      className="shrink-0 text-xs font-medium text-gray-500 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    >
                      Sign out
                    </button>
                  ) : (
                    <a
                      href="/api/auth/github/start?returnTo=/skills/publish"
                      className="shrink-0 text-xs font-medium text-[var(--lobster-accent)] transition hover:text-[var(--lobster-accent-strong)]"
                    >
                      Sign in
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <UsdcIcon className="w-4 h-4 text-[var(--lobster-accent)]" />
                  <span className="text-sm font-normal text-gray-900 dark:text-white">
                    Primary price
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  0 publishes a free skill. Paid listings settle through
                  USDC-native purchase_skill economics.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.000001"
                    value={usdcPrice}
                    onChange={(e) => setUsdcPrice(e.target.value)}
                    placeholder="0"
                    className="w-32 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-[var(--lobster-focus-ring)] focus:border-[var(--lobster-accent)]"
                  />
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    USDC
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
                  Stored as{" "}
                  <span className="font-mono">
                    {!priceIsValid
                      ? "invalid"
                      : parsedUsdcPriceMicros ?? "0 (free)"}
                  </span>{" "}
                  micros.
                </p>
              </div>

              <div className="rounded-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <FiDollarSign className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  <span className="text-sm font-normal text-gray-900 dark:text-white">
                    Protocol currency
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  New listings use USDC-native `purchase_skill`. SOL is only
                  needed for transaction fees, rent, and ATA creation.
                </p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
                  Minimum paid listing is {formatMinPrice()}.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <PublishReadiness
              connected={connected}
              githubConnected={githubConnected}
              isPaidPublish={isPaidPublish}
              profileLoading={
                isPaidPublish && (profileLoading || !profileChecked)
              }
              hasProfile={!!agentProfile}
              hasContent={!!content}
              hasName={!!name}
              hasSkillId={!!skillId}
            />
            <button
              onClick={handlePublish}
              disabled={
                publishing ||
                !content ||
                !name ||
                !skillId ||
                !priceIsValid ||
                githubLoading ||
                !hasPublisherAuth ||
                (isPaidPublish &&
                  (!connected || !profileChecked || profileLoading))
              }
              className={`${navButtonPrimaryInlineClass} shrink-0`}
            >
              {publishing ? (
                <>
                  <FiLoader className="w-4 h-4 animate-spin" />
                  {publishStep === "chain"
                    ? "Creating on-chain listing…"
                    : "Saving to repo…"}
                </>
              ) : (
                <>
                  <FiUpload className="w-4 h-4" />
                  Publish Skill
                </>
              )}
            </button>
          </div>
        </>
      </div>
    </main>
  );
}
