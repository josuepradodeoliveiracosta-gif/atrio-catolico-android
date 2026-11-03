#!/usr/bin/env python3
"""Cheap, offline validation of Play closed-track listing copy (not release approval).

Reads only the store metadata, the Gradle identity and the existing status
records. Does not sign, build, upload, fetch URLs or mark any gate approved.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
import unicodedata

PACKAGE = "br.com.atriocatolico"
LOCALE = "pt-BR"
STORE = Path("fastlane/metadata/android") / LOCALE
LIMITS = {
    "title.txt": (1, 30, False),
    "short_description.txt": (1, 80, False),
    "full_description.txt": (80, 4000, True),
}
CHANGELOG_LIMIT = 500
UNREVIEWED = re.compile(
    r"\b(?:TODO|TBD|PLACEHOLDER|SUBSTITUIR|A DEFINIR|A CONFIRMAR)\b",
    flags=re.IGNORECASE,
)
UNSUPPORTED_PROMISES = (
    "todos os dados são excluídos automaticamente",
    "100% seguro",
    "segurança garantida",
    "exclusão completa e imediata",
    "aprovado pelo google play",
)


def _read_utf8(path: Path) -> str:
    raw = path.read_bytes()
    if not raw or raw.startswith(b"\xef\xbb\xbf") or b"\r" in raw:
        raise ValueError("arquivo vazio, BOM ou fim de linha inesperado")
    value = raw.decode("utf-8", "strict")
    if not value.endswith("\n") or value.endswith("\n\n"):
        raise ValueError("precisa terminar com exatamente uma quebra de linha")
    if value != unicodedata.normalize("NFC", value):
        raise ValueError("caracteres Unicode nao normalizados")
    return value[:-1]


def _content_problem(value: str, limit: int, multiline: bool) -> str | None:
    if not 1 <= len(value) <= limit:
        return "limite de caracteres excedido ou texto vazio"
    if not multiline and "\n" in value:
        return "o campo deve conter apenas uma linha"
    if value != value.strip() or any(line != line.rstrip() for line in value.split("\n")):
        return "espacos finais ou iniciais indevidos"
    if any(unicodedata.category(char) in ("Cc", "Cf", "Cs")
           and char != "\n" for char in value):
        return "caracter de controle ou invisivel"
    if "<" in value or ">" in value:
        return "HTML nao permitido no metadado"
    if UNREVIEWED.search(value):
        return "rascunho ou placeholder no texto da loja"
    if any(phrase in value.lower() for phrase in UNSUPPORTED_PROMISES):
        return "promessa de seguranca ou exclusao nao homologada"
    return None


def audit_listing(root: Path) -> list[str]:
    """Return blockers for the metadata ONLY, never a Play-release authorization."""
    failures = []
    root = Path(root)
    gradle = root / "app/build.gradle.kts"
    try:
        text = gradle.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return ["gradle_nao_encontrado"]
    codes = re.findall(r"^\s*versionCode\s*=\s*(\d+)\s*$", text, re.M)
    packages = re.findall(r'^\s*applicationId\s*=\s*"([^"]+)"\s*$', text, re.M)
    if len(codes) != 1 or len(packages) != 1 or packages[0] != PACKAGE:
        failures.append("pacote_ou_versao_ambigua")
    code = codes[0] if len(codes) == 1 else None
    for name, (minimum, maximum, multiline) in LIMITS.items():
        path = root / STORE / name
        try:
            value = _read_utf8(path)
            problem = _content_problem(value, maximum, multiline)
            if problem or len(value) < minimum:
                failures.append(f"{name}: {problem or 'texto insuficiente'}")
        except (OSError, UnicodeError, ValueError) as exc:
            failures.append(f"{name}: {type(exc).__name__}")
    if code:
        path = root / STORE / "changelogs" / (code + ".txt")
        try:
            value = _read_utf8(path)
            problem = _content_problem(value, CHANGELOG_LIMIT, True)
            if problem:
                failures.append(f"changelog_{code}: {problem}")
        except (OSError, UnicodeError, ValueError) as exc:
            failures.append(f"changelog_{code}: {type(exc).__name__}")
    return failures


def gate_snapshot(root: Path) -> dict:
    """Progress counters are informational and do not override the release gate."""
    result = {"privacy": "nao_verificado", "ugc": "nao_verificado",
              "releaseAuthorized": False}
    for key, filename in (
        ("privacy", "docs/google-play-privacidade-evidencias.json"),
        ("ugc", "docs/google-play-ugc-evidencias.json"),
    ):
        try:
            data = json.loads((root / filename).read_text(encoding="utf-8"))
            requirements = data["requirements"]
            if not isinstance(requirements, dict) or not requirements:
                raise ValueError("empty")
            verified = sum(1 for x in requirements.values()
                           if isinstance(x, dict) and x.get("verified") is True)
            result[key] = f"{verified}/{len(requirements)}"
        except (OSError, UnicodeError, ValueError, KeyError, TypeError):
            result[key] = "nao_verificado"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    if sys.flags.optimize:
        print("FALHA: executar sem Python -O", file=sys.stderr)
        return 1
    root = args.root.resolve()
    issues = audit_listing(root)
    snapshot = gate_snapshot(root)
    print("METADADOS_PLAY:", "OK" if not issues else "PENDENTE")
    for issue in issues:
        print(" -", issue)
    print("EVIDENCIAS:", json.dumps(snapshot, ensure_ascii=False, sort_keys=True))
    print("NAO assina, nao publica, nao autoriza release e nao verifica artes.")
    return 0 if not issues else 1


if __name__ == "__main__":
    raise SystemExit(main())
