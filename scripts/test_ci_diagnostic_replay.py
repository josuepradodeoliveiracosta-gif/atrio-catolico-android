"""Offline tests for deterministic replay of fixed, synthetic error fixtures."""
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_diagnostic_replay import CASES, replay, render_markdown


class DiagnosticReplayTests(unittest.TestCase):
    def test_all_fixed_cases_pass_without_root_cause_assertions(self):
        r = replay()
        self.assertEqual(r["cases_total"], 9)
        self.assertEqual(r["passed"], 9)
        self.assertEqual(r["failed"], 0)
        self.assertEqual(r["root_cause"], "not_established")
        self.assertEqual(r["deploy_or_merge"], "never")

    def test_unknown_exit_code_is_inconclusive(self):
        r = replay(tuple(c for c in CASES if c[0] == "unknown_exit_code"))
        self.assertEqual(r["cases"][0]["observed_status"], "inconclusive")
        self.assertEqual(r["cases"][0]["observed_signals"], [])

    def test_failed_example_with_successful_job_is_not_classified(self):
        r = replay(tuple(c for c in CASES
                         if c[0] == "success_with_fixture_failure_text"))
        self.assertEqual(r["cases"][0]["observed_signals"], [])
        self.assertEqual(r["cases"][0]["observed_status"],
                         "not_applicable_nonfailed_job")

    def test_disconnected_markers_are_not_combined(self):
        r = replay(tuple(c for c in CASES if c[0] == "distant_markers"))
        self.assertEqual(r["cases"][0]["observed_signals"],
                         ["generic_test_assertion"])

    def test_reject_modified_unknown_and_duplicate_cases(self):
        with self.assertRaises(ValueError):
            replay(())
        with self.assertRaises(ValueError):
            replay((CASES[0], CASES[0]))
        item = list(CASES[0])
        item[2] += "CHANGED"
        with self.assertRaises(ValueError):
            replay((tuple(item),))
        with self.assertRaises(ValueError):
            replay((("fake", "failure", "", (), "inconclusive"),))

    def test_report_does_not_echo_fixture_text(self):
        r = replay()
        combined = json.dumps(r, ensure_ascii=False) + render_markdown(r)
        for forbidden in ("/synthetic.kt", "AssertionError:",
                          "adb: device offline", "Process completed with exit code",
                          "setup-gradle@v4 not found", "Unresolved reference"):
            self.assertNotIn(forbidden, combined)

    def test_markdown_is_stable_and_excludes_commands(self):
        md = render_markdown(replay())
        self.assertIn("9 | **Aprovados:** 9", md)
        self.assertIn("Causa raiz não comprovada", md)
        self.assertNotIn("firebase deploy", md)
        self.assertNotIn("gradle :app", md)

    def test_cli_all_cases_writes_safe_json_markdown(self):
        with TemporaryDirectory() as d:
            root = Path(d)
            out_json, out_md = root / "replay.json", root / "replay.md"
            proc = subprocess.run(
                [sys.executable, "-m", "scripts.ci_diagnostic_replay",
                 "--json", str(out_json), "--markdown", str(out_md)],
                cwd=Path(__file__).resolve().parents[1],
                capture_output=True, text=True, timeout=20,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            got = json.loads(out_json.read_text(encoding="utf-8"))
            self.assertEqual((got["passed"], got["failed"]), (9, 0))
            self.assertIn("9/9", proc.stdout)
            self.assertIn("Reprodução determinística",
                          out_md.read_text(encoding="utf-8"))

    def test_cli_single_case_and_invalid_input(self):
        with TemporaryDirectory() as d:
            root = Path(d)
            out_json, out_md = root / "replay.json", root / "replay.md"
            cmd = [sys.executable, "-m", "scripts.ci_diagnostic_replay"]
            cmd += ["--json", str(out_json), "--markdown", str(out_md)]
            good = subprocess.run(cmd + ["--case", "kotlin_reference"],
                                  cwd=Path(__file__).resolve().parents[1],
                                  capture_output=True, text=True, timeout=20)
            self.assertEqual(good.returncode, 0, good.stderr)
            self.assertEqual(json.loads(out_json.read_text(encoding="utf-8"))[
                "cases_total"], 1)
            bad = subprocess.run(cmd + ["--case", "actual-system-command"],
                                 cwd=Path(__file__).resolve().parents[1],
                                 capture_output=True, text=True, timeout=20)
            self.assertNotEqual(bad.returncode, 0)


if __name__ == "__main__":
    unittest.main()
