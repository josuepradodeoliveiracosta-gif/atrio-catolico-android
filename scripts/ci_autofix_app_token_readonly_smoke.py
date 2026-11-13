#!/usr/bin/env python3
"""One-shot GitHub App token smoke proof: fixed HTTPS GETs, never a repo write.

The token is supplied only by a GitHub Actions environment in a manually
triggered, main-only workflow. It must not be printed, uploaded, cached, or
provided to untrusted pull requests. This script never creates a token.
"""
import json
import os
from urllib.request import HTTPRedirectHandler, Request, build_opener

REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
OWNER = "josuepradodeoliveiracosta-gif"
WORKFLOW_NAME = "QA - Verificar token GitHub App (somente leitura)"
API_HOST = "https://api.github.com"
INVENTORY = "/installation/repositories?per_page=2"
SOURCE_FILE = ".github/workflows/autofix-qa-approved-draft.yml"
SOURCE = f"/repos/{REPO}/contents/{SOURCE_FILE}?ref=main"
PULLS = f"/repos/{REPO}/pulls?state=open&per_page=1"
ALLOWED_ENDPOINTS = frozenset((INVENTORY, SOURCE, PULLS))
MAX_RESPONSE_BYTES = 256_000


class NoRedirect(HTTPRedirectHandler):
    """Bearer credentials must never follow redirects to arbitrary hosts."""

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def verify_context(env):
    """Fail closed outside an owner's explicit manual dispatch on main."""
    expected = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_ACTOR": OWNER,
        "GITHUB_WORKFLOW": WORKFLOW_NAME,
    }
    if (not isinstance(env, dict)
            or any(env.get(key) != value for key, value in expected.items())):
        raise PermissionError("prova autorizada apenas por dispatch do fundador na main")


def read_only_get(endpoint, token, open_request=None):
    """Accept only three audited GitHub GET paths; bound response bytes."""
    if endpoint not in ALLOWED_ENDPOINTS:
        raise ValueError("endpoint fora da allowlist de leitura")
    if (not isinstance(token, str) or not 1 <= len(token) <= 4096
            or token.strip() != token or any(c in token for c in "\r\n\x00")):
        raise PermissionError("token de instalacao invalido ou ausente")
    request = Request(
        API_HOST + endpoint,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + token,
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method="GET",
    )
    if open_request is None:
        open_request = build_opener(NoRedirect).open
    with open_request(request, timeout=15) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("resposta GitHub acima do limite")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("resposta GitHub nao e JSON valido") from error


def verify_installation_token(token, open_request=None):
    """Verify installation scope and useful GETs without remote mutation."""
    inventory = read_only_get(INVENTORY, token, open_request)
    if (type(inventory) is not dict
            or type(inventory.get("total_count")) is not int
            or inventory["total_count"] != 1
            or type(inventory.get("repositories")) is not list
            or len(inventory["repositories"]) != 1
            or type(inventory["repositories"][0]) is not dict
            or inventory["repositories"][0].get("full_name") != REPO):
        raise PermissionError("instalacao nao esta limitada ao repositorio esperado")

    source = read_only_get(SOURCE, token, open_request)
    if (type(source) is not dict or source.get("type") != "file"
            or source.get("path") != SOURCE_FILE):
        raise ValueError("leitura do arquivo de origem nao comprovada")

    pulls = read_only_get(PULLS, token, open_request)
    if type(pulls) is not list or len(pulls) > 1:
        raise ValueError("leitura de PRs nao comprovada")
    return {
        "repository_scope_verified": True,
        "contents_read_verified": True,
        "pull_requests_read_verified": True,
        "remote_writes": 0,
    }


def main(env=None):
    environment = dict(os.environ) if env is None else env
    verify_context(environment)
    token = environment.get("ATRIO_APP_SMOKE_TOKEN", "")
    try:
        proof = verify_installation_token(token)
    except Exception:
        # Deliberately suppress exception values and tracebacks from HTTP
        # libraries: authorization headers and responses must not reach logs.
        raise RuntimeError("prova GET da GitHub App falhou; sem exibir dados confidenciais") from None
    if (not proof["repository_scope_verified"]
            or not proof["contents_read_verified"]
            or not proof["pull_requests_read_verified"]
            or proof["remote_writes"] != 0):
        raise RuntimeError("contrato somente leitura nao comprovado")
    print("GitHub App: token temporario validado somente leitura; 1 repo; zero escritas")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
