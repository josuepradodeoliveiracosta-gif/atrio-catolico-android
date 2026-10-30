#!/usr/bin/env python3
"""Create only one synthetic Firestore QA post through authorized Cloud Shell.

Default is read-only. --apply requires project QA + billing disabled + explicit
confirmation; no service-account keys, no production changes, no account creation.
"""
import argparse
from datetime import datetime, timezone
import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

PROJECT = "atrio-catolico-qa-v2"
RESOURCE = f"projects/{PROJECT}/databases/(default)/documents/posts/qa_post_1"
URL = "https://firestore.googleapis.com/v1/" + RESOURCE
CONFIRM = "CREATE_ONLY_QA_FIXTURE"
TITLE = "Dúvida fictícia sobre a Missa"
BODY = "Como funciona o calendário litúrgico? Conteúdo apenas para QA."


def gcloud(*args):
    return subprocess.check_output(
        ["gcloud", *args], stderr=subprocess.DEVNULL, text=True
    ).strip()


def checked_environment():
    if gcloud("config", "get-value", "project") != PROJECT:
        raise RuntimeError("Projeto gcloud diferente do QA; nenhuma alteração permitida.")
    billing = gcloud("billing", "projects", "describe", PROJECT,
                     "--format=value(billingEnabled)").lower()
    if billing != "false":
        raise RuntimeError("Faturamento QA ativo ou desconhecido; operação bloqueada.")


def request(method, token, payload=None):
    url = URL
    if method == "PATCH":
        url += "?currentDocument.exists=false"
    req = urllib.request.Request(
        url,
        data=None if payload is None else json.dumps(payload).encode("utf-8"),
        headers={"Authorization": "Bearer " + token,
                 "Accept": "application/json",
                 "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        # Never log response bodies, identity, actual document text or tokens.
        return error.code, None


def fixture_fields():
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {"fields": {
        "qaFixture": {"booleanValue": True},
        "uid": {"stringValue": "qa-synthetic-user"},
        "authorName": {"stringValue": "Guardião QA"},
        "title": {"stringValue": TITLE},
        "body": {"stringValue": BODY},
        "category": {"stringValue": "duvidas"},
        "createdAt": {"timestampValue": timestamp},
    }}


def is_qa_fixture(document):
    return bool(
        isinstance(document, dict)
        and document.get("name") == RESOURCE
        and document.get("fields", {}).get("qaFixture", {}).get("booleanValue")
        is True
    )


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm", default="")
    args = parser.parse_args(argv)
    if args.apply and args.confirm != CONFIRM:
        raise RuntimeError("Confirmação explícita obrigatória para QA.")
    checked_environment()
    token = gcloud("auth", "print-access-token")
    if len(token) < 20:
        raise RuntimeError("Credenciais Google Cloud ausentes.")
    status, existing = request("GET", token)
    if status == 200:
        if is_qa_fixture(existing):
            print("QA_FIXTURE_ALREADY_EXISTS: nenhuma modificação")
            return
        raise RuntimeError("Documento já existe sem marca QA; não sobrescrever.")
    if status != 404:
        raise RuntimeError(f"Leitura da fixture QA indisponível ({status}); abortado.")
    if not args.apply:
        print("QA_FIXTURE_DRY_RUN: fixture ausente; --apply necessário")
        return
    created, _ = request("PATCH", token, fixture_fields())
    if created not in (200, 201):
        raise RuntimeError(f"Criação QA não confirmada ({created}); sem retry automático.")
    verified, document = request("GET", token)
    if verified != 200 or not is_qa_fixture(document):
        raise RuntimeError("Documento QA não confirmado após criação.")
    print("QA_FIXTURE_CREATED_AND_VERIFIED: somente posts/qa_post_1")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("QA_FIXTURE_BLOCKED: " + str(error), file=sys.stderr)
        sys.exit(1)
