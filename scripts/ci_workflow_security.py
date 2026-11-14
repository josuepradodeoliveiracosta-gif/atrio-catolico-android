#!/usr/bin/env python3
"""Fail-closed guard for dangerous GitHub Actions events and broad permissions.

Uses only the Python standard library. This is a targeted policy check, not a
general YAML interpreter or a replacement for CodeQL and review.
"""
from __future__ import annotations

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
PROTECTOR = "proteger-repositorio.yml"

TARGET_KEY = re.compile(
    r"""^\s*(?:pull_request_target|'pull_request_target'|"pull_request_target")\s*:"""
)
INLINE_TARGET = re.compile(
    r"""^\s*(?:on|'on'|"on")\s*:\s*[\[{].*\bpull_request_target\b"""
)
WRITE_ALL = re.compile(
    r"""^\s*(?:permissions|'permissions'|"permissions")\s*:\s*"""
    r"""(?:write-all|'write-all'|"write-all")\s*(?:#.*)?$"""
)
EXCESSIVE_PROTECTOR_PERMISSION = re.compile(
    r"^\s+(?:contents|actions|checks|issues|pull-requests|workflows|"
    r"security-events|id-token|deployments|packages|statuses)\s*:\s*write(?:\s*#.*)?$",
    re.MULTILINE,
)
HEAD_CHECKOUT = re.compile(
    r"^\s*ref:\s*.*(?:github\.event\.pull_request\.head|github\.head_ref)",
    re.MULTILINE,
)

TRUSTED_REF = "ref: " + chr(36) + "{{ github.event.pull_request.base.sha }}"


def protected_workflow_issues(source: str) -> list[str]:
    """Guard the exact exception; never turn the allowlist into a free pass."""
    required_lines = (
        "on:",
        "  pull_request_target:",
        "    branches: [main]",
        "permissions:",
        "  contents: read",
        "persist-credentials: false",
        TRUSTED_REF,
        "git fetch --no-tags --force origin",
        "git rev-parse FETCH_HEAD",
        "git merge-base",
        "python3 scripts/guard_exclusoes.py",
    )
    errors = []
    for value in required_lines:
        if value not in source:
            errors.append("protecao contra exclusoes perdeu uma invariante confiavel")
            break

    if len(re.findall(r"(?m)^\s*uses:\s*actions/checkout@", source)) != 1:
        errors.append("protecao contra exclusoes exige um unico checkout da base")
    if EXCESSIVE_PROTECTOR_PERMISSION.search(source):
        errors.append("permissao de escrita proibida na protecao com pull_request_target")
    if HEAD_CHECKOUT.search(source):
        errors.append("checkout da branch/commit nao confiavel na protecao")
    if "secrets." in source or "id-token: write" in source:
        errors.append("credenciais ou OIDC proibidos na protecao de exclusoes")
    if re.search(
        r"(?m)^\s*git\s+(?:checkout|switch)\b.*(?:FETCH_HEAD|PR_HEAD_SHA)",
        source,
    ):
        errors.append("execucao de codigo da PR proibida no job privilegiado")
    return errors


def audit_workflows(directory: Path) -> list[str]:
    """Return violations; never print the possibly sensitive matched lines."""
    if not directory.is_dir():
        return ["diretorio de workflows ausente ou inacessivel"]

    files = sorted(
        p for p in directory.iterdir()
        if p.is_file() and p.suffix.lower() in {".yml", ".yaml"}
    )
    if not files:
        return ["nenhum workflow YAML encontrado"]

    errors: list[str] = []
    protected_source: str | None = None
    allowed_target_count = 0

    for file in files:
        try:
            source = file.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            errors.append(f"{file.name}: nao foi possivel ler YAML como UTF-8")
            continue

        if file.name == PROTECTOR:
            protected_source = source

        for line_no, line in enumerate(source.splitlines(), 1):
            if WRITE_ALL.match(line):
                errors.append(f"{file.name}:{line_no}: permissions write-all proibido")
            if TARGET_KEY.match(line):
                if file.name != PROTECTOR:
                    errors.append(f"{file.name}:{line_no}: pull_request_target nao autorizado")
                else:
                    allowed_target_count += 1
            if INLINE_TARGET.match(line):
                errors.append(
                    f"{file.name}:{line_no}: evento pull_request_target inline nao autorizado"
                )

    if protected_source is None:
        errors.append(f"{PROTECTOR}: workflow de protecao obrigatorio ausente")
    elif allowed_target_count != 1:
        errors.append(
            f"{PROTECTOR}: esperado exatamente um gatilho pull_request_target"
        )
    else:
        errors.extend(protected_workflow_issues(protected_source))

    return errors


def main() -> int:
    errors = audit_workflows(ROOT / ".github" / "workflows")
    for error in errors:
        print("SECURITY:", error, file=sys.stderr)
    if errors:
        print(f"SECURITY: {len(errors)} violacao(oes) da politica de workflows",
              file=sys.stderr)
        return 1
    print("OK: nenhum write-all ou pull_request_target nao autorizado; "
          "workflow protetor preservado")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
