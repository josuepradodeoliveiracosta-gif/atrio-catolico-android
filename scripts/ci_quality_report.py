#!/usr/bin/env python3
"""Snapshot read-only dos checks associados a um SHA exato."""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re
from urllib.request import Request, urlopen

REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
REQUIRED = (
    "Detectar segredos em arquivos e histórico Git",
    "Evitar regressão de versionCode e versionName",
    "Regras de seguranca Firestore",
    "Compilar Android de testes",
    "Bloquear exclusoes em massa (Atrio)",
)


def validate_sha(sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha or ""):
        raise ValueError("SHA deve ter 40 digitos hexadecimais")
    return sha


def get_checks(sha, token, opener=urlopen):
    validate_sha(sha)
    if not token:
        raise ValueError("GitHub token de leitura ausente")
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
            batch = json.load(response).get("check_runs")
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


def report(sha, checks):
    validate_sha(sha)
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
            "conclusion": conclusion, "details_url": check.get("html_url") or "",
        })
    required = {
        name: state_for([x for x in checks if x["name"] == name])
        for name in REQUIRED
    }
    complete = all(value == "success" for value in required.values())
    summary = {
        "repository": REPO, "commit_sha": sha, "check_count": len(checks),
        "counts": dict(sorted(totals.items())), "required_checks": required,
        "all_required_success": complete, "checks": serialized,
        "purpose": "audit_only_never_merge_approval",
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
    markdown.extend((
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
    parser.add_argument("--json", required=True)
    parser.add_argument("--markdown", required=True)
    args = parser.parse_args()
    output, markdown = report(
        args.sha, get_checks(args.sha, os.environ.get("GITHUB_TOKEN", ""))
    )
    Path(args.json).write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    Path(args.markdown).write_text(markdown, encoding="utf-8")
    print("Relatório gerado sem alterações remotas:", output["check_count"])


if __name__ == "__main__":
    main()
