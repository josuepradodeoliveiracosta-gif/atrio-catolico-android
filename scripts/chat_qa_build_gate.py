#!/usr/bin/env python3
"""Preflight offline para buildType chatQa, sem rede ou uso de credenciais."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys

QA_PACKAGE = "br.com.atriocatolico.chatqa"
PROD_PROJECT = "atrio-catolico"
PROD_HOSTS = {"atrio-push.atrio-catolico.workers.dev",
              "atrio-guardian-v2.atrio-catolico.workers.dev"}


class QaBuildGateError(ValueError):
    pass


def validate(path, *, project, app_id, worker_url, sha256):
    if (not re.fullmatch(r"[a-z][a-z0-9-]{4,40}", project or "") or
            project == PROD_PROJECT):
        raise QaBuildGateError("qa_project_not_approved")
    if not re.fullmatch(r"1:[0-9]+:android:[0-9a-fA-F]+", app_id or ""):
        raise QaBuildGateError("qa_app_id_not_approved")
    m = re.fullmatch(r"https://([a-z0-9-]+)\.([a-z0-9-]+)\.workers\.dev",
                     worker_url or "")
    if (not m or "qa" not in m.group(1).split("-") or
            worker_url.removeprefix("https://") in PROD_HOSTS):
        raise QaBuildGateError("separate_qa_worker_required")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", sha256 or ""):
        raise QaBuildGateError("approved_config_hash_required")
    config = Path(path)
    if config.is_symlink() or not config.is_file():
        raise QaBuildGateError("separate_qa_config_required")
    if not 0 < config.stat().st_size <= 65536:
        raise QaBuildGateError("qa_config_size_invalid")
    data_bytes = config.read_bytes()
    if hashlib.sha256(data_bytes).hexdigest() != sha256.lower():
        raise QaBuildGateError("qa_config_hash_mismatch")
    try:
        data = json.loads(data_bytes)
        info = data["project_info"]
        clients = data["client"]
        if not isinstance(clients, list) or len(clients) != 1:
            raise QaBuildGateError("one_qa_client_required")
        client = clients[0]
        actual_project = info["project_id"]
        sender = str(info["project_number"])
        actual_app = client["client_info"]["mobilesdk_app_id"]
        actual_package = client["client_info"]["android_client_info"]["package_name"]
        keys = client["api_key"]
        if not isinstance(keys, list) or not keys or not keys[0]["current_key"]:
            raise QaBuildGateError("qa_config_incomplete")
    except (ValueError, KeyError, IndexError, TypeError):
        raise QaBuildGateError("qa_config_incomplete") from None
    if actual_project != project or actual_project == PROD_PROJECT:
        raise QaBuildGateError("qa_project_mismatch")
    if actual_app != app_id or sender != app_id.split(":")[1]:
        raise QaBuildGateError("qa_firebase_app_or_sender_mismatch")
    if actual_package != QA_PACKAGE:
        raise QaBuildGateError("qa_package_mismatch")
    if hashlib.sha256(config.read_bytes()).hexdigest() != sha256.lower():
        raise QaBuildGateError("qa_config_changed_during_check")
    return True  # Ainda exige auditoria do APK e de FCM.


def main():
    try:
        validate(
            "app/src/chatQa/google-services.json",
            project=os.getenv("ATRIO_CHAT_QA_PROJECT", ""),
            app_id=os.getenv("ATRIO_CHAT_QA_APP_ID", ""),
            worker_url=os.getenv("ATRIO_CHAT_QA_WORKER_URL", ""),
            sha256=os.getenv("ATRIO_CHAT_QA_CONFIG_SHA256", ""),
        )
    except (QaBuildGateError, OSError) as exc:
        print("CHAT QA REPROVADO: " + str(exc), file=sys.stderr)
        return 1
    print("CHAT QA: configuracao verificada offline. APK e rede nao auditados.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
