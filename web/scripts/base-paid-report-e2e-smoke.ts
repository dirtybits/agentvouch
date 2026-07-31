import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { AGENTVOUCH_EVM_A1_READ_ABI } from "../lib/adapters/agentVouchEvmAbi";
import { normalizeChainAddressForStorage } from "../lib/chainAddress";

export const MAX_BASE_LOG_BLOCK_SPAN = 1_999n;
export const BASE_A1_CHAIN_ID = 84_532;
export const BASE_A1_PROTOCOL_VERSION = "base-v1-a1";

const OPS_ABI = parseAbi([
  ...AGENTVOUCH_EVM_A1_READ_ABI,
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function CONFIG_ROLE() view returns (bytes32)",
  "function RESOLVER_ROLE() view returns (bytes32)",
  "function SETTLEMENT_ROLE() view returns (bytes32)",
  "function PAUSE_ROLE() view returns (bytes32)",
  "function getVouch(address voucher, address vouchee) view returns (address voucherAddress, address voucheeAddress, uint256 stakeUsdcMicros, uint8 status, uint256 cumulativeRevenueUsdcMicros, uint64 linkedListingCount, uint256 entryRewardIndexUsdcMicrosX1e12, uint256 pendingRewardsUsdcMicros, uint64 lastPayoutAt)",
  "event Vouched(address indexed voucher, address indexed vouchee, uint256 stake)",
  "event VouchRevoked(address indexed voucher, address indexed vouchee, uint256 returned)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
]);

const USDC_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

export type OpsMode = "preflight" | "monitor" | "gate-c-readiness";

export type GateCDecisionRecord = {
  schemaVersion: 1;
  decision: "GO: isolated smoke" | "NO-GO";
  approvedBy: string;
  approvedAt: string;
  candidateCommit: string;
  chainId: number;
  protocolVersion: string;
  contractAddress: string;
  libraryAddress: string;
  deploymentBlock: string;
  usdcAddress: string;
  slashPercentage: number;
  restitutionRecipient: string;
  roleCustodyReference: string;
  securityAcceptanceReference: string;
  gateBReadbackReference: string;
  signingMethod: string;
  fallbackCranker: string;
  monitorOwner: string;
  incidentCommander: string;
  exposure: {
    policy: string;
    capUsdcMicros: string;
    authorBondUsdcMicros: string;
    voucherStakeUsdcMicros: string[];
    listingPriceUsdcMicros: string;
    purchaseLane: "Direct" | "Authorization" | "Settlement";
  };
  fixtures: {
    author: string;
    upheldBuyer: string;
    rejectedBuyer: string;
    expiryBuyer: string;
    vouchers: string[];
    resolver: string;
    pauseAuthority: string;
  };
};

export type GateCObservedDeployment = {
  candidateCommit: string;
  chainId: number;
  protocolVersion: string;
  contractAddress: string;
  libraryAddress: string;
  deploymentBlock: string;
  usdcAddress: string;
  paused: boolean;
  slashPercentage: number;
  restitutionRecipient: string;
  chainContext: string;
  reportBondUsdcMicros: string;
  minVouchStakeUsdcMicros: string;
  minAuthorBondForFreeListingUsdcMicros: string;
  minPaidListingPriceUsdcMicros: string;
  authorShareBps: number;
  voucherShareBps: number;
  protocolFeeBps: number;
  authorProceedsLockSeconds: string;
  refundClaimWindowSeconds: string;
  challengerRewardBps: number;
  challengerRewardCapUsdcMicros: string;
  stakeWeightPerUsdc: number;
  riskComponentCap: string;
  vouchWeight: number;
  vouchComponentCap: string;
  longevityBonusPerDay: number;
  longevityComponentCap: string;
  upheldDisputePenalty: string;
  reputationScoreCap: string;
  roleHolders: Record<string, string[]>;
  registeredFixtureAddresses: string[];
};

export type GateCTransactionPlanStep = {
  id: string;
  kind: "read" | "transaction" | "expected-revert" | "wait" | "reconcile";
  actor: string;
  call: string;
  expectedEvidence: string;
  earliestExecution?: string;
  publicNetworkTimeWarpAllowed: false;
};

export type GateCReadiness = {
  assessment: "READY_FOR_HUMAN_REVIEW" | "BLOCKED";
  executionAuthorized: false;
  readOnly: true;
  writeModesEnabled: false;
  blockers: string[];
  plannedGrossFundingUsdcMicros: string;
  transactionPlan: GateCTransactionPlanStep[];
};

export type InclusiveBlockRange = { fromBlock: bigint; toBlock: bigint };

export type MonitorCheckpoint = {
  chainId: number;
  contractAddress: string;
  blockNumber: string;
  blockHash: string;
};

export type StoredEvent = {
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  eventName: string;
  args: Record<string, string>;
};

export type MonitoredReport = {
  reportId: string;
  authorAddress: string;
  status: number;
  outcome: number;
  reviewDeadline: string;
  acceptedAt: string;
  activeVouchStakeUsdcMicros: string;
  processedPreSlashStakeUsdcMicros: string;
  buyerCreditUsdcMicros: string;
  claimDeadline: string;
  creditHandled: boolean;
  fallbackCrankerCandidates: number;
};

export type OpsAlert = {
  kind:
    | "pending-past-review-deadline"
    | "accepted-awaiting-ruling"
    | "slash-work-stalled"
    | "buyer-credit-near-expiry"
    | "event-derived-reserve-credit"
    | "unexpected-pause-state"
    | "missing-fallback-cranker-candidate";
  severity: "warning" | "critical";
  reportId?: string;
  message: string;
};

type OpsConfig = {
  mode: OpsMode;
  rpcUrl: string;
  contractAddress: Address;
  libraryAddress: Address;
  deploymentBlock: bigint;
  expectedFacadeRuntimeHash: Hex;
  expectedLibraryRuntimeHash: Hex;
  expectedUsdcAddress: Address;
  expectedPaused: boolean;
  expectedRoleHolders: Record<string, string[]>;
  acceptedAgeAlertSeconds: bigint;
  creditExpiryAlertSeconds: bigint;
  stateDir: string;
  candidateCommit?: string;
  gateCDecisionPath?: string;
};

function createOpsPublicClient(rpcUrl: string) {
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
}

type OpsPublicClient = ReturnType<typeof createOpsPublicClient>;

const ROLE_NAMES = [
  "DEFAULT_ADMIN_ROLE",
  "CONFIG_ROLE",
  "RESOLVER_ROLE",
  "SETTLEMENT_ROLE",
  "PAUSE_ROLE",
] as const;

export function buildInclusiveBlockRanges(
  fromBlock: bigint,
  toBlock: bigint,
  maxSpan = MAX_BASE_LOG_BLOCK_SPAN
): InclusiveBlockRange[] {
  if (fromBlock < 0n || toBlock < fromBlock || maxSpan <= 0n) return [];
  const ranges: InclusiveBlockRange[] = [];
  for (let start = fromBlock; start <= toBlock; start += maxSpan) {
    ranges.push({
      fromBlock: start,
      toBlock: start + maxSpan - 1n < toBlock ? start + maxSpan - 1n : toBlock,
    });
  }
  return ranges;
}

export function assertCheckpointCanonical(
  checkpoint: MonitorCheckpoint,
  canonicalHash: string | null | undefined
): void {
  if (
    !canonicalHash ||
    canonicalHash.toLowerCase() !== checkpoint.blockHash.toLowerCase()
  ) {
    throw new Error(
      `Event history reorg detected at checkpoint block ${checkpoint.blockNumber}`
    );
  }
}

export function deriveEventReserveCredit(events: StoredEvent[]): bigint {
  let reserve = 0n;
  for (const event of events) {
    if (
      event.eventName === "PaidPurchaseReportRejected" ||
      event.eventName === "PaidPurchaseReportDismissed" ||
      event.eventName === "PaidPurchaseReportFinalized" ||
      event.eventName === "PaidPurchaseReportCreditExpired"
    ) {
      reserve += BigInt(event.args.reserveCredit ?? "0");
    } else if (event.eventName === "RestitutionReserveClaimed") {
      reserve -= BigInt(event.args.amount ?? "0");
      if (reserve < 0n) {
        throw new Error(
          "Restitution reserve event history is incomplete or inconsistent"
        );
      }
    }
  }
  return reserve;
}

export function buildPaidReportAlerts(input: {
  nowSeconds: bigint;
  paused: boolean;
  expectedPaused: boolean;
  acceptedAgeAlertSeconds: bigint;
  creditExpiryAlertSeconds: bigint;
  eventDerivedReserveCredit: bigint;
  reports: MonitoredReport[];
}): OpsAlert[] {
  const alerts: OpsAlert[] = [];
  if (input.paused !== input.expectedPaused) {
    alerts.push({
      kind: "unexpected-pause-state",
      severity: "critical",
      message: `Expected paused=${input.expectedPaused}; observed paused=${input.paused}`,
    });
  }
  if (input.eventDerivedReserveCredit > 0n) {
    alerts.push({
      kind: "event-derived-reserve-credit",
      severity: "warning",
      message: `Event-derived restitution reserve credit is ${input.eventDerivedReserveCredit} USDC micros`,
    });
  }
  for (const report of input.reports) {
    const reportId = report.reportId;
    const reviewDeadline = BigInt(report.reviewDeadline);
    const acceptedAt = BigInt(report.acceptedAt);
    const activeStake = BigInt(report.activeVouchStakeUsdcMicros);
    const processedStake = BigInt(report.processedPreSlashStakeUsdcMicros);
    const buyerCredit = BigInt(report.buyerCreditUsdcMicros);
    const claimDeadline = BigInt(report.claimDeadline);
    if (report.status === 1 && input.nowSeconds >= reviewDeadline) {
      alerts.push({
        kind: "pending-past-review-deadline",
        severity: "critical",
        reportId,
        message: `Report ${reportId} is pending past its review deadline`,
      });
    }
    if (
      report.status === 2 &&
      acceptedAt > 0n &&
      input.nowSeconds - acceptedAt >= input.acceptedAgeAlertSeconds
    ) {
      alerts.push({
        kind: "accepted-awaiting-ruling",
        severity: "warning",
        reportId,
        message: `Report ${reportId} has remained accepted without a ruling`,
      });
    }
    if (report.status === 3 && activeStake > processedStake) {
      alerts.push({
        kind: "slash-work-stalled",
        severity: "critical",
        reportId,
        message: `Report ${reportId} has ${
          activeStake - processedStake
        } snapshotted stake left to crank`,
      });
      if (report.fallbackCrankerCandidates === 0) {
        alerts.push({
          kind: "missing-fallback-cranker-candidate",
          severity: "critical",
          reportId,
          message: `Report ${reportId} has remaining slash work but no validated active voucher candidate`,
        });
      }
    }
    if (
      buyerCredit > 0n &&
      !report.creditHandled &&
      claimDeadline >= input.nowSeconds &&
      claimDeadline - input.nowSeconds <= input.creditExpiryAlertSeconds
    ) {
      alerts.push({
        kind: "buyer-credit-near-expiry",
        severity: "critical",
        reportId,
        message: `Report ${reportId} has funded buyer credit nearing expiry`,
      });
    }
  }
  return alerts;
}

export function parseOpsMode(argv: string[]): OpsMode {
  if (
    argv.some(
      (arg) => arg === "--apply" || /private[-_]?key|mnemonic|seed/i.test(arg)
    )
  ) {
    throw new Error(
      "Public-network apply and secret-bearing arguments are disabled in the pre-broadcast driver"
    );
  }
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  if (positional.length > 1) {
    throw new Error("Operations command accepts exactly one read-only mode");
  }
  const mode = positional[0] ?? "preflight";
  if (
    mode !== "preflight" &&
    mode !== "monitor" &&
    mode !== "gate-c-readiness"
  ) {
    throw new Error(
      `Unsupported mode ${mode}; only read-only preflight, monitor, and gate-c-readiness modes are enabled`
    );
  }
  return mode;
}

function normalizedAddress(value: string): string | null {
  const address = normalizeChainAddressForStorage({
    chainContext: `eip155:${BASE_A1_CHAIN_ID}`,
    value,
  });
  return address === "0x0000000000000000000000000000000000000000"
    ? null
    : address;
}

function nonPending(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && !/pending|tbd|todo/i.test(normalized);
}

export function sanitizeOpsDiagnostic(error: unknown): string {
  const diagnostic =
    error instanceof Error ? error.stack || error.message : String(error);
  return diagnostic.replace(/https?:\/\/[^\s)\]}]+/gi, "<redacted-rpc-url>");
}

function currentGitCommit(): string {
  const dirty = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    { encoding: "utf8" }
  ).trim();
  if (dirty) {
    throw new Error(
      "Gate-C readiness requires a clean checkout of the reviewed candidate"
    );
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("Unable to derive an exact candidate commit from Git HEAD");
  }
  return commit.toLowerCase();
}

function parseUnsigned(value: string): bigint | null {
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function addressMatches(left: string, right: string): boolean {
  const normalizedLeft = normalizedAddress(left);
  return normalizedLeft !== null && normalizedLeft === normalizedAddress(right);
}

function buildGateCTransactionPlan(
  decision: GateCDecisionRecord
): GateCTransactionPlanStep[] {
  const step = (
    id: string,
    kind: GateCTransactionPlanStep["kind"],
    actor: string,
    call: string,
    expectedEvidence: string,
    earliestExecution?: string
  ): GateCTransactionPlanStep => ({
    id,
    kind,
    actor,
    call,
    expectedEvidence,
    earliestExecution,
    publicNetworkTimeWarpAllowed: false,
  });
  const facade = decision.contractAddress;
  const reserve = decision.restitutionRecipient;
  const cranker = decision.fallbackCranker;
  const purchaseCall =
    decision.exposure.purchaseLane === "Authorization"
      ? "purchaseWithAuthorization"
      : "purchaseSkill";
  return [
    step(
      "preflight-paused-deployment",
      "read",
      "operator",
      `${facade}: verify exact code/config/roles and paused=true`,
      "Gate-B readback, canonical block hash, and explicit-block USDC snapshot"
    ),
    step(
      "register-fresh-fixtures",
      "transaction",
      "each fresh fixture",
      `${facade}.registerAgent(metadataUri)`,
      "one successful AgentRegistered receipt per author, buyer, and voucher"
    ),
    step(
      "approve-exact-fixture-funding",
      "transaction",
      "each funded fixture",
      `${decision.usdcAddress}: exact allowances for bonds/vouches/reports`,
      "successful exact Approval receipts; Authorization purchase amount uses EIP-3009"
    ),
    step(
      "unpause-upheld-branch",
      "transaction",
      decision.fixtures.pauseAuthority,
      `${facade}.setPaused(false)`,
      "PausedSet(false) receipt and observed paused=false"
    ),
    step(
      "seed-author-bond-listings-vouches",
      "transaction",
      "author and voucher fixtures",
      `${facade}: deposit exact author bond, create three paid listings, and add each approved vouch`,
      "exact AuthorBondDeposited, SkillListingCreated, and Vouched receipts"
    ),
    step(
      "purchase-upheld-fixture",
      "transaction",
      decision.fixtures.upheldBuyer,
      `${facade}.${purchaseCall}(upheldListingId, exact lane inputs)`,
      "SkillPurchased receipt with exact buyer, listing, price, revision, and purchaseId"
    ),
    step(
      "open-upheld-report",
      "transaction",
      decision.fixtures.upheldBuyer,
      `${facade}.openPaidPurchaseReport(author, upheldListingId, upheldPurchaseId, evidenceUri)`,
      "PaidPurchaseReportOpened receipt with exact reportId and reviewDeadline"
    ),
    step(
      "replay-upheld-receipt",
      "expected-revert",
      decision.fixtures.upheldBuyer,
      "repeat open-upheld-report exact calldata",
      "simulation reverts PaidPurchaseReceiptConsumed; no transaction broadcast"
    ),
    step(
      "wrong-role-review",
      "expected-revert",
      decision.fixtures.upheldBuyer,
      `${facade}.reviewPaidPurchaseReport(event:open-upheld-report.reportId, true)`,
      "simulation reverts AccessControlUnauthorizedAccount; no transaction broadcast"
    ),
    step(
      "accept-upheld-report",
      "transaction",
      decision.fixtures.resolver,
      `${facade}.reviewPaidPurchaseReport(event:open-upheld-report.reportId, true)`,
      "PaidPurchaseReportAccepted receipt before the review deadline"
    ),
    step(
      "repause-before-upheld-settlement",
      "transaction",
      decision.fixtures.pauseAuthority,
      `${facade}.setPaused(true)`,
      "PausedSet(true) receipt and observed paused=true"
    ),
    step(
      "resolve-upheld-report",
      "transaction",
      decision.fixtures.resolver,
      `${facade}.resolvePaidPurchaseReport(event:open-upheld-report.reportId, Upheld)`,
      "PaidPurchaseReportParked receipt with exact slash snapshot"
    ),
    step(
      "slash-upheld-voucher-page-1",
      "transaction",
      cranker,
      `${facade}.slashPaidPurchaseReportVouches(reportId, [voucher[0]])`,
      "first PaidPurchaseReportVouchSlashed receipt and partial processed stake"
    ),
    step(
      "slash-upheld-voucher-page-2",
      "transaction",
      cranker,
      `${facade}.slashPaidPurchaseReportVouches(reportId, remaining vouchers)`,
      "remaining slash receipts plus PaidPurchaseReportFinalized"
    ),
    step(
      "claim-upheld-buyer-credit",
      "transaction",
      decision.fixtures.upheldBuyer,
      `${facade}.claimPaidPurchaseReportCredit(reportId)`,
      "PaidPurchaseReportCreditClaimed and explicit-block buyer USDC delta"
    ),
    step(
      "unpause-rejected-branch",
      "transaction",
      decision.fixtures.pauseAuthority,
      `${facade}.setPaused(false)`,
      "PausedSet(false) receipt"
    ),
    step(
      "open-rejected-report",
      "transaction",
      decision.fixtures.rejectedBuyer,
      "purchase rejected fixture then open its exact paid-purchase report",
      "SkillPurchased and PaidPurchaseReportOpened receipts"
    ),
    step(
      "repause-before-rejection",
      "transaction",
      decision.fixtures.pauseAuthority,
      `${facade}.setPaused(true)`,
      "PausedSet(true) receipt"
    ),
    step(
      "paused-entry-rejection",
      "expected-revert",
      decision.fixtures.rejectedBuyer,
      `${facade}.purchaseSkill(rejectedListingId) while paused`,
      "simulation reverts EnforcedPause; no transaction broadcast"
    ),
    step(
      "reject-report",
      "transaction",
      decision.fixtures.resolver,
      `${facade}.reviewPaidPurchaseReport(event:open-rejected-report.reportId, false)`,
      "PaidPurchaseReportRejected receipt and reserve-credit delta"
    ),
    step(
      "unpause-expiry-branch",
      "transaction",
      decision.fixtures.pauseAuthority,
      `${facade}.setPaused(false)`,
      "PausedSet(false) receipt"
    ),
    step(
      "open-expiry-report",
      "transaction",
      decision.fixtures.expiryBuyer,
      "purchase expiry fixture then open its exact paid-purchase report",
      "SkillPurchased and PaidPurchaseReportOpened receipts with reviewDeadline"
    ),
    step(
      "repause-before-expiry-wait",
      "transaction",
      decision.fixtures.pauseAuthority,
      `${facade}.setPaused(true)`,
      "PausedSet(true) receipt"
    ),
    step(
      "premature-expiry-close",
      "expected-revert",
      cranker,
      `${facade}.closePaidPurchaseReportCredit(event:open-expiry-report.reportId)`,
      "simulation reverts PaidPurchaseReviewOpen; no transaction broadcast"
    ),
    step(
      "wait-for-expiry-deadline",
      "wait",
      "operator",
      "wait for the public Base Sepolia timestamp to reach the recorded reviewDeadline",
      "canonical block timestamp at or after reviewDeadline; no time warp",
      "event:open-expiry-report.reviewDeadline"
    ),
    step(
      "close-expired-report",
      "transaction",
      cranker,
      `${facade}.closePaidPurchaseReportCredit(event:open-expiry-report.reportId)`,
      "PaidPurchaseReportExpired receipt and exact claimDeadline",
      "event:open-expiry-report.reviewDeadline"
    ),
    step(
      "claim-expiry-buyer-credit",
      "transaction",
      decision.fixtures.expiryBuyer,
      `${facade}.claimPaidPurchaseReportCredit(event:open-expiry-report.reportId)`,
      "PaidPurchaseReportCreditClaimed and explicit-block buyer USDC delta"
    ),
    step(
      "wrong-reserve-recipient",
      "expected-revert",
      cranker,
      `${facade}.claimRestitutionReserve()`,
      "simulation reverts for a non-recipient; no transaction broadcast"
    ),
    step(
      "claim-restitution-reserve",
      "transaction",
      reserve,
      `${facade}.claimRestitutionReserve()`,
      "RestitutionReserveClaimed and explicit-block recipient USDC delta"
    ),
    step(
      "reclaim-voucher-residuals",
      "transaction",
      "each slashed voucher",
      `${facade}.revokeVouch(author)`,
      "VouchRevoked receipts and explicit-block residual USDC deltas"
    ),
    step(
      "final-repause-and-reconcile",
      "reconcile",
      decision.fixtures.pauseAuthority,
      `${facade}: prove paused=true and reconcile reports, slash work, credits, reserve, residuals, and contract USDC`,
      "zero unexplained liability, final canonical checkpoint, and old-deployment/Solana regression references"
    ),
  ];
}

export function evaluateGateCDecision(
  decision: GateCDecisionRecord,
  observed: GateCObservedDeployment
): GateCReadiness {
  const blockers: string[] = [];
  if (decision.schemaVersion !== 1) {
    blockers.push("Gate-C decision schemaVersion must be 1");
  }
  if (decision.decision !== "GO: isolated smoke") {
    blockers.push("Founder decision is not GO: isolated smoke");
  }
  if (!/^[0-9a-f]{40}$/i.test(decision.candidateCommit)) {
    blockers.push("Candidate commit is not an exact 40-character Git SHA");
  } else if (
    decision.candidateCommit.toLowerCase() !==
    observed.candidateCommit.toLowerCase()
  ) {
    blockers.push(
      "Candidate commit differs from the reviewed deployment record"
    );
  }
  if (!nonPending(decision.approvedBy)) blockers.push("Approver is missing");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      decision.approvedAt
    ) ||
    !Number.isFinite(Date.parse(decision.approvedAt))
  ) {
    blockers.push("Approval timestamp is not an ISO-8601 timestamp");
  }
  if (
    decision.chainId !== observed.chainId ||
    observed.chainId !== BASE_A1_CHAIN_ID
  ) {
    blockers.push("Gate-C decision chain differs from Base Sepolia");
  }
  if (
    decision.protocolVersion !== observed.protocolVersion ||
    observed.protocolVersion !== BASE_A1_PROTOCOL_VERSION
  ) {
    blockers.push("Protocol version differs from the observed A1 deployment");
  }
  if (!addressMatches(decision.contractAddress, observed.contractAddress)) {
    blockers.push("Facade address differs from the observed deployment");
  }
  if (!addressMatches(decision.libraryAddress, observed.libraryAddress)) {
    blockers.push("Settlement library differs from the observed deployment");
  }
  if (decision.deploymentBlock !== observed.deploymentBlock) {
    blockers.push("Deployment block differs from the observed deployment");
  }
  if (!addressMatches(decision.usdcAddress, observed.usdcAddress)) {
    blockers.push("Native USDC differs from the observed deployment");
  }
  if (!observed.paused) blockers.push("Candidate is not paused");
  const lockedConfigChecks: Array<[string, string | number, string | number]> =
    [
      ["chain context", observed.chainContext, "eip155:84532"],
      ["minimum vouch stake", observed.minVouchStakeUsdcMicros, "1000000"],
      ["report bond", observed.reportBondUsdcMicros, "5000000"],
      [
        "minimum free-listing author bond",
        observed.minAuthorBondForFreeListingUsdcMicros,
        "1000000",
      ],
      [
        "minimum paid-listing price",
        observed.minPaidListingPriceUsdcMicros,
        "10000",
      ],
      ["author share", observed.authorShareBps, 6000],
      ["voucher share", observed.voucherShareBps, 4000],
      ["protocol fee", observed.protocolFeeBps, 0],
      ["author proceeds lock", observed.authorProceedsLockSeconds, "0"],
      ["refund claim window", observed.refundClaimWindowSeconds, "604800"],
      ["challenger reward", observed.challengerRewardBps, 0],
      ["challenger reward cap", observed.challengerRewardCapUsdcMicros, "0"],
      ["stake weight", observed.stakeWeightPerUsdc, 0],
      ["risk component cap", observed.riskComponentCap, "0"],
      ["vouch weight", observed.vouchWeight, 0],
      ["vouch component cap", observed.vouchComponentCap, "0"],
      ["longevity bonus", observed.longevityBonusPerDay, 0],
      ["longevity component cap", observed.longevityComponentCap, "0"],
      ["upheld-report penalty", observed.upheldDisputePenalty, "0"],
      ["reputation score cap", observed.reputationScoreCap, "0"],
    ];
  for (const [name, actual, expected] of lockedConfigChecks) {
    if (String(actual) !== String(expected)) {
      blockers.push(
        `Locked A1 ${name} differs: expected ${expected}; observed ${actual}`
      );
    }
  }
  if (decision.slashPercentage !== observed.slashPercentage) {
    blockers.push("Slash percentage differs from the deployed config");
  }
  if (
    !addressMatches(
      decision.restitutionRecipient,
      observed.restitutionRecipient
    )
  ) {
    blockers.push("Restitution recipient differs from the deployed config");
  }
  for (const [field, value] of [
    ["Role custody reference", decision.roleCustodyReference],
    [
      "Security review or risk-acceptance reference",
      decision.securityAcceptanceReference,
    ],
    ["Gate-B readback reference", decision.gateBReadbackReference],
    ["Signing method", decision.signingMethod],
    ["Monitor owner", decision.monitorOwner],
    ["Incident commander", decision.incidentCommander],
    ["Exposure policy", decision.exposure.policy],
  ] as const) {
    if (!nonPending(value)) blockers.push(`${field} is missing or pending`);
  }
  if (!normalizedAddress(decision.fallbackCranker)) {
    blockers.push("Fallback cranker is missing or pending");
  }
  const purchaseLane = String(decision.exposure.purchaseLane);
  const purchaseLaneRecognized = [
    "Direct",
    "Authorization",
    "Settlement",
  ].includes(purchaseLane);
  const purchaseLaneEligible = ["Direct", "Authorization"].includes(
    purchaseLane
  );
  if (!purchaseLaneRecognized) {
    blockers.push("Purchase lane must be Direct, Authorization, or Settlement");
  } else if (purchaseLane === "Settlement") {
    blockers.push("Settlement-lane receipts are ineligible for Gate-C reports");
  }

  const fixtureAddresses = [
    decision.fixtures.author,
    decision.fixtures.upheldBuyer,
    decision.fixtures.rejectedBuyer,
    decision.fixtures.expiryBuyer,
    ...decision.fixtures.vouchers,
  ];
  const normalizedFixtures = fixtureAddresses
    .map(normalizedAddress)
    .filter((value): value is string => value !== null);
  if (normalizedFixtures.length !== fixtureAddresses.length) {
    blockers.push("Every fresh fixture must be a non-zero EVM address");
  }
  if (decision.fixtures.vouchers.length < 2) {
    blockers.push("At least two fresh voucher fixtures are required");
  }
  if (new Set(normalizedFixtures).size !== normalizedFixtures.length) {
    blockers.push(
      "Fresh author, buyer, and voucher fixture addresses must be distinct"
    );
  }
  const registeredFixtures = new Set(
    observed.registeredFixtureAddresses
      .map(normalizedAddress)
      .filter((value): value is string => value !== null)
  );
  const unexpectedlyRegistered = normalizedFixtures.filter((fixture) =>
    registeredFixtures.has(fixture)
  );
  if (unexpectedlyRegistered.length > 0) {
    blockers.push(
      `Fresh fixtures are already registered: ${unexpectedlyRegistered.join(
        ", "
      )}`
    );
  }
  const resolverHolders = observed.roleHolders.RESOLVER_ROLE ?? [];
  if (
    !resolverHolders.some((holder) =>
      addressMatches(holder, decision.fixtures.resolver)
    )
  ) {
    blockers.push("Resolver fixture is not an observed RESOLVER_ROLE holder");
  }
  const pauseHolders = observed.roleHolders.PAUSE_ROLE ?? [];
  if (
    !pauseHolders.some((holder) =>
      addressMatches(holder, decision.fixtures.pauseAuthority)
    )
  ) {
    blockers.push("Pause fixture is not an observed PAUSE_ROLE holder");
  }
  const roleHolders = new Set(
    Object.values(observed.roleHolders)
      .flat()
      .map(normalizedAddress)
      .filter((value): value is string => value !== null)
  );
  const roleBearingFreshFixtures = normalizedFixtures.filter((fixture) =>
    roleHolders.has(fixture)
  );
  if (roleBearingFreshFixtures.length > 0) {
    blockers.push(
      `Fresh fixtures unexpectedly hold protocol roles: ${roleBearingFreshFixtures.join(
        ", "
      )}`
    );
  }
  const fallbackCranker = normalizedAddress(decision.fallbackCranker);
  if (fallbackCranker && roleHolders.has(fallbackCranker)) {
    blockers.push("Fallback cranker must not hold a protocol role");
  }
  if (
    fallbackCranker &&
    addressMatches(fallbackCranker, decision.restitutionRecipient)
  ) {
    blockers.push(
      "Fallback cranker must differ from the restitution recipient"
    );
  }
  if (
    addressMatches(decision.fixtures.resolver, decision.fixtures.pauseAuthority)
  ) {
    blockers.push("Resolver and pause authority fixtures must be distinct");
  }
  const fixtureIsolationAddresses = [
    decision.restitutionRecipient,
    decision.fallbackCranker,
    decision.fixtures.resolver,
    decision.fixtures.pauseAuthority,
  ]
    .map(normalizedAddress)
    .filter((value): value is string => value !== null);
  const overlappingFixture = normalizedFixtures.find((fixture) =>
    fixtureIsolationAddresses.includes(fixture)
  );
  if (overlappingFixture) {
    blockers.push(
      "Fresh fixtures must differ from role actors, the fallback cranker, and the restitution recipient"
    );
  }

  const authorBond = parseUnsigned(decision.exposure.authorBondUsdcMicros);
  const listingPrice = parseUnsigned(decision.exposure.listingPriceUsdcMicros);
  const voucherStakes =
    decision.exposure.voucherStakeUsdcMicros.map(parseUnsigned);
  const reportBond = parseUnsigned(observed.reportBondUsdcMicros);
  const minVouch = parseUnsigned(observed.minVouchStakeUsdcMicros);
  const minPaid = parseUnsigned(observed.minPaidListingPriceUsdcMicros);
  const cap = parseUnsigned(decision.exposure.capUsdcMicros);
  if (
    authorBond === null ||
    authorBond === 0n ||
    listingPrice === null ||
    reportBond === null ||
    minVouch === null ||
    minPaid === null ||
    cap === null ||
    voucherStakes.some((stake) => stake === null)
  ) {
    blockers.push(
      "Fixture funding and cap values must be unsigned USDC micro-unit integers"
    );
  }
  if (listingPrice !== null && minPaid !== null && listingPrice < minPaid) {
    blockers.push(
      "Fixture listing price is below the deployed paid-listing minimum"
    );
  }
  if (
    minVouch !== null &&
    voucherStakes.some((stake) => stake !== null && stake < minVouch)
  ) {
    blockers.push(
      "A fixture voucher stake is below the deployed vouch minimum"
    );
  }
  if (
    decision.exposure.voucherStakeUsdcMicros.length !==
    decision.fixtures.vouchers.length
  ) {
    blockers.push(
      "Every voucher fixture needs one exact approved stake amount"
    );
  }
  const plannedGrossFunding =
    authorBond !== null && listingPrice !== null && reportBond !== null
      ? authorBond +
        voucherStakes.reduce<bigint>(
          (total, stake) => total + (stake ?? 0n),
          0n
        ) +
        3n * (listingPrice + reportBond)
      : 0n;
  if (cap !== null && plannedGrossFunding > cap) {
    blockers.push(
      "Planned gross fixture funding exceeds the approved exposure cap"
    );
  }

  const assessment =
    blockers.length === 0 ? "READY_FOR_HUMAN_REVIEW" : "BLOCKED";

  return {
    assessment,
    executionAuthorized: false,
    readOnly: true,
    writeModesEnabled: false,
    blockers,
    plannedGrossFundingUsdcMicros: plannedGrossFunding.toString(),
    transactionPlan:
      assessment === "READY_FOR_HUMAN_REVIEW" && purchaseLaneEligible
        ? buildGateCTransactionPlan(decision)
        : [],
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function requireHex32(name: string): Hex {
  const value = requireEnv(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex value`);
  }
  return value.toLowerCase() as Hex;
}

function parseBoolean(name: string): boolean {
  const value = requireEnv(name);
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false`);
  }
  return value === "true";
}

function loadConfig(argv: string[]): OpsConfig {
  const mode = parseOpsMode(argv);
  const contractAddress = getAddress(
    requireEnv("BASE_A1_OPS_CONTRACT_ADDRESS")
  );
  const roleHolders = JSON.parse(
    requireEnv("BASE_A1_EXPECTED_ROLE_HOLDERS_JSON")
  ) as Record<string, unknown>;
  const expectedRoleHolders: Record<string, string[]> = {};
  for (const role of ROLE_NAMES) {
    const holders = roleHolders[role];
    if (!Array.isArray(holders)) {
      throw new Error(`BASE_A1_EXPECTED_ROLE_HOLDERS_JSON is missing ${role}`);
    }
    expectedRoleHolders[role] = holders.map((holder) =>
      getAddress(String(holder)).toLowerCase()
    );
  }
  return {
    mode,
    rpcUrl: requireEnv("BASE_A1_OPS_RPC_URL"),
    contractAddress,
    libraryAddress: getAddress(requireEnv("BASE_A1_OPS_LIBRARY_ADDRESS")),
    deploymentBlock: BigInt(requireEnv("BASE_A1_OPS_DEPLOYMENT_BLOCK")),
    expectedFacadeRuntimeHash: requireHex32(
      "BASE_A1_EXPECTED_FACADE_RUNTIME_HASH"
    ),
    expectedLibraryRuntimeHash: requireHex32(
      "BASE_A1_EXPECTED_LIBRARY_RUNTIME_HASH"
    ),
    expectedUsdcAddress: getAddress(
      requireEnv("BASE_A1_EXPECTED_USDC_ADDRESS")
    ),
    expectedPaused: parseBoolean("BASE_A1_EXPECTED_PAUSED"),
    expectedRoleHolders,
    acceptedAgeAlertSeconds: BigInt(
      process.env.BASE_A1_ACCEPTED_AGE_ALERT_SECONDS ?? "3600"
    ),
    creditExpiryAlertSeconds: BigInt(
      process.env.BASE_A1_CREDIT_EXPIRY_ALERT_SECONDS ?? "86400"
    ),
    stateDir:
      process.env.BASE_A1_OPS_STATE_DIR ??
      path.join(
        ".agent-keys",
        "base-paid-report",
        contractAddress.toLowerCase()
      ),
    candidateCommit:
      mode === "gate-c-readiness" ? currentGitCommit() : undefined,
    gateCDecisionPath:
      mode === "gate-c-readiness"
        ? requireEnv("BASE_A1_GATE_C_DECISION_PATH")
        : undefined,
  };
}

function field(value: unknown, name: string, index: number): unknown {
  const tuple = value as Record<string | number, unknown>;
  return tuple[name] ?? tuple[index];
}

function atomicJson(pathname: string, value: unknown): void {
  const temporary = `${pathname}.${process.pid}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify(
      value,
      (_key, item) => (typeof item === "bigint" ? item.toString() : item),
      2
    )}\n`,
    { mode: 0o600 }
  );
  renameSync(temporary, pathname);
}

function readJson<T>(pathname: string): T | null {
  if (!existsSync(pathname)) return null;
  return JSON.parse(readFileSync(pathname, "utf8")) as T;
}

function withRunLock<T>(
  stateDir: string,
  action: () => Promise<T>
): Promise<T> {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(stateDir, "run.lock");
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch {
    throw new Error(`Another A1 operations process owns ${lockPath}`);
  }
  return action().finally(() => {
    closeSync(descriptor);
    rmSync(lockPath, { force: true });
  });
}

function normalizeEventArgs(args: unknown): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!args || typeof args !== "object") return normalized;
  for (const [key, value] of Object.entries(args)) {
    if (/^\d+$/.test(key)) continue;
    normalized[key] = String(value);
  }
  return normalized;
}

async function scanDeploymentEvents(input: {
  client: OpsPublicClient;
  config: OpsConfig;
  latestBlock: bigint;
  forceFullRescan?: boolean;
}): Promise<{ events: StoredEvent[]; checkpoint: MonitorCheckpoint }> {
  const eventPath = path.join(input.config.stateDir, "events.json");
  const checkpointPath = path.join(input.config.stateDir, "checkpoint.json");
  const checkpoint = input.forceFullRescan
    ? null
    : readJson<MonitorCheckpoint>(checkpointPath);
  const events = input.forceFullRescan
    ? []
    : readJson<StoredEvent[]>(eventPath) ?? [];
  let fromBlock = input.config.deploymentBlock;
  if (checkpoint) {
    if (!existsSync(eventPath)) {
      throw new Error("Checkpoint exists without its deployment event history");
    }
    if (
      checkpoint.chainId !== BASE_A1_CHAIN_ID ||
      checkpoint.contractAddress.toLowerCase() !==
        input.config.contractAddress.toLowerCase()
    ) {
      throw new Error("Checkpoint belongs to a different chain or deployment");
    }
    const checkpointBlock = await input.client.getBlock({
      blockNumber: BigInt(checkpoint.blockNumber),
    });
    assertCheckpointCanonical(checkpoint, checkpointBlock.hash);
    fromBlock = BigInt(checkpoint.blockNumber) + 1n;
  }

  for (const range of buildInclusiveBlockRanges(fromBlock, input.latestBlock)) {
    const logs = await input.client.getLogs({
      address: input.config.contractAddress,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
    });
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: OPS_ABI,
          data: log.data,
          topics: log.topics,
        });
        events.push({
          blockNumber: String(log.blockNumber),
          blockHash: String(log.blockHash),
          transactionHash: String(log.transactionHash),
          logIndex: Number(log.logIndex),
          eventName: String(decoded.eventName),
          args: normalizeEventArgs(decoded.args),
        });
      } catch {
        // Ignore exact-contract events outside the frozen operations ABI.
      }
    }
  }
  const latest = await input.client.getBlock({
    blockNumber: input.latestBlock,
  });
  if (!latest.hash) throw new Error("Latest block has no canonical hash");
  const nextCheckpoint: MonitorCheckpoint = {
    chainId: BASE_A1_CHAIN_ID,
    contractAddress: input.config.contractAddress.toLowerCase(),
    blockNumber: input.latestBlock.toString(),
    blockHash: latest.hash,
  };
  atomicJson(eventPath, events);
  atomicJson(checkpointPath, nextCheckpoint);
  return { events, checkpoint: nextCheckpoint };
}

function reconstructRoleHolders(
  events: StoredEvent[]
): Map<string, Set<string>> {
  const holders = new Map<string, Set<string>>();
  for (const event of events) {
    if (
      event.eventName !== "RoleGranted" &&
      event.eventName !== "RoleRevoked"
    ) {
      continue;
    }
    const role = event.args.role?.toLowerCase();
    const account = event.args.account?.toLowerCase();
    if (!role || !account)
      throw new Error("Malformed AccessControl event history");
    const roleHolders = holders.get(role) ?? new Set<string>();
    if (event.eventName === "RoleGranted") roleHolders.add(account);
    else roleHolders.delete(account);
    holders.set(role, roleHolders);
  }
  return holders;
}

async function assertExactRoleMatrix(input: {
  client: OpsPublicClient;
  contractAddress: Address;
  events: StoredEvent[];
  expected: Record<string, string[]>;
}): Promise<Record<string, string[]>> {
  const roleHashes = await Promise.all(
    ROLE_NAMES.map((role) =>
      input.client.readContract({
        address: input.contractAddress,
        abi: OPS_ABI,
        functionName: role,
      })
    )
  );
  const reconstructed = reconstructRoleHolders(input.events);
  const observed: Record<string, string[]> = {};
  for (let index = 0; index < ROLE_NAMES.length; index += 1) {
    const name = ROLE_NAMES[index];
    const roleHash = String(roleHashes[index]).toLowerCase();
    const actual = [...(reconstructed.get(roleHash) ?? new Set())].sort();
    const expected = [...input.expected[name]]
      .map((value) => value.toLowerCase())
      .sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `${name} holder mismatch: expected ${expected.join(
          ","
        )}; observed ${actual.join(",")}`
      );
    }
    observed[name] = actual;
  }
  return observed;
}

function reconstructVoucherMembership(
  events: StoredEvent[]
): Map<string, Set<string>> {
  const byAuthor = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.eventName !== "Vouched" && event.eventName !== "VouchRevoked")
      continue;
    const author = event.args.vouchee?.toLowerCase();
    const voucher = event.args.voucher?.toLowerCase();
    if (!author || !voucher) continue;
    const vouchers = byAuthor.get(author) ?? new Set<string>();
    if (event.eventName === "Vouched") vouchers.add(voucher);
    else vouchers.delete(voucher);
    byAuthor.set(author, vouchers);
  }
  return byAuthor;
}

async function readMonitoredReports(input: {
  client: OpsPublicClient;
  contractAddress: Address;
  events: StoredEvent[];
}): Promise<MonitoredReport[]> {
  const openedIds = [
    ...new Set(
      input.events
        .filter((event) => event.eventName === "PaidPurchaseReportOpened")
        .map((event) => event.args.reportId)
        .filter(Boolean)
    ),
  ];
  const voucherMembership = reconstructVoucherMembership(input.events);
  const reports: MonitoredReport[] = [];
  for (const reportIdString of openedIds) {
    const reportId = BigInt(reportIdString);
    const [core, settlement] = await Promise.all([
      input.client.readContract({
        address: input.contractAddress,
        abi: OPS_ABI,
        functionName: "getPaidPurchaseReportCore",
        args: [reportId],
      }),
      input.client.readContract({
        address: input.contractAddress,
        abi: OPS_ABI,
        functionName: "getPaidPurchaseReportSettlement",
        args: [reportId],
      }),
    ]);
    const authorAddress = getAddress(String(field(core, "author", 1)));
    let fallbackCrankerCandidates = 0;
    for (const voucher of voucherMembership.get(authorAddress.toLowerCase()) ??
      []) {
      const vouch = await input.client.readContract({
        address: input.contractAddress,
        abi: OPS_ABI,
        functionName: "getVouch",
        args: [getAddress(voucher), authorAddress],
      });
      if (
        BigInt(String(field(vouch, "stakeUsdcMicros", 2))) > 0n &&
        Number(field(vouch, "status", 3)) === 0
      ) {
        fallbackCrankerCandidates += 1;
      }
    }
    reports.push({
      reportId: reportId.toString(),
      authorAddress,
      reviewDeadline: String(field(core, "reviewDeadline", 5)),
      acceptedAt: String(field(core, "acceptedAt", 6)),
      status: Number(field(core, "status", 8)),
      outcome: Number(field(core, "outcome", 9)),
      activeVouchStakeUsdcMicros: String(
        field(settlement, "activeVouchStake", 1)
      ),
      processedPreSlashStakeUsdcMicros: String(
        field(settlement, "processedPreSlashStake", 2)
      ),
      buyerCreditUsdcMicros: String(field(settlement, "buyerCredit", 6)),
      claimDeadline: String(field(settlement, "claimDeadline", 7)),
      creditHandled: Boolean(field(settlement, "creditHandled", 8)),
      fallbackCrankerCandidates,
    });
  }
  return reports;
}

async function runReadOnlyOperations(config: OpsConfig): Promise<void> {
  await withRunLock(config.stateDir, async () => {
    const client = createOpsPublicClient(config.rpcUrl);
    const [chainId, latestBlock, facadeCode, libraryCode] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      client.getCode({ address: config.contractAddress }),
      client.getCode({ address: config.libraryAddress }),
    ]);
    if (chainId !== BASE_A1_CHAIN_ID) {
      throw new Error(
        `Expected chain ${BASE_A1_CHAIN_ID}; RPC returned ${chainId}`
      );
    }
    if (latestBlock < config.deploymentBlock) {
      throw new Error("Deployment block is ahead of the RPC head");
    }
    if (
      !facadeCode ||
      facadeCode === "0x" ||
      !libraryCode ||
      libraryCode === "0x"
    ) {
      throw new Error("Facade or settlement library has no runtime code");
    }
    if (config.mode === "gate-c-readiness") {
      if (config.deploymentBlock === 0n) {
        throw new Error("Gate-C deployment block cannot be zero");
      }
      const [facadeCodeAtDeployment, facadeCodeBeforeDeployment] =
        await Promise.all([
          client.getCode({
            address: config.contractAddress,
            blockNumber: config.deploymentBlock,
          }),
          client.getCode({
            address: config.contractAddress,
            blockNumber: config.deploymentBlock - 1n,
          }),
        ]);
      if (
        !facadeCodeAtDeployment ||
        facadeCodeAtDeployment === "0x" ||
        keccak256(facadeCodeAtDeployment).toLowerCase() !==
          config.expectedFacadeRuntimeHash
      ) {
        throw new Error(
          "Facade deployment block does not contain the approved runtime"
        );
      }
      if (facadeCodeBeforeDeployment && facadeCodeBeforeDeployment !== "0x") {
        throw new Error(
          "Facade already had code before the declared deployment block"
        );
      }
    }
    if (
      keccak256(facadeCode).toLowerCase() !== config.expectedFacadeRuntimeHash
    ) {
      throw new Error(
        "Facade runtime hash does not match the approved linked artifact"
      );
    }
    if (
      keccak256(libraryCode).toLowerCase() !== config.expectedLibraryRuntimeHash
    ) {
      throw new Error(
        "Settlement library runtime hash does not match the approved artifact"
      );
    }

    const [protocolVersion, paused, rawConfig, latest] = await Promise.all([
      client.readContract({
        address: config.contractAddress,
        abi: OPS_ABI,
        functionName: "PROTOCOL_VERSION",
      }),
      client.readContract({
        address: config.contractAddress,
        abi: OPS_ABI,
        functionName: "paused",
      }),
      client.readContract({
        address: config.contractAddress,
        abi: OPS_ABI,
        functionName: "getConfig",
      }),
      client.getBlock({ blockNumber: latestBlock }),
    ]);
    if (protocolVersion !== BASE_A1_PROTOCOL_VERSION) {
      throw new Error(`Unexpected protocol version ${protocolVersion}`);
    }
    if (
      (config.mode === "preflight" || config.mode === "gate-c-readiness") &&
      Boolean(paused) !== config.expectedPaused
    ) {
      throw new Error(
        `Preflight pause mismatch: expected ${
          config.expectedPaused
        }; observed ${Boolean(paused)}`
      );
    }
    const usdcAddress = getAddress(String(field(rawConfig, "usdc", 0)));
    if (usdcAddress !== config.expectedUsdcAddress) {
      throw new Error(
        "Configured USDC does not match the approved native USDC"
      );
    }
    const lockedConfigValues = [
      [String(field(rawConfig, "chainContext", 1)), "eip155:84532"],
      [String(field(rawConfig, "minVouchStakeUsdcMicros", 2)), "1000000"],
      [String(field(rawConfig, "disputeBondUsdcMicros", 3)), "5000000"],
      [
        String(field(rawConfig, "minAuthorBondForFreeListingUsdcMicros", 4)),
        "1000000",
      ],
      [String(field(rawConfig, "minPaidListingPriceUsdcMicros", 5)), "10000"],
      [String(field(rawConfig, "authorShareBps", 6)), "6000"],
      [String(field(rawConfig, "voucherShareBps", 7)), "4000"],
      [String(field(rawConfig, "protocolFeeBps", 8)), "0"],
      [String(field(rawConfig, "authorProceedsLockSeconds", 10)), "0"],
      [String(field(rawConfig, "refundClaimWindowSeconds", 11)), "604800"],
      [String(field(rawConfig, "challengerRewardBps", 12)), "0"],
      [String(field(rawConfig, "challengerRewardCapUsdcMicros", 13)), "0"],
      [String(field(rawConfig, "stakeWeightPerUsdc", 14)), "0"],
      [String(field(rawConfig, "riskComponentCap", 15)), "0"],
      [String(field(rawConfig, "vouchWeight", 16)), "0"],
      [String(field(rawConfig, "vouchComponentCap", 17)), "0"],
      [String(field(rawConfig, "longevityBonusPerDay", 18)), "0"],
      [String(field(rawConfig, "longevityComponentCap", 19)), "0"],
      [String(field(rawConfig, "upheldDisputePenalty", 20)), "0"],
      [String(field(rawConfig, "reputationScoreCap", 21)), "0"],
    ] as const;
    if (lockedConfigValues.some(([actual, expected]) => actual !== expected)) {
      throw new Error(
        "Observed A1 config differs from the exact deployment-script configuration"
      );
    }

    const { events, checkpoint } = await scanDeploymentEvents({
      client,
      config,
      latestBlock,
      forceFullRescan: config.mode === "gate-c-readiness",
    });
    const roles = await assertExactRoleMatrix({
      client,
      contractAddress: config.contractAddress,
      events,
      expected: config.expectedRoleHolders,
    });
    const reports = await readMonitoredReports({
      client,
      contractAddress: config.contractAddress,
      events,
    });
    let gateCReadiness: GateCReadiness | undefined;
    if (config.mode === "gate-c-readiness") {
      const decision = readJson<GateCDecisionRecord>(
        config.gateCDecisionPath as string
      );
      if (!decision) {
        throw new Error(
          `Gate-C decision file does not exist: ${config.gateCDecisionPath}`
        );
      }
      const freshFixtureAddresses = [
        decision.fixtures.author,
        decision.fixtures.upheldBuyer,
        decision.fixtures.rejectedBuyer,
        decision.fixtures.expiryBuyer,
        ...decision.fixtures.vouchers,
      ]
        .map(normalizedAddress)
        .filter((value): value is string => value !== null);
      const registeredFixtureAddresses = (
        await Promise.all(
          freshFixtureAddresses.map(async (fixtureAddress) => {
            const profile = await client.readContract({
              address: config.contractAddress,
              abi: OPS_ABI,
              functionName: "getProfile",
              args: [getAddress(fixtureAddress)],
              blockNumber: latestBlock,
            });
            return Boolean(field(profile, "registered", 0))
              ? fixtureAddress
              : null;
          })
        )
      ).filter((value): value is string => value !== null);
      gateCReadiness = evaluateGateCDecision(decision, {
        candidateCommit: config.candidateCommit as string,
        chainId,
        protocolVersion: String(protocolVersion),
        contractAddress: config.contractAddress,
        libraryAddress: config.libraryAddress,
        deploymentBlock: config.deploymentBlock.toString(),
        usdcAddress,
        paused: Boolean(paused),
        slashPercentage: Number(field(rawConfig, "slashPercentage", 9)),
        restitutionRecipient: getAddress(
          String(field(rawConfig, "treasuryRecipient", 22))
        ),
        chainContext: String(field(rawConfig, "chainContext", 1)),
        reportBondUsdcMicros: String(
          field(rawConfig, "disputeBondUsdcMicros", 3)
        ),
        minVouchStakeUsdcMicros: String(
          field(rawConfig, "minVouchStakeUsdcMicros", 2)
        ),
        minAuthorBondForFreeListingUsdcMicros: String(
          field(rawConfig, "minAuthorBondForFreeListingUsdcMicros", 4)
        ),
        minPaidListingPriceUsdcMicros: String(
          field(rawConfig, "minPaidListingPriceUsdcMicros", 5)
        ),
        authorShareBps: Number(field(rawConfig, "authorShareBps", 6)),
        voucherShareBps: Number(field(rawConfig, "voucherShareBps", 7)),
        protocolFeeBps: Number(field(rawConfig, "protocolFeeBps", 8)),
        authorProceedsLockSeconds: String(
          field(rawConfig, "authorProceedsLockSeconds", 10)
        ),
        refundClaimWindowSeconds: String(
          field(rawConfig, "refundClaimWindowSeconds", 11)
        ),
        challengerRewardBps: Number(
          field(rawConfig, "challengerRewardBps", 12)
        ),
        challengerRewardCapUsdcMicros: String(
          field(rawConfig, "challengerRewardCapUsdcMicros", 13)
        ),
        stakeWeightPerUsdc: Number(field(rawConfig, "stakeWeightPerUsdc", 14)),
        riskComponentCap: String(field(rawConfig, "riskComponentCap", 15)),
        vouchWeight: Number(field(rawConfig, "vouchWeight", 16)),
        vouchComponentCap: String(field(rawConfig, "vouchComponentCap", 17)),
        longevityBonusPerDay: Number(
          field(rawConfig, "longevityBonusPerDay", 18)
        ),
        longevityComponentCap: String(
          field(rawConfig, "longevityComponentCap", 19)
        ),
        upheldDisputePenalty: String(
          field(rawConfig, "upheldDisputePenalty", 20)
        ),
        reputationScoreCap: String(field(rawConfig, "reputationScoreCap", 21)),
        roleHolders: roles,
        registeredFixtureAddresses,
      });
      atomicJson(
        path.join(config.stateDir, "gate-c-readiness.json"),
        gateCReadiness
      );
    }
    const eventDerivedReserveCredit = deriveEventReserveCredit(events);
    const alerts = buildPaidReportAlerts({
      nowSeconds: latest.timestamp,
      paused: Boolean(paused),
      expectedPaused: config.expectedPaused,
      acceptedAgeAlertSeconds: config.acceptedAgeAlertSeconds,
      creditExpiryAlertSeconds: config.creditExpiryAlertSeconds,
      eventDerivedReserveCredit,
      reports,
    });
    const contractUsdcBalance = await client.readContract({
      address: usdcAddress,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [config.contractAddress],
      blockNumber: latestBlock,
    });
    const manifest = {
      mode: config.mode,
      readOnly: true,
      chainId,
      protocolVersion,
      contractAddress: config.contractAddress,
      libraryAddress: config.libraryAddress,
      usdcAddress,
      deploymentBlock: config.deploymentBlock.toString(),
      observedBlock: latestBlock.toString(),
      observedBlockHash: latest.hash,
      facadeRuntimeHash: keccak256(facadeCode),
      libraryRuntimeHash: keccak256(libraryCode),
      roles,
    };
    atomicJson(path.join(config.stateDir, "manifest.json"), manifest);
    atomicJson(path.join(config.stateDir, "alerts.json"), alerts);
    atomicJson(path.join(config.stateDir, "balance-snapshot.json"), {
      blockNumber: latestBlock.toString(),
      blockHash: latest.hash,
      contractUsdcBalanceMicros: contractUsdcBalance.toString(),
    });
    atomicJson(path.join(config.stateDir, "summary.json"), {
      checkpoint,
      reportCount: reports.length,
      reports,
      eventDerivedReserveCreditUsdcMicros: eventDerivedReserveCredit.toString(),
      alerts,
      writeModesEnabled: false,
      gateCReadiness,
    });
    console.log(
      JSON.stringify({
        ok: gateCReadiness
          ? gateCReadiness.assessment === "READY_FOR_HUMAN_REVIEW"
          : true,
        mode: config.mode,
        readOnly: true,
        contractAddress: config.contractAddress,
        observedBlock: latestBlock.toString(),
        reportCount: reports.length,
        alertCount: alerts.length,
        gateCAssessment: gateCReadiness?.assessment,
        gateCExecutionAuthorized: gateCReadiness?.executionAuthorized,
        gateCBlockerCount: gateCReadiness?.blockers.length,
        stateDir: config.stateDir,
      })
    );
    if (gateCReadiness?.assessment === "BLOCKED") process.exitCode = 1;
  });
}

async function main(): Promise<void> {
  const config = loadConfig(process.argv.slice(2));
  await runReadOnlyOperations(config);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(sanitizeOpsDiagnostic(error));
    process.exitCode = 1;
  });
}
