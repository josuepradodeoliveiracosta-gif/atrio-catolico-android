"""Tests of the conservative diagnostic evidence audit; no network."""
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_diagnostic_evaluation import evaluate, markdown_report

REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
DATA = (Path(__file__).resolve().parents[1] / "docs" / "ci" / "datasets"
        / "diagnostics-holdout-v1.json")


def sample():
    return json.loads(DATA.read_text(encoding="utf-8"))


class DiagnosticEvidenceTests(unittest.TestCase):
    def test_holdout_preserves_denominators_without_fabricated_precision(self):
        result = evaluate(sample())
        self.assertEqual((result["sample_total"], result["failed_jobs"],
                          result["successful_controls"]), (16, 13, 3))
        self.assertEqual(result["signal_coverage"], {
            "specific": 3, "generic_only": 3,
            "inconclusive": 7, "denominator_failed_jobs": 13,
        })
        self.assertEqual(result["human_review_pending_failed_jobs"], 13)
        self.assertIsNone(result["root_cause_precision"])
        self.assertIsNone(result["adjudicated_signal_precision"])

    def test_success_does_not_create_incident(self):
        data = sample()
        good = next(x for x in data["cases"] if x["conclusion"] == "success")
        good["signal_ids"] = ["android_adb_offline"]
        with self.assertRaises(ValueError):
            evaluate(data)

    def test_unrecognized_marker_or_duplicate_job_rejected(self):
        data = sample()
        data["cases"][0]["signal_ids"] = ["unknown_rule"]
        with self.assertRaises(ValueError):
            evaluate(data)
        data = sample()
        data["cases"][0]["job_id"] = data["cases"][1]["job_id"]
        with self.assertRaises(ValueError):
            evaluate(data)

    def test_raw_log_and_private_fields_are_rejected(self):
        data = sample()
        data["cases"][0]["raw_log"] = "password=example"
        with self.assertRaises(ValueError):
            evaluate(data)
        data = sample()
        data["cases"][0]["review"]["reviewer_email"] = "email@example.test"
        with self.assertRaises(ValueError):
            evaluate(data)

    def test_pending_review_cannot_have_accepted_label(self):
        data = sample()
        data["cases"][0]["review"]["accepted_signal_ids"] = []
        with self.assertRaises(ValueError):
            evaluate(data)

    def test_human_attestation_only_enables_signal_metric(self):
        data = sample()
        case = next(x for x in data["cases"] if x["id"] == "firebase_mock_sha")
        case["review"] = {
            "status": "human_attested",
            "accepted_signal_ids": ["qa_mock_sha_assertion"],
            "review_reference": f"https://github.com/{REPO}/pull/259#issuecomment-1234",
        }
        r = evaluate(data)
        self.assertEqual(r["human_attested_failed_jobs"], 1)
        self.assertEqual(r["adjudicated_signal_precision"], 1.0)
        self.assertIsNone(r["root_cause_precision"])
        self.assertEqual(r["review_attestation_authenticity"], "not_verified_offline")

    def test_disagreement_counted_as_signal_false_positive(self):
        data = sample()
        c = next(x for x in data["cases"] if x["id"] == "firebase_mock_sha")
        c["review"] = {
            "status": "human_attested",
            "accepted_signal_ids": ["sqlite_closed_database"],
            "review_reference": f"https://github.com/{REPO}/pull/259",
        }
        r = evaluate(data)
        self.assertEqual(r["adjudicated_signal_counts"], {
            "correct_specific": 0, "incorrect_specific": 1, "missed_specific": 1,
        })
        self.assertEqual(r["adjudicated_signal_precision"], 0.0)
        self.assertIsNone(r["root_cause_precision"])

    def test_untrusted_attestation_url_rejected(self):
        data = sample()
        data["cases"][0]["review"] = {
            "status": "human_attested", "accepted_signal_ids": [],
            "review_reference": "https://github.com.evil.example/pull/259",
        }
        with self.assertRaises(ValueError):
            evaluate(data)

    def test_safe_markdown_has_no_log_text(self):
        doc = markdown_report(evaluate(sample()))
        self.assertIn("nao calculavel", doc)
        self.assertIn("3/13", doc)
        self.assertNotIn("ghp_", doc)
        self.assertIn(f"https://github.com/{REPO}/actions/runs/", doc)

    def test_cli_runs_offline(self):
        with TemporaryDirectory() as d:
            out = Path(d)
            js, md = out / "metrics.json", out / "metrics.md"
            proc = subprocess.run([
                sys.executable, "-m", "scripts.ci_diagnostic_evaluation",
                "--manifest", str(DATA), "--json", str(js),
                "--markdown", str(md)],
                cwd=Path(__file__).resolve().parents[1],
                capture_output=True, text=True, timeout=20)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(json.loads(js.read_text(encoding="utf-8"))["failed_jobs"], 13)
            self.assertIn("nao calculavel", md.read_text(encoding="utf-8"))
            self.assertIn("13 falhas", proc.stdout)


if __name__ == "__main__":
    unittest.main()
