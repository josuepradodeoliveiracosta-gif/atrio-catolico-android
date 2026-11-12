#!/usr/bin/env python3
"""Stage-3 sandbox repair pilot, driven by the existing verified diagnostic plan.

Read exactly one hash-pinned, versioned QA fixture from the checkout, then
prepare a patch *only in a disposable temporary directory*. No actual
repository modifications, GitHub API, tokens, shell, deploys or external writes.
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
FIXTURE_NAME = "tests/qa/autofix/sqlite_closed_connection.py"
QA_PATH_ALLOWLIST = frozenset((FIXTURE_NAME,))
MAX_FIXTURE_BYTES = 2048
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


def read_pinned_qa_source(checkout_root, relative_path, allowlist,
                          expected_sha256, max_bytes):
    """Shared fail-closed reader for reviewed QA paths; never writes checkout."""
    if (not isinstance(relative_path, str)
            or not isinstance(allowlist, (set, frozenset, tuple))
            or relative_path not in allowlist
            or not isinstance(expected_sha256, str)
            or len(expected_sha256) != 64
            or type(max_bytes) is not int or not 0 < max_bytes <= 20_000):
        raise ValueError("arquivo QA fora da allowlist")
    if not isinstance(checkout_root, (str, Path)):
        raise ValueError("raiz de checkout invalida")
    root = Path(checkout_root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("raiz de checkout invalida")
    root = root.resolve(strict=True)
    candidate = root
    for part in Path(relative_path).parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise ValueError("symlink QA nao autorizado")
    if not candidate.is_file() or candidate.stat().st_size > max_bytes:
        raise ValueError("arquivo QA ausente ou acima do limite")
    if candidate.resolve(strict=True).relative_to(root) != Path(relative_path):
        raise ValueError("arquivo QA fora do checkout")
    source = candidate.read_text(encoding="utf-8")
    if len(source.encode("utf-8")) > max_bytes or sha256(source) != expected_sha256:
        raise ValueError("arquivo QA divergente do hash revisado")
    return source


def read_checkout_fixture(checkout_root, relative_path=FIXTURE_NAME):
    """Read the sole versioned SQLite fixture through the common QA guard."""
    source = read_pinned_qa_source(
        checkout_root, relative_path, QA_PATH_ALLOWLIST,
        BEFORE_SHA256, MAX_FIXTURE_BYTES)
    if source != BEFORE:
        raise ValueError("fixture QA divergente do conteudo revisado")
    return source


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
        "approval_required_before_any_repository_write": True,
        "production_access": False,
        "next_stage": "qa_sandbox_patch_planning_after_review",
    }
    for key, expected in required.items():
        if key not in plan or type(plan[key]) is not type(expected) or plan[key] != expected:
            raise ValueError("contrato do plano invalido")
    if type(plan.get("required_checks_complete")) is not bool:
        raise ValueError("estado de gates invalido")
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
        "checkout_fixture_verified": False,
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
    if (not plan["required_checks_complete"] or len(jobs) != 1
            or plan["candidate_count"] != 1 or not _eligible(jobs[0])):
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
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(fixture_source, encoding="utf-8")
        if (target.is_symlink()
                or target.resolve(strict=True).relative_to(root) != Path(FIXTURE_NAME)):
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


def preview_from_checkout(plan, checkout_root, relative_path=FIXTURE_NAME):
    """Create an isolated diff from a pinned, tracked QA checkout file."""
    source = read_checkout_fixture(checkout_root, relative_path)
    result = preview(plan, fixture_source=source)
    result["checkout_fixture_verified"] = True
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--checkout-root", required=True)
    parser.add_argument("--json", required=True)
    args = parser.parse_args()
    src = Path(args.plan)
    if src.stat().st_size > MAX_PLAN_BYTES:
        parser.error("plano acima do limite")
    result = preview_from_checkout(json.loads(src.read_text(encoding="utf-8")),
                                   args.checkout_root)
    # The only diff that can be published was created from the pinned QA fixture.
    Path(args.json).write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8")
    print(SECTION, result["status"], "(repo untouched)")


if __name__ == "__main__":
    main()
