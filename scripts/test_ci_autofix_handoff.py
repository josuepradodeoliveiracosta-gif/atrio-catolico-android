"""Offline regression tests for evidence-gated review handoff of real QA patch.

Tests use the existing CI report, snapshot and remediation builders. No
network, GitHub writes, paid services or production data.
"""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_quality_report import REQUIRED, report
from scripts.ci_diagnostic_snapshot import digest
from scripts.ci_autofix_policy import build_plan
from scripts.ci_autofix_handoff import evidence_gate, handoff, read_json_bounded
from scripts.test_ci_autofix_policy import fixtures
from scripts.ci_autofix_qa_review import (
    PATCH_ID, QA_TARGET, QA_PATCHED_SHA256, apply_reviewed_patch, qa_patch_state,
)
from scripts.ci_autofix_pr_draft_plan import draft_pr_plan
from scripts.ci_autofix_sandbox import sha256

ROOT = Path(__file__).resolve().parents[1]
SHA = "a" * 40


def sample(checks=None):
    if checks is None:
        checks = [
            {"name": REQUIRED[0], "status": "completed", "conclusion": "success"},
            {"name": REQUIRED[1], "status": "completed", "conclusion": "success"},
        ]
    original, _ = report(SHA, checks)
    snapshot = digest(original)
    _, identity, signals = fixtures(blocked=True)
    identity["results"] = []
    identity["checked_jobs"] = 0
    identity["verified_jobs"] = 0
    signals["results"] = []
    signals["jobs_classified"] = 0
    plan = build_plan(snapshot, identity, signals)
    return original, snapshot, plan


class HandoffTests(unittest.TestCase):
    def test_only_exact_push_main_with_consistent_evidence_yields_intent(self):
        report_data, snapshot, plan = sample()
        result = handoff(report_data, snapshot, plan, "push", "main", ROOT)
        self.assertEqual(result["status"], "draft_pr_intent_review_required")
        self.assertEqual(result["draft_pr_intent_id"], "atrio-qa-scope-" + SHA[:12])
        self.assertTrue(result["patch_preview_verified"])
        self.assertEqual(result["patch_id"], PATCH_ID)
        self.assertEqual(result["reviewed_file"], QA_TARGET)
        self.assertEqual(result["mode"], "read_only_review_intent")
        self.assertTrue(result["review_intent_only"])
        self.assertFalse(result["permission_to_write_repo"])
        self.assertFalse(result["production_access"])
        self.assertFalse(result["current_pr_head_verified"])
        self.assertEqual(result["automatic_pull_requests_created"], 0)
        self.assertEqual(result["automatic_repairs_executed"], 0)
        self.assertEqual(result["merges_or_deploys"], 0)
        self.assertIsNone(result["measured_automation_percent"])
        self.assertEqual(result["regression_validation"], "requires_ci_tests")
        self.assertNotIn("patch", result)
        self.assertNotIn("log", json.dumps(result))

    def test_exact_already_applied_patch_does_not_create_second_intent(self):
        a, b, c = sample()
        original = (ROOT / QA_TARGET).read_text(encoding="utf-8")
        self.assertEqual(qa_patch_state(ROOT), "needs_patch")
        corrected = apply_reviewed_patch(original)
        self.assertEqual(sha256(corrected), QA_PATCHED_SHA256)
        with TemporaryDirectory() as directory:
            target = Path(directory) / QA_TARGET
            target.parent.mkdir(parents=True)
            target.write_text(corrected, encoding="utf-8")
            self.assertEqual(qa_patch_state(directory), "already_applied")
            decision = handoff(a, b, c, "push", "main", directory)
            self.assertEqual(decision["status"], "blocked_already_applied")
            self.assertIsNone(decision["draft_pr_intent_id"])
            self.assertFalse(decision["permission_to_write_repo"])
            self.assertEqual(decision["automatic_pull_requests_created"], 0)
            self.assertEqual(
                draft_pr_plan(decision, directory)["status"],
                "blocked_by_handoff")
            self.assertEqual(target.read_text(encoding="utf-8"), corrected)
            # Unknown drift, even if it contains the desired patch, is not
            # grounds for a "fixed" classification or a remote write.
            target.write_text(corrected + "# unexpected drift\n",
                              encoding="utf-8")
            with self.assertRaises(ValueError):
                qa_patch_state(directory)
            with self.assertRaises(ValueError):
                handoff(a, b, c, "push", "main", directory)
            target.unlink()
            target.symlink_to(ROOT / QA_TARGET)
            with self.assertRaises(ValueError):
                qa_patch_state(directory)

    def test_pr_unknown_event_or_non_main_branch_is_blocked(self):
        a, b, c = sample()
        for event, branch in (("pull_request", "main"), ("push", "feature/x"),
                              ("unknown", "main"), ("push", "MAIN"),
                              ("pull_request", "feature/x")):
            with self.subTest(event=event, branch=branch):
                p = handoff(a, b, c, event, branch, ROOT)
                self.assertEqual(p["status"], "blocked_event_or_branch")
                self.assertIsNone(p["draft_pr_intent_id"])

    def test_unrecognized_event_rejected(self):
        a, b, c = sample()
        for event in ("pull_request_target", "", None, 22, "workflow_run"):
            with self.subTest(event=event):
                with self.assertRaises(ValueError):
                    evidence_gate(a, b, c, event, "main")

    def test_real_failed_or_missing_required_check_stays_blocked(self):
        a, b, c = sample([{"name": REQUIRED[0],
                           "status": "completed", "conclusion": "failure"},
                          {"name": REQUIRED[1],
                           "status": "completed", "conclusion": "success"}])
        p = handoff(a, b, c, "push", "main", ROOT)
        self.assertEqual(p["status"], "blocked_required_check_pattern")
        self.assertFalse(p["permission_to_write_repo"])
        a, b, c = sample([{"name": REQUIRED[0],
                           "status": "completed", "conclusion": "success"}])
        self.assertEqual(handoff(a, b, c, "push", "main", ROOT)["status"],
                         "blocked_required_check_pattern")

    def test_other_failed_optional_check_blocks_candidate(self):
        checks = [
            {"name": REQUIRED[0], "status": "completed", "conclusion": "success"},
            {"name": REQUIRED[1], "status": "completed", "conclusion": "success"},
            {"name": "optional", "status": "completed", "conclusion": "failure"},
        ]
        a, b, c = sample(checks)
        self.assertEqual(handoff(a, b, c, "push", "main", ROOT)["status"],
                         "blocked_competing_failure_or_log_evidence")

    def test_duplicate_names_and_forged_required_status_are_rejected(self):
        a, b, c = sample()
        a["checks"].append(deepcopy(a["checks"][0]))
        a["check_count"] += 1
        with self.assertRaises(ValueError):
            evidence_gate(a, b, c, "push", "main")
        a, b, c = sample()
        a["required_checks"][REQUIRED[2]] = "success"
        with self.assertRaises(ValueError):
            evidence_gate(a, b, c, "push", "main")

    def test_cross_artifact_sha_and_required_blocker_mismatch_rejected(self):
        for key in ("report", "snapshot", "plan"):
            with self.subTest(key=key):
                documents = list(deepcopy(sample()))
                documents[{"report": 0, "snapshot": 1, "plan": 2}[key]][
                    "commit_sha"] = "b" * 40
                with self.assertRaises(ValueError):
                    evidence_gate(*documents, "push", "main")
        a, b, c = sample()
        b["required_missing"].pop()
        with self.assertRaises(ValueError):
            evidence_gate(a, b, c, "push", "main")

    def test_forged_plan_or_executed_writes_rejected(self):
        changes = (
            ("mode", "auto_approve"),
            ("required_checks_complete", True),
            ("approval_required_before_any_repository_write", False),
            ("root_cause_established", True),
            ("automatic_repairs_executed", 1),
            ("automatic_pull_requests_created", 1),
            ("automation_target_percent", 100),
            ("measured_automation_percent", 99),
            ("production_access", True),
        )
        for key, value in changes:
            with self.subTest(key=key):
                a, b, c = deepcopy(sample())
                c[key] = value
                with self.assertRaises(ValueError):
                    evidence_gate(a, b, c, "push", "main")

    def test_competing_plan_jobs_blocks_and_leaks_no_raw_text(self):
        a, b, c = sample()
        c["jobs"] = [{"unexpected": "secret-from-log"}]
        c["candidate_count"] = 0
        result = handoff(a, b, c, "push", "main", ROOT)
        self.assertEqual(result["status"], "blocked_competing_failure_or_log_evidence")
        self.assertNotIn("secret-from-log", json.dumps(result))

    def test_no_candidate_when_required_all_success(self):
        a, b, c = sample([{"name": name, "status": "completed",
                            "conclusion": "success"} for name in REQUIRED])
        self.assertEqual(handoff(a, b, c, "push", "main", ROOT)["status"],
                         "blocked_required_check_pattern")

    def test_json_file_limits_and_cli_readonly(self):
        with TemporaryDirectory() as directory:
            d = Path(directory)
            a, b, c = sample()
            for name, data in (("report.json", a), ("diagnostics.json", b),
                               ("plan.json", c)):
                (d / name).write_text(json.dumps(data), encoding="utf-8")
            out = d / "intent.json"
            cmd = [
                sys.executable, "-m", "scripts.ci_autofix_handoff",
                "--report", str(d / "report.json"),
                "--diagnostics", str(d / "diagnostics.json"),
                "--plan", str(d / "plan.json"),
                "--source-event", "push", "--source-branch", "main",
                "--checkout-root", str(ROOT), "--json", str(out),
            ]
            proc = subprocess.run(cmd, cwd=ROOT, text=True,
                                  capture_output=True, timeout=20)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(json.loads(out.read_text(encoding="utf-8"))[
                "status"], "draft_pr_intent_review_required")
            (d / "oversized.json").write_bytes(b"x" * 250001)
            with self.assertRaises(ValueError):
                read_json_bounded(d / "oversized.json")
            with self.assertRaises(ValueError):
                read_json_bounded(d / "missing.json")


if __name__ == "__main__":
    unittest.main()
