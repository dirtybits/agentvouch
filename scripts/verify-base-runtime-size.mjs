import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARD_RUNTIME_LIMIT = 24_576;
const SOFT_RUNTIME_LIMIT = 23_500;
const INITCODE_LIMIT = 49_152;
const EXPECTED_STORAGE_LAYOUT_SHA256 =
  "1d3551ad881bfe94fef5e709f3d4fe4b7827f743e54d76fd9fb1ddec802dbbeb";

const EXPECTED_A1_FUNCTIONS = [
  "openPaidPurchaseReport",
  "reviewPaidPurchaseReport",
  "resolvePaidPurchaseReport",
  "slashPaidPurchaseReportVouches",
  "claimPaidPurchaseReportCredit",
  "closePaidPurchaseReportCredit",
  "claimRestitutionReserve",
  "getPaidPurchaseReportCore",
  "getPaidPurchaseReportSettlement",
  "getPaidPurchaseReportEvidence",
];
const STALE_REPORT_FUNCTIONS = [
  "openReport",
  "resolveReport",
  "openFinancialReport",
  "slashReportVouches",
  "claimFinancialReportRefund",
  "closeFinancialReportReserve",
  "getAuthorReport",
  "getFinancialReport",
];
const EXPECTED_A1_EVENTS = [
  "PaidPurchaseReportOpened",
  "PaidPurchaseReportAccepted",
  "PaidPurchaseReportRejected",
  "PaidPurchaseReportExpired",
  "PaidPurchaseReportParked",
  "PaidPurchaseReportVouchSlashed",
  "PaidPurchaseReportDismissed",
  "PaidPurchaseReportFinalized",
  "PaidPurchaseReportCreditClaimed",
  "PaidPurchaseReportCreditExpired",
  "RestitutionReserveClaimed",
];
const EXPECTED_A1_ERRORS = [
  "PaidPurchaseReportNotFound",
  "PaidPurchaseReportInvalidState",
  "PaidPurchaseReceiptIneligible",
  "PaidPurchaseReceiptConsumed",
  "PaidPurchaseBuyerBusy",
  "PaidPurchaseListingBusy",
  "PaidPurchaseAuthorBusy",
  "PaidPurchaseBuyerCooldown",
  "PaidPurchaseAuthorCooldown",
  "PaidPurchaseReviewExpired",
  "PaidPurchaseReviewOpen",
  "PaidPurchaseEvidenceTooLong",
  "PaidPurchaseSlashPageTooLarge",
  "PaidPurchaseSlashSnapshotIncomplete",
  "PaidPurchaseCreditNotFunded",
  "PaidPurchaseCreditExpired",
  "PaidPurchaseCreditOpen",
  "PaidPurchaseCreditAlreadyHandled",
  "PurchaseLaneIneligible",
];

function artifact(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

function byteLength(hex, label) {
  if (
    typeof hex !== "string" ||
    !hex.startsWith("0x") ||
    hex.length % 2 !== 0
  ) {
    throw new Error(`${label} is not a byte-aligned hex artifact`);
  }
  return (hex.length - 2) / 2;
}

function inspect(name, value, constructorArgsBytes = 0) {
  const runtime = byteLength(value.deployedBytecode.object, `${name} runtime`);
  const initcode = byteLength(value.bytecode.object, `${name} initcode`);
  const creationInput = initcode + constructorArgsBytes;
  const failures = [];
  if (runtime > HARD_RUNTIME_LIMIT)
    failures.push(`EIP-170 by ${runtime - HARD_RUNTIME_LIMIT} bytes`);
  if (runtime > SOFT_RUNTIME_LIMIT)
    failures.push(`soft limit by ${runtime - SOFT_RUNTIME_LIMIT} bytes`);
  if (creationInput > INITCODE_LIMIT)
    failures.push(`EIP-3860 by ${creationInput - INITCODE_LIMIT} bytes`);
  console.log(
    `${name}: runtime=${runtime} hard_headroom=${
      HARD_RUNTIME_LIMIT - runtime
    } ` +
      `soft_headroom=${SOFT_RUNTIME_LIMIT - runtime} initcode=${initcode} ` +
      `creation_input=${creationInput} initcode_headroom=${
        INITCODE_LIMIT - creationInput
      }`
  );
  if (failures.length > 0)
    throw new Error(`${name} exceeds ${failures.join(", ")}`);
}

function assertAbi(facade) {
  const namesByType = (type) =>
    new Set(
      facade.abi.filter((item) => item.type === type).map((item) => item.name)
    );
  const functions = namesByType("function");
  const events = namesByType("event");
  const errors = namesByType("error");
  for (const name of EXPECTED_A1_FUNCTIONS) {
    if (!functions.has(name)) throw new Error(`facade ABI is missing ${name}`);
  }
  for (const name of STALE_REPORT_FUNCTIONS) {
    if (functions.has(name))
      throw new Error(`facade ABI retains stale ${name}`);
  }
  for (const name of EXPECTED_A1_EVENTS) {
    if (!events.has(name))
      throw new Error(`facade ABI is missing event ${name}`);
  }
  for (const name of EXPECTED_A1_ERRORS) {
    if (!errors.has(name))
      throw new Error(`facade ABI is missing error ${name}`);
  }
}

function normalizedStorageHash(storageLayout) {
  // Solc embeds compilation-unit AST ids in struct/enum type identifiers (for
  // example `t_struct(Config)56857_storage`). Those ids change when unrelated
  // test contracts enter the build graph, so strip them before freezing layout.
  const canonicalType = (type) =>
    type.replace(
      /t_(struct|enum)\(([^)]+)\)\d+(_storage)?/g,
      (_, kind, label, storageSuffix = "") =>
        `t_${kind}(${label})${storageSuffix}`
    );
  const types = Object.fromEntries(
    Object.entries(storageLayout.types)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        canonicalType(key),
        {
          encoding: value.encoding,
          label: value.label,
          numberOfBytes: value.numberOfBytes,
          members: value.members?.map(({ label, slot, offset, type }) => ({
            label,
            slot,
            offset,
            type: canonicalType(type),
          })),
        },
      ])
  );
  const normalized = {
    storage: storageLayout.storage.map(({ label, slot, offset, type }) => ({
      label,
      slot,
      offset,
      type: canonicalType(type),
    })),
    types,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

try {
  const facade = artifact(
    "contracts/base-poc/out/AgentVouchEvm.sol/AgentVouchEvm.json"
  );
  const settlement = artifact(
    "contracts/base-poc/out/PaidPurchaseSettlement.sol/PaidPurchaseSettlement.json"
  );
  const links = facade.deployedBytecode.linkReferences ?? {};
  const linkedNames = Object.values(links).flatMap((contracts) =>
    Object.keys(contracts)
  );
  if (linkedNames.length !== 1 || linkedNames[0] !== "PaidPurchaseSettlement") {
    throw new Error(
      `unexpected facade link references: ${linkedNames.join(", ") || "none"}`
    );
  }
  assertAbi(facade);
  const storageHash = normalizedStorageHash(facade.storageLayout);
  if (storageHash !== EXPECTED_STORAGE_LAYOUT_SHA256) {
    throw new Error(
      `facade storage layout drifted: expected ${EXPECTED_STORAGE_LAYOUT_SHA256}, got ${storageHash}`
    );
  }

  // AgentVouchEvm(address,address) contributes two 32-byte ABI words to creation input.
  inspect("AgentVouchEvm", facade, 64);
  inspect("PaidPurchaseSettlement", settlement);
} catch (error) {
  console.error(`Base runtime-size verification failed: ${error.message}`);
  process.exitCode = 1;
}
