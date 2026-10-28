#!/usr/bin/env python3
"""Scanner de segredos nos arquivos Git atuais. Não examina todo o histórico.
Nunca imprime credenciais: somente o caminho do arquivo e o tipo do achado.
"""
import argparse
from pathlib import Path
import re
import subprocess
import sys

MAX_BYTES = 2_000_000
FORBIDDEN_NAMES = {".env", ".dev.vars", "serviceaccountkey.json",
 "firebase-service-account.json", "google-application-credentials.json",
 "keystore.properties", "key.properties"}
FORBIDDEN_SUFFIXES = (".jks", ".keystore", ".p12", ".pfx", ".p8", ".pem", ".mobileprovision", ".tfstate")
SENSITIVE_JSON = re.compile(r"(?i)(?:service.?account|firebase.?adminsdk|credentials|private.?key).*\.json$")
DETECTORS = [
 ("PRIVATE_KEY_BLOCK", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----")),
 ("GOOGLE_ADMIN_PRIVATE_KEY", re.compile(r'"private_key"\s*:\s*"-----BEGIN')),
 ("GOOGLE_ADMIN_PRIVATE_KEY_ID", re.compile(r'"private_key_id"\s*:\s*"[a-f0-9]{28,}"')),
 ("GITHUB_ACCESS_TOKEN", re.compile(r"(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}")),
 ("AWS_ACCESS_KEY", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
 ("STRIPE_SECRET", re.compile(r"sk_live_[A-Za-z0-9]{20,}")),
 ("OPENAI_SECRET", re.compile(r"sk-(?:proj-)?[A-Za-z0-9_-]{32,}")),
 ("SLACK_TOKEN", re.compile(r"xox[baprs]-[0-9A-Za-z-]{20,}")),
 ("DISCORD_WEBHOOK", re.compile(r"https://(?:discord\.com|discordapp\.com)/api/webhooks/\d+/[A-Za-z0-9_-]{20,}")),
]
PUBLIC_FIREBASE_CLIENT = "app/google-services.json"


def forbidden_path(name: str) -> bool:
    posix = name.replace("\\", "/")
    base = posix.rsplit("/", 1)[-1]
    lower = base.lower()
    parts = posix.lower().split("/")
    if lower in FORBIDDEN_NAMES or lower.startswith(".env.") or lower.startswith(".dev.vars."):
        return lower not in (".env.example", ".env.sample", ".dev.vars.example")
    if any(p in (".git", ".wrangler", "secrets", "private") for p in parts[:-1]):
        return True
    if lower.endswith(FORBIDDEN_SUFFIXES) or lower.endswith((".tfvars", ".tfstate.backup")):
        return True
    if name != PUBLIC_FIREBASE_CLIENT and SENSITIVE_JSON.search(base):
        return True
    return False


def inspect_text(content: str) -> list[str]:
    return [label for label, pattern in DETECTORS if pattern.search(content)]


def audit(repo_root: Path) -> list[tuple[str, str]]:
    output = subprocess.run(["git", "-C", str(repo_root), "ls-files", "-z"],
                            check=True, capture_output=True)
    issues = []
    for entry in output.stdout.split(b"\0"):
        if not entry:
            continue
        filename = entry.decode("utf-8", "surrogateescape")
        path = repo_root / filename
        if forbidden_path(filename):
            issues.append((filename, "FORBIDDEN_TRACKED_PATH"))
        if not path.is_file() or path.stat().st_size > MAX_BYTES:
            continue
        payload = path.read_bytes()
        if b"\0" in payload[:4096]:
            continue
        for kind in inspect_text(payload.decode("utf-8", errors="replace")):
            issues.append((filename, kind))
    return issues


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    try:
        issues = audit(args.root.resolve())
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"ERRO: auditoria indisponível ({type(exc).__name__})")
        return 2
    if issues:
        for filename, kind in issues:
            print(f"ALERTA: {filename}: {kind}")
        print(f"Falhou: {len(issues)} ocorrência(s). Investigar e rotacionar credenciais.")
        return 1
    print("OK: nenhum padrão de alto sinal nos arquivos rastreados do Git.")
    print("Histórico, dependências e outros vazamentos requerem verificações adicionais.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
