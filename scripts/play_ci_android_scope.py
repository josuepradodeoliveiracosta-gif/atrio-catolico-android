#!/usr/bin/env python3
"""Scope costly unsigned Play AAB compilation to Android-impacting PR changes.

Fail CLOSED: any unknown path, missing diff, or invalid filename forces AAB.
Always run all privacy/UGC, release gate and deletion QA on every relevant PR.
Never signs, deploys, changes versions or marks evidence approved.
"""
from __future__ import annotations

import argparse
from pathlib import Path

_ANDROID_PREFIXES = ("app/", "gradle/")
_ANDROID_FILES = frozenset({
    "build.gradle.kts", "settings.gradle.kts", "gradle.properties",
    ".github/workflows/play-closed-aab-ci.yml",
    ".github/workflows/play-signed-aab-manual.yml",
    "scripts/play_store_bundle_check.py",
    "scripts/play_release_gate.py",
    "scripts/validar_firebase.py",
    "scripts/play_upload_certificate_check.py",
    "scripts/play_app_signing_continuity.py",
    "scripts/play_ci_android_scope.py",
    "scripts/test_play_ci_android_scope.py",
})
_NON_ANDROID_PREFIXES = ("docs/", "cloudflare/", "tests/",
                         "fastlane/metadata/android/")
_NON_ANDROID_FILES = frozenset({
    "README.md", "CHANGELOG.md", "SECURITY.md",
    "scripts/play_listing_preflight.py",
})


def requires_android_build(paths: list[str] | None) -> bool:
    """True unless EVERY changed path is explicitly known non-Android.

    A missing or empty list never skips the bundle, and deletions/renames
    are still represented as changed paths by Git diff.
    """
    if not paths:
        return True
    for name in paths:
        if not isinstance(name, str) or not name or "\x00" in name or "\n" in name:
            return True
        if name in _ANDROID_FILES or name.startswith(_ANDROID_PREFIXES):
            return True
        if name in _NON_ANDROID_FILES or name.startswith(_NON_ANDROID_PREFIXES):
            continue
        if name.startswith("scripts/test_") and name.endswith(".py"):
            continue
        # New/unknown files are treated as potentially Android-affecting.
        return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--changed-file", type=Path, required=True,
                        help="Git diff --name-only -z output, trusted local file")
    args = parser.parse_args()
    try:
        names = args.changed_file.read_bytes().split(b"\x00")
        if names and not names[-1]:
            names.pop()
        paths = [part.decode("utf-8", errors="strict") for part in names]
    except (OSError, UnicodeError):
        paths = None
    print("android=" + ("true" if requires_android_build(paths) else "false"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
