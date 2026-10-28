#!/usr/bin/env python3
"""Detect high-confidence leaked credentials in tracked Git files/history.

Safe for public GitHub Actions logs: never prints matched secret values.
No external packages or credentials required. Heuristic, not a complete audit.
"""
from __future__ import annotations

import argparse
import io
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
MAX_BLOB = 1_000_000
MAX_HISTORICAL_BLOBS = 25_000

PATTERNS = {
    # Um cabeçalho isolado é normal em código que processa PEM; exigimos
    # pelo menos duas linhas reais de conteúdo base64 para sinalizar vazamento.
    "private-key-pem": re.compile(
        rb"-----BEGIN[ \\t]+(?:RSA[ \\t]+|EC[ \\t]+|OPENSSH[ \\t]+)?PRIVATE[ \\t]+KEY-----"
        rb"\\r?\\n(?:[A-Za-z0-9+/=]{40,88}\\r?\\n){2,}"
    ),
    "github-token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b"),
    "aws-access-key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "slack-token": re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    "stripe-live-secret": re.compile(rb"\b(?:sk|rk)_live_[A-Za-z0-9]{18,}\b"),
    "google-service-account-json": re.compile(
        rb'"type"\s*:\s*"service_account"[\s\S]{0,120000}"private_key"\s*:\s*"'
        rb'|"private_key"\s*:\s*"[\s\S]{0,120000}"type"\s*:\s*"service_account"'
    ),
}

# Filename checks are intentionally case-insensitive.
SENSITIVE_NAME = re.compile(
    r"(?:^|/)(?:\.env(?:\.[^/]*)?|credentials\.json|secrets\.json"
    r"|(?:[^/]*service[-_]account[^/]*|[^/]*adminsdk[^/]*|"
    r"[^/]*private[-_]key[^/]*)\.json"
    r"|[^/]*\.(?:jks|keystore|p12|pfx|pem|p8|key))$", re.I
)
SAFE_TEMPLATE = re.compile(r"(?:^|/)\.env\.(?:example|sample)$", re.I)

def git(*args: str, input_data: bytes | None = None) -> bytes:
    return subprocess.run(
        ["git", *args], cwd=ROOT, input=input_data,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
        timeout=120,
    ).stdout

def find_risks(data: bytes) -> list[str]:
    return [name for name, pattern in PATTERNS.items() if pattern.search(data)]

def blocked_filename(name: str) -> bool:
    return bool(SENSITIVE_NAME.search(name)) and not bool(SAFE_TEMPLATE.search(name))

def scan_current() -> tuple[int, int]:
    files = [x.decode("utf-8", "replace") for x in git("ls-files", "-z").split(b"\0") if x]
    violations = 0
    for file in files:
        if blocked_filename(file):
            print(f"SECURITY: forbidden tracked filename: {file}")
            violations += 1
        target = ROOT / file
        if not target.is_file():
            continue
        if target.stat().st_size > MAX_BLOB:
            continue
        for kind in find_risks(target.read_bytes()):
            print(f"SECURITY: {kind} detected in tracked file: {file}")
            violations += 1
    return len(files), violations

def scan_history() -> tuple[int, int]:
    raw = git("rev-list", "--objects", "--all")
    objects: list[tuple[str, str]] = []
    seen = set()
    for line in raw.splitlines():
        parts = line.decode("utf-8", "replace").split(" ", 1)
        oid = parts[0]
        if oid in seen or not re.fullmatch(r"[a-f0-9]{40,64}", oid):
            continue
        seen.add(oid)
        objects.append((oid, parts[1] if len(parts) == 2 else ""))
    if len(objects) > MAX_HISTORICAL_BLOBS:
        raise RuntimeError("history too large to scan completely; use dedicated historical scanner")
    violations = 0
    blobs = 0
    for offset in range(0, len(objects), 40):
        chunk = objects[offset:offset+40]
        raw_batch = git("cat-file", "--batch",
                        input_data=("".join(oid + "\n" for oid, _ in chunk)).encode())
        stream = io.BytesIO(raw_batch)
        for oid, path in chunk:
            hdr = stream.readline().strip().split(b" ")
            if len(hdr) != 3 or hdr[0].decode() != oid:
                raise RuntimeError("unrecognized git batch response")
            kind, size = hdr[1], int(hdr[2])
            payload = stream.read(size)
            if len(payload) != size or stream.read(1) != b"\n":
                raise RuntimeError("incomplete git batch data")
            if kind != b"blob":
                continue
            blobs += 1
            if path and blocked_filename(path):
                print(f"SECURITY: sensitive filename in reachable history: {path} (object {oid[:12]})")
                violations += 1
            if size > MAX_BLOB:
                continue
            for label in find_risks(payload):
                print(f"SECURITY: {label} in Git history (object {oid[:12]}; file {path or '[unknown]'})")
                violations += 1
    return blobs, violations

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--history", action="store_true", help="also scan all reachable Git objects")
    args = parser.parse_args()
    try:
        tracked, bad = scan_current()
        print(f"Security current-tree scan: {tracked} tracked files checked.")
        if args.history:
            blobs, history_bad = scan_history()
            bad += history_bad
            print(f"Security history scan: {blobs} Git blobs checked.")
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired,
            OSError, RuntimeError, ValueError) as err:
        # Never echo stderr: third-party errors can contain secrets.
        print(f"SECURITY: scan could not finish safely ({type(err).__name__}).")
        return 2
    if bad:
        print(f"SECURITY: {bad} possible sensitive findings. Review privately; rotate real exposures.")
        return 1
    print("Security scan passed. Pattern matching does not guarantee absence of secrets.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
