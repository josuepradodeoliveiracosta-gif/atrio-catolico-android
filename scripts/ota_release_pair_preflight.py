#!/usr/bin/env python3
"""Read-only preflight for a future two-APK official OTA device pilot.

No signing, installing, publishing, network access, or changes to release gates.
An approved pair does NOT prove in-app OTA, session persistence or release safety.
"""
import argparse
import json
from pathlib import Path
import sys

from scripts.ota_apk_preflight import (
    PACKAGE, PreflightError, digest, file_sha256, inspect_apk,
)
from scripts.ota_release_cert import (
    PINNED_OFFICIAL_CERT_SHA256, require_official_certificate,
)

MAX_APK_BYTES = 262_144_000
FIRST_OTA_VERSION_CODE = 36  # 0.20.0/code35 had no in-app OTA client


def version_key(version_name):
    if len(version_name) > 64:
        raise PreflightError("versionName excede limite de segurança")
    parts = version_name.split(".")
    if len(parts) != 3 or any(not p.isascii() or not p.isdecimal() for p in parts):
        raise PreflightError("versionName deve ser numerica e ter tres componentes")
    return tuple(int(part) for part in parts)


def verify_release_pair(
    base_apk, candidate_apk, *, base_sha256, candidate_sha256, sdk
):
    """Compare two actual APK files against independently recorded SHA-256s."""
    base, candidate = Path(base_apk), Path(candidate_apk)
    if not base.is_file() or not candidate.is_file():
        raise PreflightError("Ambos os APKs devem existir")
    if base.resolve() == candidate.resolve():
        raise PreflightError("O candidato deve ser outro arquivo, nao o APK base")
    if not all(0 < p.stat().st_size <= MAX_APK_BYTES for p in (base, candidate)):
        raise PreflightError("Tamanho de APK fora dos limites do OTA")
    expected_base = digest(base_sha256)
    expected_candidate = digest(candidate_sha256)
    if expected_base == expected_candidate:
        raise PreflightError("Os dois APKs devem ser versoes diferentes")
    actual_base = file_sha256(base)
    actual_candidate = file_sha256(candidate)
    if actual_base != expected_base or actual_candidate != expected_candidate:
        raise PreflightError("APK alterado: SHA-256 difere do valor independente")

    sdk_path = Path(sdk)
    base_info = inspect_apk(base, sdk_path)
    candidate_info = inspect_apk(candidate, sdk_path)
    for entry in (base_info, candidate_info):
        if entry["package"] != PACKAGE:
            raise PreflightError("Pacote de homologacao diferente do Atrio oficial")
        require_official_certificate(entry["certificate_sha256"])

    if base_info["versionCode"] < FIRST_OTA_VERSION_CODE:
        raise PreflightError(
            "APK base 0.20.0/code35 nao possui cliente OTA: usar versao posterior"
        )
    if candidate_info["versionCode"] <= base_info["versionCode"]:
        raise PreflightError("versionCode do candidato deve superar o da base")
    if version_key(candidate_info["versionName"]) <= version_key(base_info["versionName"]):
        raise PreflightError("versionName do candidato deve ser posterior")

    # Detect a file changing while the Android SDK was examining it.
    if file_sha256(base) != expected_base or file_sha256(candidate) != expected_candidate:
        raise PreflightError("APK modificado durante a verificacao")

    return {
        "package": PACKAGE,
        "official_certificate_sha256": PINNED_OFFICIAL_CERT_SHA256,
        "base": {
            "versionName": base_info["versionName"],
            "versionCode": base_info["versionCode"],
            "apkSha256": actual_base,
        },
        "candidate": {
            "versionName": candidate_info["versionName"],
            "versionCode": candidate_info["versionCode"],
            "apkSha256": actual_candidate,
        },
        "result": "offline_signature_and_version_preflight_only",
        "physical_ota_homologated": False,
        "session_preservation_tested": False,
        "release_approved": False,
        "published": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-apk", required=True)
    parser.add_argument("--candidate-apk", required=True)
    parser.add_argument("--base-sha256", required=True)
    parser.add_argument("--candidate-sha256", required=True)
    parser.add_argument("--android-sdk", required=True)
    args = parser.parse_args()
    try:
        record = verify_release_pair(
            args.base_apk, args.candidate_apk,
            base_sha256=args.base_sha256,
            candidate_sha256=args.candidate_sha256,
            sdk=args.android_sdk,
        )
    except (PreflightError, OSError, ValueError, OverflowError) as exc:
        print("PILOTO RELEASE BLOQUEADO: " + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
