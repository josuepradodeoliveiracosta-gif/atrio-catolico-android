#!/usr/bin/env python3
"""Inventario NO-GO do QA: apenas arquivos locais e um GET opcional da issue 200."""
import argparse
from hashlib import sha1, sha256
import json
import os
from pathlib import Path
import re
from urllib.request import Request, urlopen

REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
ISSUE = "https://api.github.com/repos/" + REPO + "/issues/200"
PIN = "526b8a1e7ff09aca79a4a539ee1681a6c0a76f77"
QA = "atrio-catolico-qa-geral"
GATES = (
    "function qaChatAge18Eligible(uid)",
    "proof.get('minimumAge',0) == 18",
    "proof.get('policyVersion','') == '2026-11-18plus-qa-v1'",
    "match /users/{uid}/chatAgeEligibility/current",
    "match /{path=**}/atrioGroupInvites/{inviteId}",
    "match /chats/{chatId}",
    "match /chat_groups/{groupId}",
)
TAIL = "\n".join(("    match /{document=**} {",
                   "      allow read, write: if false;",
                   "    }", "  }", "}", ""))
OPEN = re.compile(r"allow\s+[^:;\n]{1,60}:\s*if\s+true\s*;", re.I)


def blob_hash(text):
    b = text.encode("utf-8")
    return sha1(b"blob " + str(len(b)).encode() + b"\0" + b).hexdigest()


def issue_state(token, opener=urlopen):
    if not token:
        return "unknown"
    req = Request(ISSUE, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with opener(req, timeout=15) as res:
            raw = res.read(100001)
        if len(raw) > 100000:
            return "unknown"
        data = json.loads(raw)
        if (data.get("number") != 200
                or data.get("repository_url") !=
                "https://api.github.com/repos/" + REPO
                or data.get("state") not in ("open", "closed")
                or "pull_request" in data):
            return "unknown"
        return data["state"]
    except (OSError, ValueError, KeyError, TypeError):
        return "unknown"


def inspect(base, candidates, issue="unknown", qa_report=None, prod_report=None):
    if not isinstance(base, str) or any(not isinstance(s, str) for s in candidates.values()):
        raise ValueError("Fontes de Rules invalidas")
    base_sha = sha256(base.encode()).hexdigest()
    pinned = blob_hash(base) == PIN
    checked = {}
    prefix = base[:base.rfind("    match /{document=**} {")]
    for name, src in candidates.items():
        checks = {
            "age18_and_private_paths": all(g in src for g in GATES),
            "deny_all_at_end": src.endswith(TAIL),
            "no_literal_open_grants": OPEN.search(src) is None,
            "no_embedded_real_qa_project": QA not in src,
        }
        if name == "parity":
            checks["versioned_base_preserved"] = (
                pinned and len(prefix) > 1000 and src.startswith(prefix)
                and "BEGIN QA PARITY ADDITIVE" in src
                and "END QA PARITY ADDITIVE" in src
            )
        checked[name] = {"sha256": sha256(src.encode()).hexdigest(), "checks": checks}
    qa_evidence = bool(
        isinstance(qa_report, dict)
        and qa_report.get("project") == QA
        and qa_report.get("mode") == "READ_ONLY_TWO_GET"
        and qa_report.get("firestoreRulesCurrentlyDenyAll") is True
        and qa_report.get("safeToEnableChat") is False
        and qa_report.get("productionContacted") is False
        and qa_report.get("deployPerformed") is False
        and re.fullmatch(r"[0-9a-f]{64}", str(qa_report.get("sha256", "")))
    )
    prod_evidence = bool(
        isinstance(prod_report, dict)
        and prod_report.get("project") == "atrio-catolico"
        and prod_report.get("mode") == "READ_ONLY_NO_DEPLOY_NO_BACKUP"
        and prod_report.get("exactMatch") is True
        and prod_report.get("publishedSha256") == base_sha
        and prod_report.get("repositorySha256") == base_sha
        and prod_report.get("deploymentApproved") is False
        and prod_report.get("releaseApproved") is False
    )
    blockers = []
    if not pinned:
        blockers.append("VERSIONED_MAIN_RULES_BLOB_CHANGED")
    for name, value in checked.items():
        if not all(value["checks"].values()):
            blockers.append("CANDIDATE_" + name.upper() + "_REVIEW_REQUIRED")
    if not qa_evidence:
        blockers.append("QA_CLOUD_DENY_ALL_NOT_EVIDENCED")
    if not prod_evidence:
        blockers.append("PRODUCTION_CLOUD_PARITY_NOT_EVIDENCED")
    if issue != "closed":
        blockers.append("ISSUE_200_POLICY_STILL_OPEN_OR_UNKNOWN")
    else:
        blockers.append("ISSUE_200_CLOSED_DOES_NOT_PROVE_FORMAL_APPROVAL")
    blockers += [
        "TRUSTED_18_PLUS_VERIFIER_NOT_APPROVED",
        "MODERATION_RETENTION_LGPD_NOT_APPROVED",
        "EXPLICIT_QA_DEPLOY_AND_ROLLBACK_NOT_AUTHORIZED",
    ]
    return {
        "report": "qa_milestone3_preflight_offline",
        "environment": "QA_NO_DEPLOY",
        "status": "NO_GO",
        "deployment_authorized": False,
        "completed_milestones": 2,
        "total_milestones": 7,
        "base_sha256": base_sha,
        "base_blob_matches_pin": pinned,
        "candidates": checked,
        "imported_reports_NOT_authenticated": {
            "qa_deny_all_consistent": qa_evidence,
            "production_parity_consistent": prod_evidence,
        },
        "policy_issue_200": issue if issue in ("open", "closed") else "unknown",
        "blockers": blockers,
    }


def optional_report(path):
    if not path:
        return None
    obj = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(obj, dict):
        raise ValueError("Relatorio externo deve ser objeto")
    return obj


def markdown(report):
    lines = [
        "## Marco 3 — Preflight das Rules de QA (somente leitura)",
        "",
        "**NO-GO: nenhuma aprovacao de implantacao foi concedida.**",
        "",
        "- Base Git revisada preservada: " + str(report["base_blob_matches_pin"]),
        "- Issue #200: " + report["policy_issue_200"],
        "- Relatorios do operador nao sao autenticados por esta ferramenta.",
        "",
        "### Candidatas e testes de contrato",
    ]
    for name, item in report["candidates"].items():
        lines.append("- " + name + ": SHA-256 " + item["sha256"]
                     + "; contrato " + ("OK" if all(item["checks"].values()) else "PENDENTE"))
    lines.extend(("", "### Bloqueios", ""))
    lines.extend("- " + x for x in report["blockers"])
    lines.extend((
        "",
        "CI verde significa apenas que a auditoria foi executada.",
        "Nao aprova Rules reais, FCM, prova de idade, Cloudflare ou producao.",
        "",
    ))
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    for arg in ("base", "standalone", "parity", "json-out", "md-out"):
        parser.add_argument("--" + arg, required=True)
    parser.add_argument("--qa-report")
    parser.add_argument("--prod-report")
    parser.add_argument("--check-issue", action="store_true")
    args = parser.parse_args()
    report = inspect(
        Path(args.base).read_text(encoding="utf-8"),
        {"standalone": Path(args.standalone).read_text(encoding="utf-8"),
         "parity": Path(args.parity).read_text(encoding="utf-8")},
        issue_state(os.environ.get("GITHUB_TOKEN", "")) if args.check_issue else "unknown",
        optional_report(args.qa_report), optional_report(args.prod_report),
    )
    Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    Path(args.md_out).write_text(markdown(report), encoding="utf-8")
    print("QA marco 3:", report["status"], "issue #200:", report["policy_issue_200"])
    # Codigo zero aprova somente a GERACAO do relatorio NO-GO.


if __name__ == "__main__":
    main()
