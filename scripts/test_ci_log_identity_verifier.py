"""Offline proof of provenance checks and privacy guards (no GitHub calls)."""
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest.mock import Mock
import unittest

from scripts.ci_quality_report import REPO
from scripts.ci_log_identity_verifier import (
    MAX_LOG_JOBS, MAX_RESPONSE_BYTES, api_json, markdown_evidence,
    validate_queue, verify, verify_one,
)

SHA = "a" * 40

def candidate(run_id=12, job_id=34, state="failure"):
    return {"run_id": run_id, "job_id": job_id, "state": state,
            "identity_verified": False}

def snapshot(candidates=None):
    return {"repository": REPO, "commit_sha": SHA,
            "log_review_queue": {
                "mode": "metadata_only_no_log_access",
                "automatic_log_download": False, "root_cause_established": False,
                "candidates": [] if candidates is None else candidates}}

def run():
    return {"id": 12, "head_sha": SHA, "status": "completed",
            "run_attempt": 1, "repository": {"full_name": REPO},
            "head_repository": {"full_name": REPO}}

def job():
    return {"id": 34, "run_id": 12, "head_sha": SHA,
            "run_attempt": 1, "status": "completed", "conclusion": "failure"}


class IdentityVerifierTests(unittest.TestCase):
    def test_valid_identity_is_not_causal_proof_or_log_access(self):
        called = []
        def read(path, token):
            called.append(path)
            return run() if path == "/runs/12" else job()
        report = verify(snapshot([candidate()]), "fake-read-token", read)
        self.assertEqual(called, ["/runs/12", "/jobs/34"])
        self.assertEqual(report["verified_jobs"], 1)
        self.assertTrue(report["results"][0]["identity_verified"])
        self.assertFalse(report["raw_logs_accessed"])
        self.assertFalse(report["raw_logs_published"])
        self.assertFalse(report["root_cause_established"])
        self.assertEqual(report["freshness"], "not_checked_against_current_pr_head")
        self.assertNotIn("fake-read-token", json.dumps(report))

    def test_wrong_repo_run_sha_and_status_are_rejected(self):
        cases = [
            ({"head_repository": {"full_name": "elsewhere/repo"}}, "rejected_repository"),
            ({"repository": {"full_name": "elsewhere/repo"}}, "rejected_repository"),
            ({"head_sha": "b" * 40}, "rejected_run_sha"),
            ({"id": 99}, "rejected_run_sha"),
            ({"status": "in_progress"}, "rejected_run_incomplete"),
        ]
        for alteration, expected in cases:
            with self.subTest(expected=expected, alteration=alteration):
                self.assertEqual(verify_one({**run(), **alteration}, job(),
                                            SHA, candidate()), expected)

    def test_wrong_job_id_binding_sha_conclusion_and_attempt_rejected(self):
        cases = [
            ({"id": 9}, "rejected_job_identity"),
            ({"run_id": 99}, "rejected_job_identity"),
            ({"head_sha": "b" * 40}, "rejected_job_identity"),
            ({"status": "queued"}, "rejected_job_conclusion"),
            ({"conclusion": "success"}, "rejected_job_conclusion"),
            ({"run_attempt": 2}, "rejected_run_attempt"),
            ({"run_attempt": None}, "rejected_run_attempt"),
        ]
        for alteration, expected in cases:
            with self.subTest(expected=expected, alteration=alteration):
                self.assertEqual(verify_one(run(), {**job(), **alteration},
                                            SHA, candidate()), expected)

    def test_timeout_requires_matching_timeout_in_api(self):
        j = {**job(), "conclusion": "timed_out"}
        self.assertEqual(verify_one(run(), j, SHA, candidate(state="timed_out")),
                         "verified")
        self.assertEqual(verify_one(run(), j, SHA, candidate(state="failure")),
                         "rejected_job_conclusion")

    def test_bogus_queue_is_rejected_before_any_network_call(self):
        cases = [
            {"repository": "someone/other"},
            {"commit_sha": "not_sha"},
            {"log_review_queue": None},
            {"log_review_queue": {**snapshot()["log_review_queue"],
                                  "automatic_log_download": True}},
            {"log_review_queue": {**snapshot()["log_review_queue"],
                                  "candidates": [candidate() for _ in range(MAX_LOG_JOBS + 1)]}},
            {"log_review_queue": {**snapshot()["log_review_queue"],
                                  "candidates": [candidate(), candidate()]}},
            {"log_review_queue": {**snapshot()["log_review_queue"],
                                  "candidates": [candidate(state="success")]}},
            {"log_review_queue": {**snapshot()["log_review_queue"],
                                  "candidates": [{**candidate(), "identity_verified": True}]}},
            {"log_review_queue": {**snapshot()["log_review_queue"],
                                  "candidates": [candidate(run_id=0)]}},
        ]
        for change in cases:
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    validate_queue({**snapshot(), **change})
        call = Mock(side_effect=AssertionError("should never fetch"))
        with self.assertRaises(ValueError):
            verify(snapshot([candidate(), candidate()]), "dummy", call)
        call.assert_not_called()

    def test_missing_token_skips_all_api_calls_and_does_not_claim_verification(self):
        call = Mock(side_effect=AssertionError("offline only"))
        report = verify(snapshot([candidate()]), None, call)
        call.assert_not_called()
        self.assertEqual(report["results"][0]["verdict"], "metadata_unavailable")
        self.assertEqual(report["verified_jobs"], 0)

    def test_network_error_cannot_leak_api_response_or_credentials(self):
        secret = "ghp_never_print_this_fake"
        def fail(path, token):
            raise OSError(secret + " /private/someone@example.test")
        report = verify(snapshot([candidate()]), secret, fail)
        rendered = json.dumps(report) + markdown_evidence(report)
        self.assertNotIn(secret, rendered)
        self.assertNotIn("someone@example.test", rendered)
        self.assertEqual(report["results"][0]["verdict"], "metadata_unavailable")

    def test_request_is_read_only_bounded_and_points_only_to_github_api(self):
        seen = []
        class Reply:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self, count):
                self.count = count
                return json.dumps(run()).encode("utf-8")
        def open_fake(request, timeout):
            seen.append((request.full_url, request.get_method(), timeout))
            return Reply()
        result = api_json("/runs/12", "fake-token", open_fake)
        self.assertEqual(result["head_sha"], SHA)
        self.assertEqual(seen, [
            (f"https://api.github.com/repos/{REPO}/actions/runs/12", "GET", 12)])
        class Oversize(Reply):
            def read(self, count):
                return b"x" * (MAX_RESPONSE_BYTES + 1)
        with self.assertRaises(ValueError):
            api_json("/runs/12", "fake-token", lambda request, timeout: Oversize())

    def test_metadata_api_never_uses_arbitrary_or_redirected_endpoint(self):
        forbidden = [
            "https://evil.example/jobs/12", "/jobs/0", "/runs/12/logs",
            "//evil.example", "/runs/12/../settings", "/jobs/12?token=x",
            "/runs/9999999999999999999", "/jobs/12/extra",
        ]
        call = Mock(side_effect=AssertionError("should not reach network"))
        for target in forbidden:
            with self.subTest(target=target):
                with self.assertRaises(ValueError):
                    api_json(target, "dummy-token", call)
        call.assert_not_called()

    def test_queue_rejects_boolean_and_string_identifiers(self):
        for value in (True, "12", 12.0):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    validate_queue(snapshot([candidate(run_id=value)]))

    def test_cli_generates_bounded_metadata_only_artifact(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            inp, out, md = [root / name for name in
                            ("diagnostics.json", "job-evidence.json", "report.md")]
            inp.write_text(json.dumps(snapshot()), encoding="utf-8")
            md.write_text("# Relatorio existente\n", encoding="utf-8")
            env = {**os.environ, "GITHUB_TOKEN": ""}
            proc = subprocess.run(
                [sys.executable, "-m", "scripts.ci_log_identity_verifier",
                 "--diagnostics", str(inp), "--json", str(out),
                 "--markdown", str(md)],
                cwd=Path(__file__).resolve().parents[1], env=env,
                text=True, capture_output=True, timeout=20)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(json.loads(out.read_text())["verified_jobs"], 0)
            full = md.read_text()
            self.assertIn("# Relatorio existente", full)
            self.assertIn("Identidade de jobs do CI", full)
            self.assertIn("logs nao lidos", full)


if __name__ == "__main__":
    unittest.main()
