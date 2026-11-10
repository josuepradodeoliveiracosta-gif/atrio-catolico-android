#!/usr/bin/env python3
"""Diferencial de advisories npm, sem mutacao nem acesso direto ao registry."""
import argparse
import json
from pathlib import Path
import sys

SEVERE = {"high", "critical"}


def signatures(data):
    if not isinstance(data, dict) or data.get("auditReportVersion") != 2:
        raise ValueError("npm audit JSON v2 ausente; impossivel auditar")
    vulns = data.get("vulnerabilities")
    if not isinstance(vulns, dict) or "error" in data:
        raise ValueError("npm audit falhou; nenhuma aprovacao possivel")
    keys = set()
    for package, meta in vulns.items():
        if not isinstance(meta, dict):
            raise ValueError("Vulnerabilidade npm malformada")
        if meta.get("severity") not in SEVERE:
            continue
        vias = meta.get("via") or []
        if not isinstance(vias, list):
            raise ValueError("Cadeia de advisories invalida")
        if not vias:
            keys.add((package, "severity:" + meta["severity"]))
        for via in vias:
            if isinstance(via, str):
                identity = "indirect:" + via
            elif isinstance(via, dict):
                identity = str(via.get("source") or via.get("url")
                               or via.get("name") or "unknown")
            else:
                raise ValueError("Advisory invalido")
            keys.add((package, identity))
    return keys


def compare(base, head):
    before = signatures(base)
    after = signatures(head)
    new = sorted(after - before)
    payload = {
        "source": "npm audit JSON v2; local package-lock comparison",
        "previous_high_or_critical_signatures": len(before),
        "current_high_or_critical_signatures": len(after),
        "new_high_or_critical": [dict(package=p, advisory=a) for p, a in new],
        "no_new_severe_vulnerabilities": not new,
        "note": "Existing vulnerabilities remain visible but are not newly introduced.",
    }
    markdown = [
        "## Auditoria npm diferencial (main versus PR)",
        "",
        f"- Assinaturas altas/críticas na base: **{len(before)}**",
        f"- Assinaturas altas/críticas na PR: **{len(after)}**",
        f"- Introduzidas pela PR: **{len(new)}**",
        "",
    ]
    if new:
        markdown.append("**Ação necessária:** a PR introduziu riscos novos:")
        for package, advisory in new[:40]:
            label = (package + " / " + advisory).replace("|", r"\|")
            markdown.append("- " + label)
    else:
        markdown.append("Nenhuma vulnerabilidade alta/crítica nova detectada nesta comparação.")
    markdown += [
        "",
        "Isto não elimina vulnerabilidades preexistentes e não substitui "
        "Dependency Graph, Dependabot, CodeQL ou os testes de compatibilidade.",
        "Apenas manifests do repositório público enviados ao registry npm.",
        "",
    ]
    return payload, "\n".join(markdown)


def main():
    p = argparse.ArgumentParser()
    for name in ("base", "head", "json", "markdown"):
        p.add_argument("--" + name, required=True)
    args = p.parse_args()
    base = json.loads(Path(args.base).read_text(encoding="utf-8"))
    head = json.loads(Path(args.head).read_text(encoding="utf-8"))
    result, summary = compare(base, head)
    Path(args.json).write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    Path(args.markdown).write_text(summary, encoding="utf-8")
    print("Novas vulnerabilidades altas/criticas:", len(result["new_high_or_critical"]))
    if result["new_high_or_critical"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
