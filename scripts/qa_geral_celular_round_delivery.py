"""Recupera e confere localmente o APK 41 assinado do QA Geral Celular."""

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

from scripts.ota_apk_preflight import PreflightError, file_sha256
from scripts.qa_geral_celular_approve import PACKAGE, verified_version_code


APK39_CERT_SHA256 = "63b26756491bb0103e44e561d63c5481c0d9a6e7374b322ff4e97e1cd5629e57"
ROUND_CODE = 41


def check_sha256(path, expected):
    if not re.fullmatch(r"[0-9a-fA-F]{64}", expected):
        raise PreflightError("Informe o SHA-256 completo do resumo da execução de entrega.")
    if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
        raise PreflightError("Arquivo ausente, vazio ou não regular.")
    actual = file_sha256(path)
    if actual != expected.lower():
        raise PreflightError("SHA-256 do arquivo diverge do resumo da entrega.")
    return actual


def verify_apk(apk, expected, build_tools, certificate=APK39_CERT_SHA256):
    digest = check_sha256(apk, expected)
    if verified_version_code(apk, build_tools, certificate) != ROUND_CODE:
        raise PreflightError("A entrega da rodada exige versionCode 41.")
    return digest


def recover_apk(ciphertext, cipher_sha256, identity, output, apk_sha256, build_tools,
                *, certificate=APK39_CERT_SHA256):
    check_sha256(ciphertext, cipher_sha256)
    with TemporaryDirectory(prefix=".apk41-", dir=output.parent) as staging:
        apk = Path(staging) / "apk41.apk"
        subprocess.run(
            ["age", "--decrypt", "--identity", str(identity.resolve()), "--output", str(apk),
             str(ciphertext.resolve())],
            check=True,
            capture_output=True,
        )
        digest = verify_apk(apk, apk_sha256, build_tools, certificate)
        apk.chmod(0o600)
        os.link(apk, output)
    return digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    recover = modes.add_parser("recover", help="Decifrar e validar o APK antes do envio ao Drive")
    recover.add_argument("ciphertext", type=Path)
    recover.add_argument("cipher_sha256")
    recover.add_argument("identity", type=Path)
    recover.add_argument("output", type=Path)
    verify = modes.add_parser("verify", help="Validar a cópia baixada do Drive antes da instalação")
    verify.add_argument("apk", type=Path)
    for mode in (recover, verify):
        mode.add_argument("apk_sha256", help="SHA-256 do APK no resumo da execução de entrega")
        mode.add_argument("--build-tools", type=Path, help="Pasta de aapt e apksigner, se fora do PATH")
    args = parser.parse_args()
    tools = args.build_tools
    try:
        if tools is None:
            aapt = shutil.which("aapt")
            if not aapt:
                raise PreflightError("Instale aapt e apksigner ou informe --build-tools.")
            tools = Path(aapt).parent
        if args.mode == "recover":
            digest = recover_apk(args.ciphertext, args.cipher_sha256, args.identity, args.output,
                                 args.apk_sha256, tools)
        else:
            digest = verify_apk(args.apk, args.apk_sha256, tools)
    except subprocess.CalledProcessError:
        print("Entrega recusada. Falha ao decifrar para a identidade informada.", file=sys.stderr)
        return 1
    except FileExistsError:
        print("Entrega recusada. O APK de saída já existe.", file=sys.stderr)
        return 1
    except (PreflightError, OSError) as exc:
        print(f"Entrega recusada. {exc}", file=sys.stderr)
        return 1
    print(f"APK verificado: {PACKAGE}, versionCode={ROUND_CODE}, assinantes=1")
    print(f"SHA-256 do APK: {digest}")
    print(f"SHA-256 do certificado de QA: {APK39_CERT_SHA256}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
