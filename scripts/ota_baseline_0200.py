#!/usr/bin/env python3
"""Verificacao somente de leitura do APK historico oficial 0.20.0."""
import argparse
import json
from pathlib import Path
import sys
from scripts.ota_apk_preflight import PreflightError, file_sha256
from scripts.ota_release_cert import verify_existing_signed_apk

HISTORICAL_APK_SHA256 = "2c1a55dfdc797e10e8ce9ec371a3136289d039ab99311387e5d02cf010f0c509"
HISTORICAL_VERSION_CODE = 35
HISTORICAL_VERSION_NAME = "0.20.0"
HISTORICAL_BUILD_RUN = 41174393714
HISTORICAL_ARTIFACT_ID = 13031693723

def verify_historical_baseline(apk, *, sdk, runner=None):
    apk = Path(apk)
    if not apk.is_file() or apk.stat().st_size == 0:
        raise PreflightError("APK historico ausente ou vazio")
    actual_hash = file_sha256(apk)
    if actual_hash != HISTORICAL_APK_SHA256:
        raise PreflightError("SHA-256 nao corresponde ao APK historico")
    kwargs = {"runner": runner} if runner is not None else {}
    facts = verify_existing_signed_apk(apk, sdk=sdk, **kwargs)
    if (facts["versionCode"], facts["versionName"]) != (
        HISTORICAL_VERSION_CODE, HISTORICAL_VERSION_NAME
    ):
        raise PreflightError("Versao historica nao corresponde a 0.20.0/code35")
    return {
        **facts, "apk_sha256": actual_hash,
        "historic_workflow_run": HISTORICAL_BUILD_RUN,
        "historic_artifact_id": HISTORICAL_ARTIFACT_ID,
        "result": "historical_apk_only_verified",
        "physical_ota_tested": False,
        "release_authorized": False,
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True)
    parser.add_argument("--android-sdk", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(verify_historical_baseline(args.apk, sdk=args.android_sdk), indent=2))
        return 0
    except (PreflightError, OSError, ValueError) as exc:
        print("BASELINE BLOQUEADA: " + str(exc), file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
