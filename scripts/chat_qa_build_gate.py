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


def validate(path, *, project, app_id, worker_url, sha256, offline_only=False):
    if (not re.fullmatch(r"[a-z][a-z0-9-]{4,40}", project or "") or
            project != "atrio-catolico-qa-geral"):
        raise QaBuildGateError("qa_project_not_approved")
    if not re.fullmatch(r"1:[0-9]+:android:[0-9a-fA-F]+", app_id or ""):
        raise QaBuildGateError("qa_app_id_not_approved")
    if type(offline_only) is not bool:
        raise QaBuildGateError("qa_offline_mode_invalid")
    if offline_only:
        if worker_url != "":
            raise QaBuildGateError("qa_offline_worker_url_must_be_empty")
    else:
        m = re.fullmatch(r"https://([a-z0-9-]+)\\.([a-z0-9-]+)\\.workers\\.dev",
                         worker_url or "")
        if (not m or m.group(1) != "atrio-qa-geral"
                or m.group(2) in ("demo-account", "conta", "example", "example-account")
                or worker_url.removeprefix("https://") in PROD_HOSTS):
            raise QaBuildGateError("approved_qa_worker_url_required")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", sha256 or ""):
        raise QaBuildGateError("approved_config_hash_required")
    config = Path(path)
    if config.is_symlink() or not config.is_file():
        raise QaBuildGateError("separate_qa_config_required")
    if not 0 < config.stat().st_size <= 65536:
        raise QaBuildGateError("qa_config_size_invalid")
    data_bytes = config.read_bytes()
    # Mesmo com project_id correto, impedir referencias de producao em campos
    # adicionais, como storage_bucket e oauth_client. Sem imprimir o JSON.
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
        if (not isinstance(keys, list) or len(keys) != 1
                or not isinstance(keys[0]["current_key"], str)
                or not keys[0]["current_key"]):
            raise QaBuildGateError("qa_config_incomplete")
    except (ValueError, KeyError, IndexError, TypeError):
        raise QaBuildGateError("qa_config_incomplete") from None
    def production_reference(obj):
        if isinstance(obj, str):
            return PROD_PROJECT in obj.replace(project, "")
        if isinstance(obj, list):
            return any(production_reference(v) for v in obj)
        if isinstance(obj, dict):
            return any(production_reference(k) or production_reference(v)
                       for k, v in obj.items())
        return False
    if production_reference(data):
        raise QaBuildGateError("production_reference_in_qa_config")
    if actual_project != project or actual_project == PROD_PROJECT:
        raise QaBuildGateError("qa_project_mismatch")
    if actual_app != app_id or sender != app_id.split(":")[1]:
        raise QaBuildGateError("qa_firebase_app_or_sender_mismatch")
    if actual_package != QA_PACKAGE:
        raise QaBuildGateError("qa_package_mismatch")
    if hashlib.sha256(config.read_bytes()).hexdigest() != sha256.lower():
        raise QaBuildGateError("qa_config_changed_during_check")
    return True  # Ainda exige auditoria do APK e de FCM.


def sanitized_receipt(path, *, project, app_id, worker_url, sha256, offline_only=False):
    """Somente evidencias locais verificadas; nunca copiar a API key."""
    validate(path, project=project, app_id=app_id,
             worker_url=worker_url, sha256=sha256, offline_only=offline_only)
    return {
        "schema": "atrio-chat-qa-preflight-v1",
        "status": "local_config_passed_only",
        "firebase_project_id": project,
        "firebase_android_app_id": app_id,
        "fcm_sender_id": app_id.split(":")[1],
        "android_package": QA_PACKAGE,
        "worker_qa_origin": worker_url if not offline_only else None,
        "offline_build_no_worker": offline_only,
        "google_services_sha256": sha256.lower(),
        "not_verified": [
            "firebase_cloud_ownership",
            "firebase_rules_and_auth",
            "cloudflare_worker_deployed",
            "cloudflare_d1_binding",
            "apk_real_contents_and_signer",
            "fcm_delivery_on_physical_devices",
            "minor_policy_and_data_retention",
        ],
    }


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv not in ([], ["--receipt"]):
        print("CHAT QA REPROVADO: invalid_arguments", file=sys.stderr)
        return 1
    try:
        offline_env = os.getenv("ATRIO_CHAT_QA_OFFLINE_ONLY", "")
        if offline_env not in ("", "1"):
            raise QaBuildGateError("qa_offline_mode_invalid")
        info = sanitized_receipt(
            "app/src/chatQa/google-services.json",
            project=os.getenv("ATRIO_CHAT_QA_PROJECT", ""),
            app_id=os.getenv("ATRIO_CHAT_QA_APP_ID", ""),
            worker_url=os.getenv("ATRIO_CHAT_QA_WORKER_URL", ""),
            sha256=os.getenv("ATRIO_CHAT_QA_CONFIG_SHA256", ""),
            offline_only=(offline_env == "1"),
        )
    except (QaBuildGateError, OSError) as exc:
        print("CHAT QA REPROVADO: " + str(exc), file=sys.stderr)
        return 1
    if argv == ["--receipt"]:
        print(json.dumps(info, ensure_ascii=False, sort_keys=True))
    else:
        print("CHAT QA: configuracao verificada offline. APK e rede nao auditados.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
