"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiAlertTriangle,
  FiCheckCircle,
  FiExternalLink,
  FiLoader,
} from "react-icons/fi";
import { useChainWallet } from "@/components/WalletContextProvider";
import { useWritableChainWallet } from "@/hooks/useWritableChainWallet";
import {
  BASE_PAID_PURCHASE_REPORTS_ENABLED,
  BASE_SEPOLIA_CHAIN_ID,
} from "@/lib/adapters/baseWalletConfig";
import {
  PAID_PURCHASE_REPORT_BOND_USDC_MICROS,
  PAID_PURCHASE_REPORT_MAX_EVIDENCE_BYTES,
  hasPaidPurchaseReportCapability,
} from "@/lib/adapters/basePaidPurchaseReports";
import { getErrorMessage } from "@/lib/errors";
import { navButtonPrimaryInlineClass } from "@/lib/buttonStyles";

export type BasePaidPurchaseSummary = {
  kind: "evm-paid-purchase";
  chainContext: string;
  contractAddress: string;
  protocolVersion: string;
  buyerAddress: string;
  listingId: string;
  purchaseId: string;
  listingRevision: string | null;
  amountMicros: string;
  paymentFlow: string | null;
};

type BasePaidPurchaseReportPreflight = {
  chainContext: string;
  contractAddress: string;
  protocolVersion: string;
  buyerAddress: string;
  authorAddress: string;
  listingId: string;
  purchaseId: string;
  purchaseRevision: string;
  purchasePriceUsdcMicros: string;
  purchaseTimestamp: string;
  filingDeadline: string;
  lane: number;
  paused: boolean;
  eligible: boolean;
  reason: string | null;
  requiresExactCallSimulation: boolean;
};

export type BasePaidPurchaseReportSummary = {
  reportId: string;
  status: number;
  outcome: number;
  filedAt: string;
  reviewDeadline: string;
  buyerCreditUsdcMicros: string;
  claimDeadline: string | null;
  creditHandled: boolean;
  evidenceUri: string;
};

type PaidReportLookupResponse = {
  preflight: BasePaidPurchaseReportPreflight;
  report: null | { state: BasePaidPurchaseReportSummary };
};

type SubmissionStage =
  | "idle"
  | "registering-and-simulating"
  | "approving-and-submitting"
  | "confirming"
  | "indexing"
  | "claiming"
  | "success"
  | "error";

function reportStatusLabel(report: BasePaidPurchaseReportSummary): string {
  if (report.status === 1) return "Pending operator review";
  if (report.status === 2) return "Accepted for resolution";
  if (report.status === 3) return "Voucher slashing in progress";
  if (report.outcome === 1) return "Rejected";
  if (report.outcome === 2) return "Expired";
  if (report.outcome === 3) return "Dismissed";
  if (report.outcome === 4) return "Upheld";
  return "Terminal";
}

function isBuyerCreditClaimable(
  report: BasePaidPurchaseReportSummary | null
): boolean {
  if (!report || report.creditHandled) return false;
  try {
    return (
      BigInt(report.buyerCreditUsdcMicros) > 0n &&
      BigInt(report.claimDeadline ?? "0") >
        BigInt(Math.floor(Date.now() / 1000))
    );
  } catch {
    return false;
  }
}

export default function PaidPurchaseReportPanel({
  skillId,
  purchase,
}: {
  skillId: string;
  purchase: BasePaidPurchaseSummary;
}) {
  const wallet = useWritableChainWallet();
  const session = useChainWallet();
  const [evidenceUri, setEvidenceUri] = useState("");
  const [stage, setStage] = useState<SubmissionStage>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [userOpHash, setUserOpHash] = useState<string | null>(null);
  const [preflight, setPreflight] =
    useState<BasePaidPurchaseReportPreflight | null>(null);
  const [report, setReport] = useState<BasePaidPurchaseReportSummary | null>(
    null
  );
  const [loadingState, setLoadingState] = useState(false);

  const normalizedEvidenceUri = evidenceUri.trim();
  const evidenceBytes = useMemo(
    () => new TextEncoder().encode(normalizedEvidenceUri).length,
    [normalizedEvidenceUri]
  );
  const walletOwnsPurchase =
    !!session.account &&
    purchase.buyerAddress.toLowerCase() === session.account.toLowerCase();
  const paidReportWallet = hasPaidPurchaseReportCapability(wallet)
    ? wallet
    : null;
  const capable = paidReportWallet !== null;

  const refreshReport = useCallback(async () => {
    if (!BASE_PAID_PURCHASE_REPORTS_ENABLED || !walletOwnsPurchase) return;
    setLoadingState(true);
    try {
      const params = new URLSearchParams({
        buyer: purchase.buyerAddress,
        purchaseId: purchase.purchaseId,
      });
      const response = await fetch(
        `/api/skills/${encodeURIComponent(skillId)}/paid-reports?${params}`,
        { cache: "no-store" }
      );
      const payload = (await response.json().catch(() => null)) as
        | PaidReportLookupResponse
        | { error?: string }
        | null;
      if (!response.ok || !payload || !("preflight" in payload)) {
        throw new Error(
          payload && "error" in payload && payload.error
            ? payload.error
            : "Paid-report state could not be loaded."
        );
      }
      setPreflight(payload.preflight);
      setReport(payload.report?.state ?? null);
    } catch (error) {
      setStage("error");
      setMessage(
        getErrorMessage(error, "Paid-report state could not be loaded.")
      );
    } finally {
      setLoadingState(false);
    }
  }, [purchase.buyerAddress, purchase.purchaseId, skillId, walletOwnsPurchase]);

  useEffect(() => {
    void refreshReport();
  }, [refreshReport]);

  if (!BASE_PAID_PURCHASE_REPORTS_ENABLED || !walletOwnsPurchase) return null;

  const busy = !["idle", "success", "error"].includes(stage);

  const verifyOpenedReport = async (openedTxHash: string) => {
    const response = await fetch(
      `/api/skills/${encodeURIComponent(skillId)}/paid-reports/verify`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: openedTxHash,
          purchaseId: purchase.purchaseId,
        }),
      }
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(
        payload?.error || "Report confirmed but indexing failed."
      );
    }
  };

  const openReport = async () => {
    if (!paidReportWallet) {
      setStage("error");
      setMessage(
        "This connected Base wallet cannot safely submit paid reports."
      );
      return;
    }
    if (!preflight?.eligible) {
      setStage("error");
      setMessage(preflight?.reason || "This purchase is not reportable.");
      return;
    }
    if (
      evidenceBytes === 0 ||
      evidenceBytes > PAID_PURCHASE_REPORT_MAX_EVIDENCE_BYTES
    ) {
      setStage("error");
      setMessage("Evidence must be 1-256 UTF-8 bytes.");
      return;
    }

    setMessage(null);
    setTxHash(null);
    setUserOpHash(null);
    try {
      setStage("registering-and-simulating");
      const resultPromise = paidReportWallet.openPaidPurchaseReport({
        chainContext: preflight.chainContext,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        contractAddress: preflight.contractAddress,
        authorAddress: preflight.authorAddress,
        listingId: preflight.listingId,
        purchaseId: preflight.purchaseId,
        evidenceUri: normalizedEvidenceUri,
        expectedBondUsdcMicros: PAID_PURCHASE_REPORT_BOND_USDC_MICROS,
      });
      setStage("approving-and-submitting");
      const result = await resultPromise;
      setStage("confirming");
      setTxHash(result.txHash);
      setUserOpHash(result.userOpHash ?? null);
      setStage("indexing");
      await verifyOpenedReport(result.txHash);
      await refreshReport();
      setStage("success");
      setMessage(
        `Paid-purchase report #${result.reportId} opened and verified.`
      );
    } catch (error) {
      setStage("error");
      setMessage(
        getErrorMessage(error, "Failed to open paid-purchase report.")
      );
    }
  };

  const claimCredit = async () => {
    if (!paidReportWallet || !report || !isBuyerCreditClaimable(report)) return;
    setMessage(null);
    setStage("claiming");
    try {
      const result = await paidReportWallet.claimPaidPurchaseReportCredit({
        chainContext: preflight?.chainContext ?? purchase.chainContext,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        contractAddress: preflight?.contractAddress ?? purchase.contractAddress,
        reportId: report.reportId,
      });
      setTxHash(result.txHash);
      setUserOpHash(result.userOpHash ?? null);
      await refreshReport();
      setStage("success");
      setMessage("Funded buyer credit claimed.");
    } catch (error) {
      setStage("error");
      setMessage(getErrorMessage(error, "Failed to claim buyer credit."));
    }
  };

  return (
    <div className="mt-3 rounded-sm border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/70 dark:bg-amber-950/20">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <FiAlertTriangle className="h-4 w-4" /> Buyer protection for this
        purchase
      </div>
      <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
        A paid report posts a 5 USDC bond and immutable public evidence.
        Founder/operator review is centralized. Rejection, dismissal, or expiry
        are possible; upheld recovery is limited to available collateral and is
        not a full-refund guarantee. Funded buyer credit expires seven days
        after funding.
      </p>
      <p className="mt-2 font-mono text-[11px] text-amber-700 dark:text-amber-400">
        Purchase {purchase.purchaseId.slice(0, 10)}…
        {preflight
          ? ` · file by ${new Date(
              Number(preflight.filingDeadline) * 1000
            ).toLocaleString()}`
          : ""}
      </p>

      {loadingState && !preflight ? (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
          <FiLoader className="h-4 w-4 animate-spin" /> Checking the exact
          purchase and deployment…
        </p>
      ) : report ? (
        <div className="mt-3 rounded-sm border border-amber-200 bg-white/70 p-3 dark:border-amber-900 dark:bg-gray-950/40">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-800 dark:text-gray-200">
            <FiCheckCircle className="h-3.5 w-3.5" /> Report #{report.reportId}:{" "}
            {reportStatusLabel(report)}
          </div>
          <p className="mt-1 break-all text-[11px] text-gray-500 dark:text-gray-400">
            Evidence: {report.evidenceUri}
          </p>
          {isBuyerCreditClaimable(report) && (
            <button
              type="button"
              onClick={() => void claimCredit()}
              disabled={busy}
              className={`mt-3 ${navButtonPrimaryInlineClass}`}
            >
              {stage === "claiming" ? (
                <FiLoader className="h-4 w-4 animate-spin" />
              ) : null}
              Claim funded buyer credit
            </button>
          )}
        </div>
      ) : preflight?.eligible ? (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Public evidence URI
          </label>
          <input
            value={evidenceUri}
            onChange={(event) => setEvidenceUri(event.target.value)}
            placeholder="ipfs://… or https://…"
            disabled={busy}
            className="w-full rounded-sm border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-900 dark:bg-gray-950 dark:text-white"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              {evidenceBytes}/{PAID_PURCHASE_REPORT_MAX_EVIDENCE_BYTES} UTF-8
              bytes
            </span>
            <button
              type="button"
              onClick={() => void openReport()}
              disabled={busy || !capable}
              className={navButtonPrimaryInlineClass}
            >
              {busy ? <FiLoader className="h-4 w-4 animate-spin" /> : null}
              {stage === "indexing" ? "Indexing…" : "Post 5 USDC bond & report"}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-600 dark:text-gray-300">
          {preflight?.reason ||
            "This purchase is not eligible for a paid report."}
        </p>
      )}

      {message && (
        <p
          className={`mt-3 text-xs ${
            stage === "error"
              ? "text-red-700 dark:text-red-300"
              : "text-green-700 dark:text-green-300"
          }`}
        >
          {message}
        </p>
      )}
      {(txHash || userOpHash) && (
        <div className="mt-2 space-y-1 text-[11px]">
          {txHash && (
            <a
              href={`https://sepolia.basescan.org/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[var(--sea-accent)] hover:underline"
            >
              Transaction {txHash.slice(0, 10)}…{" "}
              <FiExternalLink className="h-3 w-3" />
            </a>
          )}
          {userOpHash && (
            <p className="font-mono text-gray-500">
              UserOp {userOpHash.slice(0, 10)}…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
