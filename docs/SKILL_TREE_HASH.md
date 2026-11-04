# Skill Tree Hash (`agentvouch-tree-v1`)

<!-- plain-language-reading-guide: 2026-10-24 -->

> Status: normative, version 1. Written 2026-10-24.
> It describes what `computeTreeHash` in `web/lib/skillStorage.ts` already does at `main` `dfc5fff5`. It does not change any stored hash.
> Test vectors: `packages/agentvouch-protocol/test-vectors/tree-hash.json`.
> Plan: `.agents/plans/skill-evals-and-packages.plan.md` (Phase 1).

## What the tree hash is

The tree hash is the fingerprint of one skill version. It covers the path and the exact bytes of every file in the version. If one byte or one file name changes, the tree hash changes.

AgentVouch uses the tree hash to:

- name one exact version (scan results in `skill_scans` use it as their key);
- let a client check that downloaded files are the files that AgentVouch stored and reports.

A matching tree hash proves that the bytes are unchanged. It does not prove that the content is safe. Trust evidence (stake, Reports, scans, evaluations) is separate.

## Terms

- **Skill tree:** the files of one skill version. It contains exactly one top-level `SKILL.md`.
- **Path:** the location of a file in the tree, relative to the tree root, with `/` between segments.
- **Digest:** the lowercase hexadecimal SHA-256 of the exact bytes of one file (64 characters).

## Path rules

A stored path obeys all of these rules. Upload enforces them (`normalizeSkillPath` and `normalizeSkillTreeFiles` in `web/lib/skillStorage.ts`).

1. It is not empty.
2. It has no white space at the start or end. Upload removes it.
3. It is relative. It does not start with `/` or with a drive letter such as `C:/`.
4. It uses `/` only. Upload changes `\` to `/`, so a stored path never contains `\`.
5. It has no empty segment (`a//b`, `dir/`), no `.` segment, and no `..` segment.
6. It is unique in the tree.
7. One path is exactly `SKILL.md`.

AgentVouch stores and hashes path text exactly as it was received, as UTF-8. It applies no Unicode normalization. Two names that look the same can be different paths: `café.md` written with `é` (U+00E9, NFC) and `café.md` written with `e` plus a combining accent (U+0065 U+0301, NFD). They give different tree hashes. Publishers should use NFC names.

**Client rule:** a client must also reject a tree in which one path is a folder of another path, for example `docs` and `docs/a.md`. Such a tree cannot be written to a file system. Upload does not enforce this yet (see [Known gaps](#known-gaps-2026-10-24)).

## Algorithm

Input: the path and the bytes of every file in the tree.

1. For each file, compute its digest: the lowercase hex SHA-256 of its exact bytes. Do not change line endings, text encoding, or a byte order mark.
2. For each file, make one entry: the path, then one U+0000 (NUL) character, then the digest.
3. Sort the entries in ascending UTF-16 code unit order. This is the default JavaScript string sort (`Array.prototype.sort()` with no compare function).
4. Join the sorted entries with one U+000A (LF) between entries. Do not add an LF at the end.
5. Encode the joined text as UTF-8.
6. The tree hash is the lowercase hex SHA-256 of those bytes.

Notes:

- **Only paths and bytes go into the hash.** Content type, the executable flag, file mode, timestamps, and the archive format do not. AgentVouch computes the executable flag from the path and the first bytes, so the flag cannot change without a path or byte change.
- **Do not use locale-aware sorting.** For ASCII paths, UTF-16 code unit order is the same as byte order, so uppercase letters sort before lowercase letters: `SKILL.md`, then `Zebra.md`, then `references/api.md`. `localeCompare` and ICU collation give a different order and a wrong hash.
- **Code unit order is not code point order.** For most non-ASCII paths the two orders agree. They differ when a character above U+FFFF meets a character from U+E000 to U+FFFF. Example: `😀` (U+1F600, code units D83D DE00) sorts before `～` (U+FF5E) in code unit order, but after it in code point order. Use code unit order. In Python, sort with `key=lambda entry: entry.encode("utf-16-be")`.
- **Entries are sorted, not paths.** NUL is lower than every other character, so the result is the same as sorting the paths.

### Reference implementations

TypeScript (the production code in `web/lib/skillStorage.ts`, reduced):

```ts
import { createHash } from "node:crypto";

export function treeHash(files: { path: string; bytes: Uint8Array }[]): string {
  const entries = files
    .map((file) => {
      const digest = createHash("sha256").update(file.bytes).digest("hex");
      return `${file.path}\0${digest}`;
    })
    .sort();
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}
```

Python (standard library; the full version is `packages/agentvouch-protocol/test-vectors/tree_hash_reference.py`):

```python
import hashlib

def tree_hash(files):  # files: list of (path: str, data: bytes)
    entries = ["%s\0%s" % (path, hashlib.sha256(data).hexdigest()) for path, data in files]
    entries.sort(key=lambda entry: entry.encode("utf-16-be"))
    return hashlib.sha256("\n".join(entries).encode("utf-8")).hexdigest()
```

## The manifest

Each version stores a manifest in `skill_versions.files`. The API returns it as `files` in `GET /api/skills/{id}`. It has one entry per file:

| Field         | Meaning                                                  | In the hash      |
| ------------- | -------------------------------------------------------- | ---------------- |
| `path`        | The stored path                                          | Yes              |
| `sha256`      | The file digest                                          | Yes (as step 1)  |
| `size`        | The file length in bytes                                 | No               |
| `contentType` | The served content type                                  | No               |
| `executable`  | Computed from the path and the first bytes               | No               |

The manifest digests are the output of step 1, so the tree hash can be computed from the manifest alone. This lets a client check one file without the whole tree.

## How a client checks a download

1. Read `tree_hash` and `files` from `GET /api/skills/{id}`. Treat them as the claim to check.
2. **Tree download** (`/api/skills/{id}/archive`):
   - Read the tar archive. Reject any entry that is not a regular file.
   - Reject any path that breaks the path rules, including a path that is also a folder of another path.
   - Compute the tree hash from the extracted bytes.
   - Stop if it differs from `tree_hash`. Do not move files to their final place before the check passes.
3. **One file** (`/api/skills/{id}/raw?path=...`):
   - Compute the digest of the downloaded bytes. Compare it with the manifest entry for that path.
   - Compute the tree hash from the manifest digests. Compare it with `tree_hash`.
   - Stop if either check fails.
4. Record the checked tree hash with the install. The CLI writes it to `<path>.agentvouch.json`.

Note: `/raw` serves `SKILL.md` from `skill_versions.content` for every storage type. The stored tree must therefore hold the same `SKILL.md` bytes. The sweep below checks this.

## Legacy single-file versions

Single-file versions that existed before multi-file storage got a manifest and a tree hash from a SQL backfill in `web/lib/db.ts`. That SQL computes the SHA-256 of `SKILL.md`, then NUL, then the hex digest of the content. This is the same as the algorithm for a tree with one file. The vector test checks this equivalence.

## Test vectors

`packages/agentvouch-protocol/test-vectors/tree-hash.json` lists inputs and expected results:

| Vector                          | What it pins                                                        |
| ------------------------------- | ------------------------------------------------------------------- |
| `single-skill-md`               | The basic one-file case and the legacy SQL formula                  |
| `crlf-line-endings`             | Bytes are hashed exactly: CRLF and LF differ                        |
| `empty-file`                    | A zero-byte file                                                    |
| `binary-file`                   | Raw bytes that are not valid UTF-8                                  |
| `ascii-case-order`              | Uppercase sorts before lowercase; locale-aware sorting fails        |
| `punctuation-and-space-order`   | Order of space, `-`, `.`, `/`, `_`; a file before a same-name folder |
| `unicode-nfc-path`              | A non-ASCII path in NFC                                             |
| `unicode-nfd-path`              | The same visible path in NFD gives a different hash                 |
| `astral-vs-bmp-order`           | UTF-16 code unit order, not code point order                        |
| `nested-tree`                   | Several nested folders                                              |
| `invalid_paths` (list)          | Paths that every implementation must reject                         |

Two independent implementations check the vectors:

- `web/__tests__/lib/treeHashVectors.test.ts` runs the production code.
- `tree_hash_reference.py` is a standard-library Python version. It produced the expected values. Run it with `python3 packages/agentvouch-protocol/test-vectors/tree_hash_reference.py`.

On 2026-10-24, three wrong implementations were tried against the vectors. Each one failed: locale-aware sorting, code point sorting, and NFC normalization of paths.

To add a vector: add its inputs, run `tree_hash_reference.py --write`, review the diff, run `npx prettier --write` on the JSON file, then run both checks.

`tree_hash_reference.py --dir PATH` prints the tree hash of a local folder. It leaves out the same files as `agentvouch` CLI publish: `.git` and `node_modules` folders, `.DS_Store` files, `*.agentvouch.json` files, and symbolic links.

## Checking stored data

`web/scripts/tree-hash-sweep.ts` recomputes the tree hash of stored versions and lists every version where the data does not agree. Run it before the CLI starts to stop installs on a hash mismatch.

It is read-only:

- It runs one SELECT query (built and tested in `web/lib/treeHashAudit.ts`). It never calls `initializeDatabase()`, which runs schema changes.
- It reads Blob storage. It never writes or deletes.
- It does not call the download routes. Those routes record download events and change public install counts.

Usage, from `web/`:

```bash
npx tsx --env-file=.env.local ./scripts/tree-hash-sweep.ts --latest-only
npx tsx --env-file=.env.local ./scripts/tree-hash-sweep.ts --json tree-hash-sweep.json
# or, with the variables exported:
npm run db:tree-hash-sweep --workspace @agentvouch/web -- --skill <uuid> --verbose
```

It needs `DATABASE_URL`, and `BLOB_READ_WRITE_TOKEN` for multi-file versions. It prints the database host before the query. If `EXPECTED_DATABASE_HOST` is set and does not match, it stops before it reads anything. Exit codes: `0` every version matches, `1` one or more versions have findings, `2` setup or usage error.

Finding codes:

| Code                          | Meaning                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| `missing_tree_hash`           | The version has no stored tree hash                                        |
| `malformed_tree_hash`         | The stored tree hash is not 64 lowercase hex characters                    |
| `missing_manifest`            | The version has no stored manifest                                         |
| `invalid_manifest`            | The manifest is not an array of valid entries                              |
| `manifest_tree_hash_mismatch` | The manifest digests give a different tree hash                            |
| `files_unavailable`           | The stored bytes could not be read: for example a missing Blob archive, or a tree above the upload limits (see Known gaps) |
| `bytes_tree_hash_mismatch`    | The stored bytes give a different tree hash                                |
| `file_digest_mismatch`        | A file's bytes do not match its manifest digest                            |
| `file_size_mismatch`          | A file's length does not match its manifest size                           |
| `file_missing_from_manifest`  | Storage has a file that the manifest does not list                         |
| `file_missing_from_storage`   | The manifest lists a file that storage does not have                       |
| `raw_skill_md_mismatch`       | `skill_versions.content` (served by `/raw`) differs from the tree's `SKILL.md` |
| `invalid_path`                | A stored path breaks the path rules                                        |
| `duplicate_path`              | A path appears more than once                                              |
| `missing_skill_md`            | The tree has no top-level `SKILL.md`                                       |
| `path_conflict`               | A path is a file and also a folder of another path                         |

## Changes to this algorithm

A change to any step is a new algorithm with a new name, for example `agentvouch-tree-v2`. Stored hashes keep the version that made them. Never change `agentvouch-tree-v1` in place.

## Known gaps (2026-10-24)

- Upload does not reject a tree where one path is also a folder of another path. The sweep reports such trees as `path_conflict`. The fix is planned with the CLI download check (Phase 1, second PR).
- The CLI records `tree_hash` but does not check downloads against it yet (Phase 1, second PR).
- The `/zip` builder sorts entries with `localeCompare`, which depends on the server's ICU data. Zip bytes can differ between servers, so do not pin zip bytes. The tree hash does not depend on archive bytes.
- The stored-tar reader (`ingestTarArchive`) enforces the upload limits (200 files, 5 MB), but mirror sync stores trees up to 512 files and 8 MB. `/raw?path=` and `/zip` use that reader, so they cannot serve a mirrored tree above the upload limits. The sweep reports such a version as `files_unavailable` with the limit message. `/archive` is not affected, because it serves the stored tar bytes directly.
