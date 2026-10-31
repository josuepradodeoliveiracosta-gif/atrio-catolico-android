#!/usr/bin/env python3
"""Read-only verification of an official Átrio APK before offering OTA updates.

Requires Android SDK Build Tools 35.0.0 and command-line tools. Does not sign,
install, modify an APK, access Firebase, or publish anything.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

PACKAGE = "br.com.atriocatolico"
SDK_BUILD_TOOLS = "35.0.0"


class PreflightError(ValueError):
    pass


def digest(value):
    normalized = value.strip().replace(":", "").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", normalized):
        raise PreflightError("SHA-256 invalido ou nao informado")
    return normalized


def file_sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for piece in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(piece)
    return h.hexdigest()


def command(args):
    try:
        return subprocess.run(args, check=True, text=True, capture_output=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise PreflightError("Ferramenta Android ausente ou verificacao do APK falhou") from None


def inspect_apk(path, sdk, runner=command):
    """Extract verified APK facts, never trusting metadata supplied by the caller."""
    apksigner = str(sdk / "build-tools" / SDK_BUILD_TOOLS / "apksigner")
    analyzer = str(sdk / "cmdline-tools" / "latest" / "bin" / "apkanalyzer")
    signed = runner([apksigner, "verify", "--print-certs", str(path)])
    certs = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9:]+)", signed)
    if len(certs) != 1:
        raise PreflightError("APK sem um unico assinante verificavel")
    package = runner([analyzer, "manifest", "application-id", str(path)])
    code = runner([analyzer, "manifest", "version-code", str(path)])
    name = runner([analyzer, "manifest", "version-name", str(path)])
    debuggable = runner([analyzer, "manifest", "debuggable", str(path)])
    if package != PACKAGE:
        raise PreflightError("Identificador de pacote diferente do Atrio")
    if not re.fullmatch(r"[1-9][0-9]*", code):
        raise PreflightError("versionCode invalido")
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", name):
        raise PreflightError("versionName invalido")
    if debuggable != "false":
        raise PreflightError("APK depuravel ou modo de depuracao nao verificavel")
    return {"package": package, "versionCode": int(code),
            "versionName": name, "certificate_sha256": digest(certs[0])}


def verify(apk, *, sdk, expected_cert, expected_code, expected_name,
           expected_apk_sha256=None, previous_apk=None, runner=command):
    apk = Path(apk)
    if not apk.is_file() or apk.stat().st_size == 0:
        raise PreflightError("APK nao encontrado ou vazio")
    cert = digest(expected_cert)  # Must come from a previously trusted key.
    if expected_code < 1 or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", expected_name):
        raise PreflightError("Versao esperada invalida")
    sha = file_sha256(apk)
    if expected_apk_sha256 and sha != digest(expected_apk_sha256):
        raise PreflightError("Hash do APK nao corresponde ao informado")
    current = inspect_apk(apk, Path(sdk), runner=runner)
    if current["certificate_sha256"] != cert:
        raise PreflightError("Assinatura nao corresponde ao certificado permanente")
    if (current["versionCode"], current["versionName"]) != (expected_code, expected_name):
        raise PreflightError("Versao do APK difere da versao aprovada")
    if previous_apk is not None:
        previous_path = Path(previous_apk)
        if not previous_path.is_file():
            raise PreflightError("APK anterior nao encontrado")
        previous = inspect_apk(previous_path, Path(sdk), runner=runner)
        if previous["certificate_sha256"] != cert:
            raise PreflightError("APK anterior usa outra assinatura: migracao necessaria")
        if current["versionCode"] <= previous["versionCode"]:
            raise PreflightError("Nova versao deve ter versionCode maior que o anterior")
    return {**current, "apk_sha256": sha, "compatibility_with_previous":
            "verified" if previous_apk is not None else "not_tested"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True)
    parser.add_argument("--expected-cert", required=True,
                        help="SHA-256 do certificado permanente obtido de fonte confiavel")
    parser.add_argument("--expected-code", required=True, type=int)
    parser.add_argument("--expected-name", required=True)
    parser.add_argument("--expected-apk-sha256",
                        help="SHA-256 do arquivo APK, se ja conhecido independentemente")
    parser.add_argument("--previous-apk",
                        help="APK anteriormente distribuido para testar compatibilidade")
    args = parser.parse_args()
    try:
        sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
        if not sdk:
            raise PreflightError("ANDROID_HOME nao configurado")
        result = verify(args.apk, sdk=sdk, expected_cert=args.expected_cert,
                        expected_code=args.expected_code, expected_name=args.expected_name,
                        expected_apk_sha256=args.expected_apk_sha256,
                        previous_apk=args.previous_apk)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except (PreflightError, OSError) as exc:
        print(f"PREFLIGHT REPROVADO: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
