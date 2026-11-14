#!/usr/bin/env python3
"""Offline NO-GO preflight for splitting Guardian V2 writer and policy activation.

No external calls, secrets, IAM changes, workflow dispatch or deployment.
The result is intentionally NEVER a production authorization.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/guardiao-v2-moderator-runner.yml"

# Read only the two privileged jobs. This is a deliberately narrow
# contract parser, not a full YAML parser or an IAM effective-access check.
JOB = re.compile(r"(?m)^  ([a-z][a-z0-9-]*):[ \t]*$")
EXPECTED = ("moderator", "activate-policy")
FIELDS = {
    "conta_servico": re.compile(r"(?m)^          service_account: ([^\s#]+)\s*(?:#.*)?$"),
    "provedor_wif": re.compile(r"(?m)^          workload_identity_provider: ([^\s#]+)\s*(?:#.*)?$"),
    "ambiente": re.compile(r"(?m)^    environment: ([^\s#]+)\s*(?:#.*)?$"),
}
RESULT_NAMES = ("conta_servico", "provedor_wif", "ambiente")


def job_fields(source):
    if not isinstance(source, str) or not source.startswith("name:"):
        return None
    headers = list(JOB.finditer(source))
    names = [m.group(1) for m in headers]
    if any(names.count(name) != 1 for name in EXPECTED):
        return None
    result = {}
    for name in EXPECTED:
        i = names.index(name)
        start = headers[i].end()
        end = headers[i + 1].start() if i + 1 < len(headers) else len(source)
        block = source[start:end]
        values = {}
        for field, pattern in FIELDS.items():
            matches = pattern.findall(block)
            if len(matches) != 1 or not matches[0]:
                return None
            values[field] = matches[0]
        # A job without exact branch and event restrictions is not evidence
        # of the required division, even when the names are different.
        gate = re.search(r"(?m)^    if: (.+)$", block)
        if not gate or "github.ref == 'refs/heads/main'" not in gate.group(1):
            return None
        if name == "activate-policy":
            if ("github.event_name == 'workflow_dispatch'" not in gate.group(1) or
                    "inputs.confirm_policy_activation == true" not in gate.group(1)):
                return None
        else:
            if "github.event_name == 'schedule'" not in gate.group(1):
                return None
        result[name] = values
    return result


def assess(source):
    """Return only safe enumerated statuses, not credentials or raw YAML."""
    jobs = job_fields(source)
    if jobs is None:
        return {**{name: "INCONCLUSIVO" for name in RESULT_NAMES},
                "firestore_iam": "NAO_ATestado",
                "decisao": "NO_GO"}
    status = {}
    for name in RESULT_NAMES:
        status[name] = ("COMPARTILHADO" if
                        jobs["moderator"][name] == jobs["activate-policy"][name]
                        else "DISTINTO_NO_CODIGO")
    # Even fully separated workflow strings do not prove that identities lack
    # inherited roles, impersonation rights, Firestore document permissions,
    # or overlapping provider conditions in deployed Google Cloud IAM.
    status["firestore_iam"] = "NAO_ATestado"
    status["decisao"] = "NO_GO" if "COMPARTILHADO" in status.values() else "EXIGE_PROVA_QA_IAM"
    return status


def main():
    try:
        source = WORKFLOW.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        source = ""
    result = assess(source)
    for name in (*RESULT_NAMES, "firestore_iam", "decisao"):
        print(f"{name}: {result[name]}")
    print("LIMITACAO: analise offline; jamais autoriza IAM, Firebase, deploy ou merge.")
    return 2 if result["decisao"] in ("NO_GO", "EXIGE_PROVA_QA_IAM") else 3


if __name__ == "__main__":
    sys.exit(main())
