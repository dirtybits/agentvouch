"""
Create a copy of a PowerPoint deck without speaker notes.

By default this reads:
    pitch/AgentVouch_walkthrough.pptx

and writes:
    pitch/AgentVouch_walkthrough.no-notes.pptx

Run from anywhere:
    python3 themes/remove_speaker_notes.py
    python3 themes/remove_speaker_notes.py input.pptx output.pptx

No dependencies beyond the stdlib.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_SRC = REPO_ROOT / "pitch" / "AgentVouch_walkthrough.pptx"
DEFAULT_DST = REPO_ROOT / "pitch" / "AgentVouch_walkthrough.no-notes.pptx"

CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NOTES_REL_TYPES = {
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
}
NOTES_CONTENT_TYPES = {
    "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
    "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml",
}
NOTES_PREFIXES = (
    "ppt/notesSlides/",
    "ppt/notesMasters/",
)

ET.register_namespace("", CONTENT_TYPES_NS)
ET.register_namespace("", REL_NS)


def is_notes_part(name: str) -> bool:
    return name.startswith(NOTES_PREFIXES)


def is_notes_rels_part(name: str) -> bool:
    return (
        name.startswith("ppt/notesSlides/_rels/")
        or name.startswith("ppt/notesMasters/_rels/")
    )


def strip_content_type_notes(data: bytes) -> tuple[bytes, int]:
    root = ET.fromstring(data)
    removed = 0
    for child in list(root):
        part_name = child.attrib.get("PartName", "").lstrip("/")
        content_type = child.attrib.get("ContentType")
        if part_name.startswith(NOTES_PREFIXES) or content_type in NOTES_CONTENT_TYPES:
            root.remove(child)
            removed += 1
    if not removed:
        return data, 0
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True), removed


def strip_notes_relationships(data: bytes) -> tuple[bytes, int]:
    root = ET.fromstring(data)
    removed = 0
    for child in list(root):
        rel_type = child.attrib.get("Type")
        target = child.attrib.get("Target", "")
        normalized_target = target.replace("\\", "/")
        if rel_type in NOTES_REL_TYPES or "notesSlides/" in normalized_target or "notesMasters/" in normalized_target:
            root.remove(child)
            removed += 1
    if not removed:
        return data, 0
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True), removed


def remove_speaker_notes(src: Path, dst: Path) -> dict[str, int]:
    if not src.exists():
        sys.exit(f"source not found: {src}")
    if src.resolve() == dst.resolve():
        sys.exit("output path must differ from input path so the original deck is preserved")
    dst.parent.mkdir(parents=True, exist_ok=True)

    stats = {
        "skipped_parts": 0,
        "removed_content_types": 0,
        "removed_relationships": 0,
        "copied_parts": 0,
    }

    out = BytesIO()
    with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        written: set[str] = set()
        for info in zin.infolist():
            name = info.filename
            if name in written:
                continue
            if is_notes_part(name) or is_notes_rels_part(name):
                stats["skipped_parts"] += 1
                continue

            data = zin.read(name)
            if name == "[Content_Types].xml":
                data, removed = strip_content_type_notes(data)
                stats["removed_content_types"] += removed
            elif name.endswith(".rels"):
                data, removed = strip_notes_relationships(data)
                stats["removed_relationships"] += removed

            zout.writestr(info, data)
            written.add(name)
            stats["copied_parts"] += 1

    dst.write_bytes(out.getvalue())
    return stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Write a copy of a PPTX with speaker notes removed."
    )
    parser.add_argument("input", nargs="?", type=Path, default=DEFAULT_SRC)
    parser.add_argument("output", nargs="?", type=Path, default=DEFAULT_DST)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    stats = remove_speaker_notes(args.input.resolve(), args.output.resolve())
    print(f"wrote {args.output} ({args.output.stat().st_size:,} bytes)")
    print(
        "removed "
        f"{stats['skipped_parts']} notes parts, "
        f"{stats['removed_content_types']} content-type entries, "
        f"{stats['removed_relationships']} relationships"
    )


if __name__ == "__main__":
    main()
