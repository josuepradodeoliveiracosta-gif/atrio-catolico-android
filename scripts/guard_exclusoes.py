#!/usr/bin/env python3
"""Trava contra exclusao generalizada, executada do codigo confiavel da main.

Inspeciona objetos Git; nunca altera o repositorio, os backups ou os dados.
O chamador deve validar os SHAs e jamais executar codigo da PR.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass

MAX_FILES_DELETED = 8
PERCENT_LIMIT_NUMERATOR = 10  # 10% da arvore rastreada
PERCENT_LIMIT_DENOMINATOR = 100
MIN_FOR_PERCENT = 3

# Uma remocao isolada destes arquivos ja exige revisao excepcional.
PROTECTED_DELETIONS = {
    "AGENTS.md",
    "README.md",
    ".github/CODEOWNERS",
    ".github/workflows/proteger-repositorio.yml",
    "scripts/guard_exclusoes.py",
    "scripts/test_guard_exclusoes.py",
    "firestore.rules",
    "app/build.gradle.kts",
    "gradle/wrapper/gradle-wrapper.properties",
}
PROTECTED_PREFIXES = (
    ".github/workflows/",
    "backup/",
    "backups/",
    "exports/",
    "snapshots/",
)

# A propria trava nao pode ser desativada por edicao numa PR.
GUARD_FILES = {
    ".github/workflows/proteger-repositorio.yml",
    "scripts/guard_exclusoes.py",
    ".github/CODEOWNERS",
}


@dataclass(frozen=True)
class Change:
    status: str
    path: str


def parse_name_status(raw: bytes) -> list[Change]:
    """Interpreta git diff --name-status -z --no-renames (status, caminho)."""
    if not raw:
        return []
    parts = raw.split(b"\0")
    if parts[-1] != b"":
        raise ValueError("Diff incompleto: faltou terminador NUL")
    parts.pop()
    if len(parts) % 2:
        raise ValueError("Diff inconsistente: status/caminho desemparelhados")
    changes = []
    for index in range(0, len(parts), 2):
        status = parts[index].decode("ascii", errors="strict")
        path = parts[index + 1].decode("utf-8", errors="surrogateescape")
        if status not in {"A", "M", "D", "T", "U"} or not path:
            raise ValueError("Status ou caminho invalido no diff")
        changes.append(Change(status, path))
    return changes


def evaluate(changes: list[Change], base_file_count: int) -> list[str]:
    """Politica conservadora: bloqueia exclusoes em massa e guarda da seguranca."""
    if base_file_count <= 0:
        return ["Nao foi possivel verificar os arquivos rastreados na base."]
    deleted = [c.path for c in changes if c.status == "D"]
    reasons = []
    for change in changes:
        if change.path in GUARD_FILES and change.status != "A":
            reasons.append(
                f"Arquivo da trava alterado: {change.path!r} (alteracao excepcional)."
            )
    for path in deleted:
        if path in PROTECTED_DELETIONS or path.startswith(PROTECTED_PREFIXES):
            reasons.append(f"Remocao de arquivo protegido: {path!r}.")
    if len(deleted) >= MAX_FILES_DELETED:
        reasons.append(
            f"Exclusao de {len(deleted)} arquivos (limite: {MAX_FILES_DELETED})."
        )
    if (
        len(deleted) >= MIN_FOR_PERCENT
        and len(deleted) * PERCENT_LIMIT_DENOMINATOR
        >= base_file_count * PERCENT_LIMIT_NUMERATOR
    ):
        reasons.append(
            f"Exclusao de {len(deleted)} de {base_file_count} arquivos "
            "(10% ou mais da base)."
        )
    return reasons


def git_bytes(*args: str) -> bytes:
    return subprocess.run(
        ["git", *args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    ).stdout


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="SHA de merge-base confiavel")
    parser.add_argument("--head", required=True, help="SHA exato do topo da PR")
    args = parser.parse_args()
    for sha in (args.base, args.head):
        if re.fullmatch(r"[0-9a-f]{40}", sha) is None:
            print("ERRO: o comparativo exige SHAs Git completos.", file=sys.stderr)
            return 2
    try:
        baseline = git_bytes("ls-tree", "-r", "--name-only", "-z", args.base)
        base_count = len([p for p in baseline.split(b"\0") if p])
        diff = git_bytes(
            "diff", "--name-status", "--no-renames", "-z",
            args.base, args.head, "--",
        )
        changes = parse_name_status(diff)
        reasons = evaluate(changes, base_count)
    except (OSError, subprocess.CalledProcessError, UnicodeError, ValueError) as exc:
        print(f"ERRO: verificacao de seguranca inconclusiva: {exc}", file=sys.stderr)
        return 2

    if reasons:
        print("BLOQUEADO: a PR exige uma revisao excepcional, sem bypass automatico.")
        for reason in reasons:
            print(f" - {reason}")
        return 1
    deleted_count = sum(c.status == "D" for c in changes)
    print(
        f"APROVADO: {deleted_count} exclusoes de {base_count} arquivos rastreados; "
        "nenhuma trava/area protegida removida."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# TESTE TEMPORARIO: esta mudanca na propria trava deve ser BLOQUEADA pelo CI.
