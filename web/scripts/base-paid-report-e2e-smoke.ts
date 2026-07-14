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

export type OpsMode = "preflight" | "monitor";

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
  const mode = argv.find((arg) => !arg.startsWith("-")) ?? "preflight";
  if (mode !== "preflight" && mode !== "monitor") {
    throw new Error(
      `Unsupported mode ${mode}; only read-only preflight and monitor modes are enabled`
    );
  }
  return mode;
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
    mode: parseOpsMode(argv),
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
}): Promise<{ events: StoredEvent[]; checkpoint: MonitorCheckpoint }> {
  const eventPath = path.join(input.config.stateDir, "events.json");
  const checkpointPath = path.join(input.config.stateDir, "checkpoint.json");
  const checkpoint = readJson<MonitorCheckpoint>(checkpointPath);
  const events = readJson<StoredEvent[]>(eventPath) ?? [];
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
      config.mode === "preflight" &&
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
    if (
      BigInt(String(field(rawConfig, "disputeBondUsdcMicros", 3))) !==
        5_000_000n ||
      BigInt(String(field(rawConfig, "refundClaimWindowSeconds", 11))) !==
        604_800n ||
      Number(field(rawConfig, "challengerRewardBps", 12)) !== 0 ||
      BigInt(String(field(rawConfig, "challengerRewardCapUsdcMicros", 13))) !==
        0n
    ) {
      throw new Error(
        "Locked paid-report bond, claim window, or zero-reward economics differ"
      );
    }

    const { events, checkpoint } = await scanDeploymentEvents({
      client,
      config,
      latestBlock,
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
    });
    console.log(
      JSON.stringify({
        ok: true,
        mode: config.mode,
        readOnly: true,
        contractAddress: config.contractAddress,
        observedBlock: latestBlock.toString(),
        reportCount: reports.length,
        alertCount: alerts.length,
        stateDir: config.stateDir,
      })
    );
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
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
