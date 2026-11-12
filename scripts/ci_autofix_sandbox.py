#!/usr/bin/env python3
"""Stage-3 sandbox repair pilot, driven by the existing verified diagnostic plan.

The only patchable source is a pinned, synthetic SQLite QA fixture created in a
private temporary directory. This is deliberately NOT a repository file repair.
No GitHub API, token, shell, network, PR, merge, deployment or external write.
"""
import argparse
import ast
import difflib
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.ci_quality_report import REPO, validate_sha

MAX_PLAN_BYTES = 100_000
MAX_PATCH_BYTES = 4096
MAX_JOBS = 3
RECIPE = "qa_sqlite_lifecycle_review"
SIGNAL = "sqlite_closed_database"
FIXTURE_NAME = "qa_sqlite_lifecycle_fixture.py"
SECTION = "Sandbox dry-run — SQLite QA"

# These strings are authored and pinned here, never constructed from logs,
# paths, URLs, diff contents or other untrusted data.
BEFORE = (
    "def fetch_sample(connection):\n"
    "    connection.close()\n"
    "    return connection.execute(\"SELECT 1\").fetchall()\n"
)
AFTER = (
    "def fetch_sample(connection):\n"
    "    rows = connection.execute(\"SELECT 1\").fetchall()\n"
    "    connection.close()\n"
    "    return rows\n"
)
BEFORE_SHA256 = hashlib.sha256(BEFORE.encode("utf-8")).hexdigest()


def sha256(source):
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def _validate_plan(plan):
    """Refuse unproven eligibility or any metadata claiming executed writes."""
    if not isinstance(plan, dict):
        raise ValueError("plano ausente")
    sha = validate_sha(plan.get("commit_sha"))
    required = {
        "schema_version": 1,
        "repository": REPO,
        "mode": "plan_only_no_execution",
        "based_on": "ci_log_safe_analysis_verified_job_signals",
        "automation_target_percent": 99,
        "measured_automation_percent": None,
        "root_cause_established": False,
        "freshness_verified_against_current_pr_head": False,
        "required_checks_complete": True,
        "approval_required_before_any_repository_write": True,
        "production_access": False,
        "next_stage": "qa_sandbox_patch_planning_after_review",
    }
    for key, expected in required.items():
        if key not in plan or type(plan[key]) is not type(expected) or plan[key] != expected:
            raise ValueError("contrato do plano invalido")
    for key in ("automatic_repairs_executed", "automatic_reruns_executed",
                "automatic_pull_requests_created", "automatic_merges_or_deploys"):
        if type(plan.get(key)) is not int or plan[key] != 0:
            raise ValueError("plano com efeitos colaterais declarados")
    jobs = plan.get("jobs")
    if not isinstance(jobs, list) or len(jobs) > MAX_JOBS:
        raise ValueError("fila de correcoes excedida")
    if type(plan.get("candidate_count")) is not int:
        raise ValueError("contagem de candidatos invalida")
    if sum(isinstance(x, dict) and x.get("decision") ==
           "qa_proposal_candidate" for x in jobs) != plan["candidate_count"]:
        raise ValueError("candidatos divergentes")
    seen = set()
    for row in jobs:
        if not isinstance(row, dict):
            raise ValueError("job invalido")
        run_id, job_id = row.get("run_id"), row.get("job_id")
        if (type(run_id) is not int or type(job_id) is not int
                or not 0 < run_id < 10 ** 18 or not 0 < job_id < 10 ** 18
                or (run_id, job_id) in seen):
            raise ValueError("identidade de job invalida ou duplicada")
        seen.add((run_id, job_id))
        if (row.get("requires_human_approval_for_write") is not True
                or not isinstance(row.get("signal_ids"), list)
                or any(not isinstance(s, str) or len(s) > 60
                       for s in row["signal_ids"])
                or not isinstance(row.get("decision"), str)
                or not isinstance(row.get("recipe_id"), str)
                or not isinstance(row.get("reason_id"), str)):
            raise ValueError("proposta de job invalida")
    return sha, jobs


def _eligible(job):
    return (job["decision"] == "qa_proposal_candidate"
            and job["recipe_id"] == RECIPE
            and job["reason_id"] == "review_qa_only"
            and job["signal_ids"] == [SIGNAL]
            and job["requires_human_approval_for_write"] is True)


def preview(plan, fixture_source=BEFORE):
    """Actually change and verify a synthetic fixture in a disposable sandbox.

    Only the exact pinned source is accepted: no arbitrary repository patch,
    private data from a log, or bypass of a failed QA check is possible.
    """
    sha, jobs = _validate_plan(plan)
    if not isinstance(fixture_source, str):
        raise ValueError("fonte invalida")
    if sha256(fixture_source) != BEFORE_SHA256 or fixture_source != BEFORE:
        raise ValueError("fixture alterada: bloqueio por conteudo imutavel")
    result = {
        "schema_version": 1,
        "repository": REPO,
        "commit_sha": sha,
        "mode": "disposable_sandbox_only",
        "status": "blocked_not_eligible",
        "recipe_id": "none",
        "fixture": FIXTURE_NAME,
        "source_sha256": BEFORE_SHA256,
        "fixed_sha256": None,
        "patch": None,
        "syntax_verified": False,
        "repository_files_changed": 0,
        "automatic_pull_requests_created": 0,
        "automatic_merges_or_deploys": 0,
        "production_access": False,
        "current_pr_head_verified": False,
    }
    # One candidate, one verified rule, no competing incident. Any ambiguity
    # or missing gate is deliberately excluded by the upstream plan and here.
    if len(jobs) != 1 or plan["candidate_count"] != 1 or not _eligible(jobs[0]):
        return result
    ast.parse(BEFORE, filename=FIXTURE_NAME)
    ast.parse(AFTER, filename=FIXTURE_NAME)
    patch = "".join(difflib.unified_diff(
        BEFORE.splitlines(keepends=True),
        AFTER.splitlines(keepends=True),
        fromfile="a/" + FIXTURE_NAME,
        tofile="b/" + FIXTURE_NAME,
        n=3,
    ))
    if not patch or len(patch.encode("utf-8")) > MAX_PATCH_BYTES:
        raise ValueError("patch sintetico excedeu o limite")
    # No externally selected destination. The temporary directory and its
    # contents are destroyed before returning a sanitized result.
    with TemporaryDirectory(prefix="atrio-qa-autofix-") as directory:
        root = Path(directory).resolve(strict=True)
        target = root / FIXTURE_NAME
        target.write_text(fixture_source, encoding="utf-8")
        if target.is_symlink() or target.resolve(strict=True).parent != root:
            raise ValueError("destino de sandbox nao confiavel")
        if sha256(target.read_text(encoding="utf-8")) != BEFORE_SHA256:
            raise ValueError("fonte sandbox divergente")
        target.write_text(AFTER, encoding="utf-8")
        fixed = target.read_text(encoding="utf-8")
        if fixed != AFTER or sha256(fixed) != sha256(AFTER):
            raise ValueError("correcao nao verificada na sandbox")
        ast.parse(fixed, filename=FIXTURE_NAME)
    result.update({
        "status": "sandbox_patch_verified",
        "recipe_id": RECIPE,
        "fixed_sha256": sha256(AFTER),
        "patch": patch,
        "syntax_verified": True,
    })
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--json", required=True)
    args = parser.parse_args()
    src = Path(args.plan)
    if src.stat().st_size > MAX_PLAN_BYTES:
        parser.error("plano acima do limite")
    result = preview(json.loads(src.read_text(encoding="utf-8")))
    # The only diff that can be published was created from the static fixture.
    Path(args.json).write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8")
    print(SECTION, result["status"], "(repo untouched)")


if __name__ == "__main__":
    main()
