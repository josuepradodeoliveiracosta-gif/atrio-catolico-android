#!/usr/bin/env python3
"""Offline, conservative classifier for GitHub Actions documentation-only PRs.

This module does NOT change CI by itself. It may return heavy=false only
for a complete and independently verified pull-request raw comparison
whose changes are exclusively ordinary Markdown files. The caller must check
comparison completeness, pinned base/head SHAs, and branch protection rules.
Unknown input and any other event always require the full checks.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import unicodedata

MAX_DIFF_BYTES = 262144
MAX_FILES = 1000
DOC_EXACT = frozenset({"README.md"})
DOC_PREFIXES = ("docs/", "design/", ".github/ISSUE_TEMPLATE/")
RAW_META = re.compile(
    rb":(?P<oldmode>[0-7]{6}) (?P<newmode>[0-7]{6}) "
    rb"(?P<oldsha>[0-9a-f]{7,64}) (?P<newsha>[0-9a-f]{7,64}) "
    rb"(?P<status>[AM])"
)


def documentation_path(path: str) -> bool:
    """Allow only known Markdown paths; reject traversal and confusing names."""
    if not isinstance(path, str) or not (1 <= len(path) <= 1024):
        return False
    if path.startswith("/") or "\\" in path or path.strip() != path:
        return False
    if any(unicodedata.category(ch) in {"Cc", "Cf"} for ch in path):
        return False
    parts = path.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return False
    if any(part.endswith(".md") for part in parts[:-1]):
        return False
    return path in DOC_EXACT or (
        path.endswith(".md") and path.startswith(DOC_PREFIXES)
    )


def requires_full_ci(
    raw_diff_z: bytes | None, *,
    event: str = "unknown", comparison_verified: bool = False
) -> bool:
    """Return True (fail closed) unless diff is wholly verified documentation.

    Input must be git diff --raw -z from committed, pinned SHA endpoints.
    Besides names, each raw record includes old/new file modes and object
    IDs. Only 100644 regular Markdown files may skip heavy tests. Symlinks,
    executable files, renames, copies and deletions ALWAYS require full CI.
    A NUL-terminated pair contains metadata followed by one path.
    """
    if event != "pull_request" or comparison_verified is not True:
        return True
    if (not isinstance(raw_diff_z, bytes) or
            not (2 <= len(raw_diff_z) <= MAX_DIFF_BYTES) or
            not raw_diff_z.endswith(b"\0")):
        return True
    fields = raw_diff_z[:-1].split(b"\0")
    if len(fields) % 2 or not (2 <= len(fields) <= 2 * MAX_FILES):
        return True
    seen: set[str] = set()
    for i in range(0, len(fields), 2):
        metadata, encoded = fields[i:i + 2]
        match = RAW_META.fullmatch(metadata)
        if match is None:
            return True
        oldmode, newmode = match.group("oldmode", "newmode")
        oldsha, newsha = match.group("oldsha", "newsha")
        status = match.group("status")
        if newmode != b"100644" or set(newsha) == {48}:
            return True
        if status == b"A":
            if oldmode != b"000000" or set(oldsha) != {48}:
                return True
        elif status == b"M":
            if oldmode != b"100644" or set(oldsha) == {48}:
                return True
        else:
            return True
        try:
            path = encoded.decode("utf-8", errors="strict")
        except UnicodeError:
            return True
        if path in seen or not documentation_path(path):
            return True
        seen.add(path)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-diff-z", type=Path, required=True)
    parser.add_argument("--event", type=str, required=True)
    parser.add_argument("--comparison-verified", action="store_true",
                        help="Only if caller verified pinned full diff and event")
    args = parser.parse_args()
    try:
        data = args.raw_diff_z.read_bytes()
    except OSError:
        data = None
    needs = requires_full_ci(data, event=args.event,
                             comparison_verified=args.comparison_verified)
    print("heavy=" + ("true" if needs else "false"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
