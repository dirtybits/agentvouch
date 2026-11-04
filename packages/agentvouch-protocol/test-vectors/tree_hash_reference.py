#!/usr/bin/env python3
"""Reference implementation of the AgentVouch skill tree hash, version 1.

Algorithm id: agentvouch-tree-v1. Spec: docs/SKILL_TREE_HASH.md.

This file is independent of web/lib/skillStorage.ts on purpose: two
implementations in two languages check the same vectors. Standard library only.

Usage (paths relative to the repository root):

  python3 packages/agentvouch-protocol/test-vectors/tree_hash_reference.py
      Check every vector in tree-hash.json. Exit 1 on any mismatch.

  python3 packages/agentvouch-protocol/test-vectors/tree_hash_reference.py --write
      Recompute every "expected" block from the inputs. Review the diff, then
      run prettier on tree-hash.json before you commit it.

  python3 packages/agentvouch-protocol/test-vectors/tree_hash_reference.py --dir PATH
      Print the tree hash of a local skill folder. Uses the CLI publish skip
      rules: .git and node_modules folders, .DS_Store files, *.agentvouch.json
      files, and symbolic links are left out.
"""

import argparse
import base64
import hashlib
import json
import os
import re
import sys

ALGORITHM = "agentvouch-tree-v1"
VECTORS_SCHEMA = "agentvouch.tree-hash-vectors/v1"
VECTORS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "tree-hash.json"
)

_DRIVE_LETTER = re.compile(r"^[A-Za-z]:/")
_SKIP_DIRECTORY_NAMES = {".git", "node_modules"}
_SKIP_FILE_NAMES = {".DS_Store"}


def file_digest(data):
    """Lowercase hex SHA-256 of the exact file bytes."""
    return hashlib.sha256(data).hexdigest()


def _utf16_key(text):
    # Big-endian UTF-16 bytes compare in the same order as UTF-16 code units.
    # That is the JavaScript default string sort used by computeTreeHash.
    return text.encode("utf-16-be", "surrogatepass")


def sort_paths(paths):
    """Sort paths in UTF-16 code unit order (JavaScript default sort)."""
    return sorted(paths, key=_utf16_key)


def tree_hash_from_digests(digests):
    """digests: iterable of (path, lowercase hex sha256). Returns the tree hash."""
    entries = ["%s\0%s" % (path, digest) for path, digest in digests]
    entries.sort(key=_utf16_key)
    return hashlib.sha256("\n".join(entries).encode("utf-8")).hexdigest()


def tree_hash(files):
    """files: iterable of (path, bytes). Returns the tree hash."""
    return tree_hash_from_digests(
        (path, file_digest(data)) for path, data in files
    )


def path_error(path):
    """Return why a stored path breaks the path rules, or None if it is valid."""
    if not path:
        return "empty path"
    if path != path.strip() or path.startswith("﻿") or path.endswith("﻿"):
        return "leading or trailing white space"
    if "\\" in path:
        return "backslash (stored paths use / only)"
    if path.startswith("/") or _DRIVE_LETTER.match(path):
        return "absolute path"
    segments = path.split("/")
    if any(segment == "" for segment in segments):
        return "empty segment"
    if any(segment in (".", "..") for segment in segments):
        return "dot segment"
    return None


def tree_errors(paths):
    """Return tree-level errors: duplicates, SKILL.md, and file/folder conflicts."""
    errors = set()
    seen = set()
    for path in paths:
        if path in seen:
            errors.add("duplicate path: %s" % path)
        seen.add(path)
    if "SKILL.md" not in seen:
        errors.add("missing top-level SKILL.md")
    for path in seen:
        parts = path.split("/")
        for index in range(1, len(parts)):
            prefix = "/".join(parts[:index])
            if prefix in seen:
                errors.add("path conflict: %s is a file and a folder" % prefix)
    return sorted(errors)


def _vector_bytes(file_entry):
    if "content_base64" in file_entry:
        return base64.b64decode(file_entry["content_base64"], validate=True)
    return file_entry["content_utf8"].encode("utf-8")


def compute_expected(vector):
    files = [(entry["path"], _vector_bytes(entry)) for entry in vector["files"]]
    problems = [
        "%s: %s" % (path, path_error(path)) for path, _ in files if path_error(path)
    ]
    problems.extend(tree_errors([path for path, _ in files]))
    if problems:
        raise ValueError(
            "vector %s is not a valid tree: %s" % (vector["id"], "; ".join(problems))
        )
    ordered = sort_paths([path for path, _ in files])
    digests = {path: file_digest(data) for path, data in files}
    return {
        "sorted_paths": ordered,
        "file_sha256": {path: digests[path] for path in ordered},
        "tree_hash": tree_hash(files),
    }


def load_vectors(path=VECTORS_PATH):
    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)
    if document.get("schema") != VECTORS_SCHEMA:
        raise ValueError("unexpected vectors schema: %r" % document.get("schema"))
    if document.get("algorithm") != ALGORITHM:
        raise ValueError("unexpected algorithm: %r" % document.get("algorithm"))
    return document


def check_vectors(document):
    failures = []
    ids = [vector["id"] for vector in document["vectors"]]
    if len(ids) != len(set(ids)):
        failures.append("duplicate vector ids")
    for vector in document["vectors"]:
        try:
            actual = compute_expected(vector)
        except ValueError as error:
            failures.append(str(error))
            continue
        if actual != vector.get("expected"):
            failures.append("vector %s: expected block does not match" % vector["id"])
    for case in document.get("invalid_paths", []):
        if path_error(case["path"]) is None:
            failures.append("invalid path %r was accepted" % case["path"])
    return failures


def write_vectors(document, path=VECTORS_PATH):
    for vector in document["vectors"]:
        vector["expected"] = compute_expected(vector)
    with open(path, "w", encoding="utf-8") as handle:
        # ensure_ascii keeps non-ASCII paths as \u escapes, so editors and tools
        # that normalize Unicode cannot silently change the NFC/NFD vectors.
        handle.write(json.dumps(document, indent=2, ensure_ascii=True) + "\n")


def collect_directory(root):
    files = []
    for current, folders, names in os.walk(root, followlinks=False):
        folders[:] = sorted(
            name
            for name in folders
            if name not in _SKIP_DIRECTORY_NAMES
            and not os.path.islink(os.path.join(current, name))
        )
        for name in names:
            absolute = os.path.join(current, name)
            if os.path.islink(absolute):
                continue
            if name in _SKIP_FILE_NAMES or name.endswith(".agentvouch.json"):
                continue
            relative = os.path.relpath(absolute, root).replace(os.sep, "/")
            with open(absolute, "rb") as handle:
                files.append((relative, handle.read()))
    return files


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--write", action="store_true", help="recompute expected blocks")
    group.add_argument("--dir", help="print the tree hash of a local skill folder")
    args = parser.parse_args(argv)

    if args.dir:
        files = collect_directory(args.dir)
        problems = [
            "%s: %s" % (path, path_error(path)) for path, _ in files if path_error(path)
        ]
        problems.extend(tree_errors([path for path, _ in files]))
        for problem in problems:
            print("warning: %s" % problem, file=sys.stderr)
        print(tree_hash(files))
        return 1 if problems else 0

    document = load_vectors()
    if args.write:
        write_vectors(document)
        print("wrote %d vectors to %s" % (len(document["vectors"]), VECTORS_PATH))
        return 0

    failures = check_vectors(document)
    for failure in failures:
        print("FAIL %s" % failure)
    if failures:
        return 1
    print(
        "ok: %d vectors and %d invalid paths match %s"
        % (len(document["vectors"]), len(document.get("invalid_paths", [])), ALGORITHM)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
