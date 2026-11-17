"""Cifra o par já aprovado no runner e inclui metadados de verificação."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from scripts.ota_apk_preflight import PreflightError, file_sha256
from scripts.qa_geral_celular_approve import PACKAGE, PAIR_CODES


def validate_recipient(recipient):
    if not re.fullmatch(r"age1[a-z0-9]{58}", recipient):
        raise PreflightError("Configure o destinatário público age do fundador no ambiente protegido.")


def encrypt_pair(approved_dir, output, recipient, source_sha, certificate):
    validate_recipient(recipient)
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise PreflightError("SHA do build ausente ou inválido.")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", certificate):
        raise PreflightError("SHA-256 do certificado ausente ou inválido.")
    if output.exists() or output.is_symlink():
        raise PreflightError("O caminho de entrega já existe.")

    files = []
    for code in PAIR_CODES:
        path = approved_dir / f"atrio-qa-geral-celular-{code}.apk"
        if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
            raise PreflightError(f"APK aprovado de versionCode {code} ausente.")
        files.append({"file": path.name, "versionCode": code, "sha256": file_sha256(path)})

    receipt = {
        "source_sha": source_sha,
        "applicationId": PACKAGE,
        "certificate_sha256": certificate.lower(),
        "apks": files,
    }
    with TemporaryDirectory(dir=output.parent) as temporary:
        stage = Path(temporary)
        plain = stage / "par.zip"
        encrypted = stage / "par.zip.age"
        with ZipFile(plain, "w") as bundle:
            for item in files:
                bundle.write(approved_dir / item["file"], item["file"])
            bundle.writestr("SHA256SUMS", "".join(f'{item["sha256"]}  {item["file"]}\n' for item in files))
            bundle.writestr("ORIGEM.json", json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
        subprocess.run(
            ["age", "--encrypt", "--recipient", recipient, "--output", str(encrypted.resolve()), str(plain.resolve())],
            check=True,
            capture_output=True,
        )
        if not encrypted.is_file() or encrypted.stat().st_size == 0:
            raise PreflightError("A cifra não gerou o pacote de entrega.")
        encrypted.rename(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approved-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    args = parser.parse_args()
    try:
        encrypt_pair(
            args.approved_dir,
            args.output,
            os.environ.get("ATRIO_QA_CELULAR_AGE_RECIPIENT", ""),
            args.source_sha,
            os.environ.get("ATRIO_QA_CELULAR_CERT_SHA256", ""),
        )
    except subprocess.CalledProcessError:
        print("Entrega do par recusada. Falha ao cifrar para o destinatário configurado.", file=sys.stderr)
        return 1
    except (OSError, PreflightError) as exc:
        print(f"Entrega do par recusada. {exc}", file=sys.stderr)
        return 1
    print(f"Pacote cifrado de entrega aprovado. SHA-256={file_sha256(args.output)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
