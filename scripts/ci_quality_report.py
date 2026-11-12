#!/usr/bin/env python3
"""Snapshot read-only dos checks associados a um SHA exato."""
import argparse
from collections import Counter
from datetime import datetime
import json
import os
from pathlib import Path
import re
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.parse import urlsplit

REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
MAX_CHECK_API_BYTES = 2_000_000


class NoRedirect(HTTPRedirectHandler):
    """Never forward a GitHub bearer token via a cross-host redirect."""

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


REQUIRED = (
    "Detectar segredos em arquivos e histórico Git",
    "Evitar regressão de versionCode e versionName",
    "Regras de seguranca Firestore",
    "Compilar Android de testes",
    "Bloquear exclusoes em massa (Atrio)",
)

# These jobs are triggered by Pull Requests and do not run on main pushes.
# Never count an absent PR-only check as 'success' for a push.
PR_ONLY_REQUIRED_ON_PUSH = frozenset((
    "Regras de seguranca Firestore",
    "Compilar Android de testes",
    "Bloquear exclusoes em massa (Atrio)",
))


def validate_sha(sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha or ""):
        raise ValueError("SHA deve ter 40 digitos hexadecimais")
    return sha


def get_checks(sha, token, opener=None):
    validate_sha(sha)
    if not token:
        raise ValueError("GitHub token de leitura ausente")
    # Explicitly forbid redirects with Authorization. No auth header can reach
    # any destination except the locally constructed api.github.com URL.
    if opener is None:
        opener = build_opener(NoRedirect).open
    result = []
    for page in range(1, 7):
        url = (f"https://api.github.com/repos/{REPO}/commits/"
               f"{sha}/check-runs?per_page=100&page={page}")
        request = Request(url, headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        with opener(request, timeout=20) as response:
            payload = response.read(MAX_CHECK_API_BYTES + 1)
        if len(payload) > MAX_CHECK_API_BYTES:
            raise ValueError("Resposta de checks acima do limite")
        decoded = json.loads(payload)
        if not isinstance(decoded, dict):
            raise ValueError("Resposta de checks invalida")
        batch = decoded.get("check_runs")
        if not isinstance(batch, list):
            raise ValueError("Resposta sem lista de checks")
        result.extend(batch)
        if len(batch) < 100:
            return result
    raise RuntimeError("Excesso de checks; recusa relatorio incompleto")


def state_for(checks):
    if not checks:
        return "missing"
    if any(x.get("status") != "completed" for x in checks):
        return "pending"
    if any(x.get("conclusion") != "success" for x in checks):
        return "not-success"
    return "success"


def safe_markdown(raw):
    return (str(raw).replace("|", r"\|").replace("\r", " ")
            .replace("\n", " ").replace("<", "&lt;").replace(">", "&gt;"))


def safe_actions_url(raw):
    """Keep only canonical in-repo Actions URLs without query or secrets.

    GitHub check-run details_url may be an arbitrary external integration URL;
    never copy such URLs (or their query parameters) to public CI artifacts.
    """
    if not isinstance(raw, str) or len(raw) > 2048:
        return None
    try:
        url = urlsplit(raw)
        port = url.port
    except ValueError:
        return None
    if (url.scheme != "https" or url.hostname != "github.com"
            or url.username or url.password or port not in (None, 443)):
        return None
    path = re.escape(REPO)
    if not re.fullmatch(
            rf"/{path}/(?:actions/runs/[0-9]+(?:/job/[0-9]+)?|runs/[0-9]+)",
            url.path):
        return None
    return "https://github.com" + url.path


def duration_seconds(check):
    """Segundos observados de check completo; nunca estimar em caso de lacuna."""
    if check.get("status") != "completed":
        return None
    try:
        start = datetime.fromisoformat(check["started_at"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(check["completed_at"].replace("Z", "+00:00"))
        if start.tzinfo is None or end.tzinfo is None:
            return None
        diff = (end - start).total_seconds()
    except (TypeError, KeyError, AttributeError, ValueError, OverflowError):
        return None
    if not 0 <= diff <= 86400:
        return None
    return round(diff)


def report(sha, checks, source_event="unknown"):
    validate_sha(sha)
    if source_event not in ("unknown", "push", "pull_request"):
        raise ValueError("evento de CI invalido")
    if not isinstance(checks, list):
        raise ValueError("checks deve ser uma lista")
    totals = Counter()
    serialized = []
    for check in checks:
        if not isinstance(check, dict) or not isinstance(check.get("name"), str):
            raise ValueError("check invalido")
        status = check.get("status") or "unknown"
        conclusion = check.get("conclusion") or "pending"
        totals[conclusion if status == "completed" else "in_progress"] += 1
        serialized.append({
            "name": check["name"], "status": status,
            "conclusion": conclusion,
            "details_url": (safe_actions_url(check.get("details_url"))
                            or safe_actions_url(check.get("html_url")) or ""),
        })
    measured = sorted(
        ((check["name"], duration_seconds(check)) for check in checks
         if isinstance(check.get("app"), dict)
         and check["app"].get("slug") == "github-actions"),
        key=lambda pair: (pair[1] is None, -(pair[1] or 0), pair[0]),
    )
    measured = [(name, seconds) for name, seconds in measured if seconds is not None]
    timing = {
        "measured_checks": len(measured),
        "sum_check_seconds": sum(seconds for _, seconds in measured),
        "longest_checks": [
            {"name": name, "seconds": seconds} for name, seconds in measured[:5]
        ],
        "measurement_note": "duracoes_observadas_nao_custo_cobravel",
    }
    required = {
        name: state_for([x for x in checks if x["name"] == name])
        for name in REQUIRED
    }
    not_expected_on_push = sorted(
        name for name in PR_ONLY_REQUIRED_ON_PUSH
        if source_event == "push" and required[name] == "missing"
    )
    complete = all(value == "success" for value in required.values())
    summary = {
        "repository": REPO, "commit_sha": sha, "check_count": len(checks),
        "counts": dict(sorted(totals.items())), "required_checks": required,
        "all_required_success": complete, "checks": serialized,
        "timing": timing,
        "purpose": "audit_only_never_merge_approval",
        "source_event": source_event,
        "missing_pr_only_checks_on_push": not_expected_on_push,
    }
    markdown = [
        "## Relatório de CI do commit", "",
        f"**SHA exato:** {sha}", f"**Checks encontrados:** {len(checks)}", "",
        "| Estado | Total |", "| --- | ---: |",
    ]
    for label, amount in sorted(totals.items()):
        markdown.append(f"| {safe_markdown(label)} | {amount} |")
    if not totals:
        markdown.append("| Sem checks retornados | 0 |")
    markdown.extend((
        "", "### Verificações obrigatórias da main", "",
        "| Check obrigatório | Estado |", "| --- | --- |",
    ))
    for name, state in required.items():
        markdown.append(f"| {safe_markdown(name)} | {safe_markdown(state)} |")
    if not_expected_on_push:
        markdown.append(
            "Escopo do evento: os checks PR-only ausentes no push nao sao esperados. "
            "Continuam ausentes no relatorio; nao foram aprovados nem ignorados."
        )
    markdown.extend((
        "", "### Duracoes observadas dos checks GitHub Actions", "",
        f"**Checks com duracao medivel:** {timing['measured_checks']}",
        f"**Soma de duracoes observadas:** {timing['sum_check_seconds']} segundos",
        "", "| Check | Segundos |", "| --- | ---: |",
    ))
    for item in timing["longest_checks"]:
        markdown.append(f"| {safe_markdown(item['name'])} | {item['seconds']} |")
    if not timing["longest_checks"]:
        markdown.append("| Sem timestamps disponiveis | — |")
    markdown.extend((
        "", "Dados por check nao equivalem a minutos cobraveis, nem isolam tempo de fila.",
        "",
        "Todos os cinco checks obrigatórios passaram nesta consulta."
        if complete else
        "**Pendente:** há checks ausentes, não aprovados ou em andamento. "
        "Não autoriza merge.",
        "",
        "Relatório exclusivamente informativo. Checks cancelados ou ignorados "
        "não equivalem a sucesso. Outros testes e revisão humana continuam "
        "necessários. Nenhuma PR, release ou sistema externo foi modificado.",
        "",
    ))
    return summary, "\n".join(markdown)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", required=True)
    parser.add_argument("--source-event", default="unknown",
                        choices=("unknown", "push", "pull_request"))
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    output, markdown = report(
        args.sha, get_checks(args.sha, os.environ.get("GITHUB_TOKEN", "")),
        source_event=args.source_event
    )
    Path(args.json).write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    Path(args.markdown).write_text(markdown, encoding="utf-8")
    print("Relatório gerado sem alterações remotas:", output["check_count"])


if __name__ == "__main__":
    main()
