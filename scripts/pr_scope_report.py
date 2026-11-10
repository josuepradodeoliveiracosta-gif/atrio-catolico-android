#!/usr/bin/env python3
"""Relatorio exclusivamente read-only do escopo de uma Pull Request."""
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
MAX_PATHS = 10000
CATEGORIES = (
    "Android", "Firebase/Firestore", "Cloudflare",
    "CI/Seguranca", "Ferramentas", "Documentacao", "Outros"
)


def classify(path: str) -> str:
    if path.startswith(".github/"):
        return "CI/Seguranca"
    if path.startswith("app/") or path.startswith("gradle/"):
        return "Android"
    if path == "firestore.rules" or path.startswith(("firebase/", "tests/security/")):
        return "Firebase/Firestore"
    if path.startswith("cloudflare/"):
        return "Cloudflare"
    if path.startswith("scripts/"):
        return "Ferramentas"
    if path.startswith("docs/") or path.endswith(".md"):
        return "Documentacao"
    return "Outros"


def validate_sha(sha: str) -> str:
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Commit SHA deve ter 40 caracteres hexadecimais")
    return sha


def changed_files(base: str, head: str) -> list[str]:
    validate_sha(base)
    validate_sha(head)
    result = subprocess.run(
        ["git", "diff", "--name-only", "-z", f"{base}...{head}", "--"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=60,
    ).stdout
    paths = [p.decode("utf-8", "replace") for p in result.split(b"\0") if p]
    if len(paths) > MAX_PATHS:
        raise RuntimeError("Escopo excedeu o limite de auditoria")
    return paths


def report(base: str, head: str, paths: list[str]) -> str:
    validate_sha(base)
    validate_sha(head)
    counts = Counter(classify(p) for p in paths)
    lines = [
        "## Relatorio automatico de escopo da PR",
        "",
        f"- Base: {base[:12]}",
        f"- Head: {head[:12]}",
        f"- Arquivos modificados: **{len(paths)}**",
        "",
        "| Area | Arquivos |",
        "| --- | ---: |",
    ]
    for category in CATEGORIES:
        if counts[category]:
            lines.append(f"| {category} | {counts[category]} |")
    if not paths:
        lines.append("| Nenhuma mudanca detectada | 0 |")
    lines.append("")
    if len(paths) > 30 or len(counts) >= 4:
        lines.append(
            "**Atencao, escopo amplo:** avaliar dividir futuras funcionalidades "
            "em PRs menores. Este relatorio nao bloqueia a PR."
        )
    elif paths:
        lines.append(
            "Escopo registrado. A aprovacao depende dos testes e da revisao "
            "humana; contagem de arquivos nao comprova qualidade."
        )
    sensitive = any(
        p == "firestore.rules" or p.startswith(
            (".github/workflows/", "cloudflare/", "firebase/")
        ) or "release" in p.lower() or "signing" in p.lower()
        for p in paths
    )
    if sensitive:
        lines.extend((
            "",
            "**Areas sensiveis detectadas:** validar isolamento, permissoes, "
            "testes e autorizacao separada para qualquer implantacao."
        ))
    lines.extend((
        "",
        "Sem deploy, chamadas remotas ou alteracao do repositorio. "
        "Esta verificacao e apenas informativa.",
        "",
    ))
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    args = parser.parse_args()
    print(report(args.base, args.head, changed_files(args.base, args.head)))


if __name__ == "__main__":
    main()
