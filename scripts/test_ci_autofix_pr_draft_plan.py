"""Offline checks for a future PR-draft manifest with zero GitHub writes."""
from copy import deepcopy
import io
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest

from scripts.ci_autofix_handoff import handoff
from scripts.ci_autofix_pr_draft_plan import (
    BASE_BRANCH, BRANCH_NAME, MAX_REMOTE_RESPONSE_BYTES, STATIC_TITLE,
    draft_pr_plan, fetch_live_pr_context,
)
from scripts.test_ci_autofix_handoff import sample
from scripts.ci_quality_report import NoRedirect, REPO

ROOT = Path(__file__).resolve().parents[1]
SHA = "a" * 40


def good_handoff():
    a, b, c = sample()
    return handoff(a, b, c, "push", "main", ROOT)


def live(sha=SHA, duplicates=()):
    return {"main_sha": sha, "duplicate_pr_numbers": list(duplicates)}


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
        self.assertTrue(plan["candidate_patch_verified"])
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

    def test_unverified_live_main_or_missing_live_context_blocks(self):
        result = draft_pr_plan(good_handoff(), ROOT)
        self.assertEqual(result["status"], "blocked_live_context_unavailable")
        self.assertFalse(result["live_main_sha_checked"])
        self.assertFalse(result["draft_pr_created"])
        for malformed in ({}, {"main_sha": "../main", "duplicate_pr_numbers": []},
                          {"main_sha": SHA, "duplicate_pr_numbers": [True]},
                          {"main_sha": SHA, "duplicate_pr_numbers": None}):
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
            payload = ({"commit": {"sha": SHA}} if "/branches/main" in req.full_url
                       else open_prs)
            return io.BytesIO(json.dumps(payload).encode("utf-8"))
        result = fetch_live_pr_context("demo-token", opener=opener)
        self.assertEqual(result, {"main_sha": SHA, "duplicate_pr_numbers": [18]})
        self.assertEqual(len(seen), 2)
        self.assertTrue(seen[1].endswith("/pulls?state=open&per_page=100&page=1"))
        self.assertNotIn("private_token", json.dumps(result))
        p = draft_pr_plan(good_handoff(), ROOT, result)
        self.assertEqual(p["status"], "blocked_existing_pr")

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
        with patch("scripts.ci_autofix_pr_draft_plan.build_opener") as builder:
            builder.return_value.open.side_effect = lambda req, timeout: (
                io.BytesIO(json.dumps({"commit": {"sha": SHA}}).encode())
                if "/branches/main" in req.full_url else io.BytesIO(b"[]"))
            got = fetch_live_pr_context("demo")
            self.assertEqual(got["main_sha"], SHA)
            builder.assert_called_once_with(NoRedirect)

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
