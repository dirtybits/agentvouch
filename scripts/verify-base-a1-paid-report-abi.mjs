import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forgeArtifact =
  "contracts/base-poc/out/AgentVouchEvm.sol/AgentVouchEvm.json";
const sources = {
  web: "web/lib/adapters/agentVouchEvmAbi.ts",
  ui: "contracts/base-poc/ui/src/abi.ts",
  harness: "contracts/base-poc/harness/src/abi.ts",
};

// Curated paid-report surface only. Tuple-heavy non-report reads are intentionally
// outside this gate until the client ABI sources expose a structured format.
const buyerFunctions = [
  "openPaidPurchaseReport",
  "claimPaidPurchaseReportCredit",
  "getPaidPurchaseReportCore",
  "getPaidPurchaseReportSettlement",
  "getPaidPurchaseReportEvidence",
];
const operatorFunctions = [
  "reviewPaidPurchaseReport",
  "resolvePaidPurchaseReport",
  "slashPaidPurchaseReportVouches",
  "closePaidPurchaseReportCredit",
  "claimRestitutionReserve",
];
const events = [
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
const errors = [
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

function parseAbiFragments(relativePath) {
  const source = readFileSync(resolve(root, relativePath), "utf8");
  return [...source.matchAll(/"((?:function|event|error) [^"]+)"/g)].map(
    ([, fragment]) => fragment
  );
}

function normalizeType(type) {
  if (type === "uint") return "uint256";
  if (type === "int") return "int256";
  if (type === "byte") return "bytes1";
  return type;
}

function parameterTypes(parameters, { preserveIndexed = false } = {}) {
  if (parameters.includes("(")) {
    throw new Error(
      `tuple ABI fragments require a structured parser: ${parameters}`
    );
  }
  return parameters
    .split(",")
    .map((parameter) => parameter.trim())
    .filter(Boolean)
    .map((parameter) => {
      const tokens = parameter.split(/\s+/);
      const type = normalizeType(tokens[0]);
      return preserveIndexed && tokens.includes("indexed")
        ? `${type} indexed`
        : type;
    });
}

function clientAbiShape(fragment) {
  const match = fragment.match(
    /^(function|event|error) ([^(]+)\(([^)]*)\)(.*)$/
  );
  if (!match) throw new Error(`unsupported ABI fragment: ${fragment}`);
  const [, type, name, parameters, tail] = match;
  const inputs = parameterTypes(parameters, {
    preserveIndexed: type === "event",
  });
  const mutability =
    type === "function"
      ? tail.match(/\b(view|pure|payable)\b/)?.[1] ?? "nonpayable"
      : null;
  const returns =
    type === "function" ? tail.match(/returns \(([^)]*)\)/)?.[1] : null;
  const output = returns ? parameterTypes(returns) : [];
  if (type === "function") {
    return `${type} ${name}(${inputs.join(
      ","
    )}) ${mutability} returns(${output.join(",")})`;
  }
  return `${type} ${name}(${inputs.join(",")})`;
}

function structuredParameterType(parameter) {
  const type = normalizeType(parameter.type);
  if (!type.startsWith("tuple")) return type;
  if (!Array.isArray(parameter.components)) {
    throw new Error(`tuple parameter is missing components: ${type}`);
  }
  const suffix = type.slice("tuple".length);
  return `(${parameter.components
    .map(structuredParameterType)
    .join(",")})${suffix}`;
}

function artifactAbiShape(item) {
  const inputs = item.inputs.map((input) => {
    const type = structuredParameterType(input);
    return item.type === "event" && input.indexed ? `${type} indexed` : type;
  });
  if (item.type === "function") {
    const outputs = item.outputs.map(structuredParameterType);
    return `function ${item.name}(${inputs.join(",")}) ${
      item.stateMutability
    } returns(${outputs.join(",")})`;
  }
  return `${item.type} ${item.name}(${inputs.join(",")})`;
}

function loadForgeAbi() {
  const artifactPath = resolve(root, forgeArtifact);
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch (error) {
    throw new Error(
      `fresh Forge artifact is required at ${forgeArtifact}; run forge build --root contracts/base-poc (${error.message})`
    );
  }
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`Forge artifact at ${forgeArtifact} has no ABI array`);
  }
  return artifact.abi;
}

const parsed = Object.fromEntries(
  Object.entries(sources).map(([name, relativePath]) => [
    name,
    parseAbiFragments(relativePath),
  ])
);
const forgeAbi = loadForgeAbi();

function findClientShape(sourceName, type, name) {
  const prefix = `${type} ${name}(`;
  const fragments = parsed[sourceName].filter((fragment) =>
    fragment.startsWith(prefix)
  );
  if (fragments.length !== 1) {
    throw new Error(
      `${sourceName} must contain exactly one ${type} ${name}; found ${fragments.length}`
    );
  }
  return clientAbiShape(fragments[0]);
}

function findArtifactShape(type, name) {
  const items = forgeAbi.filter(
    (item) => item.type === type && item.name === name
  );
  if (items.length !== 1) {
    throw new Error(
      `Forge artifact must contain exactly one ${type} ${name}; found ${items.length}`
    );
  }
  return artifactAbiShape(items[0]);
}

function verify(type, names, sourceNames) {
  for (const name of names) {
    const expected = findArtifactShape(type, name);
    for (const sourceName of sourceNames) {
      const actual = findClientShape(sourceName, type, name);
      if (actual !== expected) {
        throw new Error(
          `${type} ${name} differs between Forge artifact and ${sourceName}: expected ${expected}; got ${actual}`
        );
      }
    }
  }
}

function verifyOmitted(type, names, sourceName) {
  for (const name of names) {
    const prefix = `${type} ${name}(`;
    if (parsed[sourceName].some((fragment) => fragment.startsWith(prefix))) {
      throw new Error(`${sourceName} must omit operator-only ${type} ${name}`);
    }
  }
}

try {
  verify("function", buyerFunctions, ["web", "ui", "harness"]);
  verify("function", operatorFunctions, ["ui", "harness"]);
  verifyOmitted("function", operatorFunctions, "web");
  verify("event", events, ["web", "ui", "harness"]);
  verify("error", errors, ["web", "ui", "harness"]);
  console.log(
    `Base A1 Forge/client ABI parity verified: ${buyerFunctions.length} buyer/read functions across web/ui/harness, ${operatorFunctions.length} operator functions across ui/harness (omitted from web), ${events.length} events and ${errors.length} errors across all clients.`
  );
} catch (error) {
  console.error(`Base A1 client ABI verification failed: ${error.message}`);
  process.exitCode = 1;
}
