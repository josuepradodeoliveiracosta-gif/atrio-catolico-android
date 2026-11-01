#!/usr/bin/env python3
"""Read-only SHA-256 gate for an approved Google Play upload certificate.

The input is the public DER certificate exported from the existing JKS by
keytool. This tool never loads private keys, signs bundles, or contacts Google.
"""
import argparse
import hashlib
import hmac
import os
from pathlib import Path
import re
import sys


def normalize_fingerprint(value):
    if not isinstance(value, str):
        raise ValueError("expected_upload_fingerprint_not_configured")
    compact = value.replace(":", "")
    if not re.fullmatch(r"[0-9A-Fa-f]{64}", compact):
        raise ValueError("expected_upload_fingerprint_invalid")
    if ":" in value and not re.fullmatch(r"(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}", value):
        raise ValueError("expected_upload_fingerprint_invalid")
    return compact.lower()


def verify_certificate_der(data, expected):
    fingerprint = normalize_fingerprint(expected)
    if not isinstance(data, bytes) or not (64 <= len(data) <= 65536) or data[:1] != b"\x30":
        raise ValueError("public_certificate_der_invalid")
    return hmac.compare_digest(hashlib.sha256(data).hexdigest(), fingerprint)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--certificate", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        expected = os.environ.get("ATRIO_PLAY_UPLOAD_CERT_SHA256")
        normalize_fingerprint(expected)
        with args.certificate.open("rb") as source:
            data = source.read(65537)
        if not verify_certificate_der(data, expected):
            print("BLOQUEADO: certificado de upload nao corresponde ao SHA-256 aprovado.", file=sys.stderr)
            return 2
    except (OSError, ValueError) as err:
        # Never print certificate bytes, fingerprint, private secrets or path.
        reason = str(err) if isinstance(err, ValueError) else "certificate_unreadable"
        print("BLOQUEADO: " + reason, file=sys.stderr)
        return 2
    print("OK: certificado publico de upload coincide com o SHA-256 aprovado; nao publica.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
