"""QA-only safeguards for bounded log reading and signal-only artifacts."""
from email.message import Message
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest.mock import Mock
import unittest
from urllib.error import HTTPError

from scripts.ci_quality_report import REPO
from scripts.ci_log_safe_analysis import (
    MAX_ANALYZED_JOBS, MAX_LOG_BYTES, analyze, approved_signed_url,
    download_job_log, markdown_analysis, validate_identity,
)
SHA = "a" * 40

def candidate(job_id=34):
    return {"run_id": 12, "job_id": job_id, "state": "failure",
            "identity_verified": False}

def snapshot(candidates=None):
    return {"repository": REPO, "commit_sha": SHA,
            "log_review_queue": {
                "mode": "metadata_only_no_log_access",
                "automatic_log_download": False,
                "root_cause_established": False,
                "candidates": candidates if candidates is not None else []}}

def evidence(candidates=None, verified=None):
    candidates = [] if candidates is None else candidates
    verified = set() if verified is None else verified
    rows = [{"run_id": row["run_id"], "job_id": row["job_id"],
             "state": row["state"],
             "verdict": "verified" if row["job_id"] in verified
                        else "metadata_unavailable",
             "identity_verified": row["job_id"] in verified}
            for row in candidates]
    return {"repository": REPO, "commit_sha": SHA,
            "mode": "read_only_verified_metadata_no_logs",
            "raw_logs_accessed": False, "raw_logs_published": False,
            "root_cause_established": False,
            "checked_jobs": len(rows), "verified_jobs": len(verified),
            "results": rows}

class Reply:
    def __init__(self, body):
        self.body = body
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self, limit):
        return self.body[:limit]

class LogSafeTests(unittest.TestCase):
    def test_only_approved_https_log_storage_is_accepted(self):
        good = [
            "https://results-receiver.actions.githubusercontent.com/foo?sig=a",
            "https://productionresultssa0.blob.core.windows.net/foo?sig=b",
        ]
        bad = [
            "http://productionresultssa0.blob.core.windows.net/foo",
            "https://blob.core.windows.net/foo",
            "https://evil.blob.core.windows.net.evil.test/foo",
            "https://github.com/owner/repo/actions/runs/1",
            "https://u:p@results.actions.githubusercontent.com/foo",
            "https://results.actions.githubusercontent.com:999/foo",
            "https://results.actions.githubusercontent.com/foo#fragment",
            "file:///etc/passwd",
            "https://localhost/abc",
            "https://results.actions.githubusercontent.com/" + "x" * 5000,
        ]
        for url in good:
            with self.subTest(url=url):
                self.assertTrue(approved_signed_url(url))
        for url in bad:
            with self.subTest(url=url):
                self.assertFalse(approved_signed_url(url))

    def test_redirect_drops_auth_and_only_reads_bounded_text(self):
        signed = "https://results-receiver.actions.githubusercontent.com/log?sig=private"
        seen = []
        def opener(request, timeout):
            seen.append((request.full_url, request.get_header("Authorization"), timeout))
            if len(seen) == 1:
                h = Message()
                h["Location"] = signed
                raise HTTPError(request.full_url, 302, "Found", h, None)
            return Reply(b"adb: device offline\n")
        result = download_job_log(34, "fake-token", opener)
        self.assertEqual(result, "adb: device offline\n")
        self.assertEqual(len(seen), 2)
        self.assertIn("/actions/jobs/34/logs", seen[0][0])
        self.assertEqual(seen[0][1], "Bearer fake-token")
        self.assertEqual(seen[1][0], signed)
        self.assertIsNone(seen[1][1])

    def test_redirect_to_unauthorized_host_never_opens_second_request(self):
        seen = []
        def opener(request, timeout):
            seen.append(request.full_url)
            h = Message()
            h["Location"] = "https://evil.example/logs?secret=one"
            raise HTTPError(request.full_url, 302, "Found", h, None)
        with self.assertRaises(ValueError):
            download_job_log(34, "fake-token", opener)
        self.assertEqual(len(seen), 1)

    def test_log_too_large_is_rejected_and_never_classified(self):
        def opener(request, timeout):
            if request.full_url.startswith("https://api.github.com/"):
                h = Message()
                h["Location"] = "https://x.actions.githubusercontent.com/log?sig=q"
                raise HTTPError(request.full_url, 302, "Found", h, None)
            return Reply(b"x" * (MAX_LOG_BYTES + 1))
        with self.assertRaises(ValueError):
            download_job_log(34, "fake-token", opener)

    def test_verified_job_classifies_signal_only_without_secrets(self):
        rows = [candidate()]
        private = "ghp_private_value_user@example.test /home/private/data"
        def get_log(job_id, token):
            return private + "\nadb: device offline\n"
        out = analyze(snapshot(rows), evidence(rows, verified={34}),
                      "fake-token", get_log)
        serialized = json.dumps(out, ensure_ascii=False) + markdown_analysis(out)
        self.assertEqual(out["jobs_classified"], 1)
        self.assertEqual(out["results"][0]["signal_ids"], ["android_adb_offline"])
        self.assertEqual(out["results"][0]["classification"], "single_signal_review_needed")
        self.assertFalse(out["raw_log_text_in_artifacts"])
        self.assertFalse(out["root_cause_established"])
        for fragment in ("ghp_private_value", "user@example.test", "/home/private"):
            self.assertNotIn(fragment, serialized)

    def test_unverified_and_tokenless_jobs_never_trigger_log_fetch(self):
        rows = [candidate()]
        call = Mock(side_effect=AssertionError("log access not allowed"))
        for is_verified, token in ((False, "fake"), (True, None)):
            with self.subTest(verified=is_verified, token=token):
                out = analyze(snapshot(rows), evidence(rows, {34} if is_verified else set()),
                              token, call)
                self.assertEqual(out["jobs_classified"], 0)
        call.assert_not_called()

    def test_limit_on_number_of_downloads_and_no_automatic_fixes(self):
        rows = [candidate(34+i) for i in range(MAX_ANALYZED_JOBS + 2)]
        fetch = Mock(return_value="adb: device offline\n")
        out = analyze(snapshot(rows), evidence(rows, {x["job_id"] for x in rows}),
                      "fake-token", fetch)
        self.assertEqual(fetch.call_count, MAX_ANALYZED_JOBS)
        self.assertEqual(out["jobs_classified"], MAX_ANALYZED_JOBS)
        self.assertEqual(sum(x["result"] == "limit_reached" for x in out["results"]), 2)
        self.assertEqual(out["automatic_repairs"], 0)
        self.assertEqual(out["automatic_reruns"], 0)
        self.assertEqual(out["automatic_merges_or_deploys"], 0)

    def test_error_payload_never_leaks_into_report(self):
        rows = [candidate()]
        def leak(job_id, token):
            raise OSError("ghp_private_secret user@private.test")
        out = analyze(snapshot(rows), evidence(rows, {34}), "token", leak)
        serialized = json.dumps(out) + markdown_analysis(out)
        self.assertEqual(out["results"][0]["result"], "log_unavailable")
        self.assertNotIn("ghp_private_secret", serialized)
        self.assertNotIn("user@private.test", serialized)

    def test_invalid_identity_proof_is_rejected_before_reading(self):
        rows = [candidate()]
        good = evidence(rows, {34})
        cases = [
            {"repository": "other/repo"},
            {"commit_sha": "b"*40},
            {"mode": "unknown"},
            {"raw_logs_accessed": True},
            {"verified_jobs": 0},
            {"checked_jobs": 9},
            {"results": [{**good["results"][0], "run_id": 99}]},
            {"results": [{**good["results"][0], "identity_verified": False}]},
        ]
        for change in cases:
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    validate_identity(snapshot(rows), {**good, **change})
        fetch = Mock(side_effect=AssertionError("must not fetch"))
        with self.assertRaises(ValueError):
            analyze(snapshot(rows), {**good, "verified_jobs": 0}, "token", fetch)
        fetch.assert_not_called()

    def test_cli_without_candidates_preserves_report_and_never_needs_token(self):
        rows = []
        with TemporaryDirectory() as folder:
            root = Path(folder)
            di, ids, out, md = [root / name for name in (
                "diagnostics.json", "job-evidence.json", "ci-log-signals.json", "ci-report.md")]
            di.write_text(json.dumps(snapshot(rows)), encoding="utf-8")
            ids.write_text(json.dumps(evidence(rows)), encoding="utf-8")
            md.write_text("# Original report\n", encoding="utf-8")
            proc = subprocess.run(
                [sys.executable, "-m", "scripts.ci_log_safe_analysis",
                 "--diagnostics", str(di), "--identity", str(ids),
                 "--json", str(out), "--markdown", str(md)],
                cwd=Path(__file__).resolve().parents[1],
                env={**os.environ, "GITHUB_TOKEN": ""}, text=True,
                capture_output=True, timeout=20)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(json.loads(out.read_text())["jobs_classified"], 0)
            self.assertIn("# Original report", md.read_text())
            self.assertIn("Sinais de logs verificados", md.read_text())

if __name__ == "__main__":
    unittest.main()
