"""Offline contract tests for the first, non-executing autofix policy stage."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_quality_report import REPO
from scripts.ci_failure_classifier import MAX_LOG_BYTES
from scripts.ci_log_safe_analysis import MAX_ANALYZED_JOBS
from scripts.ci_autofix_policy import build_plan, markdown_plan, SECTION

SHA = "a" * 40


def fixtures(signals=("android_adb_offline",), verified=True, blocked=False):
    candidate = {"run_id": 123, "job_id": 456, "state": "failure",
                 "identity_verified": False}
    queue = {
        "repository": REPO, "commit_sha": SHA,
        "all_required_success": not blocked,
        "required_blocking": ([{"name": "Regras de seguranca Firestore",
                                "state": "missing"}] if blocked else []),
        "log_review_queue": {
            "mode": "metadata_only_no_log_access",
            "automatic_log_download": False,
            "root_cause_established": False,
            "candidates": [candidate],
        },
    }
    identity = {
        "repository": REPO, "commit_sha": SHA,
        "mode": "read_only_verified_metadata_no_logs",
        "raw_logs_accessed": False, "raw_logs_published": False,
        "root_cause_established": False, "checked_jobs": 1,
        "verified_jobs": int(verified),
        "results": [{
            "run_id": 123, "job_id": 456, "state": "failure",
            "verdict": "verified" if verified else "metadata_unavailable",
            "identity_verified": verified,
        }],
    }
    analysis = {
        "repository": REPO, "commit_sha": SHA,
        "mode": "read_only_bounded_log_signal_analysis",
        "max_jobs_per_report": MAX_ANALYZED_JOBS,
        "max_log_bytes_per_job": MAX_LOG_BYTES,
        "jobs_classified": int(verified),
        "results": [{
            "run_id": 123, "job_id": 456, "state": "failure",
            "result": "classified_in_memory" if verified
                      else "identity_not_verified",
            "signal_ids": list(signals) if verified else [],
            "classification": (
                "not_analyzed" if not verified else
                "inconclusive" if not signals else
                "single_signal_review_needed" if len(signals) == 1 else
                "multiple_signals_review_needed"),
        }],
        "raw_log_text_in_artifacts": False,
        "root_cause_established": False,
        "automatic_repairs": 0, "automatic_reruns": 0,
        "automatic_merges_or_deploys": 0,
        "pr_head_freshness": "not_verified",
    }
    return queue, identity, analysis


class AutoFixPolicyTests(unittest.TestCase):
    def test_qa_candidate_proposes_review_only(self):
        plan = build_plan(*fixtures())
        self.assertEqual(plan["mode"], "plan_only_no_execution")
        self.assertEqual(plan["candidate_count"], 1)
        self.assertEqual(plan["jobs"][0]["decision"], "qa_proposal_candidate")
        self.assertEqual(plan["jobs"][0]["recipe_id"], "qa_emulator_health_review")
        self.assertTrue(plan["jobs"][0]["requires_human_approval_for_write"])
        self.assertIsNone(plan["measured_automation_percent"])
        self.assertEqual(plan["automation_target_percent"], 99)
        for key in ("automatic_repairs_executed", "automatic_reruns_executed",
                    "automatic_pull_requests_created", "automatic_merges_or_deploys"):
            self.assertEqual(plan[key], 0)
        self.assertFalse(plan["production_access"])

    def test_missing_required_check_blocks_proposals_not_guessed_as_failure(self):
        plan = build_plan(*fixtures(blocked=True))
        self.assertEqual(plan["candidate_count"], 0)
        self.assertFalse(plan["required_checks_complete"])
        self.assertEqual(plan["jobs"][0]["decision"], "blocked")
        self.assertEqual(plan["jobs"][0]["reason_id"], "required_checks_incomplete")

    def test_two_signals_need_human_review_no_automatic_selection(self):
        plan = build_plan(*fixtures(signals=(
            "android_adb_offline", "android_compose_timeout")))
        self.assertEqual(plan["jobs"][0]["decision"], "human_review")
        self.assertEqual(plan["jobs"][0]["recipe_id"], "none")

    def test_sensitive_or_non_whitelisted_rule_is_not_patch_candidate(self):
        for rule in ("qa_firestore_open_grant_contract", "kotlin_unresolved_reference",
                     "generic_test_assertion", "ci_contract_mismatch"):
            with self.subTest(rule=rule):
                p = build_plan(*fixtures(signals=(rule,)))
                self.assertEqual(p["jobs"][0]["decision"], "human_review")

    def test_unknown_or_duplicate_signal_rejected(self):
        for bad in (["arbitrary_python_code"], ["android_adb_offline"] * 2):
            with self.subTest(bad=bad):
                a, b, c = fixtures()
                c["results"][0]["signal_ids"] = bad
                with self.assertRaises(ValueError):
                    build_plan(a, b, c)

    def test_unverified_job_never_proposed(self):
        plan = build_plan(*fixtures(verified=False))
        self.assertEqual(plan["candidate_count"], 0)
        self.assertEqual(plan["jobs"][0]["decision"], "no_action")

    def test_unverified_identity_cannot_claim_classified_log(self):
        snap, identity, analysis = fixtures(verified=False)
        analysis["jobs_classified"] = 1
        analysis["results"][0].update({
            "result": "classified_in_memory",
            "signal_ids": ["android_adb_offline"],
            "classification": "single_signal_review_needed",
        })
        with self.assertRaises(ValueError):
            build_plan(snap, identity, analysis)

    def test_mismatch_sha_counts_or_claimed_actions_are_rejected(self):
        for path, value in (
                (("analysis", "commit_sha"), "b" * 40),
                (("identity", "commit_sha"), "b" * 40),
                (("analysis", "automatic_repairs"), 1),
                (("analysis", "automatic_merges_or_deploys"), True),
                (("analysis", "jobs_classified"), 0),
                (("analysis", "root_cause_established"), True),
                (("analysis", "raw_log_text_in_artifacts"), True),
                (("analysis", "max_log_bytes_per_job"), MAX_LOG_BYTES + 1),
                (("snapshot", "all_required_success"), False),
                (("analysis", "pr_head_freshness"), "current"),
        ):
            with self.subTest(path=path):
                parts = list(deepcopy(fixtures()))
                item = {"snapshot": 0, "identity": 1, "analysis": 2}[path[0]]
                parts[item][path[1]] = value
                with self.assertRaises(ValueError):
                    build_plan(*parts)

    def test_safe_projection_does_not_expose_injected_payloads(self):
        snap, identity, analysis = fixtures()
        private = "ghp_injected_token_person@example.test /home/private"
        analysis["results"][0]["raw_log"] = private
        snap["log_review_queue"]["sensitive_text"] = private
        plan = build_plan(snap, identity, analysis)
        rendered = json.dumps(plan) + markdown_plan(plan)
        self.assertNotIn(private, rendered)
        self.assertNotIn("raw_log", rendered)
        self.assertIn(SECTION, rendered)

    def test_no_jobs_yields_empty_plan_and_no_false_goal_success(self):
        snap, identity, analysis = fixtures()
        snap["log_review_queue"]["candidates"] = []
        identity["results"] = []
        identity["checked_jobs"] = 0
        identity["verified_jobs"] = 0
        analysis["results"] = []
        analysis["jobs_classified"] = 0
        plan = build_plan(snap, identity, analysis)
        self.assertEqual(plan["jobs"], [])
        self.assertEqual(plan["candidate_count"], 0)
        self.assertIsNone(plan["measured_automation_percent"])

    def test_cli_outputs_fixed_artifacts_and_rejects_duplicate_section(self):
        with TemporaryDirectory() as d:
            root = Path(d)
            snapshot, identity, analysis = fixtures()
            inputs = (("ci-diagnostics.json", snapshot),
                      ("ci-job-evidence.json", identity),
                      ("ci-log-signals.json", analysis))
            for name, payload in inputs:
                (root / name).write_text(json.dumps(payload), encoding="utf-8")
            md = root / "ci-report.md"
            md.write_text("# CI report\n", encoding="utf-8")
            out = root / "ci-remediation-plan.json"
            cmd = [sys.executable, "-m", "scripts.ci_autofix_policy",
                   "--diagnostics", str(root / inputs[0][0]),
                   "--identity", str(root / inputs[1][0]),
                   "--signals", str(root / inputs[2][0]),
                   "--json", str(out), "--markdown", str(md)]
            first = subprocess.run(cmd, capture_output=True, text=True,
                                   cwd=Path(__file__).resolve().parents[1], timeout=20)
            self.assertEqual(first.returncode, 0, first.stderr)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(data["candidate_count"], 1)
            self.assertIn(SECTION, md.read_text(encoding="utf-8"))
            second = subprocess.run(cmd, capture_output=True, text=True,
                                    cwd=Path(__file__).resolve().parents[1], timeout=20)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual(data, json.loads(out.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
