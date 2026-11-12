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

    def test_end_to_end_report_to_safe_log_signal_with_mocked_metadata(self):
        """Real pure pipeline functions; simulated GitHub and sanitized log."""
        from scripts.ci_quality_report import REQUIRED, report
        from scripts.ci_diagnostic_snapshot import digest
        from scripts.ci_log_identity_verifier import verify
        url = f"https://github.com/{REPO}/actions/runs/12/job/34"
        checks = [{"name": n, "status": "completed", "conclusion": "success"}
                  for n in REQUIRED]
        checks[0] = {**checks[0], "conclusion": "failure", "details_url": url,
                     "html_url": f"https://github.com/{REPO}/runs/99"}
        report_json, _ = report(SHA, checks)
        queue = digest(report_json)
        self.assertEqual(queue["log_review_queue"]["total_candidates"], 1)
        self.assertFalse(queue["all_required_success"])

        api_calls = []
        def fake_metadata(path, token):
            api_calls.append(path)
            if path == "/runs/12":
                return {"id": 12, "head_sha": SHA, "status": "completed",
                        "run_attempt": 1, "repository": {"full_name": REPO},
                        "head_repository": {"full_name": REPO}}
            if path == "/jobs/34":
                return {"id": 34, "run_id": 12, "head_sha": SHA,
                        "status": "completed", "conclusion": "failure"}
            raise AssertionError("Unexpected API call")
        proof = verify(queue, "synthetic-token", fake_metadata)
        self.assertEqual(api_calls, ["/runs/12", "/jobs/34"])
        self.assertEqual(proof["verified_jobs"], 1)
        read = Mock(return_value=(
            "private@example.test token=private_secret\n"
            "adb: device offline\n"))
        result = analyze(queue, proof, "synthetic-token", read)
        self.assertEqual(read.call_count, 1)
        self.assertEqual(result["jobs_classified"], 1)
        self.assertEqual(result["results"][0]["signal_ids"], ["android_adb_offline"])
        artifact = json.dumps(result) + markdown_analysis(result)
        self.assertNotIn("private@example.test", artifact)
        self.assertNotIn("private_secret", artifact)
        self.assertFalse(result["root_cause_established"])
        self.assertEqual(result["automatic_merges_or_deploys"], 0)

    def test_end_to_end_sha_mismatch_fails_closed_without_log_read(self):
        from scripts.ci_quality_report import REQUIRED, report
        from scripts.ci_diagnostic_snapshot import digest
        from scripts.ci_log_identity_verifier import verify
        url = f"https://github.com/{REPO}/actions/runs/12/job/34"
        checks = [{"name": n, "status": "completed", "conclusion": "success"}
                  for n in REQUIRED]
        checks[1] = {**checks[1], "conclusion": "failure", "details_url": url}
        output, _ = report(SHA, checks)
        queue = digest(output)
        def metadata(path, token):
            if path == "/runs/12":
                return {"id": 12, "head_sha": "b" * 40, "status": "completed",
                        "run_attempt": 1, "repository": {"full_name": REPO},
                        "head_repository": {"full_name": REPO}}
            return {"id": 34, "run_id": 12, "head_sha": SHA,
                    "status": "completed", "conclusion": "failure"}
        proof = verify(queue, "synthetic-token", metadata)
        self.assertEqual(proof["results"][0]["verdict"], "rejected_run_sha")
        fetch = Mock(side_effect=AssertionError("should never request log"))
        result = analyze(queue, proof, "synthetic-token", fetch)
        fetch.assert_not_called()
        self.assertEqual(result["jobs_classified"], 0)
        self.assertFalse(result["raw_log_text_in_artifacts"])



    def test_qa_full_cli_pipeline_generates_expected_artifacts_without_logs(self):
        """Exercise actual sequential CLI entrypoints, without GitHub credentials.

        Report collection alone is simulated; all downstream scripts run as
        subprocesses, mirroring workflow order and artifact filenames.
        """
        from scripts.ci_quality_report import REQUIRED, report
        for failed in (False, True):
            with self.subTest(failed=failed), TemporaryDirectory() as folder:
                root = Path(folder)
                report_json = root / "ci-report.json"
                digest_json = root / "ci-diagnostics.json"
                identity_json = root / "ci-job-evidence.json"
                signals_json = root / "ci-log-signals.json"
                markdown = root / "ci-report.md"
                checks = [{"name": name, "status": "completed", "conclusion": "success"}
                          for name in REQUIRED]
                if failed:
                    checks[0] = {
                        **checks[0], "conclusion": "failure",
                        "details_url": f"https://github.com/{REPO}/actions/runs/12/job/34",
                    }
                original, original_md = report(SHA, checks)
                report_json.write_text(json.dumps(original), encoding="utf-8")
                markdown.write_text(original_md, encoding="utf-8")
                commands = (
                    ["scripts.ci_diagnostic_snapshot",
                     "--report-json", str(report_json),
                     "--output-json", str(digest_json), "--markdown", str(markdown)],
                    ["scripts.ci_log_identity_verifier",
                     "--diagnostics", str(digest_json),
                     "--json", str(identity_json), "--markdown", str(markdown)],
                    ["scripts.ci_log_safe_analysis",
                     "--diagnostics", str(digest_json),
                     "--identity", str(identity_json),
                     "--json", str(signals_json), "--markdown", str(markdown)],
                )
                for args in commands:
                    run = subprocess.run(
                        [sys.executable, "-m", *args],
                        cwd=Path(__file__).resolve().parents[1],
                        env={**os.environ, "GITHUB_TOKEN": ""},
                        capture_output=True, text=True, timeout=20)
                    self.assertEqual(run.returncode, 0, run.stderr)
                self.assertTrue(all(path.is_file() for path in (
                    report_json, digest_json, identity_json, signals_json, markdown)))
                digest_data = json.loads(digest_json.read_text(encoding="utf-8"))
                identity_data = json.loads(identity_json.read_text(encoding="utf-8"))
                signals_data = json.loads(signals_json.read_text(encoding="utf-8"))
                self.assertEqual(digest_data["log_review_queue"]["total_candidates"],
                                 1 if failed else 0)
                self.assertEqual(identity_data["checked_jobs"], 1 if failed else 0)
                self.assertEqual(identity_data["verified_jobs"], 0)
                self.assertEqual(signals_data["jobs_classified"], 0)
                self.assertFalse(signals_data["raw_log_text_in_artifacts"])
                self.assertEqual(signals_data["automatic_merges_or_deploys"], 0)
                report_md = markdown.read_text(encoding="utf-8")
                self.assertIn("Relatório de CI do commit", report_md)
                self.assertIn("Síntese de diagnóstico por commit", report_md)
                self.assertIn("Identidade de jobs do CI", report_md)
                self.assertIn("Sinais de logs verificados", report_md)



    def test_historical_replay_synthetic_contract_keeps_required_success(self):
        """The known failed job is optional; no fake failure of required gates."""
        from scripts.ci_quality_report import REQUIRED, report
        from scripts.ci_diagnostic_snapshot import digest
        from scripts.ci_log_identity_verifier import verify
        historical_sha = "e046f3c3609b8fee5e7b0064646ec174ab3ca2d3"
        run_id, job_id = 42866978165, 130007825671
        checks = [{"name": name, "status": "completed", "conclusion": "success"}
                  for name in REQUIRED]
        checks.append({
            "name": "Testar telas do Átrio — profiles",
            "status": "completed", "conclusion": "failure",
            "details_url": f"https://github.com/{REPO}/actions/runs/{run_id}/job/{job_id}",
        })
        raw_report, _ = report(historical_sha, checks)
        self.assertTrue(raw_report["all_required_success"])
        summary = digest(raw_report)
        self.assertEqual(summary["log_review_queue"]["total_candidates"], 1)
        calls = []
        def metadata(path, token):
            calls.append(path)
            if path == f"/runs/{run_id}":
                return {"id": run_id, "head_sha": historical_sha,
                        "status": "completed", "run_attempt": 1,
                        "repository": {"full_name": REPO},
                        "head_repository": {"full_name": REPO}}
            if path == f"/jobs/{job_id}":
                return {"id": job_id, "run_id": run_id,
                        "head_sha": historical_sha,
                        "status": "completed", "conclusion": "failure",
                        "run_attempt": 1}
            raise AssertionError("unexpected metadata endpoint")
        proof = verify(summary, "dummy-token", metadata)
        self.assertEqual(calls, [f"/runs/{run_id}", f"/jobs/{job_id}"])
        self.assertEqual(proof["verified_jobs"], 1)
        classified = analyze(
            summary, proof, "dummy-token",
            lambda _job, _token: ("adb: device offline\n"
                                  "ComposeTimeoutException: Condition still not satisfied\n"))
        self.assertEqual(classified["jobs_classified"], 1)
        self.assertEqual(set(classified["results"][0]["signal_ids"]),
                         {"android_adb_offline", "android_compose_timeout"})
        self.assertFalse(classified["root_cause_established"])
        self.assertEqual(classified["automatic_merges_or_deploys"], 0)

    def test_historical_replay_is_opt_in_pinned_and_read_only(self):
        workflow = (Path(__file__).resolve().parents[1] /
                    ".github/workflows/ci-quality-report.yml").read_text(encoding="utf-8")
        self.assertIn("qa_historical_replay:", workflow)
        self.assertIn("default: false", workflow)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertEqual(workflow.count("      - Revisão automática - CodeQL"), 1)
        self.assertNotIn("contents: write", workflow)
        self.assertNotIn("pull-requests: write", workflow)
        self.assertNotIn("secrets.", workflow)
        self.assertIn('CI_QA_HISTORICAL_REPLAY: ${{ inputs.qa_historical_replay', workflow)
        self.assertIn('CI_TARGET_SHA="e046f3c3609b8fee5e7b0064646ec174ab3ca2d3"',
                      workflow)
        self.assertIn('CI_REF_NAME" != "feat/qa-diagnostics-integration-20261112"',
                      workflow)

    def test_replay_branch_guard_executes_without_api_or_production(self):
        """Execute exact shell guard from YAML, never the networked commands."""
        workflow = (Path(__file__).resolve().parents[1] /
                    ".github/workflows/ci-quality-report.yml").read_text(encoding="utf-8")
        segment = workflow.split(
            "        run: |\n          set -euo pipefail\n", 1)
        self.assertEqual(len(segment), 2)
        before_report = segment[1].split(
            "          python3 scripts/ci_quality_report.py", 1)[0]
        self.assertIn('if [[ "$CI_QA_HISTORICAL_REPLAY" == "true" ]]', before_report)
        shell = "set -euo pipefail\n" + "\n".join(
            line[10:] if line.startswith("          ") else line
            for line in before_report.rstrip("\n").splitlines()) + (
                '\nprintf "%s" "$CI_TARGET_SHA"\n')
        cases = (
            ("true", "workflow_dispatch",
             "feat/qa-diagnostics-integration-20261112", True, True),
            ("true", "workflow_dispatch", "main", False, False),
            ("true", "workflow_run",
             "feat/qa-diagnostics-integration-20261112", False, False),
            ("false", "workflow_dispatch", "main", True, False),
            ("false", "workflow_run", "main", True, False),
        )
        for enabled, event, ref, success, historical in cases:
            with self.subTest(enabled=enabled, event=event, ref=ref):
                done = subprocess.run(
                    ["bash", "-c", shell],
                    env={**os.environ,
                         "CI_QA_HISTORICAL_REPLAY": enabled,
                         "CI_EVENT_NAME": event,
                         "CI_REF_NAME": ref,
                         "CI_TARGET_SHA": SHA},
                    text=True, capture_output=True, timeout=5)
                self.assertEqual(done.returncode == 0, success)
                if success:
                    expected = ("e046f3c3609b8fee5e7b0064646ec174ab3ca2d3"
                                if historical else SHA)
                    self.assertTrue(done.stdout.rstrip().endswith(expected))
                self.assertNotIn("synthetic-token", done.stdout)

if __name__ == "__main__":
    unittest.main()
