"""The patch executor must modify ONLY a disposable, pinned QA fixture."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_autofix_policy import build_plan
from scripts.ci_autofix_sandbox import (
    AFTER, BEFORE, BEFORE_SHA256, FIXTURE_NAME, RECIPE, SIGNAL,
    sha256, preview,
)
from scripts.test_ci_autofix_policy import fixtures


def sqlite_plan():
    return build_plan(*fixtures(signals=(SIGNAL,)))


class SandboxFixTests(unittest.TestCase):
    def test_valid_sqlite_qa_proposal_patches_only_disposable_copy(self):
        plan = sqlite_plan()
        result = preview(plan)
        self.assertEqual(result["status"], "sandbox_patch_verified")
        self.assertEqual(result["mode"], "disposable_sandbox_only")
        self.assertEqual(result["recipe_id"], RECIPE)
        self.assertEqual(result["fixture"], FIXTURE_NAME)
        self.assertEqual(result["source_sha256"], BEFORE_SHA256)
        self.assertEqual(result["fixed_sha256"], sha256(AFTER))
        self.assertTrue(result["syntax_verified"])
        self.assertIn("-    connection.close()", result["patch"])
        self.assertIn("+    rows = connection.execute", result["patch"])
        self.assertEqual(result["repository_files_changed"], 0)
        self.assertEqual(result["automatic_pull_requests_created"], 0)
        self.assertEqual(result["automatic_merges_or_deploys"], 0)
        self.assertFalse(result["production_access"])
        self.assertFalse(result["current_pr_head_verified"])

    def test_unsupported_rule_never_generates_patch(self):
        for sig in ("android_adb_offline", "qa_mock_sha_assertion",
                    "qa_rules_baseline_assertion"):
            with self.subTest(sig=sig):
                plan = build_plan(*fixtures(signals=(sig,)))
                result = preview(plan)
                self.assertEqual(result["status"], "blocked_not_eligible")
                self.assertIsNone(result["patch"])

    def test_non_whitelisted_security_rules_are_blocked(self):
        for signal in ("qa_firestore_open_grant_contract",
                       "qa_ota_tampered_download_test"):
            with self.subTest(signal=signal):
                plan = build_plan(*fixtures(signals=(signal,)))
                self.assertEqual(preview(plan)["status"], "blocked_not_eligible")

    def test_incomplete_checks_do_not_trigger_patch(self):
        blocked = build_plan(*fixtures(signals=(SIGNAL,), blocked=True))
        self.assertEqual(preview(blocked)["status"], "blocked_not_eligible")

    def test_unverified_job_never_triggers_patch(self):
        blocked = build_plan(*fixtures(signals=(SIGNAL,), verified=False))
        self.assertEqual(preview(blocked)["status"], "blocked_not_eligible")

    def test_multi_signal_case_needs_review_instead_of_patch(self):
        p = build_plan(*fixtures(signals=(SIGNAL, "android_adb_offline")))
        self.assertEqual(preview(p)["status"], "blocked_not_eligible")

    def test_source_hash_pinning_prevents_unexpected_edits_and_reapplication(self):
        p = sqlite_plan()
        with self.assertRaises(ValueError):
            preview(p, BEFORE + "# injected secrets do not get published")
        with self.assertRaises(ValueError):
            preview(p, AFTER)
        with self.assertRaises(ValueError):
            preview(p, b"not text")

    def test_reject_forged_flags_and_identity_fields(self):
        cases = (
            ("production_access", True),
            ("approval_required_before_any_repository_write", False),
            ("freshness_verified_against_current_pr_head", True),
            ("root_cause_established", True),
            ("measured_automation_percent", 99),
            ("automatic_repairs_executed", 1),
            ("automatic_pull_requests_created", 1),
            ("automatic_merges_or_deploys", True),
            ("candidate_count", 2),
            ("commit_sha", "invalid"),
            ("schema_version", 2),
            ("mode", "remote_execute"),
            ("required_checks_complete", False),
        )
        for key, value in cases:
            with self.subTest(key=key):
                p = deepcopy(sqlite_plan())
                p[key] = value
                with self.assertRaises(ValueError):
                    preview(p)

    def test_reject_altered_job_contract(self):
        changes = (
            ("recipe_id", "qa_firewall_deploy"),
            ("decision", "automatic_merge"),
            ("signal_ids", ["unknown_rule"]),
            ("requires_human_approval_for_write", False),
            ("reason_id", "automatically_authorized"),
            ("job_id", 0),
        )
        for field, value in changes:
            with self.subTest(field=field):
                p = deepcopy(sqlite_plan())
                p["jobs"][0][field] = value
                result = None
                try:
                    result = preview(p)
                except ValueError:
                    pass
                self.assertTrue(result is None or result["patch"] is None)

    def test_multiple_jobs_prevent_ambiguous_patch(self):
        p = deepcopy(sqlite_plan())
        extra = deepcopy(p["jobs"][0])
        extra["job_id"] += 1
        extra["decision"] = "human_review"
        extra["recipe_id"] = "none"
        extra["reason_id"] = "no_approved_recipe"
        p["jobs"].append(extra)
        self.assertEqual(preview(p)["status"], "blocked_not_eligible")

    def test_cli_generates_json_not_repo_modification(self):
        with TemporaryDirectory() as d:
            root = Path(d)
            report, output = root / "plan.json", root / "patch-preview.json"
            report.write_text(json.dumps(sqlite_plan()), encoding="utf-8")
            command = [sys.executable, "-m", "scripts.ci_autofix_sandbox",
                       "--plan", str(report), "--json", str(output)]
            proc = subprocess.run(command, cwd=Path(__file__).resolve().parents[1],
                                  capture_output=True, text=True, timeout=20)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            got = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(got["status"], "sandbox_patch_verified")
            self.assertFalse((root / FIXTURE_NAME).exists())
            self.assertIn("repo untouched", proc.stdout)

    def test_invalid_or_large_plan_is_rejected_without_output(self):
        with TemporaryDirectory() as d:
            root = Path(d)
            src, dest = root / "invalid.json", root / "result.json"
            src.write_text("x" * 100_001, encoding="utf-8")
            cmd = [sys.executable, "-m", "scripts.ci_autofix_sandbox",
                   "--plan", str(src), "--json", str(dest)]
            proc = subprocess.run(cmd, cwd=Path(__file__).resolve().parents[1],
                                  capture_output=True, text=True, timeout=20)
            self.assertNotEqual(proc.returncode, 0)
            self.assertFalse(dest.exists())


if __name__ == "__main__":
    unittest.main()
