// Side-effect-only module: verify the Node.js runtime satisfies the minimum
// version BEFORE any heavy dependency (the Solana / rpc-websockets stack) is
// imported. On an unsupported Node version those transitive deps fail with a
// cryptic `ERR_REQUIRE_ESM` stack trace at import time, before any command
// runs. Importing this module first turns that into a clear, actionable error.
//
// This file must stay dependency-free (only Node built-ins + package.json) so
// it can load on any runtime, and bin.ts must import it before ./cli.js.
import pkg from "../package.json";

type Version = [number, number, number];

function parseVersion(value: string): Version | null {
  const match = value.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

/**
 * Returns null when `current` satisfies `required` (a `>=x.y.z` engines range),
 * or a user-facing error message when it does not. Returns null when either
 * value cannot be parsed, so a malformed engines field never blocks the CLI.
 */
export function checkNodeVersion(
  current: string,
  required: string | undefined
): string | null {
  if (!required) {
    return null;
  }

  const minimum = parseVersion(required);
  const running = parseVersion(current);
  if (!minimum || !running) {
    return null;
  }

  if (compareVersions(running, minimum) >= 0) {
    return null;
  }

  const min = minimum.join(".");
  return [
    `agentvouch requires Node.js >=${min}, but you are running v${running.join(".")}.`,
    `Upgrade Node (e.g. \`nvm install ${minimum[0]}\` or https://nodejs.org) and try again.`,
  ].join("\n");
}

const failure = checkNodeVersion(
  process.versions.node,
  (pkg as { engines?: { node?: string } }).engines?.node
);

if (failure) {
  process.stderr.write(`${failure}\n`);
  process.exit(1);
}
