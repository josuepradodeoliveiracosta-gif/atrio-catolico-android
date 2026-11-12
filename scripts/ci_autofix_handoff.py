#!/usr/bin/env python3
"""Fail-closed evidence gate for handing existing CI QA previews to PR review.

Extends the existing report -> diagnostic snapshot -> remediation plan ->
sandbox pipeline. NO GitHub API, subprocess, token, write to checkout, PR,
merge, rerun, deploy or inference of root cause. The generated intent cannot
authorize a repository write.
"""
import argparse
import json
from pathlib import Path

from scripts.ci_quality_report import REPO, REQUIRED, state_for, validate_sha
from scripts.ci_autofix_qa_review import PATCH_ID, QA_TARGET, preview_real_qa_patch

MAX_INPUT_BYTES = 250_000
PR_ONLY = frozenset(REQUIRED[2:])
ORDINARY = frozenset(REQUIRED[:2])
CHECK_STATES = frozenset(("missing", "pending", "not-success", "success"))


def read_json_bounded(path):
    file = Path(path)
    if not file.is_file() or file.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError("artifact de CI ausente ou acima do limite")
    return json.loads(file.read_text(encoding="utf-8"))


def evidence_gate(report, snapshot, plan, source_event, source_branch):
    """Require correlated SHA, successful observed checks, and push on main.

    These requirements establish a narrow *metadata symptom*, not a causal
    diagnosis or permission to patch/merge; any uncertainty blocks automation.
    """
    if (not isinstance(report, dict) or not isinstance(snapshot, dict)
            or not isinstance(plan, dict)):
        raise ValueError("artifacts de CI invalidos")
    sha = validate_sha(report.get("commit_sha"))
    if (report.get("repository") != REPO
            or snapshot.get("repository") != REPO
            or plan.get("repository") != REPO
            or snapshot.get("commit_sha") != sha
            or plan.get("commit_sha") != sha):
        raise ValueError("SHA/repo de CI nao conferem")
    required = report.get("required_checks")
    checks = report.get("checks")
    if (not isinstance(required, dict) or set(required) != set(REQUIRED)
            or not isinstance(checks, list)
            or not isinstance(report.get("check_count"), int)
            or type(report["check_count"]) is not int
            or not 0 <= report["check_count"] <= 600
            or report["check_count"] != len(checks)
            or any(not isinstance(c, dict) or not isinstance(c.get("name"), str)
                   or not isinstance(c.get("status"), str)
                   or not isinstance(c.get("conclusion"), str) for c in checks)
            or len({c["name"] for c in checks}) != len(checks)):
        raise ValueError("checks invalidos ou duplicados")
    reconstructed = {
        name: state_for([c for c in checks if c["name"] == name])
        for name in REQUIRED
    }
    # The report uses 'not-success' for all non-success check conclusions.
    expected_required = {
        name: ("missing" if reconstructed[name] == "missing" else
               "pending" if reconstructed[name] == "pending" else
               "success" if reconstructed[name] == "success" else "not-success")
        for name in REQUIRED
    }
    if (any(required.get(k) not in CHECK_STATES for k in REQUIRED)
            or required != expected_required
            or type(report.get("all_required_success")) is not bool
            or report["all_required_success"] != all(
                state == "success" for state in required.values())):
        raise ValueError("contrato de checks do relatorio inconsistente")
    blocked = [{"name": n, "state": required[n]}
               for n in REQUIRED if required[n] != "success"]
    missing = [n for n in REQUIRED if required[n] == "missing"]
    queue = snapshot.get("log_review_queue")
    if (snapshot.get("required_blocking") != blocked
            or snapshot.get("required_missing") != missing
            or snapshot.get("all_required_success") != report["all_required_success"]
            or type(snapshot.get("non_success_count")) is not int
            or not isinstance(queue, dict)
            or not isinstance(queue.get("candidates"), list)
            or type(plan.get("candidate_count")) is not int
            or not isinstance(plan.get("jobs"), list)
            or plan.get("mode") != "plan_only_no_execution"
            or plan.get("based_on") != "ci_log_safe_analysis_verified_job_signals"
            or plan.get("root_cause_established") is not False
            or plan.get("approval_required_before_any_repository_write") is not True
            or plan.get("production_access") is not False
            or plan.get("freshness_verified_against_current_pr_head") is not False
            or plan.get("measured_automation_percent") is not None
            or type(plan.get("automation_target_percent")) is not int
            or plan.get("automation_target_percent") != 99
            or type(plan.get("required_checks_complete")) is not bool
            or plan["required_checks_complete"] != (not bool(blocked))):
        raise ValueError("diagnosticos ou plano divergentes")
    for key in ("automatic_repairs_executed", "automatic_reruns_executed",
                "automatic_pull_requests_created", "automatic_merges_or_deploys"):
        if type(plan.get(key)) is not int or plan[key] != 0:
            raise ValueError("plano indica escrita inesperada")
    if source_event not in ("push", "pull_request", "unknown"):
        raise ValueError("evento de workflow nao reconhecido")

    # Event branch is verified by the calling workflow's event payload, never
    # by a URL, a log line, or a report authored by a PR.
    if source_event != "push" or source_branch != "main":
        return sha, "blocked_event_or_branch"
    if (report["all_required_success"] or
            any(required[n] != "success" for n in ORDINARY) or
            any(required[n] != "missing" for n in PR_ONLY)):
        return sha, "blocked_required_check_pattern"
    if (any(c["status"] != "completed" or c["conclusion"] != "success"
            for c in checks)
            or snapshot["non_success_count"] != 0
            or snapshot.get("non_success_checks") != []
            or queue.get("candidates") != []
            or queue.get("truncated") is not False
            or queue.get("automatic_log_download") is not False
            or plan["candidate_count"] != 0 or plan["jobs"] != []):
        return sha, "blocked_competing_failure_or_log_evidence"
    return sha, "review_candidate"


def handoff(report, snapshot, plan, source_event, source_branch, checkout_root):
    sha, state = evidence_gate(report, snapshot, plan, source_event, source_branch)
    result = {
        "schema_version": 1,
        "mode": "read_only_review_intent",
        "repository": REPO,
        "commit_sha": sha,
        "status": state,
        "patch_id": PATCH_ID,
        "reviewed_file": QA_TARGET,
        "draft_pr_intent_id": None,
        "review_intent_only": True,
        "automatic_pull_requests_created": 0,
        "automatic_repairs_executed": 0,
        "merges_or_deploys": 0,
        "permission_to_write_repo": False,
        "current_pr_head_verified": False,
        "production_access": False,
        "measured_automation_percent": None,
        "reason": "event_scope_metadata_not_root_cause",
    }
    if state != "review_candidate":
        return result
    evidence = preview_real_qa_patch(checkout_root)
    if (evidence.get("mode") != "manual_review_only_sandbox_preview"
            or evidence.get("checkout_files_changed") != 0
            or evidence.get("patch_id") != PATCH_ID
            or evidence.get("target") != QA_TARGET
            or evidence.get("syntax_verified") is not True
            or evidence.get("sandbox_rollback_verified") is not True
            or evidence.get("human_approval_required_for_repository_write") is not True):
        raise ValueError("sandbox QA nao comprovada")
    result.update({
        "status": "draft_pr_intent_review_required",
        "draft_pr_intent_id": "atrio-qa-scope-" + sha[:12],
        "source_sha256": evidence["source_sha256"],
        "patched_sha256": evidence["patched_sha256"],
        "patch_preview_verified": True,
        "regression_validation": "requires_ci_tests",
    })
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--diagnostics", required=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--source-event", choices=("unknown", "push", "pull_request"),
                        required=True)
    parser.add_argument("--source-branch", required=True)
    parser.add_argument("--checkout-root", required=True)
    parser.add_argument("--json", required=True)
    args = parser.parse_args()
    result = handoff(
        read_json_bounded(args.report),
        read_json_bounded(args.diagnostics),
        read_json_bounded(args.plan),
        args.source_event, args.source_branch, args.checkout_root)
    Path(args.json).write_text(
        json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8")
    print("Autocorrecao:", result["status"], "(somente revisao, sem PR)")


if __name__ == "__main__":
    main()
