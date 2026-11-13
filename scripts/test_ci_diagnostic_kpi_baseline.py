"""QA KPI baseline tests: no API, no log access, no synthetic success claims."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_diagnostic_evaluation import evaluate
from scripts.ci_diagnostic_kpi_baseline import (
    SOURCE, baseline, generate, markdown,
)


def audited():
    data = SOURCE.read_bytes()
    return baseline(evaluate(json.loads(data)), hashlib.sha256(data).hexdigest())


class DiagnosticKpiBaselineTests(unittest.TestCase):
    def test_frozen_holdout_counts_and_explicit_unknown_outcomes(self):
        result = audited()
        self.assertEqual(result["jobs_total"], 16)
        self.assertEqual(result["failed_jobs"], 13)
        self.assertEqual(result["successful_controls"], 3)
        self.assertEqual(result["specific_signal_jobs"], 3)
        self.assertEqual(result["generic_only_signal_jobs"], 3)
        self.assertEqual(result["inconclusive_failed_jobs"], 7)
        self.assertEqual(result["specific_signal_coverage_pct"], 23.1)
        self.assertEqual(result["any_signal_coverage_pct"], 46.2)
        self.assertEqual(result["human_attested_failed_jobs"], 0)
        self.assertEqual(result["human_review_pending_failed_jobs"], 13)
        self.assertIsNone(result["measured_root_cause_accuracy_pct"])
        self.assertIsNone(result["measured_automated_remediation_pct"])
        self.assertIsNone(result["eligible_remediation_denominator"])
        self.assertIsNone(result["verified_automatic_repairs_numerator"])
        self.assertEqual(result["automated_repairs_executed_by_this_tool"], 0)
        self.assertEqual(result["external_requests_performed"], 0)
        self.assertFalse(result["auto_merge_or_deploy_authorized"])

    def test_false_rates_or_invented_review_authenticity_are_rejected(self):
        doc = json.loads(SOURCE.read_text(encoding="utf-8"))
        evaluated = evaluate(doc)
        for key, value in (
            ("root_cause_precision", 0.9),
            ("review_attestation_authenticity", "verified"),
            ("acceptance", "demonstrated"),
        ):
            with self.subTest(key=key):
                modified = copy.deepcopy(evaluated)
                modified[key] = value
                with self.assertRaises(ValueError):
                    baseline(modified, "a" * 64)

    def test_inconsistent_denominators_and_bools_fail_closed(self):
        value = evaluate(json.loads(SOURCE.read_text(encoding="utf-8")))
        for key, bad in (
            ("failed_jobs", 12),
            ("sample_total", True),
            ("human_review_pending_failed_jobs", 0),
        ):
            with self.subTest(key=key):
                modified = copy.deepcopy(value)
                modified[key] = bad
                with self.assertRaises(ValueError):
                    baseline(modified, "b" * 64)
        altered = copy.deepcopy(value)
        altered["signal_coverage"]["generic_only"] = 4
        with self.assertRaises(ValueError):
            baseline(altered, "a" * 64)

    def test_unsupported_scope_and_digest_rejected(self):
        value = evaluate(json.loads(SOURCE.read_text(encoding="utf-8")))
        value["scope"] = "complete_classifier_blind_accuracy"
        with self.assertRaises(ValueError):
            baseline(value, "c" * 64)
        value["scope"] = "holdout_for_seven_added_rules_not_blind_for_entire_classifier"
        for raw in ("fake", "A" * 64, "z" * 64):
            with self.subTest(sha=raw):
                with self.assertRaises(ValueError):
                    baseline(value, raw)

    def test_output_cannot_overwrite_the_manifest(self):
        with TemporaryDirectory() as folder:
            out = Path(folder)
            with self.assertRaises(ValueError):
                generate(SOURCE, SOURCE, out / "report.md")
            with self.assertRaises(ValueError):
                generate(SOURCE, out / "same", out / "same")
            self.assertFalse((out / "report.md").exists())

    def test_report_never_calls_coverage_accuracy_or_reports_fake_autofix(self):
        output = markdown(audited())
        for expected in (
            "13 falhos", "3/13 (23.1%)", "6/13 (46.2%)",
            "nao demonstrada", "nao aferivel",
            "nao e prova de autocorrecao geral",
        ):
            self.assertIn(expected, output)
        self.assertNotIn("100% de precisao", output)
        self.assertNotIn("99% alcançado", output)

    def test_cli_generates_bounded_reports_without_mutating_source(self):
        with TemporaryDirectory() as folder:
            p = Path(folder)
            original_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
            json_path, md_path = p / "metrics.json", p / "metrics.md"
            command = [
                sys.executable, "-m", "scripts.ci_diagnostic_kpi_baseline",
                "--manifest", str(SOURCE), "--json", str(json_path),
                "--markdown", str(md_path),
            ]
            process = subprocess.run(
                command, cwd=Path(__file__).resolve().parents[1],
                text=True, capture_output=True, timeout=20)
            self.assertEqual(process.returncode, 0, process.stderr)
            result = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual(result["source_sha256"], original_hash)
            self.assertIsNone(result["measured_automated_remediation_pct"])
            self.assertIn("nao demonstradas", process.stdout)
            self.assertIn("23.1%", md_path.read_text(encoding="utf-8"))
            self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                             original_hash)


if __name__ == "__main__":
    unittest.main()
