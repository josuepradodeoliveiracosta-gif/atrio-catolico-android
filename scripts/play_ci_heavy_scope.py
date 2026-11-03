#!/usr/bin/env python3
"""Fail-closed diff classifier for expensive emulator CI.

Only pure documentation, static support pages and FOUR offline moderation
review modules are safe to skip. The authenticated deletion portal, app,
Firebase Rules, Workers, backend and unknown files ALWAYS trigger emulators.
The caller must separately require a verified, linear pull_request synchronize
history; main/first PR/manual actions always run the full suites.
"""
from __future__ import annotations
import argparse
from pathlib import Path

_REVIEW_FILES = frozenset({
    "cloudflare/account-deletion-audit/src/qa-moderation-case-review.js",
    "cloudflare/account-deletion-audit/src/qa-moderation-case-review.test.js",
    "cloudflare/account-deletion-audit/src/qa-moderation-deletion-preflight.js",
    "cloudflare/account-deletion-audit/src/qa-moderation-deletion-preflight.test.js",
})
_REVIEW_PREFIXES = ("docs/", "cloudflare/account-deletion-support/")

def requires_heavy_emulators(paths: list[str] | None) -> bool:
    if not paths or len(paths) > 1000:
        return True
    for path in paths:
        if not isinstance(path, str) or not path or len(path) > 1024:
            return True
        if any(ord(char) < 32 or ord(char) == 127 for char in path):
            return True
        if path.startswith("/") or "\\" in path or \
                any(x in ("", ".", "..") for x in path.split("/")):
            return True
        if path in _REVIEW_FILES or path.startswith(_REVIEW_PREFIXES):
            continue
        return True
    return False

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--changed-file", type=Path, required=True)
    args = parser.parse_args()
    try:
        raw = args.changed_file.read_bytes()
        if len(raw) > 262144 or not raw.endswith(b"\x00"):
            raise ValueError("invalid git diff")
        paths = [x.decode("utf-8", errors="strict")
                 for x in raw[:-1].split(b"\x00")]
    except (OSError, UnicodeError, ValueError):
        paths = None
    print("heavy=" + ("true" if requires_heavy_emulators(paths) else "false"))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
