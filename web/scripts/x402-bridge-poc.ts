import {
  evaluateX402BridgePoc,
  evaluateX402SettlementDestinationPoc,
} from "@/lib/x402BridgePoc";

async function main() {
  const readiness = evaluateX402BridgePoc();
  const settlementDestination = await evaluateX402SettlementDestinationPoc();
  const report = {
    readiness,
    settlementDestination,
  };

  console.log(JSON.stringify(report, null, 2));

  if (
    process.argv.includes("--strict") &&
    (!settlementDestination.currentVaultCompatible ||
      settlementDestination.proofStatus !== "complete")
  ) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
