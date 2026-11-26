#!/usr/bin/env python3
"""Sondas QA manuais: metadados administrativos, nunca documentos ou mensagens."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler

from scripts.operational_diagnostic_center import unique_object

PROJECTS = {"perfil_qa": "atrio-catolico-qa-perfil",
            "chat_qa": "atrio-catolico-qa-geral",
            "qa_geral": "atrio-catolico-qa-general"}
WORKERS = {"chat_qa": "atrio-qa-geral", "qa_geral": "atrio-push-qa-general"}
MAX_BYTES = 500_000
OUTCOMES = ("metadata_confirmed", "no_deployment_reported", "access_denied",
            "not_found_or_hidden", "rate_limited", "service_error",
            "transport_unavailable", "invalid_response", "credential_missing")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def get_json(url, token, opener=None):
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9._~+/=-]{1,4096}", token):
        return "credential_missing", None
    # URLs are constructed solely by collect() from closed QA mappings.
    request = Request(url, method="GET", headers={
        "Authorization": "Bearer " + token, "Accept": "application/json"})
    try:
        with (opener or build_opener(NoRedirect).open)(request, timeout=10) as response:
            if response.status != 200:
                return "invalid_response", None
            raw = response.read(MAX_BYTES + 1)
        if not raw or len(raw) > MAX_BYTES:
            return "invalid_response", None
        parsed = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
        return ("metadata_confirmed", parsed) if isinstance(parsed, dict) else ("invalid_response", None)
    except HTTPError as exc:
        status = exc.code
        exc.close()
        return ({401: "access_denied", 403: "access_denied", 404: "not_found_or_hidden",
                 429: "rate_limited"}.get(status, "service_error" if 500 <= status <= 599
                                         else "invalid_response"), None)
    except (ValueError, UnicodeError, RecursionError):
        return "invalid_response", None
    except OSError:
        return "transport_unavailable", None


def collect(environment, provider, *, confirmed_target, token, account=None,
            now=None, fetch=get_json):
    if environment not in PROJECTS or provider not in ("firebase", "cloudflare"):
        raise ValueError("destino QA nao autorizado")
    if provider == "firebase":
        target = PROJECTS[environment]
        if confirmed_target != target or account is not None:
            raise ValueError("identidade Firebase QA divergente")
        name = f"projects/{target}/databases/(default)"
        url = "https://firestore.googleapis.com/v1/" + name
        probe = "firestore_database_metadata"
    else:
        target = WORKERS.get(environment)
        if (not target or confirmed_target != target or not isinstance(account, str)
                or not re.fullmatch(r"[a-f0-9]{32}", account)):
            raise ValueError("identidade Worker QA divergente")
        url = f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/scripts/{target}/deployments"
        probe = "worker_deployment_metadata"
    # One request maximum, no retry, no mutation, no arbitrary host or route.
    outcome, payload = fetch(url, token)
    if outcome not in OUTCOMES:
        outcome = "invalid_response"
    if outcome == "metadata_confirmed":
        if provider == "firebase":
            if not isinstance(payload, dict) or payload.get("name") != name:
                outcome = "invalid_response"
        else:
            result = payload.get("result") if isinstance(payload, dict) and payload.get("success") is True else None
            deployments = result.get("deployments") if isinstance(result, dict) else None
            if not isinstance(deployments, list):
                outcome = "invalid_response"
            elif not deployments:
                outcome = "no_deployment_reported"
            elif not all(isinstance(x, dict) and isinstance(x.get("id"), str)
                         and isinstance(x.get("versions"), list) and x["versions"]
                         for x in deployments):
                outcome = "invalid_response"
    timestamp = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return {"schema_version": 1, "environment": environment, "probe": probe,
            "outcome": outcome, "observed_at": timestamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "scope": "metadata_only", "operational_health_verified": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--environment", required=True, choices=tuple(PROJECTS))
    parser.add_argument("--provider", required=True, choices=("firebase", "cloudflare"))
    parser.add_argument("--confirm-target", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    # Explicit operator invocation only; no CI secrets, login or token minting.
    dest = Path(args.output)
    if dest.exists():
        raise SystemExit("destino existente")
    token = os.environ.get("ATRIO_QA_FIREBASE_READ_TOKEN" if args.provider == "firebase"
                           else "ATRIO_QA_CLOUDFLARE_READ_TOKEN")
    account = os.environ.get("ATRIO_QA_CLOUDFLARE_ACCOUNT_ID") if args.provider == "cloudflare" else None
    try:
        result = collect(args.environment, args.provider, confirmed_target=args.confirm_target,
                         token=token, account=account)
    except ValueError:
        raise SystemExit("destino QA recusado")
    with dest.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(result, indent=2) + "\n")
    print(result["outcome"])
    return 0 if result["outcome"] == "metadata_confirmed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
