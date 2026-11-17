"""Aprova APKs verificados do QA Geral Celular na área privada do runner."""

import argparse
import os
from pathlib import Path
import re
import shutil
import sys
from tempfile import TemporaryDirectory

from scripts.ota_apk_preflight import PreflightError, command, file_sha256
from scripts.qa_geral_celular_signature import verify_signature
from scripts.qa_geral_remote_build_gate import FUNCTIONAL_FIXTURE_APP_ID, QA_PROJECT, REGISTERED_APP_ID


PACKAGE = "br.com.atriocatolico.qageral.celular"
APK_NAME = "atrio-qa-geral-celular.apk"
PAIR_CODES = (38, 39)
FUNCTIONAL_CODE = 40


def read_version_code(apk, build_tools):
    badging = command([str(build_tools / "aapt"), "dump", "badging", str(apk.resolve())])
    identity = re.search(r"^package: name='([^']+)' versionCode='([1-9][0-9]*)' ", badging, re.MULTILINE)
    if not identity or identity[1] != PACKAGE:
        raise PreflightError("Pacote ou versionCode do APK QA Geral Celular inválido.")
    return int(identity[2])


def verified_version_code(apk, build_tools, expected_sha256):
    verify_signature(apk, build_tools / "apksigner", expected_sha256)
    return read_version_code(apk, build_tools)


def verify_functional_variant(apk, build_tools, version_code, firebase_app_id):
    if version_code != FUNCTIONAL_CODE:
        raise PreflightError(f"O APK funcional exige versionCode {FUNCTIONAL_CODE}.")
    aapt = str(build_tools / "aapt")
    resources = command([aapt, "dump", "--values", "resources", str(apk.resolve())])
    if QA_PROJECT not in resources or firebase_app_id not in resources:
        raise PreflightError("A identidade Firebase do APK funcional diverge da referência.")
    manifest = command([aapt, "dump", "xmltree", str(apk.resolve()), "AndroidManifest.xml"])
    if (
        not re.search(r"android:allowBackup[^=]*=.*0x0$", manifest, re.MULTILINE)
        or "android.permission.INTERNET" not in manifest
        or any(permission in manifest for permission in (
            "android.permission.REQUEST_INSTALL_PACKAGES", "android.permission.POST_NOTIFICATIONS",
            "br.com.atriocatolico.AtrioPushService", "androidx.core.content.FileProvider",
        ))
    ):
        raise PreflightError("O APK funcional diverge do manifesto QA sem push, OTA e backup.")


def approve(apk, approved_dir, build_tools, expected_sha256, *, functional_app_id=None):
    version_code = verified_version_code(apk, build_tools, expected_sha256)
    if functional_app_id:
        verify_functional_variant(apk, build_tools, version_code, functional_app_id)
    approved_dir.mkdir(mode=0o700)
    apk.rename(approved_dir / APK_NAME)
    return version_code


def approve_pair(base, update, approved_dir, build_tools, expected_sha256):
    apks = (base, update)
    codes = tuple(verified_version_code(apk, build_tools, expected_sha256) for apk in apks)
    if codes != PAIR_CODES:
        raise PreflightError("O par de atualização exige versionCode 38 → 39.")
    if approved_dir.exists() or approved_dir.is_symlink():
        raise PreflightError("A área de aprovação do par já existe.")

    # Uma única renomeação publica o par na área privada depois das duas cópias.
    with TemporaryDirectory(dir=approved_dir.parent) as staging:
        candidate_dir = Path(staging) / "pair"
        candidate_dir.mkdir(mode=0o700)
        hashes = {}
        for apk, code in zip(apks, codes):
            name = f"atrio-qa-geral-celular-{code}.apk"
            staged_apk = candidate_dir / name
            shutil.copyfile(apk, staged_apk)
            hashes[name] = file_sha256(staged_apk)
        candidate_dir.rename(approved_dir)
    return hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True, type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--update-apk", type=Path)
    mode.add_argument("--functional", action="store_const", const=REGISTERED_APP_ID, dest="functional_app_id")
    mode.add_argument("--functional-fixture", action="store_const", const=FUNCTIONAL_FIXTURE_APP_ID,
                      dest="functional_app_id")
    parser.add_argument("--approved-dir", required=True, type=Path)
    parser.add_argument("--build-tools", required=True, type=Path)
    args = parser.parse_args()
    fingerprint = os.environ.get("ATRIO_QA_CELULAR_CERT_SHA256", "")
    try:
        if args.update_apk is None:
            version_code = approve(
                args.apk, args.approved_dir, args.build_tools, fingerprint, functional_app_id=args.functional_app_id,
            )
            print(f"APK QA aprovado: {PACKAGE}, versionCode={version_code}, SHA-256 do certificado={fingerprint.lower()}")
            if args.functional_app_id:
                print(f"{APK_NAME}: SHA-256 do APK={file_sha256(args.approved_dir / APK_NAME)}")
        else:
            hashes = approve_pair(args.apk, args.update_apk, args.approved_dir, args.build_tools, fingerprint)
            print(f"Par QA aprovado: {PACKAGE}, versionCode=38 → 39, SHA-256 do certificado={fingerprint.lower()}")
            for name, sha256 in hashes.items():
                print(f"{name}: SHA-256 do APK={sha256}")
    except (PreflightError, OSError) as exc:
        print(f"APK QA recusado. {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
