"""Preflight local fail-closed da variante Android Perfil QA.

Nao contata Firebase, nao cria arquivos, nao mostra segredos.
O google-services.json de QA deve ser obtido separadamente pelo fundador.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import sys

EXPECTED_PROJECT = "atrio-catolico-qa-perfil"
EXPECTED_SENDER = "492511505084"
EXPECTED_APP_ID = "1:492511505084:android:17949b85935e25aedb7eb9"
EXPECTED_PACKAGE = "br.com.atriocatolico.perfilqa"
EXPECTED_PATH = Path(__file__).resolve().parents[1] / "app/src/perfilQa/google-services.json"


class QaConfigError(ValueError):
    pass


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise QaConfigError("Campo JSON duplicado: bloqueado.")
        result[key] = value
    return result


def _require(ok, message):
    if not ok:
        raise QaConfigError(message)


def validate(path: Path, expected_sha256: str) -> dict[str, str]:
    """Valida o arquivo QA, seu hash aprovado e vinculo estrito ao Android App."""
    path = Path(path)
    _require(not path.is_symlink() and path.is_file(), "Configuracao QA ausente, invalida ou symlink.")
    _require(
        bool(re.fullmatch(r"[0-9a-f]{64}", expected_sha256 or "")),
        "ATRIO_PERFIL_QA_CONFIG_SHA256 obrigatorio (hash SHA-256 valido).",
    )
    raw = path.read_bytes()
    _require(bool(raw) and len(raw) <= 1024 * 1024, "Tamanho de configuracao QA invalido.")
    _require(
        hashlib.sha256(raw).hexdigest() == expected_sha256,
        "Hash da configuracao QA nao coincide. Interromper build.",
    )
    try:
        config = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
    except (ValueError, UnicodeDecodeError) as exc:
        raise QaConfigError("JSON QA invalido ou com campos repetidos.") from exc

    _require(isinstance(config, dict), "Raiz JSON QA invalida.")
    project = config.get("project_info")
    _require(isinstance(project, dict), "project_info ausente.")
    _require(project.get("project_id") == EXPECTED_PROJECT, "Projeto Firebase nao e Perfil QA.")
    _require(str(project.get("project_number")) == EXPECTED_SENDER, "FCM sender diferente do QA.")
    # Se presente, Storage nunca deve apontar para o projeto oficial.
    storage = project.get("storage_bucket")
    _require(
        storage is None or
        (isinstance(storage, str) and storage.lower().startswith(EXPECTED_PROJECT + ".")),
        "Storage de projeto externo ao Perfil QA.",
    )
    clients = config.get("client")
    _require(isinstance(clients, list) and len(clients) == 1, "Exigir unico cliente Android QA.")
    client = clients[0]
    _require(isinstance(client, dict), "Cliente QA invalido.")
    info = client.get("client_info")
    _require(isinstance(info, dict), "client_info ausente.")
    _require(info.get("mobilesdk_app_id") == EXPECTED_APP_ID, "Firebase Android App ID diferente.")
    android = info.get("android_client_info")
    _require(isinstance(android, dict), "android_client_info ausente.")
    _require(android.get("package_name") == EXPECTED_PACKAGE, "Pacote nao e Perfil QA.")
    api_keys = client.get("api_key")
    _require(
        isinstance(api_keys, list) and len(api_keys) == 1 and
        isinstance(api_keys[0], dict) and
        isinstance(api_keys[0].get("current_key"), str) and
        len(api_keys[0]["current_key"]) >= 8,
        "Configuracao de chave cliente Firebase invalida.",
    )
    return {
        "firebase_project_id": EXPECTED_PROJECT,
        "firebase_android_app_id": EXPECTED_APP_ID,
        "android_package": EXPECTED_PACKAGE,
        "hash_verified": "true",
    }


def main() -> int:
    try:
        receipt = validate(
            EXPECTED_PATH, os.environ.get("ATRIO_PERFIL_QA_CONFIG_SHA256", "")
        )
    except (QaConfigError, OSError) as exc:
        print("PERFIL_QA=BUILD_BLOQUEADO", file=sys.stderr)
        print("MOTIVO=" + str(exc), file=sys.stderr)
        return 1
    print("PERFIL_QA=CONFIG_LOCAL_VALIDADA")
    for key, value in receipt.items():
        print(key + "=" + value)
    print("AVISO=Esta validacao nao prova APK, Rules remotas ou funcionamento em aparelho.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
