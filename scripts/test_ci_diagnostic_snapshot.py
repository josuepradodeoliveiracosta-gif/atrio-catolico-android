"""Offline, deterministic diagnostic snapshot tests: no GitHub or cloud access."""
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from scripts.ci_diagnostic_snapshot import (
    digest, markdown_digest, safe_evidence_url, write_digest,
)
from scripts.ci_quality_report import REPO, REQUIRED, report

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

    def test_output_table_is_capped_but_json_retains_all(self):
        data = sample([check(x) for x in REQUIRED] +
                      [check(f"extra-{i}", conclusion="failure") for i in range(23)])
        snap = digest(data)
        self.assertEqual(snap["non_success_count"], 23)
        self.assertIn("Mais 3 checks", markdown_digest(snap))
        self.assertEqual(len(snap["non_success_checks"]), 23)


if __name__ == "__main__":
    unittest.main()
