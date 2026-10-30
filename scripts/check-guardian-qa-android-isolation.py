#!/usr/bin/env python3
"""Guardrail for the non-production Guardião QA Android artifact.

Ensures the disposable CI checkout contains NO Firebase production options,
NO Worker production URL and that the compiled APK has a distinct package.
No cloud access or credentials are needed; this script cannot authorize release.
"""
import argparse
import os
from pathlib import Path
import re
import subprocess
import sys
from zipfile import ZipFile

PACKAGE = "br.com.atriocatolico.guardianqa"
DENIED_KEYS = [
    "ATRIO_PUSH_WORKER_URL",
    "ATRIO_GUARDIAN_WORKER_URL",
    "ATRIO_AVATAR_WORKER_URL",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "ATRIO_SIGNING_STORE_FILE",
    "ATRIO_SIGNING_STORE_PASSWORD",
    "ATRIO_SIGNING_KEY_ALIAS",
    "ATRIO_SIGNING_KEY_PASSWORD",
]
DENIED_URLS = [
    b"atrio-push.atrio-catolico.workers.dev",
    b"atrio-guardian-v2-qa.atrio-catolico.workers.dev",
]


def check_prebuild(root: Path, environ: dict[str, str]) -> list[str]:
    errors = []
    if (root / "app" / "google-services.json").exists():
        errors.append("qa_must_not_package_firebase_config")
    if environ.get("ATRIO_GUARDIAN_QA_ISOLATED") != "1":
        errors.append("qa_application_id_suffix_not_enabled")
    for key in DENIED_KEYS:
        if environ.get(key):
            errors.append("forbidden_environment_value:" + key)
    return errors


def check_apk_metadata(badging: str, resources: str, file_names: list[str], raw: bytes) -> list[str]:
    errors = []
    package_match = re.search(r"(?m)^package: name='([^']+)'", badging)
    if not package_match or package_match.group(1) != PACKAGE:
        errors.append("qa_package_not_isolated")
    if re.search(r"(?i)(?:string/|resource\s+\S+\s+)(google_app_id|google_api_key|firebase_database_url)\b", resources):
        errors.append("firebase_options_found_in_resources")
    if any("google-services.json" in name or "service-account" in name for name in file_names):
        errors.append("firebase_config_or_credential_in_apk")
    if any(url in raw for url in DENIED_URLS):
        errors.append("worker_endpoint_in_apk")
    return errors


def check_apk(path: Path) -> list[str]:
    if not path.is_file() or path.stat().st_size <= 0:
        return ["apk_missing"]
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or ""
    aapt = Path(sdk) / "build-tools" / "35.0.0" / "aapt"
    if not aapt.is_file():
        return ["aapt_missing"]
    try:
        badging = subprocess.check_output([str(aapt), "dump", "badging", str(path)], text=True)
        resources = subprocess.check_output([str(aapt), "dump", "resources", str(path)], text=True)
        with ZipFile(path) as z:
            names = z.namelist()
            broken = z.testzip()
        if broken:
            return ["apk_corrupt:" + broken]
        return check_apk_metadata(badging, resources, names, path.read_bytes())
    except (OSError, subprocess.CalledProcessError, ValueError) as exc:
        return ["apk_audit_failed:" + type(exc).__name__]


def main() -> int:
    p = argparse.ArgumentParser(description="Fail closed for isolated QA Debug builds.")
    modes = p.add_mutually_exclusive_group(required=True)
    modes.add_argument("--prebuild", action="store_true")
    modes.add_argument("--apk", type=Path)
    args = p.parse_args()
    issues = check_prebuild(Path.cwd(), os.environ) if args.prebuild else check_apk(args.apk)
    if issues:
        for problem in issues:
            print("GUARDIAN_QA_ANDROID_ISOLATION_NO_GO: " + problem)
        return 2
    print("GUARDIAN_QA_ANDROID_ISOLATION_PASS: demo app only, no production Firebase/Worker.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
