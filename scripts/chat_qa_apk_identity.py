#!/usr/bin/env python3
"""Read-only preflight for an existing Átrio Conversas QA APK.

Expected values must come from the separately approved QA build.
Does not sign, install, publish, connect to Firebase or reveal credentials.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

PACKAGE_PROD = "br.com.atriocatolico"
PROJECT_PROD = "atrio-catolico"
CERT_PROD_SHA256 = "ba2e86eacf32e2785718040d704609d3c95c3b88363c08dd3d7c5abe299902b0"
MAX_APK_BYTES = 262_144_000


class QaPreflightError(ValueError):
    pass


def command(args):
    try:
        return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        raise QaPreflightError("android_sdk_verification_failed") from None


def valid_digest(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Fa-f0-9]{64}", value.strip()):
        raise QaPreflightError("expected_digest_invalid")
    return value.strip().lower()


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def qa_apk_preflight(apk, *, sdk, expected_project, expected_package,
                     expected_cert, expected_hash, expected_firebase_app_id, runner=command):
    if (not isinstance(expected_project, str)
            or not re.fullmatch(r"[a-z][a-z0-9-]{4,40}", expected_project)
            or expected_project != "atrio-catolico-qa-geral"):
        raise QaPreflightError("separate_qa_project_required")
    if (not isinstance(expected_package, str)
            or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+", expected_package)
            or expected_package != "br.com.atriocatolico.chatqa"):
        raise QaPreflightError("separate_qa_package_required")
    if (not isinstance(expected_firebase_app_id, str)
            or not re.fullmatch(r"1:[0-9]+:android:[0-9a-fA-F]+", expected_firebase_app_id)):
        raise QaPreflightError("approved_qa_firebase_app_id_required")
    cert = valid_digest(expected_cert)
    sha = valid_digest(expected_hash)
    if cert == CERT_PROD_SHA256:
        raise QaPreflightError("release_certificate_forbidden")
    path = Path(apk)
    if not path.is_file() or not (0 < path.stat().st_size <= MAX_APK_BYTES):
        raise QaPreflightError("existing_qa_apk_missing")
    if file_sha256(path) != sha:
        raise QaPreflightError("qa_apk_sha256_mismatch")
    sdk = Path(sdk)
    apksigner = str(sdk / "build-tools" / "35.0.0" / "apksigner")
    analyzer = str(sdk / "cmdline-tools" / "latest" / "bin" / "apkanalyzer")
    verify_output = runner([apksigner, "verify", "--print-certs", str(path)])
    signer_hashes = re.findall(
        r"Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9:]+)", verify_output
    )
    if len(signer_hashes) != 1 or signer_hashes[0].replace(":", "").lower() != cert:
        raise QaPreflightError("qa_signing_certificate_mismatch")
    def manifest(field):
        return runner([analyzer, "manifest", field, str(path)]).strip()
    package = manifest("application-id")
    version_code = manifest("version-code")
    version_name = manifest("version-name")
    debuggable = manifest("debuggable")
    if package != expected_package or package == PACKAGE_PROD:
        raise QaPreflightError("qa_apk_package_mismatch")
    if debuggable != "true":
        raise QaPreflightError("qa_apk_must_be_debuggable")
    if (not re.fullmatch(r"[1-9][0-9]*", version_code)
            or not re.fullmatch(r"\d+\.\d+\.\d+", version_name)):
        raise QaPreflightError("qa_apk_version_invalid")
    def resource(name):
        value = runner([analyzer, "resources", "value", "--config", "default",
                        "--type", "string", "--name", name, str(path)])
        if not value or "\n" in value or "\r" in value:
            raise QaPreflightError("qa_firebase_resource_missing")
        return value.strip().strip('"')
    project = resource("project_id")
    firebase_app_id = resource("google_app_id")
    sender_id = resource("gcm_defaultSenderId")
    if project != expected_project or project == PROJECT_PROD:
        raise QaPreflightError("qa_firebase_project_mismatch")
    if firebase_app_id != expected_firebase_app_id:
        raise QaPreflightError("qa_firebase_app_id_mismatch")
    if sender_id != expected_firebase_app_id.split(":")[1]:
        raise QaPreflightError("qa_firebase_sender_mismatch")
    if file_sha256(path) != sha:
        raise QaPreflightError("qa_apk_changed_during_audit")
    return {
        "result": "qa_apk_identity_only",
        "apk_sha256": sha,
        "version_code": int(version_code),
        "version_name": version_name,
        "package_matches_qa": True,
        "firebase_project_matches_qa": True,
        "firebase_app_id_matches_qa": True,
        "firebase_sender_matches_qa": True,
        "qa_signer_matches": True,
        "distinct_from_production_app": True,
        "worker_endpoints_audited": False,
        "runtime_network_isolation_verified": False,
        "physical_chat_tests_verified": False,
        "production_changed": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True)
    parser.add_argument("--android-sdk", default=os.getenv("ANDROID_HOME"))
    parser.add_argument("--expected-project", required=True)
    parser.add_argument("--expected-firebase-app-id", required=True)
    parser.add_argument("--expected-package", required=True)
    parser.add_argument("--expected-cert", required=True)
    parser.add_argument("--expected-sha256", required=True)
    args = parser.parse_args()
    try:
        if not args.android_sdk:
            raise QaPreflightError("android_sdk_required")
        result = qa_apk_preflight(
            args.apk, sdk=args.android_sdk,
            expected_project=args.expected_project,
            expected_package=args.expected_package,
            expected_cert=args.expected_cert, expected_hash=args.expected_sha256,
            expected_firebase_app_id=args.expected_firebase_app_id,
        )
    except (QaPreflightError, OSError, TypeError) as exc:
        print("QA APK REPROVADO: " + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
