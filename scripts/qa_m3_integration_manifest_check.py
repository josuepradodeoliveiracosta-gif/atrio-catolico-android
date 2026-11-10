#!/usr/bin/env python3
"""Ensaiar somatório aditivo de PRs QA sem qualquer deploy, merge ou rede."""
import json
from pathlib import Path
import re
import subprocess

MANIFEST = Path("docs/qa-homologacao/QA-M3-INTEGRACAO-MANIFESTO.json")
ALLOWED = re.compile(r"^(?:\.github/workflows/|docs/qa-homologacao/|scripts/|tests/security/)")
HEX = re.compile(r"[0-9a-f]{40}\Z")
PR_NUMS = set(range(218, 227))
BLOCK = {
    "firestore.rules", "firebase.json", "app/build.gradle.kts",
    "cloudflare/push-worker/src/index.js"
}

def validate_manifest(data, tree):
    issues = []
    if not isinstance(data, dict):
        return ["MANIFEST_INVALID"]
    if (data.get("version") != 1 or data.get("status") != "NO_GO"
        or data.get("sourceParentPr") != 193
        or data.get("sourceParentSha") != "530395026d0dc37ac424b788c3f5a22f79bb8fed"
        or data.get("expectedFiles") != 35
        or data.get("requiredApproval") != "human-policy-and-separate-QA-deploy"):
        issues.append("MANIFEST_SCOPE_OR_APPROVAL_MISMATCH")
    seen = set()
    source_prs = set()
    sources = data.get("sources")
    if not isinstance(sources, list):
        return issues + ["SOURCES_NOT_LIST"]
    for record in sources:
        if not isinstance(record, dict):
            issues.append("SOURCE_INVALID")
            continue
        pr = record.get("pr")
        files = record.get("files")
        if not isinstance(pr, int) or isinstance(pr, bool):
            issues.append("PR_ID_INVALID")
        else:
            source_prs.add(pr)
        if not isinstance(files, list) or not files:
            issues.append("FILES_MISSING")
            continue
        for f in files:
            if not isinstance(f, dict):
                issues.append("FILE_ENTRY_INVALID")
                continue
            path, sha = f.get("path"), f.get("sha")
            if (not isinstance(path, str)
                or not ALLOWED.match(path) or path in BLOCK
                or ".." in path.split("/")
                or not isinstance(sha, str) or not HEX.fullmatch(sha)):
                issues.append("FILE_SCOPE_INVALID")
                continue
            if path in seen:
                issues.append("DUPLICATE_FILE")
            seen.add(path)
            if tree.get(path) != sha:
                issues.append("BLOB_MISMATCH:" + path)
    if source_prs != PR_NUMS:
        issues.append("PR_SET_INVALID")
    if len(seen) != 35:
        issues.append("FILE_COUNT_INVALID")
    return sorted(set(issues))

def tracked_tree():
    raw = subprocess.check_output(
        ["git", "ls-tree", "-r", "--full-tree", "HEAD"],
        text=True, timeout=15
    )
    output = {}
    for line in raw.splitlines():
        info, path = line.split("\t", 1)
        mode, typ, sha = info.split()
        if typ == "blob":
            output[path] = sha
    return output

if __name__ == "__main__":
    registry = json.loads(MANIFEST.read_text(encoding="utf-8"))
    problems = validate_manifest(registry, tracked_tree())
    if problems:
        print("NO_GO: integração de arquivos inconsistente:", ", ".join(problems))
        raise SystemExit(1)
    print("QA M3: 35/35 blobs de 9 PRs conferidos; teste combinado NO_GO.")
