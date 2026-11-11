#!/usr/bin/env python3
"""Escolhe bundles opcionais por diff Git verificado; ambiguidades executam ambos."""
import argparse
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
MAX_PATHS = 5000
MAX_DIFF_BYTES = 512 * 1024

BOTH = (True, True)


def choose_bundles(paths):
    """Tupla (avatar, push). Um caminho desconhecido sensivel executa ambos."""
    if not isinstance(paths, (list, tuple)) or not paths or len(paths) > MAX_PATHS:
        return BOTH
    avatar = push = False
    for path in paths:
        if (not isinstance(path, str) or not path or len(path) > 1024
                or any(c in path for c in ("\0", "\n", "\r", "\t", "\\"))
                or path.startswith("/") or "//" in path or "/../" in f"/{path}/"
                or "/./" in f"/{path}/"):
            return BOTH
        if path.startswith("cloudflare/avatar-worker/"):
            avatar = True
        elif path.startswith("cloudflare/push-worker/"):
            push = True
        elif path.startswith("cloudflare/"):
            return BOTH  # Regras/infra potencialmente compartilhadas
        elif path in (".github/workflows/worker-bundle-dry-run-ci.yml",
                      "scripts/ci_worker_scope.py", "scripts/test_ci_worker_scope.py"):
            return BOTH
    return (avatar, push) if avatar or push else BOTH


def changed_paths(base, head, runner=subprocess.run):
    if not isinstance(base, str) or not SHA_RE.fullmatch(base):
        raise ValueError("base_invalida")
    if not isinstance(head, str) or not SHA_RE.fullmatch(head):
        raise ValueError("head_invalida")
    merge = runner(
        ["git", "merge-base", "--all", base, head],
        cwd=ROOT, capture_output=True, check=True, timeout=30,
    ).stdout.decode("ascii").strip().splitlines()
    if len(merge) != 1 or not SHA_RE.fullmatch(merge[0]):
        raise ValueError("merge_base_ambiguo")
    raw = runner(
        ["git", "diff", "--name-only", "--no-renames", "--no-ext-diff",
         "--no-textconv", "-z", merge[0], head, "--"],
        cwd=ROOT, capture_output=True, check=True, timeout=30,
    ).stdout
    if not raw or len(raw) > MAX_DIFF_BYTES or not raw.endswith(b"\0"):
        raise ValueError("diff_ausente_ou_excessivo")
    paths = raw[:-1].split(b"\0")
    if len(paths) > MAX_PATHS:
        raise ValueError("muitos_arquivos")
    return [p.decode("utf-8", "strict") for p in paths]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="")
    parser.add_argument("--head", default="")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        avatar, push = choose_bundles(changed_paths(args.base, args.head))
        scope = "diff_verificado"
    except (ValueError, UnicodeError, OSError, subprocess.SubprocessError):
        avatar, push = BOTH
        scope = "falha_segura"
    # Apenas duas flags conhecidas. Nao escreve nem imprime nomes de arquivos.
    with Path(args.output).open("a", encoding="utf-8") as target:
        target.write(f"avatar={str(avatar).lower()}\n")
        target.write(f"push={str(push).lower()}\n")
    print("Workers dry-run:", scope, "avatar=" + str(avatar).lower(),
          "push=" + str(push).lower())


if __name__ == "__main__":
    main()
