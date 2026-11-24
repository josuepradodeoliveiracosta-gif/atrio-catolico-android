"""Confere a origem e permite recuperar e verificar o APK da rodada 42."""

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory

from scripts.ota_apk_preflight import PreflightError, command
from scripts.qa_geral_celular_approve import PACKAGE, verify_functional_variant
from scripts.qa_geral_celular_round_delivery import APK39_CERT_SHA256, check_sha256
from scripts.qa_geral_celular_signature import verify_signature
from scripts.qa_geral_remote_build_gate import QA_PROJECT, REGISTERED_APP_ID

VERSION_NAME = "0.19.10-qa-geral-celular-rodada-42"
VERSION_CODE = 42


def verify_source(repo, expected_sha, expected_tree):
    def git(*args):
        return command(["git", "-C", str(repo), *args]).strip()

    for label, rev, expected in (
        ("SHA", "HEAD", expected_sha),
        ("Árvore Git", "HEAD^{tree}", expected_tree),
    ):
        if not re.fullmatch(r"[0-9a-f]{40}", expected) or git("rev-parse", rev) != expected:
            raise PreflightError(f"{label} do candidato diverge da referência fixada.")
    if git("status", "--porcelain", "--untracked-files=normal"):
        raise PreflightError("Checkout do candidato contém alterações.")
    print(f"Candidato verificado: SHA={expected_sha} árvore={expected_tree}")


def verify_package_version(apk, tools, version_code, version_name):
    badging = command([str(tools / "aapt"), "dump", "badging", str(apk)])
    package_line = re.search(
        r"^package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'(?: |$)",
        badging,
        re.MULTILINE,
    )
    expected = (PACKAGE, str(version_code), version_name)
    if package_line is None or package_line.groups() != expected:
        raise PreflightError(f"Pacote ou versão do APK diverge da rodada {version_code}.")


def verify_metadata(apk, tools, *, version_code=VERSION_CODE, version_name=VERSION_NAME,
                    firebase_app_id=REGISTERED_APP_ID):
    verify_package_version(apk, tools, version_code, version_name)
    verify_functional_variant(apk, tools, version_code, firebase_app_id,
                              expected_code=version_code)
    print(f"APK verificado: {PACKAGE}, versionCode={version_code}, versionName={version_name}")
    print(f"Projeto Firebase no APK: {QA_PROJECT}")


def verify_apk(apk, digest, tools, certificate=APK39_CERT_SHA256):
    actual = check_sha256(apk, digest)
    verify_signature(apk, tools / "apksigner", certificate)
    verify_metadata(apk, tools)
    print(f"SHA-256 do APK assinado: {actual}")
    print(f"SHA-256 do certificado: {certificate.lower()} (1 assinante)")


def recover(cipher, cipher_sha, identity, apk, apk_sha, tools, certificate=APK39_CERT_SHA256):
    check_sha256(cipher, cipher_sha)
    with TemporaryDirectory(prefix=".apk42-", dir=apk.parent) as staging:
        clear = Path(staging) / "round42.apk"
        subprocess.run(
            ["age", "--decrypt", "--identity", str(identity.resolve()),
             "--output", str(clear), str(cipher.resolve())],
            check=True, capture_output=True,
        )
        verify_apk(clear, apk_sha, tools, certificate)
        clear.chmod(0o600)
        os.link(clear, apk)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    source = sub.add_parser("source")
    source.add_argument("repo", type=Path)
    source.add_argument("sha")
    source.add_argument("tree")
    metadata = sub.add_parser("metadata")
    verify = sub.add_parser("verify")
    restore = sub.add_parser("recover")
    restore.add_argument("cipher", type=Path)
    restore.add_argument("cipher_sha256")
    restore.add_argument("identity", type=Path)
    for mode in (metadata, verify, restore):
        mode.add_argument("apk", type=Path)
        mode.add_argument("--build-tools", type=Path, required=True)
    for mode in (verify, restore):
        mode.add_argument("apk_sha256")
        mode.add_argument("--certificate", default=APK39_CERT_SHA256,
                          help="Impressão digital externa. O padrão é o certificado de QA do APK 39.")
    args = parser.parse_args()
    try:
        if args.mode == "source":
            verify_source(args.repo, args.sha, args.tree)
        elif args.mode == "metadata":
            verify_metadata(args.apk, args.build_tools)
        elif args.mode == "verify":
            verify_apk(args.apk, args.apk_sha256, args.build_tools, args.certificate)
        else:
            recover(args.cipher, args.cipher_sha256, args.identity, args.apk, args.apk_sha256,
                    args.build_tools, args.certificate)
    except subprocess.CalledProcessError:
        print("Recusado: falha ao decifrar para a identidade informada.", file=sys.stderr)
        return 1
    except (PreflightError, OSError) as exc:
        print(f"Recusado: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
