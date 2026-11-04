#!/usr/bin/env python3
"""Offline continuity gate: Play app-signing certificate vs installed APK certificate.

These are two public SHA-256 fingerprints, NOT the Play upload certificate.
No signing, device access, secrets, network, or Google Play Console calls.
"""
import hmac
import os
import sys

from play_upload_certificate_check import normalize_fingerprint


def app_signing_continuity(play_fingerprint, installed_fingerprint):
    """Reject missing/invalid public fingerprints and cross-store mismatch."""
    try:
        play = normalize_fingerprint(play_fingerprint)
        installed = normalize_fingerprint(installed_fingerprint)
    except ValueError as exc:
        raise ValueError("app_signing_fingerprint_missing_or_invalid") from exc
    if not hmac.compare_digest(play, installed):
        raise ValueError("app_signing_cert_mismatch_existing_apk")
    return True


def main():
    try:
        app_signing_continuity(
            os.environ.get("ATRIO_PLAY_APP_SIGNING_CERT_SHA256"),
            os.environ.get("ATRIO_INSTALLED_APK_CERT_SHA256"),
        )
    except ValueError as exc:
        print("BLOQUEADO: " + str(exc), file=sys.stderr)
        return 2
    print("OK: os SHA-256 publicos coincidem. Conferir provas externas e teste de upgrade; sem publicacao.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
