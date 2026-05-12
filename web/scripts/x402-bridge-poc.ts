import { evaluateX402BridgePoc } from "@/lib/x402BridgePoc";

const report = evaluateX402BridgePoc();
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes("--strict") && report.status !== "pass") {
  process.exitCode = 1;
}
