"""Offline, deterministic diagnostic snapshot tests: no GitHub or cloud access."""
import json
from pathlib import Path
from unittest.mock import patch
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_diagnostic_snapshot import (
    MAX_LOG_JOBS, digest, markdown_digest, safe_evidence_url, write_digest,
)
from scripts.ci_quality_report import REPO, REQUIRED, report
from scripts import ci_quality_report

SHA = "a" * 40
NEW = "b" * 40


def check(name, status="completed", conclusion="success", link=None):
    return {"name": name, "status": status, "conclusion": conclusion,
            "html_url": link or f"https://github.com/{REPO}/actions/runs/1234/job/5678"}


def sample(checks=None):
    result, _ = report(SHA, checks if checks is not None else
                       [check(n) for n in REQUIRED])
    return result


class DiagnosticSnapshotTests(unittest.TestCase):
    def test_approved_checks_do_not_invent_incidents_or_cause(self):
        snap = digest(sample())
        self.assertTrue(snap["all_required_success"])
        self.assertEqual(snap["non_success_count"], 0)
        self.assertEqual(snap["required_blocking"], [])
        self.assertEqual(snap["freshness"], "unknown_without_current_head")
        self.assertIn("não determinada", markdown_digest(snap))

    def test_failure_pending_cancelled_and_missing_are_distinct(self):
        rows = [check(REQUIRED[0], conclusion="failure"),
                check(REQUIRED[1], status="in_progress", conclusion=None),
                check("optional", conclusion="cancelled")]
        snap = digest(sample(rows))
        states = {x["name"]: x["state"] for x in snap["non_success_checks"]}
        self.assertEqual(states[REQUIRED[0]], "failure")
        self.assertEqual(states[REQUIRED[1]], "pending")
        self.assertEqual(states["optional"], "cancelled")
        self.assertEqual(len(snap["required_missing"]), 3)
        self.assertFalse(snap["all_required_success"])

    def test_known_historical_sha_is_never_reported_as_latest(self):
        self.assertEqual(digest(sample(), NEW)["freshness"], "historical_sha")
        self.assertIn("snapshot histórico", markdown_digest(digest(sample(), NEW)))
        self.assertEqual(digest(sample(), SHA)["freshness"], "current_head")

    def test_historical_failure_is_never_suppressed(self):
        snap = digest(sample([check(REQUIRED[0], conclusion="failure")]), NEW)
        self.assertEqual(snap["non_success_checks"][0]["state"], "failure")
        self.assertEqual(snap["freshness"], "historical_sha")

    def test_untrusted_links_rejected_and_escaped(self):
        attacks = ["http://github.com/x", "https://evil.example/", "https://github.com.evil.org/",
                   f"https://github.com/{REPO}/settings/secrets/actions",
                   f"https://github.com/{REPO}/actions/runs/13)evil(",
                   "https://user:password@github.com/x", "javascript:alert(1)"]
        for link in attacks:
            self.assertIsNone(safe_evidence_url(link), link)
        self.assertEqual(safe_evidence_url(f"https://github.com/{REPO}/actions/runs/123/job/456?check_suite_focus=true"),
                         f"https://github.com/{REPO}/actions/runs/123/job/456")
        s = sample([check("<script>|titulo", conclusion="failure", link="https://evil.example/")])
        md = markdown_digest(digest(s))
        self.assertNotIn("<script>", md)
        self.assertNotIn("https://evil.example", md)
        self.assertIn("&lt;script&gt;", md)

    def test_markdown_links_in_check_names_are_not_rendered(self):
        attack = "[urgent](https://evil.example) ![image](https://evil.example/img)"
        snap = digest(sample([check(attack, conclusion="failure")]))
        md = markdown_digest(snap)
        self.assertIn(r"\[urgent\]\(https://evil.example\)", md)
        self.assertNotIn("| [urgent](https://evil.example)", md)

    def test_required_blocking_is_not_merge_approval(self):
        snap = digest(sample())
        self.assertIn("não autoriza merge", markdown_digest(snap))
        snap["all_required_success"] = False
        # status-only output never changes the original report's decision.
        self.assertNotIn("autorizado", markdown_digest(snap))

    def test_bounded_inputs_and_consistency(self):
        for other in [None, "bad", "b" * 39]:
            with self.assertRaises(ValueError):
                digest(sample(), current_head_sha=other) if other is not None else digest({})
        broken = sample()
        broken["all_required_success"] = False
        with self.assertRaises(ValueError):
            digest(broken)
        broken = sample()
        broken["checks"] = broken["checks"] * 150
        with self.assertRaises(ValueError):
            digest(broken)

    def test_write_appends_existing_report_without_duplicate(self):
        data = sample([check(REQUIRED[0], conclusion="failure")])
        with TemporaryDirectory() as d:
            base = Path(d)
            source, output, md = (base / x for x in ("report.json", "digest.json", "ci-report.md"))
            source.write_text(json.dumps(data), encoding="utf-8")
            md.write_text("## Relatório original\n", encoding="utf-8")
            write_digest(source, output, md)
            self.assertIn("## Relatório original", md.read_text(encoding="utf-8"))
            self.assertIn("Síntese de diagnóstico por commit", md.read_text(encoding="utf-8"))
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["commit_sha"], SHA)
            with self.assertRaises(ValueError):
                write_digest(source, output, md)

    def test_real_cli_module_generates_json_and_markdown(self):
        """Execute the workflow's actual entrypoint, not only imported helpers."""
        with TemporaryDirectory() as d:
            root = Path(d)
            src = root / "report.json"
            output = root / "ci-diagnostics.json"
            md = root / "ci-report.md"
            input_data = sample([check(REQUIRED[0], conclusion="failure")])
            src.write_text(json.dumps(input_data), encoding="utf-8")
            md.write_text("## Relatório original\n", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "-m", "scripts.ci_diagnostic_snapshot",
                 "--report-json", str(src),
                 "--output-json", str(output),
                 "--markdown", str(md)],
                cwd=Path(__file__).resolve().parents[1],
                capture_output=True, text=True, timeout=20,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))[
                "non_success_count"], 1)
            self.assertIn("Síntese de diagnóstico por commit",
                          md.read_text(encoding="utf-8"))
            self.assertIn("Relatório original", md.read_text(encoding="utf-8"))

    def test_original_report_and_diagnostic_cli_compose_without_network(self):
        """Exercise both real entrypoints; fake GitHub API read, no production."""
        with TemporaryDirectory() as d:
            folder = Path(d)
            report_json = folder / "ci-report.json"
            snapshot_json = folder / "ci-diagnostics.json"
            markdown = folder / "ci-report.md"
            fake_checks = [check(n) for n in REQUIRED] + [
                check("Test check with failure", conclusion="failure"),
            ]
            argv = ["ci_quality_report", "--sha", SHA,
                    "--json", str(report_json), "--markdown", str(markdown)]
            with patch.object(ci_quality_report, "get_checks",
                              return_value=fake_checks) as fake_api, \
                    patch.object(sys, "argv", argv):
                ci_quality_report.main()
            fake_api.assert_called_once()
            first = json.loads(report_json.read_text(encoding="utf-8"))
            self.assertEqual(first["check_count"], len(fake_checks))
            process = subprocess.run(
                [sys.executable, "-m", "scripts.ci_diagnostic_snapshot",
                 "--report-json", str(report_json),
                 "--output-json", str(snapshot_json),
                 "--markdown", str(markdown)],
                cwd=Path(__file__).resolve().parents[1],
                capture_output=True, text=True, timeout=20,
            )
            self.assertEqual(process.returncode, 0, process.stderr)
            result = json.loads(snapshot_json.read_text(encoding="utf-8"))
            combined = markdown.read_text(encoding="utf-8")
            self.assertEqual(result["commit_sha"], SHA)
            self.assertEqual(result["non_success_count"], 1)
            self.assertIn("## Relatório de CI do commit", combined)
            self.assertIn("## Síntese de diagnóstico por commit", combined)
            self.assertIn("https://github.com/" + REPO, combined)
            self.assertIn("não autoriza merge", combined)

    def test_automatic_triage_recommends_isolated_firestore_review(self):
        checks = [check(n) for n in REQUIRED]
        checks[2] = check(REQUIRED[2], conclusion="failure")
        out = digest(sample(checks))
        self.assertEqual(out["auto_triage"]["failed_checks"], 1)
        self.assertFalse(out["auto_triage"]["root_cause_established"])
        self.assertEqual(out["auto_triage"]["automatic_corrections_executed"], 0)
        item = next(x for x in out["non_success_checks"]
                    if x["name"] == REQUIRED[2])
        self.assertEqual(item["safe_next_step"]["id"], "review_firestore_emulator")
        self.assertIn("emulador", item["safe_next_step"]["guidance"])
        self.assertIn("Orientacao automatica de triagem", markdown_digest(out))

    def test_pending_check_not_claimed_as_failure(self):
        checks = [check(n) for n in REQUIRED]
        checks.append(check("Aguardando", status="in_progress", conclusion=None))
        out = digest(sample(checks))
        self.assertEqual(out["auto_triage"]["failed_checks"], 0)
        self.assertEqual(out["auto_triage"]["pending_checks"], 1)
        self.assertEqual(out["non_success_checks"][0]["safe_next_step"]["id"],
                         "await_check_completion")

    def test_missing_checks_get_context_review_not_false_error(self):
        out = digest(sample([check(REQUIRED[0])]))
        self.assertEqual(out["auto_triage"]["failed_checks"], 0)
        self.assertEqual(len(out["required_review"]), 4)
        self.assertTrue(all(x["safe_next_step"]["id"] == "verify_check_event_scope"
                            for x in out["required_review"]))
        self.assertIn("ausente", markdown_digest(out))

    def test_automatic_triage_does_not_execute_or_authorize_changes(self):
        checks = [check(n) for n in REQUIRED]
        checks[0] = check(REQUIRED[0], conclusion="failure")
        out = digest(sample(checks))
        info = out["auto_triage"]
        self.assertTrue(info["human_approval_required_for_merges_and_deploy"])
        self.assertEqual(info["automatic_corrections_executed"], 0)
        self.assertEqual(out["cause"], "undetermined_not_inferred_from_check_state")
        self.assertEqual(out["non_success_checks"][0]["safe_next_step"]["id"],
                         "review_secret_scan_privately")

    def test_output_table_is_capped_but_json_retains_all(self):
        data = sample([check(x) for x in REQUIRED] +
                      [check(f"extra-{i}", conclusion="failure") for i in range(23)])
        snap = digest(data)
        self.assertEqual(snap["non_success_count"], 23)
        self.assertIn("Mais 3 checks", markdown_digest(snap))
        self.assertEqual(len(snap["non_success_checks"]), 23)


    def test_failed_job_queue_contains_only_ids_without_fetch(self):
        checks = [check(n) for n in REQUIRED] + [
            check("falha relevante", conclusion="failure",
                  link=f"https://github.com/{REPO}/actions/runs/901/job/902"),
            check("timeout", conclusion="timed_out",
                  link=f"https://github.com/{REPO}/actions/runs/903/job/904"),
            check("pendente", status="in_progress", conclusion=None,
                  link=f"https://github.com/{REPO}/actions/runs/905/job/906"),
            check("cancelado", conclusion="cancelled",
                  link=f"https://github.com/{REPO}/actions/runs/907/job/908"),
        ]
        out = digest(sample(checks))["log_review_queue"]
        self.assertEqual(out["total_candidates"], 2)
        self.assertEqual([(c["run_id"], c["job_id"]) for c in out["candidates"]],
                         [(901, 902), (903, 904)])
        self.assertTrue(all(not c["identity_verified"] for c in out["candidates"]))
        self.assertEqual(out["mode"], "metadata_only_no_log_access")
        self.assertFalse(out["automatic_log_download"])
        self.assertFalse(out["root_cause_established"])
        self.assertNotIn("falha relevante", json.dumps(out))
        self.assertIn("verify_run_head_sha", out["required_before_fetch"])

    def test_log_queue_rejects_links_not_exactly_in_repo_or_job(self):
        urls = [
            "https://github.com/another/repo/actions/runs/9/job/10",
            f"https://github.com/{REPO}/actions/runs/9",
            f"https://github.com/{REPO}/actions/runs/9/job/10/more",
            f"https://github.com/{REPO}/actions/runs/0/job/10",
            f"https://github.com/{REPO}/actions/runs/9/job/0",
            f"http://github.com/{REPO}/actions/runs/9/job/10",
            f"https://github.com.evil.test/{REPO}/actions/runs/9/job/10",
            f"https://github.com/{REPO}/actions/runs/9999999999999999999/job/10",
        ]
        out = digest(sample([check(f"bad-{i}", conclusion="failure", link=url)
                             for i, url in enumerate(urls)]))["log_review_queue"]
        self.assertEqual(out["total_candidates"], 0)
        self.assertEqual(out["failed_checks_without_job_link"], len(urls))
        self.assertEqual(out["candidates"], [])

    def test_log_queue_deduplicates_and_caps_without_leaking_metadata(self):
        checks = [check(f"failed-{i}", conclusion="failure",
                        link=f"https://github.com/{REPO}/actions/runs/123/job/{1000+i}")
                  for i in range(MAX_LOG_JOBS + 5)]
        checks.append(check("duplicate", conclusion="failure",
                            link=f"https://github.com/{REPO}/actions/runs/123/job/1000"))
        out = digest(sample(checks))
        queue = out["log_review_queue"]
        self.assertEqual(queue["total_candidates"], MAX_LOG_JOBS + 5)
        self.assertEqual(len(queue["candidates"]), MAX_LOG_JOBS)
        self.assertTrue(queue["truncated"])
        self.assertIn("Nenhum download de log foi habilitado", markdown_digest(out))
        self.assertNotIn("duplicate", json.dumps(queue))


if __name__ == "__main__":
    unittest.main()
