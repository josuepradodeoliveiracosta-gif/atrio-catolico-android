"""Regression proof for a reviewed patch to the existing real CI QA module.

No production access, no GitHub calls, no writes to checkout. The new version
is imported only from a disposable file after checking the pinned source.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_autofix_qa_review import (
    EDITS, MAX_DIFF_BYTES, PATCH_ID, QA_TARGET, QA_TARGET_SHA256,
    QA_PATCHED_SHA256, apply_reviewed_patch, preview_real_qa_patch,
    qa_patch_state,
)
from scripts.ci_autofix_sandbox import sha256
from scripts.ci_quality_report import REQUIRED, report

from scripts.ci_autofix_test_checkout import ROOT as REPO_ROOT, REAL_ROOT, recover_original
SHA = "a" * 40


def check(name, conclusion="success"):
    return {"name": name, "status": "completed", "conclusion": conclusion}


class RealQaPatchTests(unittest.TestCase):
    def test_exact_reviewed_source_and_preview_never_modify_checkout(self):
        target = REPO_ROOT / QA_TARGET
        before = target.read_bytes()
        self.assertEqual(sha256(before.decode("utf-8")), QA_TARGET_SHA256)
        out = preview_real_qa_patch(REPO_ROOT)
        self.assertEqual(out["mode"], "manual_review_only_sandbox_preview")
        self.assertEqual(out["patch_id"], PATCH_ID)
        self.assertEqual(out["target"], QA_TARGET)
        self.assertTrue(out["syntax_verified"])
        self.assertTrue(out["sandbox_rollback_verified"])
        self.assertLessEqual(len(out["patch"].encode("utf-8")), MAX_DIFF_BYTES)
        self.assertIn("--- a/" + QA_TARGET, out["patch"])
        self.assertIn("+++ b/" + QA_TARGET, out["patch"])
        self.assertIn("+PR_ONLY_REQUIRED_ON_PUSH", out["patch"])
        self.assertEqual(out["checkout_files_changed"], 0)
        self.assertEqual(out["automatic_pull_requests_created"], 0)
        self.assertEqual(out["automatic_merges_or_deploys"], 0)
        self.assertFalse(out["production_access"])
        self.assertFalse(out["root_cause_established"])
        self.assertTrue(out["human_approval_required_for_repository_write"])
        self.assertEqual(target.read_bytes(), before)

    def test_real_qa_patch_executes_regression_in_disposable_module(self):
        original = (REPO_ROOT / QA_TARGET).read_text(encoding="utf-8")
        updated = apply_reviewed_patch(original)
        with TemporaryDirectory(prefix="atrio-test-qa-patch-") as d:
            target = Path(d) / "qa_ci_quality_report.py"
            target.write_text(updated, encoding="utf-8")
            spec = importlib.util.spec_from_file_location("qa_ci_report_preview", target)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            # Real observed main-push pattern: two ordinary checks pass,
            # while three PR-only checks do not run.
            checks = [check(REQUIRED[0]), check(REQUIRED[1])]
            old, _ = report(SHA, checks)
            new, md = module.report(SHA, checks, source_event="push")
            self.assertFalse(old["all_required_success"])
            self.assertFalse(new["all_required_success"])
            self.assertEqual(old["required_checks"], new["required_checks"])
            self.assertEqual(new["source_event"], "push")
            self.assertEqual(set(new["missing_pr_only_checks_on_push"]),
                             set(REQUIRED[2:]))
            self.assertIn("Escopo do evento", md)
            self.assertIn("nao foram aprovados", md)
            # No accidental promotion on PR or unknown event:
            for event in ("pull_request", "unknown"):
                other, _ = module.report(SHA, checks, source_event=event)
                self.assertEqual(other["missing_pr_only_checks_on_push"], [])
                self.assertFalse(other["all_required_success"])
            # Even on push, a truly failed mandatory check is still blocked.
            failed, _ = module.report(SHA, [check(REQUIRED[0], "failure"),
                                            check(REQUIRED[1])], source_event="push")
            self.assertFalse(failed["all_required_success"])
            self.assertEqual(failed["required_checks"][REQUIRED[0]], "not-success")
            # All required checks succeed: legacy contract continues unchanged.
            complete, _ = module.report(SHA, [check(x) for x in REQUIRED],
                                        source_event="pull_request")
            self.assertTrue(complete["all_required_success"])
            for bad in ("workflow_run", "../push", "Push", "", None):
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    module.report(SHA, checks, source_event=bad)
            self.assertEqual(module.PR_ONLY_REQUIRED_ON_PUSH, frozenset(REQUIRED[2:]))
        self.assertEqual((REPO_ROOT / QA_TARGET).read_text(encoding="utf-8"),
                         original)

    def test_drift_missing_file_symlink_and_traversal_fail_closed(self):
        original = (REPO_ROOT / QA_TARGET).read_text(encoding="utf-8")
        with self.assertRaises(ValueError):
            apply_reviewed_patch(original + "# unauthorized edit\n")
        with self.assertRaises(ValueError):
            apply_reviewed_patch(apply_reviewed_patch(original))
        with self.assertRaises(ValueError):
            preview_real_qa_patch(REPO_ROOT, "../ci_quality_report.py")
        with self.assertRaises(ValueError):
            preview_real_qa_patch(REPO_ROOT, "tests/qa/autofix/sqlite_closed_connection.py")
        with TemporaryDirectory() as d:
            path = Path(d) / QA_TARGET
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("changed", encoding="utf-8")
            with self.assertRaises(ValueError):
                preview_real_qa_patch(d)
            path.unlink()
            with self.assertRaises(ValueError):
                preview_real_qa_patch(d)
            path.symlink_to("missing.py")
            with self.assertRaises(ValueError):
                preview_real_qa_patch(d)

    def test_patcher_requires_seven_reviewed_unique_hunks(self):
        self.assertEqual(len(EDITS), 7)
        original = (REPO_ROOT / QA_TARGET).read_text(encoding="utf-8")
        self.assertTrue(all(original.count(old) == 1 for old, _ in EDITS))
        updated = apply_reviewed_patch(original)
        self.assertNotEqual(sha256(updated), QA_TARGET_SHA256)
        self.assertEqual(sha256(updated), QA_PATCHED_SHA256)
        self.assertEqual(recover_original(updated), original)
        self.assertIn('source_event=args.source_event', updated)
        self.assertIn('not_expected_on_push', updated)

    def test_manual_cli_is_bounded_json_and_keeps_source_intact(self):
        src = REPO_ROOT / QA_TARGET
        before = src.read_bytes()
        proc = subprocess.run(
            [sys.executable, "-m", "scripts.ci_autofix_qa_review",
             "--checkout-root", str(REPO_ROOT)],
            cwd=REAL_ROOT, capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = json.loads(proc.stdout)
        self.assertEqual(out["target"], QA_TARGET)
        self.assertEqual(out["regression_validation"], "requires_ci_tests")
        self.assertEqual(src.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
