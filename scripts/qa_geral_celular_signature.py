"""Conferência somente leitura da assinatura para o futuro fluxo manual de QA.

Executar como módulo a partir da raiz do repositório. No fluxo protegido,
ATRIO_QA_CELULAR_CERT_SHA256 vem do ambiente aprovado, independentemente
do APK. A verificação não cria chaves, assina ou distribui arquivos.
"""

import argparse
import os
from pathlib import Path
import re
import sys

from scripts.ota_apk_preflight import PreflightError, command


def verify_signature(apk, apksigner, expected_sha256):
    if not re.fullmatch(r"[0-9a-fA-F]{64}", expected_sha256):
        raise PreflightError("SHA-256 de referência ausente ou inválido.")
    if not apk.is_file() or apk.stat().st_size == 0:
        raise PreflightError("APK ausente ou vazio.")

    verified = command([str(apksigner), "verify", "--verbose", "--print-certs", str(apk.resolve())])
    counts = re.findall(r"^Number of signers:.*$", verified, flags=re.MULTILINE)
    digests = re.findall(r"^Signer #\S+ certificate SHA-256 digest:.*$", verified, flags=re.MULTILINE)
    if counts != ["Number of signers: 1"] or len(digests) != 1:
        raise PreflightError("O APK deve ter exatamente um assinante verificável.")

    digest = re.fullmatch(r"Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]{64})", digests[0])
    if not digest or digest[1].lower() != expected_sha256.lower():
        raise PreflightError("O SHA-256 do certificado diverge da referência.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--apksigner", required=True, type=Path)
    args = parser.parse_args()
    try:
        verify_signature(args.apk, args.apksigner, os.environ.get("ATRIO_QA_CELULAR_CERT_SHA256", ""))
    except (PreflightError, OSError) as exc:
        print(f"Assinatura QA recusada. {exc}", file=sys.stderr)
        return 1
    print("Assinatura QA aprovada. Um assinante com o SHA-256 de referência.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
