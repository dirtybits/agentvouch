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

function identifiers(cell) {
  return [...cell.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map(
    (match) => match[1]
  );
}

function parseSurfaceMap(markdown) {
  const begin = "<!-- BEGIN SURFACE MAP -->";
  const end = "<!-- END SURFACE MAP -->";
  const start = markdown.indexOf(begin);
  const finish = markdown.indexOf(end);
  if (start === -1 || finish === -1 || finish <= start) {
    throw new Error(
      "CHAIN_CAPABILITY_MAP.md is missing ordered surface-map markers"
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
    if (row.length !== 8) {
      throw new Error(
        `surface map row ${index + 1} has ${row.length} columns; expected 8`
      );
    }
  }

  return rows;
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

try {
  const rows = parseSurfaceMap(read("docs/CHAIN_CAPABILITY_MAP.md"));
  if (rows.length !== 26)
    throw new Error(`surface map has ${rows.length} rows; expected 26`);

  const mappedSolana = new Set(rows.flatMap((row) => identifiers(row[2])));
  const mappedBase = new Set(rows.flatMap((row) => identifiers(row[4])));
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
  assertSameSet(
    "chain map vs Base state-changing source",
    mappedBase,
    baseSource
  );

  console.log(
    `Chain capability map verified: ${anchorSource.size} Solana instructions, ${baseSource.size} Base state-changing functions, ${rows.length} mapped rows.`
  );
} catch (error) {
  console.error(`Chain capability map verification failed: ${error.message}`);
  process.exitCode = 1;
}
