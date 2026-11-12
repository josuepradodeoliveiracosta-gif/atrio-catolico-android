"""Offline checks for a future PR-draft manifest with zero GitHub writes."""
from copy import deepcopy
import io
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from unittest.mock import patch
import unittest

from scripts.ci_autofix_handoff import handoff
from scripts.ci_autofix_pr_draft_plan import (
    BASE_BRANCH, BRANCH_NAME, MAX_REMOTE_RESPONSE_BYTES, STATIC_TITLE,
    _get_api, draft_pr_plan, fetch_live_pr_context,
)
from scripts.test_ci_autofix_handoff import sample
from scripts.ci_quality_report import NoRedirect, REPO

ROOT = Path(__file__).resolve().parents[1]
SHA = "a" * 40


def good_handoff():
    a, b, c = sample()
    return handoff(a, b, c, "push", "main", ROOT)


def live(sha=SHA, duplicates=(), branch_exists=False):
    return {"main_sha": sha, "duplicate_pr_numbers": list(duplicates),
            "target_branch_exists": branch_exists}


class DraftPlanTests(unittest.TestCase):
    def test_verified_evidence_and_fresh_main_returns_nonwriting_draft_descriptor(self):
        candidate = good_handoff()
        plan = draft_pr_plan(candidate, ROOT, live())
        self.assertEqual(plan["status"], "draft_pr_descriptor_ready_for_review")
        self.assertEqual(plan["base_branch"], BASE_BRANCH)
        self.assertEqual(plan["head_branch"], BRANCH_NAME)
        self.assertEqual(plan["draft_pr_title"], STATIC_TITLE)
        self.assertIn(SHA, plan["draft_pr_body"])
        self.assertTrue(plan["live_main_sha_checked"])
        self.assertTrue(plan["target_branch_absence_checked"])
        self.assertTrue(plan["candidate_patch_verified"])
        self.assertTrue(plan["race_window_remains"])
        self.assertTrue(plan["draft_only"])
        self.assertFalse(plan["draft_pr_created"])
        self.assertFalse(plan["eligible_for_automatic_remote_write"])
        self.assertEqual(plan["changes_to_checkout"], 0)
        self.assertEqual(plan["remote_writes"], 0)
        self.assertEqual(plan["merges_or_deploys"], 0)
        self.assertTrue(plan["human_approval_required_before_merge"])
        self.assertIsNone(plan["current_automation_percent_measured"])
        self.assertEqual(plan["premerge_ci_validation"], "required_not_yet_verified")

    def test_stale_main_sha_fails_closed(self):
        plan = draft_pr_plan(good_handoff(), ROOT, live("b" * 40))
        self.assertEqual(plan["status"], "blocked_stale_main_head")
        self.assertTrue(plan["live_main_sha_checked"])
        self.assertIsNone(plan["draft_pr_title"])
        self.assertFalse(plan["draft_pr_created"])

    def test_open_duplicate_head_branch_blocks_and_deduplicates_numbers(self):
        result = draft_pr_plan(good_handoff(), ROOT, live(duplicates=(44, 44, 10)))
        self.assertEqual(result["status"], "blocked_existing_pr")
        self.assertEqual(result["duplicate_pr_numbers"], [10, 44])
        self.assertIsNone(result["draft_pr_body"])

    def test_unreviewed_preexisting_branch_blocks_even_without_open_pr(self):
        plan = draft_pr_plan(good_handoff(), ROOT, live(branch_exists=True))
        self.assertEqual(plan["status"], "blocked_existing_branch")
        self.assertTrue(plan["target_branch_absence_checked"])
        self.assertIsNone(plan["draft_pr_body"])
        self.assertFalse(plan["draft_pr_created"])

    def test_unverified_live_main_or_missing_live_context_blocks(self):
        result = draft_pr_plan(good_handoff(), ROOT)
        self.assertEqual(result["status"], "blocked_live_context_unavailable")
        self.assertFalse(result["live_main_sha_checked"])
        self.assertFalse(result["draft_pr_created"])
        for malformed in ({}, {"main_sha": "../main", "duplicate_pr_numbers": [],
                               "target_branch_exists": False},
                          {"main_sha": SHA, "duplicate_pr_numbers": [True],
                           "target_branch_exists": False},
                          {"main_sha": SHA, "duplicate_pr_numbers": None,
                           "target_branch_exists": False},
                          {"main_sha": SHA, "duplicate_pr_numbers": [],
                           "target_branch_exists": "false"},
                          {"main_sha": SHA, "duplicate_pr_numbers": []}):
            with self.subTest(context=malformed), self.assertRaises(ValueError):
                draft_pr_plan(good_handoff(), ROOT, malformed)

    def test_blocked_handoff_never_needs_live_network(self):
        a, b, c = sample()
        for event, branch in (("pull_request", "main"), ("push", "feature/x"),
                              ("unknown", "main")):
            item = handoff(a, b, c, event, branch, ROOT)
            result = draft_pr_plan(item, ROOT)
            self.assertEqual(result["status"], "blocked_by_handoff")
            self.assertFalse(result["candidate_patch_verified"])

    def test_forged_provenance_and_action_flags_are_rejected(self):
        for field, bad in (
            ("repository", "other/repo"),
            ("schema_version", "1"),
            ("mode", "remote_pr_writer"),
            ("patch_id", "unknown"),
            ("reviewed_file", "../other.py"),
            ("review_intent_only", False),
            ("permission_to_write_repo", True),
            ("current_pr_head_verified", True),
            ("production_access", True),
            ("measured_automation_percent", 99),
            ("automatic_pull_requests_created", 1),
            ("automatic_repairs_executed", True),
            ("merges_or_deploys", 1),
            ("source_sha256", "b" * 64),
            ("patched_sha256", "x" * 64),
            ("regression_validation", "passed_without_ci"),
            ("draft_pr_intent_id", "forged"),
        ):
            with self.subTest(field=field):
                obj = deepcopy(good_handoff())
                obj[field] = bad
                with self.assertRaises(ValueError):
                    draft_pr_plan(obj, ROOT, live())

    def test_duplicate_query_only_reads_fixed_host_and_drops_untrusted_body(self):
        seen = []
        open_prs = [
            {"number": 18, "state": "open",
             "head": {"ref": BRANCH_NAME, "repo": {"full_name": REPO}},
             "base": {"ref": "main"}, "title": "secret=do-not-copy",
             "body": "ghp_fake_private_token"},
            {"number": 19, "state": "open",
             "head": {"ref": BRANCH_NAME, "repo": {"full_name": "outside/repo"}},
             "base": {"ref": "main"}},
            {"number": 20, "state": "open",
             "head": {"ref": "different", "repo": {"full_name": REPO}},
             "base": {"ref": "main"}},
        ]
        def opener(req, timeout):
            self.assertEqual(timeout, 20)
            self.assertEqual(req.get_header("Authorization"), "Bearer demo-token")
            self.assertTrue(req.full_url.startswith(
                "https://api.github.com/repos/" + REPO + "/"))
            seen.append(req.full_url)
            if "/git/ref/heads/" in req.full_url:
                raise HTTPError(req.full_url, 404, "Not Found", {}, None)
            payload = ({"commit": {"sha": SHA}} if "/branches/main" in req.full_url
                       else open_prs)
            return io.BytesIO(json.dumps(payload).encode("utf-8"))
        result = fetch_live_pr_context("demo-token", opener=opener)
        self.assertEqual(result, {"main_sha": SHA, "duplicate_pr_numbers": [18],
                                  "target_branch_exists": False})
        self.assertEqual(len(seen), 3)
        self.assertTrue(seen[1].endswith("/pulls?state=open&per_page=10&page=1"))
        self.assertTrue(seen[2].endswith("/git/ref/heads/" + BRANCH_NAME))
        self.assertNotIn("private_token", json.dumps(result))
        p = draft_pr_plan(good_handoff(), ROOT, result)
        self.assertEqual(p["status"], "blocked_existing_pr")

    def test_paginated_prs_over_one_mb_total_find_later_draft(self):
        """Many open PRs must fit bounded pages without skipping QA branch."""
        from scripts.ci_autofix_pr_draft_plan import MAX_OPEN_PR_PAGE_SIZE
        self.assertEqual(MAX_OPEN_PR_PAGE_SIZE, 10)
        entries = [
            {"number": 1000 + i, "state": "open",
             "head": {"ref": "other-" + str(i),
                      "repo": {"full_name": REPO}},
             "base": {"ref": "main"},
             "body": "x" * 30000}
            for i in range(42)
        ]
        entries[-1]["number"] = 261
        entries[-1]["head"]["ref"] = BRANCH_NAME
        requested_pages = []

        def opener(req, timeout):
            self.assertEqual(timeout, 20)
            self.assertEqual(req.get_method(), "GET")
            if "/branches/main" in req.full_url:
                response = {"commit": {"sha": SHA}}
            elif "/pulls?state=open&per_page=10&page=" in req.full_url:
                page = int(req.full_url.rsplit("page=", 1)[1])
                requested_pages.append(page)
                response = entries[(page-1)*10:page*10]
            elif "/git/ref/heads/" + BRANCH_NAME in req.full_url:
                response = {"ref": "refs/heads/" + BRANCH_NAME}
            else:
                self.fail("endpoint inesperado: " + req.full_url)
            raw = json.dumps(response).encode("utf-8")
            self.assertLess(len(raw), MAX_REMOTE_RESPONSE_BYTES)
            return io.BytesIO(raw)

        self.assertGreater(len(json.dumps(entries).encode("utf-8")),
                           MAX_REMOTE_RESPONSE_BYTES)
        result = fetch_live_pr_context("offline-token", opener)
        self.assertEqual(result, {
            "main_sha": SHA, "duplicate_pr_numbers": [261],
            "target_branch_exists": True,
        })
        self.assertEqual(requested_pages, [1, 2, 3, 4, 5])
        self.assertNotIn("xxx", json.dumps(result))

    def test_pagination_fails_closed_on_hundred_or_repeated_prs(self):
        """Do not silently accept extra pages, duplicate rows or invalid shapes."""
        entries = [
            {"number": i + 1, "state": "open",
             "head": {"ref": "other", "repo": {"full_name": REPO}},
             "base": {"ref": "main"}}
            for i in range(100)
        ]
        def run_with(rows):
            def opener(req, timeout):
                if "/branches/main" in req.full_url:
                    value = {"commit": {"sha": SHA}}
                elif "/pulls?state=open&per_page=10&page=" in req.full_url:
                    page = int(req.full_url.rsplit("page=", 1)[1])
                    value = rows[(page-1)*10:page*10]
                else:
                    value = {"ref": "refs/heads/" + BRANCH_NAME}
                return io.BytesIO(json.dumps(value).encode("utf-8"))
            return fetch_live_pr_context("offline-token", opener)
        with self.assertRaises(ValueError):
            run_with(entries)
        repeated = entries[:11]
        repeated[-1] = dict(repeated[-1], number=repeated[0]["number"])
        with self.assertRaises(ValueError):
            run_with(repeated)

    def test_no_token_invalid_response_page_limit_and_redirect_policy(self):
        with self.assertRaises(ValueError):
            fetch_live_pr_context("")
        def opener(req, timeout):
            payload = {"commit": {"sha": SHA}} if "/branches/main" in req.full_url else [0] * 100
            return io.BytesIO(json.dumps(payload).encode("utf-8"))
        with self.assertRaises(ValueError):
            fetch_live_pr_context("demo", opener)
        def oversized(req, timeout):
            return io.BytesIO(b"x" * (MAX_REMOTE_RESPONSE_BYTES + 1))
        with self.assertRaises(ValueError):
            fetch_live_pr_context("demo", oversized)
        def no_branch(req, timeout):
            return io.BytesIO(b"{}")
        with self.assertRaises(ValueError):
            fetch_live_pr_context("demo", no_branch)
        def branch_exists(req, timeout):
            if "/branches/main" in req.full_url:
                return io.BytesIO(json.dumps({"commit": {"sha": SHA}}).encode())
            if "/git/ref/heads/" in req.full_url:
                return io.BytesIO(json.dumps(
                    {"ref": "refs/heads/" + BRANCH_NAME}).encode())
            return io.BytesIO(b"[]")
        self.assertTrue(fetch_live_pr_context("demo", branch_exists)[
            "target_branch_exists"])
        self.assertEqual(
            draft_pr_plan(good_handoff(), ROOT, live(branch_exists=True))[
                "status"], "blocked_existing_branch")
        def forbidden_branch(req, timeout):
            if "/branches/main" in req.full_url:
                return io.BytesIO(json.dumps({"commit": {"sha": SHA}}).encode())
            if "/git/ref/heads/" in req.full_url:
                raise HTTPError(req.full_url, 403, "Forbidden", {}, None)
            return io.BytesIO(b"[]")
        with self.assertRaises(HTTPError):
            fetch_live_pr_context("demo", forbidden_branch)
        def unknown_ref(req, timeout):
            if "/branches/main" in req.full_url:
                return io.BytesIO(json.dumps({"commit": {"sha": SHA}}).encode())
            if "/git/ref/heads/" in req.full_url:
                return io.BytesIO(b'{"ref":"refs/heads/other-branch"}')
            return io.BytesIO(b"[]")
        with self.assertRaises(ValueError):
            fetch_live_pr_context("demo", unknown_ref)
        with patch("scripts.ci_autofix_pr_draft_plan.build_opener") as builder:
            def no_branch(req, timeout):
                if "/branches/main" in req.full_url:
                    return io.BytesIO(json.dumps({"commit": {"sha": SHA}}).encode())
                if "/git/ref/heads/" in req.full_url:
                    raise HTTPError(req.full_url, 404, "Not Found", {}, None)
                return io.BytesIO(b"[]")
            builder.return_value.open.side_effect = no_branch
            got = fetch_live_pr_context("demo")
            self.assertEqual(got["main_sha"], SHA)
            self.assertFalse(got["target_branch_exists"])
            builder.assert_called_once_with(NoRedirect)

    def test_http_errors_close_stream_and_only_404_is_absent_branch(self):
        """Read-only preflight must close error bodies without masking 403."""
        for status, allow_not_found in (
                (404, True), (404, False), (403, True), (403, False)):
            with self.subTest(status=status, allow_not_found=allow_not_found):
                stream = io.BytesIO(b"error body must not leak")
                error = HTTPError(
                    "https://api.github.com/mock", status,
                    "simulated HTTP error", {}, stream)
                requests = []

                def opener(req, timeout):
                    requests.append((req.get_method(), req.full_url, timeout))
                    raise error

                path = "/git/ref/heads/" + BRANCH_NAME
                if status == 404 and allow_not_found:
                    self.assertIsNone(_get_api(
                        path, "offline-token", opener,
                        allow_not_found=allow_not_found))
                else:
                    with self.assertRaises(HTTPError) as caught:
                        _get_api(
                            path, "offline-token", opener,
                            allow_not_found=allow_not_found)
                    self.assertIs(caught.exception, error)
                    self.assertEqual(caught.exception.code, status)
                self.assertTrue(error.closed)
                self.assertTrue(stream.closed)
                self.assertEqual(requests, [(
                    "GET", "https://api.github.com/repos/" + REPO + path,
                    20)])

    def test_report_workflow_only_grants_read_permissions(self):
        text = (ROOT / ".github/workflows/ci-quality-report.yml").read_text(
            encoding="utf-8")
        permissions = text.split("permissions:", 1)[1].split("\njobs:", 1)[0]
        self.assertIn("contents: read", permissions)
        self.assertIn("checks: read", permissions)
        self.assertIn("actions: read", permissions)
        self.assertIn("pull-requests: read", permissions)
        self.assertNotIn(": write", permissions)
        self.assertIn("ci-autofix-pr-draft-plan.json", text)
        self.assertIn("scripts.ci_autofix_pr_draft_plan", text)

    def test_cli_blocked_handoff_does_not_need_token_or_write_repo(self):
        a, b, c = sample()
        blocked = handoff(a, b, c, "pull_request", "main", ROOT)
        with TemporaryDirectory() as directory:
            src = Path(directory) / "handoff.json"
            dst = Path(directory) / "draft-plan.json"
            src.write_text(json.dumps(blocked), encoding="utf-8")
            proc = subprocess.run(
                [sys.executable, "-m", "scripts.ci_autofix_pr_draft_plan",
                 "--handoff", str(src), "--checkout-root", str(ROOT),
                 "--json", str(dst)],
                cwd=ROOT, capture_output=True, text=True, timeout=20)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            output = json.loads(dst.read_text(encoding="utf-8"))
            self.assertEqual(output["status"], "blocked_by_handoff")
            self.assertFalse(output["draft_pr_created"])
            self.assertFalse(output["production_access"])


if __name__ == "__main__":
    unittest.main()
