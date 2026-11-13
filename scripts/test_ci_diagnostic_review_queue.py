"""Safety tests for the human-review queue. No GitHub network calls."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_diagnostic_review_queue import (
    SOURCE, build_review_queue, generate, markdown,
)


def sample():
    return SOURCE.read_bytes()


class ReviewQueueTests(unittest.TestCase):
    def test_frozen_holdout_produces_13_pending_cases_not_diagnoses(self):
        result = build_review_queue(sample(), sample())
        self.assertEqual(result["source_sha256"], hashlib.sha256(sample()).hexdigest())
        self.assertEqual(result["total_cases"], 16)
        self.assertEqual(result["failed_jobs_needing_review"], 13)
        self.assertEqual(result["successful_control_jobs_not_incidents"], 3)
        self.assertEqual(result["pending_independent_reviews"], 13)
        self.assertEqual(result["reviewed_causal_cases_verified"], 0)
        self.assertEqual(len(result["review_tasks"]), 13)
        self.assertIsNone(result["measured_root_cause_accuracy_pct"])
        self.assertIsNone(result["measured_automatic_fix_success_pct"])
        self.assertFalse(result["root_cause_goal_90_demonstrated"])
        self.assertFalse(result["automatic_fix_goal_99_demonstrated"])
        self.assertFalse(result["source_job_identity_verified_live"])
        self.assertFalse(result["sample_is_representative_for_entire_classifier"])
        self.assertEqual(result["network_requests_performed"], 0)
        self.assertEqual(result["automatic_actions_executed"], 0)

    def test_all_failed_jobs_are_distinct_and_have_no_claimed_cause(self):
        data = json.loads(sample())
        expected = {
            (case["run_id"], case["job_id"])
            for case in data["cases"] if case["conclusion"] != "success"
        }
        result = build_review_queue(sample(), sample())
        observed = {(task["run_id"], task["job_id"])
                    for task in result["review_tasks"]}
        self.assertEqual(observed, expected)
        for task in result["review_tasks"]:
            self.assertIsNone(task["confirmed_root_cause"])
            self.assertIsNone(task["root_cause_prediction_by_classifier"])
            self.assertIsNone(task["independent_review_reference"])
            self.assertFalse(task["source_job_identity_verified_live"])
            self.assertFalse(task["successful_automatic_fix_verified"])
            self.assertFalse(task["can_be_counted_in_90_percent_metric"])
            self.assertFalse(task["can_be_counted_in_99_percent_metric"])
            self.assertTrue(task["job_url_for_manual_review"].endswith(
                f"/runs/{task['run_id']}/job/{task['job_id']}"))

    def test_fake_review_or_mutated_baseline_is_rejected(self):
        frozen = sample()
        mutations = []
        for action in (
            lambda x: x["cases"][0]["review"].update(
                status="human_attested", accepted_signal_ids=[],
                review_reference="https://github.com/example/pull/123"),
            lambda x: x["cases"][0].update(raw_log="password=example"),
            lambda x: x["cases"].pop(),
            lambda x: x["cases"][0]["signal_ids"].append("unknown_code"),
        ):
            doc = json.loads(frozen)
            action(doc)
            mutations.append(json.dumps(doc).encode("utf-8"))
        for mutated in mutations:
            with self.subTest(value=mutated[:30]):
                with self.assertRaises(ValueError):
                    build_review_queue(mutated, frozen)

    def test_even_matching_mutated_source_cannot_claim_attestation(self):
        doc = json.loads(sample())
        doc["cases"][0]["review"] = {
            "status": "human_attested", "accepted_signal_ids": [],
            "review_reference": (
                "https://github.com/"
                "josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/259"
            ),
        }
        raw = json.dumps(doc).encode("utf-8")
        with self.assertRaises(ValueError):
            build_review_queue(raw, raw)

    def test_markdown_contains_no_private_logs_or_fake_metrics(self):
        data = build_review_queue(sample(), sample())
        doc = markdown(data)
        self.assertIn("13 falhas", doc)
        self.assertIn("nao demonstrada", doc)
        self.assertIn("pendente", doc)
        self.assertIn("SHA-256 da fonte", doc)
        self.assertNotIn("ghp_", doc)
        self.assertNotIn("password=", doc)
        self.assertNotIn("99% atingidos", doc)

    def test_outputs_are_local_and_never_overwrite_input_or_existing_file(self):
        with TemporaryDirectory() as tmp:
            base = Path(tmp)
            json_out, md_out = base / "queue.json", base / "queue.md"
            with self.assertRaises(ValueError):
                generate(SOURCE, SOURCE, md_out)
            with self.assertRaises(ValueError):
                generate(SOURCE, json_out, json_out)
            original_digest = hashlib.sha256(sample()).hexdigest()
            report = generate(SOURCE, json_out, md_out)
            self.assertEqual(report["pending_independent_reviews"], 13)
            self.assertEqual(hashlib.sha256(sample()).hexdigest(), original_digest)
            self.assertEqual(
                json.loads(json_out.read_text(encoding="utf-8"))["total_cases"], 16)
            with self.assertRaises(ValueError):
                generate(SOURCE, json_out, md_out)

    def test_cli_runs_offline_without_credentials(self):
        with TemporaryDirectory() as tmp:
            base = Path(tmp)
            js, md = base / "queue.json", base / "queue.md"
            proc = subprocess.run([
                sys.executable, "-m", "scripts.ci_diagnostic_review_queue",
                "--manifest", str(SOURCE), "--json", str(js),
                "--markdown", str(md),
            ], cwd=Path(__file__).resolve().parents[1],
                capture_output=True, text=True, timeout=20)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("13 falhas", proc.stdout)
            self.assertEqual(
                json.loads(js.read_text(encoding="utf-8"))["pending_independent_reviews"], 13)
            self.assertIn("nao demonstrada", md.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
