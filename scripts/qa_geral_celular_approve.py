"""Move somente um APK QA Geral Celular verificado para a área privada do runner."""

import argparse
import os
from pathlib import Path
import re
import sys

from scripts.ota_apk_preflight import PreflightError, command
from scripts.qa_geral_celular_signature import verify_signature


PACKAGE = "br.com.atriocatolico.qageral.celular"
APK_NAME = "atrio-qa-geral-celular.apk"


def approve(apk, approved_dir, build_tools, expected_sha256):
    verify_signature(apk, build_tools / "apksigner", expected_sha256)
    badging = command([str(build_tools / "aapt"), "dump", "badging", str(apk.resolve())])
    identity = re.search(r"^package: name='([^']+)' versionCode='([1-9][0-9]*)' ", badging, re.MULTILINE)
    if not identity or identity[1] != PACKAGE:
        raise PreflightError("Pacote ou versionCode do APK QA Geral Celular inválido.")

    approved_dir.mkdir(mode=0o700)
    apk.rename(approved_dir / APK_NAME)
    return identity[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--approved-dir", required=True, type=Path)
    parser.add_argument("--build-tools", required=True, type=Path)
    args = parser.parse_args()
    fingerprint = os.environ.get("ATRIO_QA_CELULAR_CERT_SHA256", "")
    try:
        version_code = approve(args.apk, args.approved_dir, args.build_tools, fingerprint)
    except (PreflightError, OSError) as exc:
        print(f"APK QA recusado. {exc}", file=sys.stderr)
        return 1
    print(f"APK QA aprovado: {PACKAGE}, versionCode={version_code}, SHA-256 do certificado={fingerprint.lower()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
