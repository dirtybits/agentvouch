#!/usr/bin/env node
// publish-learned-skills.mjs
//
// Syncs authored "learned" skills into a checkout of the public skills repo
// (default: dirtybits/agent-skills) and ensures every skill carries an MIT
// LICENSE. This is the engine behind the daily "publish learned skills" loop
// (see .github/workflows/publish-learned-skills.yml and
// docs/SKILL_PUBLISHING_LOOP.md).
//
// What counts as publishable is driven by published-skills/local-skill-
// classification.json: only skills classified `authored` are pushed. Mirrored-
// upstream and private-local skills are skipped so we never republish work that
// needs provenance/licensing review or is local-only.
//
// Safe by default: prints a plan and exits 0 (or 2 with --exit-code when there
// are pending changes). Pass --apply to actually write files.
//
// Usage:
//   node scripts/publish-learned-skills.mjs [options]
//
// Options:
//   --skills-root <dir>    Source of skill directories.
//                          Default: ./published-skills
//                          (use ~/.agents/skills for the local canonical root)
//   --agent-skills <dir>   Target skills-repo checkout. Default: ./agent-skills
//   --skills-subdir <dir>  Subdir within the target repo that holds skills.
//                          Default: skills
//   --classification <f>   Classification JSON.
//                          Default: ./published-skills/local-skill-classification.json
//   --holder <name>        MIT copyright holder. Default: $SKILL_LICENSE_HOLDER
//                          or "dirtybits"
//   --year <YYYY>          MIT copyright year. Default: current year
//   --include a,b,c        Only operate on these skill names
//   --exclude a,b,c        Skip these skill names
//   --license-only         Do not copy skills; only ensure MIT LICENSE on every
//                          skill already present in the target repo
//   --license-name <f>     LICENSE filename to write. Default: LICENSE
//   --apply                Write changes (default is dry-run)
//   --exit-code            Exit 2 when there are pending/applied changes (for CI)
//   -h, --help             Show this help

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const opts = {
    skillsRoot: "./published-skills",
    agentSkills: "./agent-skills",
    skillsSubdir: "skills",
    classification: "./published-skills/local-skill-classification.json",
    holder: process.env.SKILL_LICENSE_HOLDER || "dirtybits",
    year: String(new Date().getUTCFullYear()),
    include: null,
    exclude: null,
    licenseOnly: false,
    licenseName: "LICENSE",
    apply: false,
    exitCode: false,
  };
  const list = (v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--skills-root":
        opts.skillsRoot = next();
        break;
      case "--agent-skills":
        opts.agentSkills = next();
        break;
      case "--skills-subdir":
        opts.skillsSubdir = next();
        break;
      case "--classification":
        opts.classification = next();
        break;
      case "--holder":
        opts.holder = next();
        break;
      case "--year":
        opts.year = next();
        break;
      case "--include":
        opts.include = list(next());
        break;
      case "--exclude":
        opts.exclude = list(next());
        break;
      case "--license-only":
        opts.licenseOnly = true;
        break;
      case "--license-name":
        opts.licenseName = next();
        break;
      case "--apply":
        opts.apply = true;
        break;
      case "--exit-code":
        opts.exitCode = true;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

function mitLicense(holder, year) {
  return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// A skill directory is any directory that directly contains a top-level
// SKILL.md (matches the mirror/discovery convention used elsewhere in the repo).
function isSkillDir(p) {
  return isDir(p) && isFile(path.join(p, "SKILL.md"));
}

function loadClassification(file) {
  if (!isFile(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse classification ${file}: ${err.message}`);
  }
}

// Build name -> classification entry map.
function classificationMap(classification) {
  const map = new Map();
  if (classification && Array.isArray(classification.skills)) {
    for (const s of classification.skills) {
      if (s && s.name) map.set(s.name, s);
    }
  }
  return map;
}

// Recursively collect file paths relative to root.
function walkFiles(root, rel = "") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, rel), {
    withFileTypes: true,
  })) {
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkFiles(root, childRel));
    } else if (entry.isFile()) {
      out.push(childRel);
    }
  }
  return out;
}

function readMaybe(p) {
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    // Print the header comment block as help.
    const self = fs.readFileSync(new URL(import.meta.url), "utf8");
    const header = self
      .split("\n")
      .filter((l) => l.startsWith("//"))
      .map((l) => l.replace(/^\/\/ ?/, ""))
      .join("\n");
    console.log(header);
    return;
  }

  const include = opts.include ? new Set(opts.include) : null;
  const exclude = opts.exclude ? new Set(opts.exclude) : new Set();
  const licenseText = mitLicense(opts.holder, opts.year);

  const targetSkillsDir = path.join(opts.agentSkills, opts.skillsSubdir);
  if (!isDir(opts.agentSkills)) {
    console.error(
      `error: agent-skills checkout not found: ${opts.agentSkills}\n` +
        `Clone the target repo there first (it is gitignored at /agent-skills/), ` +
        `or pass --agent-skills <path>.`,
    );
    process.exit(1);
  }

  const classification = loadClassification(opts.classification);
  const classMap = classificationMap(classification);

  const planned = []; // { type, skill, detail }

  function wantSkill(name) {
    if (include && !include.has(name)) return false;
    if (exclude.has(name)) return false;
    return true;
  }

  // --- License-only mode: stamp MIT into every existing target skill. ---
  if (opts.licenseOnly) {
    if (!isDir(targetSkillsDir)) {
      console.error(`error: target skills dir not found: ${targetSkillsDir}`);
      process.exit(1);
    }
    for (const name of fs.readdirSync(targetSkillsDir).sort()) {
      const dir = path.join(targetSkillsDir, name);
      if (!isSkillDir(dir) || !wantSkill(name)) continue;
      const licPath = path.join(dir, opts.licenseName);
      if (readMaybe(licPath)?.toString() === licenseText) continue;
      planned.push({
        type: isFile(licPath) ? "license-update" : "license-add",
        skill: name,
        detail: path.relative(opts.agentSkills, licPath),
        write: () => fs.writeFileSync(licPath, licenseText),
      });
    }
  } else {
    // --- Publish mode: sync authored skills + ensure MIT LICENSE. ---
    if (!isDir(opts.skillsRoot)) {
      console.error(`error: skills root not found: ${opts.skillsRoot}`);
      process.exit(1);
    }

    // Determine candidate skill names from the source root.
    const candidateNames = fs
      .readdirSync(opts.skillsRoot)
      .filter((name) => isSkillDir(path.join(opts.skillsRoot, name)))
      .sort();

    for (const name of candidateNames) {
      if (!wantSkill(name)) continue;
      const entry = classMap.get(name);
      // Default-safe: when classification is available, only publish skills it
      // marks `authored`. When a skill is absent from the classification, skip
      // it (provenance unknown) unless the user explicitly --include'd it.
      const classified = entry?.classification;
      const explicit = include?.has(name);
      if (classMap.size > 0 && classified !== "authored" && !explicit) {
        planned.push({
          type: "skip",
          skill: name,
          detail: classified
            ? `classification=${classified}`
            : "not in classification",
        });
        continue;
      }

      const srcDir = path.join(opts.skillsRoot, name);
      const dstDir = path.join(targetSkillsDir, name);

      // Sync every source file; track adds/updates.
      for (const relFile of walkFiles(srcDir)) {
        const src = path.join(srcDir, relFile);
        const dst = path.join(dstDir, relFile);
        const srcBuf = fs.readFileSync(src);
        const dstBuf = readMaybe(dst);
        if (dstBuf && dstBuf.equals(srcBuf)) continue;
        planned.push({
          type: dstBuf ? "update" : "add",
          skill: name,
          detail: path.join(name, relFile),
          write: () => {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.writeFileSync(dst, srcBuf);
          },
        });
      }

      // Ensure an MIT LICENSE in the target skill dir. If the source ships its
      // own LICENSE it was already handled by the walk-sync above; only
      // synthesize MIT here when the source lacks one.
      const srcLic = readMaybe(path.join(srcDir, opts.licenseName));
      if (!srcLic) {
        const licPath = path.join(dstDir, opts.licenseName);
        if (readMaybe(licPath)?.toString() !== licenseText) {
          planned.push({
            type: isFile(licPath) ? "license-update" : "license-add",
            skill: name,
            detail: path.join(name, opts.licenseName),
            write: () => {
              fs.mkdirSync(dstDir, { recursive: true });
              fs.writeFileSync(licPath, licenseText);
            },
          });
        }
      }
    }
  }

  // --- Report + (optionally) apply. ---
  const changes = planned.filter((p) => p.type !== "skip");
  const skips = planned.filter((p) => p.type === "skip");

  const mode = opts.apply ? "APPLY" : "DRY-RUN";
  console.log(
    `publish-learned-skills [${mode}] holder="${opts.holder}" year=${opts.year}`,
  );
  console.log(`  source : ${path.resolve(opts.skillsRoot)}`);
  console.log(`  target : ${path.resolve(targetSkillsDir)}`);
  if (opts.licenseOnly) console.log("  mode   : license-only");
  console.log("");

  for (const s of skips) {
    console.log(`  skip      ${s.skill}  (${s.detail})`);
  }
  if (skips.length) console.log("");

  for (const c of changes) {
    console.log(`  ${c.type.padEnd(15)} ${c.detail}`);
    if (opts.apply) c.write();
  }

  console.log("");
  if (changes.length === 0) {
    console.log("Nothing to do — target is up to date.");
  } else if (opts.apply) {
    console.log(`Applied ${changes.length} change(s).`);
  } else {
    console.log(
      `${changes.length} pending change(s). Re-run with --apply to write.`,
    );
  }

  if (opts.exitCode && changes.length > 0) process.exit(2);
}

try {
  main();
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
