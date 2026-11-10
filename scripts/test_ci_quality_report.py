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

    def test_token_required(self):
        with self.assertRaises(ValueError):
            get_checks(SHA, "")


if __name__ == "__main__":
    unittest.main()
