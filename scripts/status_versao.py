#!/usr/bin/env python3
"""Fonte única de versão do Átrio: Gradle da main, não memória nem README.

Uso no Termux: python3 scripts/status_versao.py
Uso em CI:    python3 scripts/status_versao.py --local
              python3 scripts/status_versao.py --validate-base
"""
import argparse
import base64
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
GRADLE = "app/build.gradle.kts"
ROOT = Path(__file__).resolve().parents[1]


def parse_gradle(text):
    codes = re.findall(r'^\s*versionCode\s*=\s*(\d+)\s*$', text, re.MULTILINE)
    names = re.findall(r'^\s*versionName\s*=\s*"([^"]+)"\s*$', text, re.MULTILINE)
    if len(codes) != 1 or len(names) != 1:
        raise ValueError("Gradle deve conter um único versionCode e versionName")
    code, name = int(codes[0]), names[0]
    if code < 1 or not re.fullmatch(r'\d+\.\d+\.\d+', name):
        raise ValueError("Número de versão inválido")
    return code, name


def compare_versions(current, previous):
    code, name = current
    base_code, base_name = previous
    parts = tuple(map(int, name.split(".")))
    base_parts = tuple(map(int, base_name.split(".")))
    if code < base_code or parts < base_parts:
        raise ValueError("Regressão: a versão proposta é anterior à main")
    if (code == base_code) != (name == base_name):
        raise ValueError("versionCode e versionName devem mudar juntos")
    return True


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = result.stderr.strip()[:400]
        raise RuntimeError(f"Comando indisponível: {args[0]}. {detail}")
    return result.stdout


def api(path):
    """GitHub CLI autenticado é necessário porque o repositório é privado."""
    return json.loads(run(["gh", "api", "--method", "GET", f"repos/{REPO}/{path}"]))


def remote_gradle():
    content = api(f"contents/{GRADLE}?ref=main")
    encoded = content.get("content")
    if content.get("encoding") != "base64" or not encoded:
        raise RuntimeError("GitHub não forneceu conteúdo verificável da main")
    return base64.b64decode(encoded).decode("utf-8")


def status_remoto():
    branch = api("branches/main")
    sha = branch["commit"]["sha"]
    code, name = parse_gradle(remote_gradle())
    runs = api("actions/runs?branch=main&per_page=10").get("workflow_runs", [])
    builds = [r for r in runs if r.get("head_sha") == sha
              and r.get("name") == "Gerar APK do Atrio Catolico"]
    build = builds[0] if builds else None
    pulls = api("pulls?state=open&per_page=40")
    return {
        "fonte": "GitHub main, consultado agora",
        "versionName": name,
        "versionCode": code,
        "commit": sha,
        "build": {
            "status": build.get("status"),
            "conclusao": build.get("conclusion"),
            "url": build.get("html_url"),
        } if build else None,
        "propostas": [{
            "numero": item["number"], "titulo": item["title"],
            "ramo": item["head"]["ref"], "rascunho": item["draft"],
        } for item in pulls],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--local", action="store_true",
                       help="Mostra a versão nesta cópia (não necessariamente a atual)")
    group.add_argument("--validate-base", action="store_true",
                       help="CI: impede regressão perante origin/main")
    args = parser.parse_args()

    try:
        current = parse_gradle((ROOT / GRADLE).read_text(encoding="utf-8"))
        if args.validate_base:
            previous = parse_gradle(run(["git", "show", f"origin/main:{GRADLE}"]))
            compare_versions(current, previous)
            print(f"OK: {current[1]} (code {current[0]}) sem regressão ante "
                  f"{previous[1]} (code {previous[0]})")
        elif args.local:
            print(f"CÓPIA LOCAL: {current[1]} (versionCode {current[0]}).")
            print("Esta pode ser antiga. Para a versão oficial, rode sem --local.")
        else:
            data = status_remoto()
            print(f"VERSÃO PRINCIPAL (main): {data['versionName']} "
                  f"(versionCode {data['versionCode']})")
            print(f"Commit conferido: {data['commit']}")
            build = data['build']
            if build:
                print(f"Última compilação deste commit: "
                      f"{build['conclusao'] or build['status']}")
                print(f"Build: {build['url']}")
            else:
                print("Compilação deste commit: NÃO CONFIRMADA")
            print("PROPOSTAS ABERTAS (não são a versão integrada):")
            for pr in data["propostas"]:
                print(f"  #{pr['numero']}: {pr['titulo']} "
                      f"({'rascunho' if pr['rascunho'] else 'em revisão'})")
            if not data["propostas"]:
                print("  Nenhuma.")
            print("Versão instalada no celular: verifique no próprio aplicativo.")
    except (RuntimeError, ValueError, KeyError, OSError, UnicodeError) as exc:
        print(f"ERRO: não foi possível confirmar a versão. {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
