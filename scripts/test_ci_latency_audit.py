"""Testes offline e determinísticos da auditoria de latência, sem GitHub remoto."""
import io
import json
import unittest
from scripts.ci_latency_audit import (
    REPO, collect, escape_cell, get_json, markdown,
    percentile_nearest, profile, seconds, summarize,
)

START = "2026-11-11T10:00:00Z"
NEXT = "2026-11-11T10:02:00Z"
END = "2026-11-11T10:05:00Z"


def run(rid=11, event="pull_request", name="Validar selos (Android e Firestore)",
        conclusion="success", branch="feature/a"):
    return {"id": rid, "name": name, "event": event,
            "head_branch": branch, "conclusion": conclusion,
            "run_started_at": START, "updated_at": END}


def job(start=NEXT, end=END, name="Android", conclusion="success"):
    return {"name": name, "started_at": start, "completed_at": end,
            "conclusion": conclusion}


class LatencyAuditTests(unittest.TestCase):
    def test_profile_separates_wait_from_runner_seconds(self):
        x = profile(run(), [job(), job(start=START, end=NEXT, name="Firestore")])
        self.assertEqual(x["wall_sec"], 300)
        self.assertEqual(x["runner_seconds"], 300)
        self.assertEqual(x["critical_job_seconds"], 180)
        self.assertEqual(x["critical_job_wait_to_start_sec"], 120)
        self.assertEqual(x["critical_job"], "Android")
        self.assertIn("dependencias", x["note"])

    def test_skipped_job_does_not_consume_seconds(self):
        out = profile(run(), [
            job(), {"name": "skip", "conclusion": "skipped",
                    "started_at": None, "completed_at": None},
        ])
        self.assertEqual(out["runner_seconds"], 180)

    def test_rejects_incomplete_or_invalid_samples(self):
        for value in (
            {"id": 11, "conclusion": "failure"},
            {"id": "11", "conclusion": "success"},
            {"id": 11, "conclusion": "success", "run_started_at": START},
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                profile(value, [job()])
        for broken in (
            job(conclusion="failure"),
            job(start="2026-11-11T09:00:00Z"),
            job(start="2026-11-11T10:00:00"),
            job(end="bad"),
        ):
            with self.subTest(broken=broken), self.assertRaises(ValueError):
                profile(run(), [broken])
        with self.assertRaises(ValueError):
            profile(run(), [])

    def test_duration_and_nearest_rank_p90(self):
        self.assertEqual(seconds(START, NEXT), 120)
        self.assertEqual(percentile_nearest([1, 2, 3, 4, 5], 90), 5)
        self.assertEqual(percentile_nearest([1, 2, 3, 4, 5], 50), 3)
        with self.assertRaises(ValueError):
            percentile_nearest([], 90)
        self.assertTrue(summarize([])["incomplete"])
        self.assertEqual(summarize([
            {"wall_sec": 100, "runner_seconds": 60,
             "critical_job_wait_to_start_sec": 40},
            {"wall_sec": 200, "runner_seconds": 90,
             "critical_job_wait_to_start_sec": 60},
        ])["wall_median_sec"], 150)

    def test_github_api_is_read_only_and_fixed_scope(self):
        urls = []
        class Response:
            def __enter__(self):
                return io.BytesIO(json.dumps({"workflow_runs": []}).encode())
            def __exit__(self, *args):
                return False
        def fake_open(request, timeout):
            urls.append(request.full_url)
            self.assertEqual(timeout, 20)
            self.assertEqual(request.get_header("Authorization"), "Bearer fake")
            return Response()
        self.assertEqual(
            get_json("actions/runs?event=pull_request&per_page=100",
                     "fake", opener=fake_open)["workflow_runs"], []
        )
        self.assertEqual(len(urls), 1)
        self.assertTrue(urls[0].startswith(
            f"https://api.github.com/repos/{REPO}/actions/runs?"
        ))
        for path in ("../secrets", "actions/runs/11/rerun", "actions/workflows",
                     "actions/runs?branch=main", "actions/runs/11/jobs?per_page=1"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                get_json(path, "fake", opener=fake_open)
        with self.assertRaises(ValueError):
            get_json("actions/runs?event=pull_request&per_page=100", "")

    def test_collect_filters_failed_runs_and_reuses_job_fetch(self):
        codeql = "Revisão automática - CodeQL (Kotlin, JS, Python e Actions)"
        data = {
            "actions/runs?event=pull_request&per_page=100": {
                "workflow_runs": [
                    run(rid=11),
                    run(rid=12, name=codeql),
                    run(rid=14, conclusion="cancelled"),
                ]
            },
            "actions/runs?event=push&branch=main&per_page=100": {
                "workflow_runs": [
                    run(rid=13, event="push", name="Gerar APK do Atrio Catolico",
                        branch="main"),
                    run(rid=15, event="push", name=codeql, branch="main"),
                    run(rid=16, event="push", name=codeql, branch="other"),
                ]
            },
        }
        requested = []
        def fetch(path, token):
            self.assertEqual(token, "fake")
            requested.append(path)
            if path in data:
                return data[path]
            return {"total_count": 1, "jobs": [job()]}
        result = collect("fake", limit=5, fetcher=fetch)
        self.assertEqual(len(result["groups"]), 4)
        self.assertEqual([g["statistics"]["count"] for g in result["groups"].values()],
                         [1, 1, 1, 1])
        self.assertEqual(requested.count("actions/runs/11/jobs?per_page=100"), 1)
        self.assertNotIn("actions/runs/14/jobs?per_page=100", requested)
        self.assertNotIn("actions/runs/16/jobs?per_page=100", requested)
        doc = markdown(result)
        self.assertIn("Mediana total", doc)
        self.assertIn("dependências", doc)
        self.assertIn("https://github.com/", doc)

    def test_input_bounds_and_markdown_sanitization(self):
        for lim in (0, 21, "1", True):
            with self.subTest(limit=lim), self.assertRaises(ValueError):
                collect("fake", limit=lim, fetcher=lambda *args: {})
        self.assertNotIn("<script>", escape_cell("<script>|abc"))
        self.assertIn(r"\|", escape_cell("<script>|abc"))


if __name__ == "__main__":
    unittest.main()
