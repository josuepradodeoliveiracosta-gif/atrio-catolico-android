#!/usr/bin/env python3
"""Fail-closed continuity check for the historical official Átrio signer.

Uses the public certificate fingerprint from the verified signed 0.20.0
artifact (GitHub Actions run 41174393714). No keystore, passwords or
production secrets are read. Signing and publishing never happen here.
"""
import argparse
from pathlib import Path
import sys

from scripts.ota_apk_preflight import PreflightError, digest, inspect_apk

# Public SHA-256 of the 0.20.0/code35 official APK's single signing certificate.
# A deliberate authorized key rotation requires an explicit separate review,
# physical compatibility QA and an update of this pinned value.
PINNED_OFFICIAL_CERT_SHA256 = (
    "ba2e86eacf32e2785718040d704609d3c95c3b88363c08dd3d7c5abe299902b0"
)


def require_official_certificate(fingerprint):
    if digest(fingerprint) != PINNED_OFFICIAL_CERT_SHA256:
        raise PreflightError(
            "Certificado divergente do APK oficial 0.20.0: "
            "revisao e homologacao de assinatura obrigatorias"
        )
    return PINNED_OFFICIAL_CERT_SHA256


def verify_existing_signed_apk(apk, *, sdk, runner=None):
    """Read APK cert/package/version; reject wrong signer without modifying it."""
    kwargs = {"runner": runner} if runner is not None else {}
    details = inspect_apk(Path(apk), Path(sdk), **kwargs)
    require_official_certificate(details["certificate_sha256"])
    return details


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True)
    parser.add_argument("--android-sdk", required=True)
    args = parser.parse_args()
    try:
        details = verify_existing_signed_apk(args.apk, sdk=args.android_sdk)
        print("Assinatura oficial confere com 0.20.0: "
              + details["certificate_sha256"])
        return 0
    except (PreflightError, ValueError, OSError) as exc:
        print("BLOQUEADO: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
