#!/usr/bin/env python3
"""Termux: auditoria SOMENTE LEITURA do Firebase para Google Play.

Não acessa dados de usuários, não publica regras, não modifica o Firebase.
Os retornos completos do CLI são processados em memória e nunca impressos.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

PROJECT = "atrio-catolico"
PACKAGE = "br.com.atriocatolico"
BRANCH = "feature/play-closed-testing-aab-20261031"
ROOT = Path(__file__).resolve().parent.parent
COMMANDS = {
    "projects": ("projects:list",),
    "android": ("apps:list", "ANDROID"),
    "web": ("apps:list", "WEB"),
    "databases": ("firestore:databases:list",),
    "indexes": ("firestore:indexes",),
}


class AuditError(Exception):
    pass


def parse_json(raw):
    try:
        obj = json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise AuditError("resposta_json_invalida") from exc
    if isinstance(obj, dict) and obj.get("status") == "error":
        raise AuditError("firebase_comando_recusado")
    return obj.get("result", obj) if isinstance(obj, dict) else obj


def records(obj, *names):
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        for key in names:
            if isinstance(obj.get(key), list):
                return obj[key]
    raise AuditError("formato_remoto_desconhecido")


def cmd(argv, *, cwd=ROOT, timeout=75):
    try:
        result = subprocess.run(
            list(argv), cwd=cwd, text=True, capture_output=True,
            timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise AuditError("comando_indisponivel_ou_expirado") from exc
    if result.returncode != 0:
        # NUNCA imprimir stdout/stderr: erros de terceiros podem conter PII.
        raise AuditError("comando_recusado_ou_sem_permissao")
    return result.stdout.strip()


def local_preflight(root=ROOT, execute=cmd):
    if execute(("git", "branch", "--show-current"), cwd=root) != BRANCH:
        raise AuditError("branch_incorreta_nao_usar_main")
    config = json.loads((root / "firebase.json").read_text(encoding="utf-8"))
    if config.get("firestore") != {
        "rules": "firestore.rules", "indexes": "firestore.indexes.json"
    }:
        raise AuditError("configuracao_firestore_local_inesperada")
    firebase = json.loads((root / "app/google-services.json").read_text(encoding="utf-8"))
    if firebase.get("project_info", {}).get("project_id") != PROJECT:
        raise AuditError("projeto_android_local_divergente")
    matching = [x for x in firebase.get("client", []) if
                x.get("client_info", {}).get("android_client_info", {}).get("package_name") == PACKAGE]
    if len(matching) != 1:
        raise AuditError("pacote_android_local_divergente")
    app_id = matching[0]["client_info"].get("mobilesdk_app_id")
    if not isinstance(app_id, str) or not app_id:
        raise AuditError("firebase_android_app_id_ausente")
    gradle = (root / "app/build.gradle.kts").read_text(encoding="utf-8")
    if not re.search(r'targetSdk\s*=\s*36\b', gradle) or not re.search(
        r'applicationId\s*=\s*"br\.com\.atriocatolico"', gradle
    ):
        raise AuditError("configuracao_play_android_divergente")
    desired = json.loads((root / "firestore.indexes.json").read_text(encoding="utf-8"))
    if not isinstance(desired.get("indexes"), list) or not isinstance(
        desired.get("fieldOverrides"), list
    ):
        raise AuditError("indices_locais_invalidos")
    return {"android_app_id": app_id, "indexes": desired}


def firebase_read(key, execute=cmd):
    if key not in COMMANDS:
        raise AuditError("consulta_nao_permitida")
    args = ["firebase", *COMMANDS[key]]
    if key != "projects":
        args += ["--project", PROJECT]
    args += ["--json"]
    return parse_json(execute(args))


def index_fields(row):
    if not isinstance(row, dict):
        return ()
    fields = row.get("fields", [])
    if not isinstance(fields, list):
        return ()
    return tuple((f.get("fieldPath"), f.get("order"), f.get("arrayConfig"))
                 for f in fields if isinstance(f, dict) and f.get("fieldPath") != "__name__")


def index_signature(row):
    if not isinstance(row, dict):
        return None
    return row.get("collectionGroup"), row.get("queryScope"), index_fields(row)


def evaluate(local, remote):
    issues = []
    projects = records(remote["projects"], "projects")
    if not any(isinstance(p, dict) and p.get("projectId") == PROJECT for p in projects):
        issues.append("projeto_nao_listado_na_conta")
    android = records(remote["android"], "apps")
    if not any(isinstance(a, dict) and a.get("appId") == local["android_app_id"]
               for a in android):
        issues.append("firebase_app_android_nao_corresponde")
    web = records(remote["web"], "apps")
    if not any(isinstance(a, dict) and str(a.get("appId", "")).startswith("1:")
               for a in web):
        issues.append("firebase_app_web_para_portal_nao_confirmado")
    dbs = records(remote["databases"], "databases")
    if not any(isinstance(d, dict) and
               (d.get("databaseId") == "(default)" or
                str(d.get("name", "")).endswith("/databases/(default)"))
               for d in dbs):
        issues.append("banco_firestore_default_nao_confirmado")
    remote_index = remote["indexes"]
    if not isinstance(remote_index, dict):
        raise AuditError("resposta_indices_sem_objeto")
    compound = records(remote_index, "indexes")
    overrides = records(remote_index, "fieldOverrides")
    for desired in local["indexes"]["indexes"]:
        matches = [x for x in compound if index_signature(x) == index_signature(desired)]
        if not matches:
            issues.append("indice_composto_ausente")
        elif not any(x.get("state", "READY") == "READY" for x in matches):
            issues.append("indice_composto_ainda_nao_pronto")
    for desired in local["indexes"]["fieldOverrides"]:
        if not any(isinstance(x, dict) and
                   x.get("collectionGroup") == desired.get("collectionGroup") and
                   x.get("fieldPath") == desired.get("fieldPath") and
                   set(index_fields({"fields": x.get("indexes", [])})) ==
                   set(index_fields({"fields": desired.get("indexes", [])}))
                   for x in overrides):
            issues.append("override_indice_ausente")
    return issues


def main():
    print("Átrio Católico | Firebase via Termux | somente leitura")
    if not shutil.which("git") or not shutil.which("firebase"):
        print("BLOQUEADO: instale Git e Firebase CLI no Termux.")
        return 2
    try:
        local = local_preflight()
    except (AuditError, OSError, ValueError, KeyError, TypeError) as exc:
        name = str(exc) if isinstance(exc, AuditError) else "arquivos_locais_invalidos"
        print("BLOQUEADO: " + name)
        return 2
    remote, failed = {}, []
    for key in COMMANDS:
        try:
            remote[key] = firebase_read(key)
            print("Consulta " + key + ": respondida (sem divulgar valores)")
        except AuditError:
            failed.append("consulta_" + key + "_nao_confirmada")
            print("Consulta " + key + ": não confirmada; confira login/permissões")
    if failed:
        print("BLOQUEADO: " + ", ".join(failed))
        return 2
    try:
        issues = evaluate(local, remote)
    except AuditError:
        issues = ["resposta_firebase_inesperada_revisao_manual"]
    if issues:
        print("PENDENTE: " + ", ".join(issues))
        print("NÃO execute firebase deploy para corrigir automaticamente.")
        return 2
    print("OK: verificações remotas limitadas aprovadas.")
    print("PENDENTE: regras vigentes, Auth E-mail/Senha, políticas, portal HTTPS,")
    print("exclusão real, assinatura Play e QA humana NÃO foram verificados.")
    print("Nenhuma alteração no Firebase foi realizada.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
