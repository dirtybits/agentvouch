import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function sorted(values) {
  return [...values].sort();
}

function difference(left, right) {
  return sorted([...left].filter((value) => !right.has(value)));
}

function assertSameSet(label, actual, expected) {
  const missing = difference(expected, actual);
  const extra = difference(actual, expected);
  if (missing.length === 0 && extra.length === 0) return;

  const details = [];
  if (missing.length > 0) details.push(`missing: ${missing.join(", ")}`);
  if (extra.length > 0) details.push(`extra: ${extra.join(", ")}`);
  throw new Error(`${label} drifted (${details.join("; ")})`);
}

function functionIdentifiers(cell) {
  return [...cell.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^`]*\))?`/g)].map(
    (match) => match[1]
  );
}

function parseMarkedTable(markdown, begin, end, expectedColumns, label) {
  const start = markdown.indexOf(begin);
  const finish = markdown.indexOf(end);
  if (start === -1 || finish === -1 || finish <= start) {
    throw new Error(
      `CHAIN_CAPABILITY_MAP.md is missing ordered ${label} markers`
    );
  }

  const tableLines = markdown
    .slice(start + begin.length, finish)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  if (tableLines.length < 3) throw new Error("surface map table is empty");

  const rows = tableLines.slice(2).map((line) =>
    line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim())
  );
  for (const [index, row] of rows.entries()) {
    if (row.length !== expectedColumns) {
      throw new Error(
        `${label} row ${index + 1} has ${
          row.length
        } columns; expected ${expectedColumns}`
      );
    }
  }

  return rows;
}

function parseSurfaceMap(markdown) {
  return parseMarkedTable(
    markdown,
    "<!-- BEGIN SURFACE MAP -->",
    "<!-- END SURFACE MAP -->",
    8,
    "surface-map"
  );
}

function blockedA1FunctionNames(markdown) {
  const rows = parseMarkedTable(
    markdown,
    "<!-- BEGIN BLOCKED A1 SURFACE -->",
    "<!-- END BLOCKED A1 SURFACE -->",
    5,
    "blocked-A1-surface"
  );
  return new Set(
    rows
      .filter((row) => row[2] === "`PARTIAL_SOURCE_BLOCKED_EIP170`")
      .flatMap((row) => functionIdentifiers(row[3]))
  );
}

function anchorInstructionNames(source) {
  return new Set(
    [
      ...source.matchAll(/\bpub\s+fn\s+([a-z][a-z0-9_]*)\s*(?:<[^>]+>)?\s*\(/g),
    ].map((match) => match[1])
  );
}

function baseStateChangingFunctionNames(source) {
  const contractStart = source.indexOf("contract AgentVouchEvm");
  if (contractStart === -1)
    throw new Error("AgentVouchEvm contract declaration not found");

  const contractSource = source.slice(contractStart);
  const names = new Set();
  const functions =
    /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*([^\{;]*)\{/gms;
  for (const match of contractSource.matchAll(functions)) {
    const [, name, declarationTail] = match;
    if (!/\b(?:external|public)\b/.test(declarationTail)) continue;
    if (/\b(?:view|pure)\b/.test(declarationTail)) continue;
    names.add(name);
  }
  return names;
}

function assertBaseSurface(mappedBase, blockedA1, baseSource) {
  const missingMapped = difference(mappedBase, baseSource);
  const allowed = new Set([...mappedBase, ...blockedA1]);
  const undocumented = difference(baseSource, allowed);
  if (missingMapped.length > 0 || undocumented.length > 0) {
    const details = [];
    if (missingMapped.length > 0) {
      details.push(`missing mapped functions: ${missingMapped.join(", ")}`);
    }
    if (undocumented.length > 0) {
      details.push(`undocumented functions: ${undocumented.join(", ")}`);
    }
    throw new Error(
      `chain map vs Base state-changing source drifted (${details.join("; ")})`
    );
  }

  const presentBlocked = new Set(
    [...baseSource].filter((name) => blockedA1.has(name))
  );
  if (presentBlocked.size > 0) {
    assertSameSet(
      "blocked A1 table vs Base state-changing source",
      presentBlocked,
      blockedA1
    );
  }
}

try {
  const mapMarkdown = read("docs/CHAIN_CAPABILITY_MAP.md");
  const rows = parseSurfaceMap(mapMarkdown);
  if (rows.length !== 26)
    throw new Error(`surface map has ${rows.length} rows; expected 26`);

  const mappedSolana = new Set(
    rows.flatMap((row) => functionIdentifiers(row[2]))
  );
  const mappedBase = new Set(
    rows.flatMap((row) => functionIdentifiers(row[4]))
  );
  const blockedA1 = blockedA1FunctionNames(mapMarkdown);
  const anchorSource = anchorInstructionNames(
    read("programs/agentvouch/src/lib.rs")
  );
  const anchorIdl = new Set(
    JSON.parse(read("web/agentvouch.json")).instructions.map(({ name }) => name)
  );
  const baseSource = baseStateChangingFunctionNames(
    read("contracts/base-poc/src/AgentVouchEvm.sol")
  );

  assertSameSet("Anchor source vs checked-in IDL", anchorSource, anchorIdl);
  assertSameSet("chain map vs Anchor source", mappedSolana, anchorSource);
  assertBaseSurface(mappedBase, blockedA1, baseSource);

  console.log(
    `Chain capability map verified: ${anchorSource.size} Solana instructions, ${baseSource.size} Base state-changing functions, ${blockedA1.size} documented blocked A1 functions, ${rows.length} mapped rows.`
  );
} catch (error) {
  console.error(`Chain capability map verification failed: ${error.message}`);
  process.exitCode = 1;
}
