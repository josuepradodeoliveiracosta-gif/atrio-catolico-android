"""Offline tests for bounded live-identity check of historic failures."""
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_diagnostic_historic_identity import (
    SOURCE, generate, markdown, verify_historic_failures,
)


def fixture_fetcher():
    cases = json.loads(SOURCE.read_text(encoding="utf-8"))["cases"]
    failure_rows = [c for c in cases if c["conclusion"] != "success"]
    by_run = {c["run_id"]: c for c in failure_rows}
    by_job = {c["job_id"]: c for c in failure_rows}
    calls = []
    sha = "a" * 40

    def fetch(path, token):
        calls.append((path, token))
        if path.startswith("/runs/"):
            case = by_run[int(path.removeprefix("/runs/"))]
            return {
                "id": case["run_id"], "head_sha": sha,
                "status": "completed", "run_attempt": 1,
                "repository": {"full_name": (
                    "josuepradodeoliveiracosta-gif/atrio-catolico-android")},
                "head_repository": {"full_name": (
                    "josuepradodeoliveiracosta-gif/atrio-catolico-android")},
            }
        if path.startswith("/jobs/"):
            case = by_job[int(path.removeprefix("/jobs/"))]
            return {
                "id": case["job_id"], "run_id": case["run_id"],
                "head_sha": sha, "run_attempt": 1,
                "status": "completed", "conclusion": case["conclusion"],
            }
        raise AssertionError("unexpected path")

    return fetch, calls


class HistoricIdentityTests(unittest.TestCase):
    def test_13_verified_identifiers_still_do_not_establish_cause(self):
        fetch, calls = fixture_fetcher()
        raw = SOURCE.read_bytes()
        r = verify_historic_failures(raw, raw, "local-fixture-token", fetch)
        self.assertEqual(r["failed_jobs_in_frozen_holdout"], 13)
        self.assertEqual(r["identities_verified"], 13)
        self.assertEqual(len(calls), 26)
        self.assertEqual(len(r["rows"]), 13)
        self.assertEqual(r["causes_human_adjudicated"], 0)
        self.assertIsNone(r["measured_root_cause_accuracy_pct"])
        self.assertIsNone(r["measured_eligible_auto_repair_pct"])
        self.assertFalse(r["sample_representative"])
        self.assertFalse(r["logs_or_private_evidence_accessed"])
        self.assertEqual(r["writes_or_reruns_executed"], 0)
        for row in r["rows"]:
            self.assertTrue(row["job_identity_verified"])
            self.assertFalse(row["source_signal_independently_verified"])
            self.assertFalse(row["root_cause_established"])
            self.assertFalse(row["repair_performed_or_verified"])
            self.assertEqual(row["verified_head_sha"], "a" * 40)
        self.assertNotIn("local-fixture-token", json.dumps(r))
        self.assertIn("90% nao demonstrada", markdown(r))

    def test_no_token_makes_no_network_requests_and_no_claims(self):
        def fail(*_):
            raise AssertionError("network call without token")
        raw = SOURCE.read_bytes()
        for missing_token in (None, ""):
            with self.subTest(token=repr(missing_token)):
                r = verify_historic_failures(raw, raw, missing_token, fail)
                self.assertEqual(r["identities_verified"], 0)
                self.assertTrue(all(row["verdict"] == "not_verified_no_read_token"
                                    and row["verified_head_sha"] is None
                                    for row in r["rows"]))

    def test_tampered_job_or_repo_fails_closed(self):
        fetch, _ = fixture_fetcher()
        raw = SOURCE.read_bytes()
        for variant in ("job_sha", "run_repo", "job_conclusion", "attempt"):
            def tampered(path, token):
                result = fetch(path, token)
                if variant == "job_sha" and path.startswith("/jobs/"):
                    result["head_sha"] = "b" * 40
                if variant == "run_repo" and path.startswith("/runs/"):
                    result["repository"]["full_name"] = "other/repo"
                if variant == "job_conclusion" and path.startswith("/jobs/"):
                    result["conclusion"] = "success"
                if variant == "attempt" and path.startswith("/runs/"):
                    result["run_attempt"] = 2
                return result
            with self.subTest(variant=variant):
                r = verify_historic_failures(raw, raw, "token", tampered)
                self.assertEqual(r["identities_verified"], 0)
                self.assertTrue(all(row["verified_head_sha"] is None
                                    for row in r["rows"]))

    def test_network_error_is_normalized_and_does_not_expose_secrets(self):
        raw = SOURCE.read_bytes()
        def leak(*_):
            raise OSError("ghp_private_fake_token password=example")
        r = verify_historic_failures(raw, raw, "dummy", leak)
        self.assertEqual(r["identities_verified"], 0)
        self.assertTrue(all(row["verdict"] == "metadata_unavailable"
                            for row in r["rows"]))
        self.assertNotIn("password=", json.dumps(r))

    def test_mutated_source_or_false_review_rejected_before_fetch(self):
        raw = SOURCE.read_bytes()
        def blocked(*_):
            raise AssertionError("unexpected request")
        for altered in (raw + b" ", raw[:-1], b"{}", b""):
            with self.subTest(altered=altered[:15]), self.assertRaises(ValueError):
                verify_historic_failures(altered, raw, "token", blocked)
        with self.assertRaises(ValueError):
            verify_historic_failures(raw, raw, "x" * 4097, blocked)

    def test_outputs_are_local_immutable_and_do_not_overwrite(self):
        with TemporaryDirectory() as t:
            folder = Path(t)
            output, md = folder / "out.json", folder / "out.md"
            original = SOURCE.read_bytes()
            fetch, _ = fixture_fetcher()
            result = generate(SOURCE, output, md, "test-token", fetch)
            self.assertEqual(result["identities_verified"], 13)
            self.assertEqual(SOURCE.read_bytes(), original)
            self.assertEqual(json.loads(output.read_text())["identities_verified"], 13)
            with self.assertRaises(ValueError):
                generate(SOURCE, output, md, None)
            with self.assertRaises(ValueError):
                generate(SOURCE, SOURCE, folder / "new.md", None)
            with self.assertRaises(ValueError):
                generate(SOURCE, folder / "same", folder / "same", None)

    def test_cli_without_token_cannot_misreport_accuracy_or_fetch(self):
        with TemporaryDirectory() as t:
            out = Path(t)
            js, md = out / "out.json", out / "out.md"
            import os
            env = {**os.environ, "GITHUB_TOKEN": ""}
            p = subprocess.run([
                sys.executable, "-m", "scripts.ci_diagnostic_historic_identity",
                "--json", str(js), "--markdown", str(md),
            ], cwd=Path(__file__).resolve().parents[1],
                env=env, capture_output=True, text=True, timeout=20)
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(json.loads(js.read_text())["identities_verified"], 0)
            self.assertIn("Meta de 99% nao demonstrada", md.read_text())


if __name__ == "__main__":
    unittest.main()
