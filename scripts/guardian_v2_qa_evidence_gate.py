#!/usr/bin/env python3
"""Fail-closed OFFLINE assessor of externally collected Guardian V2 QA evidence.

This program NEVER authenticates a token, sends a request, validates IAM, or
authorizes production. Its input is an operator-supplied, sanitized summary;
even a complete summary requires independent human review of original proofs.
No credentials, payloads, user data or document paths belong in this report.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

# actor, expected authenticated outcome, whether a verified write must exist.
# Both identities must be tested separately: a 401/network error is not a
# demonstration that a valid authenticated principal was forbidden by IAM.
SCENARIOS = {
    "triage_read_policy": ("TRIAGE", "ALLOW", False),
    "triage_create_case_audit_notice": ("TRIAGE", "ALLOW", True),
    "triage_update_budget": ("TRIAGE", "ALLOW", True),
    "triage_direct_policy_patch": ("TRIAGE", "DENY", False),
    "triage_edit_profiles": ("TRIAGE", "DENY", False),
    "triage_edit_posts": ("TRIAGE", "DENY", False),
    "triage_outside_allowlist": ("TRIAGE", "DENY", False),
    "activation_enable_two_flags": ("ACTIVATION", "ALLOW", True),
    "activation_create_case": ("ACTIVATION", "DENY", False),
    "activation_write_audit": ("ACTIVATION", "DENY", False),
    "activation_send_notice": ("ACTIVATION", "DENY", False),
    "activation_update_budget": ("ACTIVATION", "DENY", False),
    "triage_delete": ("TRIAGE", "DENY", False),
    "activation_delete": ("ACTIVATION", "DENY", False),
    "triage_impersonate_activation": ("TRIAGE", "DENY", False),
    "activation_impersonate_triage": ("ACTIVATION", "DENY", False),
}
PROJECT = re.compile(r"^[a-z][a-z0-9-]{5,29}$")
PROOF = re.compile(r"^QA-[A-Za-z0-9_-]{4,48}$")
TOP_FIELDS = {"qa_project", "qa_isolated_confirmed", "qa_iam_reviewed",
              "qa_costs_authorized", "evidence_origin", "cases"}
CASE_FIELDS = {"scenario", "principal", "authenticated", "http_status",
               "pre_post_checked", "effects_present", "evidence_ref"}
FORBIDDEN_PROJECTS = {"atrio-catolico", "guardian-v2-qa-fixture"}


def assess(report: object) -> dict:
    """Return only a safe aggregate; never echo untrusted evidence contents."""
    result = {"decision": "NO_GO", "conformes": 0, "exigidos": len(SCENARIOS)}
    if type(report) is not dict or set(report) != TOP_FIELDS:
        return result
    project = report["qa_project"]
    if (type(project) is not str or not PROJECT.fullmatch(project)
            or project in FORBIDDEN_PROJECTS
            or report["qa_isolated_confirmed"] is not True
            or report["qa_iam_reviewed"] is not True
            or report["qa_costs_authorized"] is not True
            or report["evidence_origin"] != "authenticated_external_qa"):
        return result
    cases = report["cases"]
    if type(cases) is not list or len(cases) != len(SCENARIOS):
        return result
    seen = set()
    proofs = set()
    for row in cases:
        if type(row) is not dict or set(row) != CASE_FIELDS:
            return result
        scenario = row["scenario"]
        if type(scenario) is not str or scenario not in SCENARIOS or scenario in seen:
            return result
        seen.add(scenario)
        actor, expected, writes = SCENARIOS[scenario]
        reference = row["evidence_ref"]
        if (row["principal"] != actor
                or row["authenticated"] is not True
                or row["pre_post_checked"] is not True
                or type(row["http_status"]) is not int
                or type(row["effects_present"]) is not bool
                or type(reference) is not str
                or not PROOF.fullmatch(reference) or reference in proofs):
            return result
        proofs.add(reference)
        status = row["http_status"]
        if expected == "DENY":
            # An invalid token (401), timeout, or connection error is
            # inconclusive; denial must be external and side-effect free.
            if status != 403 or row["effects_present"] is not False:
                return result
        elif not (200 <= status <= 299 and row["effects_present"] is writes):
            return result
        result["conformes"] += 1
    # A complete operator report is not a cryptographic IAM verification.
    # This status must NEVER be interpreted as permission to deploy.
    result["decision"] = "CANDIDATO_REVISAO_HUMANA"
    return result


def main(argv=None) -> int:
    args = sys.argv[1:] if argv is None else argv
    record = None
    if len(args) == 1:
        try:
            path = Path(args[0])
            if path.is_file() and path.stat().st_size <= 131072:
                record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeError, RecursionError):
            pass
    summary = assess(record)
    print("decisao:", summary["decision"])
    print("cenarios_conformes:", summary["conformes"], "/", summary["exigidos"])
    print("LIMITACAO: resumo nao verifica autenticacao/IAM real; nao autoriza producao.")
    return 0 if summary["decision"] == "CANDIDATO_REVISAO_HUMANA" else 2


if __name__ == "__main__":
    sys.exit(main())
