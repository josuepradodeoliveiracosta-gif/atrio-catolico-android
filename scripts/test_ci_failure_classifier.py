"""Deterministic tests for offline error-signal triage; no secrets, APIs or deploy."""
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_failure_classifier import (
    MAX_LOG_BYTES, classify, markdown_report, positive_int, validate_sha,
)

SHA = "a" * 40
RUN = 43073256100
JOB = 130706412678


def codes(report):
    return {item["rule_id"] for item in report["signals"]}


class ClassifierTests(unittest.TestCase):
    def test_kotlin_compile_with_unresolved_reference(self):
        log = """e: file:///workspace/UserReportsAdminPanel.kt:42:44 Unresolved reference 'mutableStateListOf'.
> Task :app:compileChatQaKotlin FAILED
BUILD FAILED in 52s
"""
        result = classify(log, SHA, RUN, JOB)
        self.assertIn("kotlin_unresolved_reference", codes(result))
        self.assertEqual(result["root_cause"], "not_established")
        self.assertNotIn("UserReportsAdminPanel", json.dumps(result))

    def test_ci_contract_gradle_mismatch(self):
        log = ("FAIL: test_existing_safe_caches_kept\n"
               "AssertionError: 'gradle/actions/setup-gradle@v4' not found\n")
        result = classify(log, SHA, RUN, JOB)
        self.assertIn("ci_contract_mismatch", codes(result))

    def test_rules_fixture_rejection_not_production_claim(self):
        log = ("AssertionError: base deve conter regras oficiais substanciais\n"
               "ERR_ASSERTION\n")
        out = classify(log, SHA, RUN, JOB)
        self.assertIn("qa_rules_baseline_assertion", codes(out))
        self.assertEqual(out["automated_actions"], "none")

    def test_mock_sha_is_not_prod_incident(self):
        log = ("Error: atrio_rules_deploy_local_sha_mismatch\n"
               "code: 'ERR_ASSERTION'\n")
        self.assertIn("qa_mock_sha_assertion", codes(classify(log, SHA, RUN, JOB)))

    def test_emulator_multiple_signals_cannot_pick_root_cause(self):
        log = ("adb: device offline\n"
               "androidx.compose.ui.test.ComposeTimeoutException: Condition still not satisfied\n")
        out = classify(log, SHA, RUN, JOB)
        self.assertEqual(out["classification"], "multiple_signals_review_needed")
        self.assertEqual(codes(out), {"android_adb_offline", "android_compose_timeout"})
        self.assertEqual(out["root_cause"], "not_established")

    def test_only_exit_code_cannot_prove_cause(self):
        out = classify("##[error]Process completed with exit code 1.", SHA, RUN, JOB)
        self.assertEqual(out["classification"], "inconclusive")
        self.assertEqual(out["signals"], [])

    def test_generic_assertion_is_weak(self):
        out = classify("Exception\nAssertionError: unexpected\n", SHA, RUN, JOB)
        self.assertEqual(codes(out), {"generic_test_assertion"})
        self.assertEqual(out["signals"][0]["evidence_strength"], "generic")

    def test_no_user_data_secrets_or_paths_leak(self):
        secret = "ghp_NOT_A_REAL_TOKEN_FOR_QA"
        personal = "private.person@example.test"
        line = f"private path /home/private/{secret} {personal}\n"
        out = classify(line + "adb: device offline", SHA, RUN, JOB)
        result = json.dumps(out, ensure_ascii=False) + markdown_report(out)
        for substring in [secret, personal, "/home/private/"]:
            self.assertNotIn(substring, result)

    def test_reject_invalid_sha_ids_and_large_input(self):
        for bad in ("abc", "b" * 39, "z" * 40):
            with self.assertRaises(ValueError):
                validate_sha(bad)
        for bad in (0, -1, "x", "0", "9999999999999999999999999"):
            with self.assertRaises(ValueError):
                positive_int(bad)
        with self.assertRaises(ValueError):
            classify("x" * (MAX_LOG_BYTES + 1), SHA, RUN, JOB)

    def test_cli_generates_only_safe_artifacts(self):
        with TemporaryDirectory() as d:
            tmp = Path(d)
            logfile = tmp / "fixture.log"
            result = tmp / "result.json"
            md = tmp / "result.md"
            logfile.write_text("adb: device offline\n", encoding="utf-8")
            args = [sys.executable, "-m", "scripts.ci_failure_classifier",
                    "--log-file", str(logfile), "--sha", SHA,
                    "--run-id", str(RUN), "--job-id", str(JOB),
                    "--json", str(result), "--markdown", str(md)]
            process = subprocess.run(args,
                                     cwd=Path(__file__).resolve().parents[1],
                                     text=True, capture_output=True, timeout=20)
            self.assertEqual(process.returncode, 0, process.stderr)
            output = json.loads(result.read_text(encoding="utf-8"))
            self.assertEqual(codes(output), {"android_adb_offline"})
            self.assertIn("Causa raiz não comprovada", md.read_text(encoding="utf-8"))

    def test_code_scan_output_does_not_echo_raw_input(self):
        out = classify("cred: xyz123\nadb: device offline", SHA, RUN, JOB)
        self.assertEqual(out["signals"][0]["evidence_line_numbers"], [2])
        self.assertNotIn("cred:", markdown_report(out))


if __name__ == "__main__":
    unittest.main()
