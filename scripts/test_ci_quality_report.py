"""Testes puros, sem chamar APIs de GitHub ou Firebase."""
import io
import json
import unittest
from scripts.ci_quality_report import REQUIRED, validate_sha, state_for, report, get_checks

SHA = "a" * 40


def check(name, status="completed", conclusion="success"):
    return {"name": name, "status": status, "conclusion": conclusion}


class CiReportTests(unittest.TestCase):
    def test_sha_untrusted_rejected(self):
        for value in ("", "main", "a" * 39, "../main", "a" * 40 + "?"):
            with self.assertRaises(ValueError):
                validate_sha(value)

    def test_all_required_success(self):
        report_json, md = report(SHA, [check(x) for x in REQUIRED])
        self.assertTrue(report_json["all_required_success"])
        self.assertEqual(report_json["commit_sha"], SHA)
        self.assertEqual(report_json["check_count"], 5)
        self.assertIn("passaram", md)

    def test_missing_checks_are_not_approved(self):
        obj, md = report(SHA, [check(REQUIRED[0])])
        self.assertFalse(obj["all_required_success"])
        self.assertEqual(obj["required_checks"][REQUIRED[-1]], "missing")
        self.assertIn("Não autoriza merge", md)

    def test_cancelled_skipped_failed_and_pending(self):
        for conclusion in ("failure", "cancelled", "skipped", "neutral"):
            self.assertEqual(state_for([check("x", conclusion=conclusion)]),
                             "not-success")
        self.assertEqual(
            state_for([check("x", status="in_progress", conclusion=None)]),
            "pending",
        )

    def test_markup_is_escaped(self):
        _, md = report(SHA, [check("<script>x</script>|bad")])
        self.assertNotIn("<script>", md)

    def test_timing_uses_only_completed_github_action_checks(self):
        samples = [
            {**check("Android"), "app": {"slug": "github-actions"},
             "started_at": "2026-11-11T10:00:00Z",
             "completed_at": "2026-11-11T10:02:20Z"},
            {**check("<script>|CodeQL"), "app": {"slug": "github-actions"},
             "started_at": "2026-11-11T10:00:00Z",
             "completed_at": "2026-11-11T10:03:10Z"},
            {**check("Dependabot"), "app": {"slug": "dependabot"},
             "started_at": "2026-11-11T10:00:00Z",
             "completed_at": "2026-11-11T10:10:00Z"},
            {**check("pending", status="in_progress", conclusion=None),
             "app": {"slug": "github-actions"},
             "started_at": "2026-11-11T10:00:00Z",
             "completed_at": "2026-11-11T10:05:00Z"},
            {**check("bad"), "app": {"slug": "github-actions"},
             "started_at": "no-date",
             "completed_at": "2026-11-11T10:05:00Z"},
        ]
        output, md = report(SHA, samples)
        self.assertEqual(output["timing"]["measured_checks"], 2)
        self.assertEqual(output["timing"]["sum_check_seconds"], 330)
        self.assertEqual(output["timing"]["longest_checks"][0]["seconds"], 190)
        self.assertIn("Dados por check nao equivalem a minutos cobraveis", md)
        self.assertNotIn("<script>", md)
        self.assertIn("&lt;script&gt;", md)

    def test_timing_rejects_missing_timezone_negative_and_excessive(self):
        from scripts.ci_quality_report import duration_seconds
        sample = {**check("x"), "started_at": "2026-11-11T00:00:00Z",
                  "completed_at": "2026-11-11T00:00:30Z"}
        self.assertEqual(duration_seconds(sample), 30)
        for patch in (
            {"completed_at": "2026-11-10T23:00:00Z"},
            {"completed_at": "2026-11-13T01:00:00Z"},
            {"started_at": "2026-11-11T00:00:00"},
            {"completed_at": None},
            {"status": "in_progress"},
        ):
            self.assertIsNone(duration_seconds({**sample, **patch}))


    def test_api_pagination_and_fixed_host(self):
        urls = []
        class Response:
            def __init__(self, batch): self.batch = batch
            def __enter__(self):
                return io.BytesIO(json.dumps({"check_runs": self.batch}).encode())
            def __exit__(self, *args): return False
        def opener(req, timeout):
            self.assertEqual(timeout, 20)
            urls.append(req.full_url)
            return Response([check("x")] * (100 if req.full_url.endswith("&page=1") else 1))
        result = get_checks(SHA, "synthetic", opener=opener)
        self.assertEqual(len(result), 101)
        self.assertEqual(len(urls), 2)
        for url in urls:
            self.assertTrue(url.startswith(
                "https://api.github.com/repos/"
                "josuepradodeoliveiracosta-gif/atrio-catolico-android/"
                f"commits/{SHA}/check-runs?"
            ))

    def test_actions_job_details_url_survives_summary_instead_of_check_page(self):
        from scripts.ci_diagnostic_snapshot import digest
        job_url = ("https://github.com/"
                   "josuepradodeoliveiracosta-gif/atrio-catolico-android/"
                   "actions/runs/43266597809/job/131346880328")
        generic_check_page = ("https://github.com/"
                              "josuepradodeoliveiracosta-gif/atrio-catolico-android/"
                              "runs/10203040")
        checks = [check(x) for x in REQUIRED]
        checks[0] = {**check(REQUIRED[0], conclusion="failure"),
                     "details_url": job_url, "html_url": generic_check_page,
                     "app": {"slug": "github-actions"}}
        output, _ = report(SHA, checks)
        self.assertEqual(output["checks"][0]["details_url"], job_url)
        queue = digest(output)["log_review_queue"]
        self.assertEqual(queue["total_candidates"], 1)
        self.assertEqual(queue["candidates"][0]["run_id"], 43266597809)
        self.assertEqual(queue["candidates"][0]["job_id"], 131346880328)
        self.assertFalse(queue["automatic_log_download"])

    def test_link_fallback_and_external_details_cannot_trigger_log_scan(self):
        from scripts.ci_diagnostic_snapshot import digest
        safe_url = ("https://github.com/"
                    "josuepradodeoliveiracosta-gif/atrio-catolico-android/"
                    "runs/10203040")
        checks = [check(x) for x in REQUIRED]
        checks[0] = {**check(REQUIRED[0], conclusion="failure"),
                     "details_url": "https://outside.example/unsafe",
                     "html_url": safe_url}
        checks[1] = {**check(REQUIRED[1], conclusion="failure"),
                     "html_url": safe_url}
        data, _ = report(SHA, checks)
        self.assertEqual(data["checks"][0]["details_url"],
                         "https://outside.example/unsafe")
        self.assertEqual(data["checks"][1]["details_url"], safe_url)
        self.assertEqual(digest(data)["log_review_queue"]["total_candidates"], 0)

    def test_token_required(self):
        with self.assertRaises(ValueError):
            get_checks(SHA, "")


if __name__ == "__main__":
    unittest.main()
