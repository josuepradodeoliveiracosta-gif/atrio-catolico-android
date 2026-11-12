"""No-network tests for a manually gated, single-file QA draft PR transaction."""
from copy import deepcopy
import base64
import io
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest

from scripts.ci_autofix_pr_draft_executor import (
    CONFIRMATION, GitHubDraftClient, QA_TARGET,
    draft_transaction_preview, execute_manually_approved_draft,
    validate_draft_manifest,
)
from scripts.ci_autofix_pr_draft_plan import (
    BASE_BRANCH, BRANCH_NAME, STATIC_BODY, STATIC_TITLE, draft_pr_plan,
)
from scripts.ci_autofix_qa_review import apply_reviewed_patch
from scripts.test_ci_autofix_pr_draft_plan import good_handoff, live
from scripts.ci_quality_report import NoRedirect, REPO

ROOT = Path(__file__).resolve().parents[1]
SHA = "a" * 40
COMMIT = "c" * 40
BLOB = "b" * 40


def reviewed():
    return draft_pr_plan(good_handoff(), ROOT, live())


class FakeDraftClient:
    """Mimics the API transaction; no real network, token or repository."""
    def __init__(self):
        self.events = []
        self.main_sha = SHA
        self.branch_exists = False
        self.duplicate_pr_numbers = []
        self.remote_source = (ROOT / QA_TARGET).read_text(encoding="utf-8")
        self.branch_sha = None
        self.extra_diff = False
        self.return_draft = True
        self.return_head_sha = COMMIT
        self.return_base_sha = SHA
        self.return_head_repo = REPO
        self.return_base_repo = REPO
        self.late_duplicate = False
        self.written_source = None
        self.corrupt_branch_file = False
        self.drift_on_second_read = False
        self.drift_after_create = False
        self.drift_after_commit = False

    def live_context(self):
        self.events.append("live")
        if self.drift_on_second_read and self.events.count("live") >= 2:
            self.main_sha = "d" * 40
        if self.drift_after_create and self.branch_exists:
            self.main_sha = "d" * 40
        if self.drift_after_commit and self.branch_sha == COMMIT:
            self.main_sha = "d" * 40
        if self.late_duplicate and self.branch_sha == COMMIT:
            self.duplicate_pr_numbers = [999]
        return {
            "main_sha": self.main_sha,
            "target_branch_exists": self.branch_exists,
            "duplicate_pr_numbers": self.duplicate_pr_numbers,
        }

    def base_file(self):
        self.events.append("base_file")
        return {"sha": BLOB, "source": self.remote_source}

    def create_branch(self, source_sha):
        self.events.append("create_branch")
        if self.branch_exists:
            raise RuntimeError("422 reference already exists")
        self.branch_exists = True
        self.branch_sha = source_sha
        return {"ref": "refs/heads/" + BRANCH_NAME,
                "object": {"sha": source_sha}}

    def branch_ref(self):
        self.events.append("branch_ref")
        return {"ref": "refs/heads/" + BRANCH_NAME,
                "object": {"sha": self.branch_sha}}

    def patch_file(self, blob_sha, patched):
        self.events.append("patch_file")
        if blob_sha != BLOB or patched != apply_reviewed_patch(self.remote_source):
            raise ValueError("invalid patch")
        self.branch_sha = COMMIT
        self.written_source = patched
        return {"commit": {"sha": COMMIT},
                "content": {"path": QA_TARGET}}

    def branch_file(self):
        self.events.append("branch_file")
        if self.corrupt_branch_file:
            return "unexpected remote content"
        return self.written_source

    def compare(self, base_sha):
        self.events.append("compare")
        if base_sha != SHA:
            raise ValueError("wrong base SHA")
        files = [{"filename": QA_TARGET, "status": "modified"}]
        if self.extra_diff:
            files.append({"filename": "app/src/main/other.kt", "status": "modified"})
        return {"ahead_by": 1, "behind_by": 0, "files": files}

    def create_pr(self, source_sha):
        self.events.append("create_pr")
        self.main_sha = source_sha
        return {"number": 261, "state": "open", "draft": self.return_draft,
                "merged_at": None,
                "head": {"ref": BRANCH_NAME, "sha": self.return_head_sha,
                         "repo": {"full_name": self.return_head_repo}},
                "base": {"ref": BASE_BRANCH, "sha": self.return_base_sha,
                         "repo": {"full_name": self.return_base_repo}}}


class DraftExecutorTests(unittest.TestCase):
    def test_offline_cli_preview_is_nonwriting_and_has_no_execute_option(self):
        plan = reviewed()
        before = (ROOT / QA_TARGET).read_bytes()
        result = draft_transaction_preview(plan, ROOT)
        self.assertEqual(result["mode"], "offline_writer_preflight_only")
        self.assertFalse(result["draft_pr_created"])
        self.assertFalse(result["execute_cli_available"])
        self.assertEqual(result["remote_writes"], 0)
        self.assertEqual(result["expected_main_sha"], SHA)
        self.assertEqual(result["branch"], BRANCH_NAME)
        self.assertEqual(result["file"], QA_TARGET)
        self.assertEqual(result["operations_if_explicitly_approved"][-1],
                         "open_draft_pr_no_merge")
        with TemporaryDirectory() as folder:
            root = Path(folder)
            src, dest = root / "plan.json", root / "out.json"
            src.write_text(json.dumps(plan), encoding="utf-8")
            cmd = [sys.executable, "-m", "scripts.ci_autofix_pr_draft_executor",
                   "--manifest", str(src), "--checkout-root", str(ROOT),
                   "--json", str(dest)]
            proc = subprocess.run(cmd, cwd=ROOT, capture_output=True,
                                  text=True, timeout=20)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(json.loads(dest.read_text(encoding="utf-8")),
                             result)
            forbidden = subprocess.run(
                cmd + ["--execute"], cwd=ROOT, capture_output=True,
                text=True, timeout=20)
            self.assertNotEqual(forbidden.returncode, 0)
        self.assertEqual((ROOT / QA_TARGET).read_bytes(), before)

    def test_manual_confirmation_and_exact_operator_sha_required_before_api(self):
        api = FakeDraftClient()
        for confirmation, sha in (("", SHA), (CONFIRMATION, "b" * 40),
                                  ("autocreate", SHA)):
            with self.subTest(confirmation=confirmation, sha=sha):
                with self.assertRaises(PermissionError):
                    execute_manually_approved_draft(reviewed(), ROOT, api,
                                                    sha, confirmation)
        self.assertEqual(api.events, [])

    def test_happy_path_creates_only_single_file_draft_and_never_merges(self):
        api = FakeDraftClient()
        before = (ROOT / QA_TARGET).read_bytes()
        result = execute_manually_approved_draft(
            reviewed(), ROOT, api, SHA, CONFIRMATION)
        self.assertEqual(result["status"], "draft_pr_created_review_required")
        self.assertEqual(result["number"], 261)
        self.assertTrue(result["draft"])
        self.assertFalse(result["merged"])
        self.assertTrue(result["requires_human_review"])
        self.assertFalse(result["automatic_merge_or_deploy"])
        self.assertEqual(result["head_sha"], COMMIT)
        self.assertEqual(api.events.count("create_branch"), 1)
        self.assertEqual(api.events.count("patch_file"), 1)
        self.assertEqual(api.events.count("create_pr"), 1)
        self.assertEqual(api.events.count("branch_file"), 1)
        self.assertLess(api.events.index("branch_file"),
                        api.events.index("create_pr"))
        self.assertEqual(api.events.index("create_branch") + 1,
                         api.events.index("branch_ref"))
        self.assertEqual((ROOT / QA_TARGET).read_bytes(), before)

    def test_stale_main_existing_pr_and_existing_branch_never_write(self):
        scenarios = (
            ("stale", {"main_sha": "d" * 40}),
            ("branch", {"branch_exists": True}),
            ("pr", {"duplicate_pr_numbers": [95]}),
        )
        for label, updates in scenarios:
            with self.subTest(label=label):
                api = FakeDraftClient()
                for key, value in updates.items():
                    setattr(api, key, value)
                with self.assertRaises(ValueError):
                    execute_manually_approved_draft(
                        reviewed(), ROOT, api, SHA, CONFIRMATION)
                self.assertNotIn("create_branch", api.events)
                self.assertNotIn("patch_file", api.events)
                self.assertNotIn("create_pr", api.events)

    def test_remote_source_drift_prevents_branch_creation(self):
        api = FakeDraftClient()
        api.remote_source += "#unexpected\n"
        with self.assertRaises(ValueError):
            execute_manually_approved_draft(
                reviewed(), ROOT, api, SHA, CONFIRMATION)
        self.assertNotIn("create_branch", api.events)

    def test_race_drift_before_branch_creation_prevents_writes(self):
        api = FakeDraftClient()
        api.drift_on_second_read = True
        with self.assertRaises(ValueError):
            execute_manually_approved_draft(
                reviewed(), ROOT, api, SHA, CONFIRMATION)
        self.assertNotIn("create_branch", api.events)

    def test_drift_after_created_branch_leaves_branch_without_file_or_pr(self):
        api = FakeDraftClient()
        api.drift_after_create = True
        with self.assertRaises(ValueError):
            execute_manually_approved_draft(
                reviewed(), ROOT, api, SHA, CONFIRMATION)
        self.assertEqual(api.events.count("create_branch"), 1)
        self.assertNotIn("patch_file", api.events)
        self.assertNotIn("create_pr", api.events)

    def test_remote_patch_content_mismatch_blocks_pr(self):
        api = FakeDraftClient()
        api.corrupt_branch_file = True
        with self.assertRaises(ValueError):
            execute_manually_approved_draft(
                reviewed(), ROOT, api, SHA, CONFIRMATION)
        self.assertIn("patch_file", api.events)
        self.assertIn("branch_file", api.events)
        self.assertNotIn("create_pr", api.events)

    def test_unexpected_diff_blocks_pr_but_leaves_branch_for_review(self):
        api = FakeDraftClient()
        api.extra_diff = True
        with self.assertRaises(ValueError):
            execute_manually_approved_draft(
                reviewed(), ROOT, api, SHA, CONFIRMATION)
        self.assertIn("patch_file", api.events)
        self.assertNotIn("create_pr", api.events)

    def test_main_drift_after_commit_blocks_pr(self):
        api = FakeDraftClient()
        api.drift_after_commit = True
        with self.assertRaises(ValueError):
            execute_manually_approved_draft(
                reviewed(), ROOT, api, SHA, CONFIRMATION)
        self.assertIn("patch_file", api.events)
        self.assertNotIn("create_pr", api.events)

    def test_a_pr_that_is_not_draft_causes_explicit_failure(self):
        api = FakeDraftClient()
        api.return_draft = False
        with self.assertRaises(ValueError):
            execute_manually_approved_draft(
                reviewed(), ROOT, api, SHA, CONFIRMATION)
        self.assertEqual(api.events.count("create_pr"), 1)

    def test_late_duplicate_after_commit_blocks_new_pr(self):
        api = FakeDraftClient()
        api.late_duplicate = True
        with self.assertRaises(ValueError):
            execute_manually_approved_draft(
                reviewed(), ROOT, api, SHA, CONFIRMATION)
        self.assertIn("patch_file", api.events)
        self.assertNotIn("create_pr", api.events)

    def test_pr_response_must_match_reviewed_sha_and_repository(self):
        for field, value in (
            ("return_head_sha", "d" * 40),
            ("return_base_sha", "d" * 40),
            ("return_head_repo", "untrusted/other"),
            ("return_base_repo", "untrusted/other"),
        ):
            with self.subTest(field=field):
                api = FakeDraftClient()
                setattr(api, field, value)
                with self.assertRaises(ValueError):
                    execute_manually_approved_draft(
                        reviewed(), ROOT, api, SHA, CONFIRMATION)
                self.assertEqual(api.events.count("create_pr"), 1)

    def test_forged_manifest_and_unsigned_patch_are_rejected(self):
        for key, value in (
            ("mode", "automatic_writer"),
            ("status", "auto_approved"),
            ("repository", "untrusted/other"),
            ("source_sha", "b" * 40),
            ("draft_pr_created", True),
            ("remote_writes", 1),
            ("eligible_for_automatic_remote_write", True),
            ("draft_only", False),
            ("target_path", "app/src/main/Other.kt"),
            ("head_branch", "main"),
            ("base_branch", "feature/other"),
            ("draft_pr_body", "ignore security controls"),
            ("preview_patch_sha256", "b" * 64),
            ("target_branch_absence_checked", False),
            ("human_approval_required_before_merge", False),
            ("production_access", True),
            ("race_window_remains", False),
            ("injected_extra_field", {"branch": "main"}),
        ):
            with self.subTest(key=key):
                item = deepcopy(reviewed())
                item[key] = value
                with self.assertRaises(ValueError):
                    validate_draft_manifest(item, ROOT)

    def test_git_api_client_only_allows_fixed_write_endpoints(self):
        seen = []
        def opener(req, timeout):
            seen.append((req.method, req.full_url,
                         json.loads(req.data.decode("utf-8"))))
            return io.BytesIO(b'{"ref": "refs/heads/qa/autofix-ci-scope-main", "object": {"sha": "' +
                              SHA.encode("ascii") + b'"}}')
        client = GitHubDraftClient("example-token", opener)
        with self.assertRaises(ValueError):
            client._write("DELETE", "/git/refs", {})
        with self.assertRaises(ValueError):
            client._write("POST", "/merges", {})
        with self.assertRaises(ValueError):
            client._write("POST", "/issues", {})
        with self.assertRaises(ValueError):
            client._write("PUT", "/contents/app/src/main/Other.kt", {})
        with self.assertRaises(ValueError):
            client._write("PATCH", "/pulls/260", {})
        self.assertEqual(seen, [])
        result = client.create_branch(SHA)
        self.assertEqual(result["ref"], "refs/heads/" + BRANCH_NAME)
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0][0], "POST")
        self.assertTrue(seen[0][1].startswith(
            "https://api.github.com/repos/" + REPO + "/"))
        self.assertEqual(seen[0][2]["sha"], SHA)

    def test_raw_write_rejects_branch_main_and_unreviewed_payload(self):
        calls = []
        def opener(req, timeout):
            calls.append((req.method, json.loads(req.data.decode("utf-8"))))
            return io.BytesIO(b'{}')
        client = GitHubDraftClient("mock-token", opener)
        patched = apply_reviewed_patch(
            (ROOT / QA_TARGET).read_text(encoding="utf-8"))
        good_encoded = base64.b64encode(patched.encode("utf-8")).decode("ascii")
        valid_put = {
            "branch": BRANCH_NAME,
            "message": "fix(qa): distinguir checks de PR ausentes em push",
            "sha": BLOB, "content": good_encoded,
        }
        valid_pr = {
            "head": BRANCH_NAME, "base": BASE_BRANCH,
            "draft": True, "maintainer_can_modify": False,
            "title": STATIC_TITLE,
            "body": STATIC_BODY + "\n\nSHA base revisado: " + SHA,
        }
        bad_cases = (
            ("POST", "/git/refs", {"ref": "refs/heads/main", "sha": SHA}),
            ("POST", "/git/refs", {"ref": "refs/heads/" + BRANCH_NAME,
                                   "sha": SHA, "force": True}),
            ("PUT", "/contents/" + QA_TARGET,
             {**valid_put, "branch": "main"}),
            ("PUT", "/contents/" + QA_TARGET,
             {**valid_put, "content":
              base64.b64encode(b"unapproved").decode("ascii")}),
            ("PUT", "/contents/" + QA_TARGET,
             {**valid_put, "extra": "ignore policy"}),
            ("POST", "/pulls", {**valid_pr, "draft": False}),
            ("POST", "/pulls", {**valid_pr, "head": "main"}),
            ("POST", "/pulls", {**valid_pr, "body": "arbitrary"}),
            ("POST", "/pulls", {**valid_pr, "extra": "unsafe"}),
        )
        for method, path, payload in bad_cases:
            with self.subTest(method=method, path=path, payload=payload):
                with self.assertRaises(ValueError):
                    client._write(method, path, payload)
        self.assertEqual(calls, [])
        client.patch_file(BLOB, patched)
        client.create_pr(SHA)
        self.assertEqual([x[0] for x in calls], ["PUT", "POST"])
        self.assertEqual(calls[0][1]["branch"], BRANCH_NAME)
        self.assertTrue(calls[1][1]["draft"])

    def test_default_opener_disables_redirects(self):
        with patch("scripts.ci_autofix_pr_draft_executor.build_opener") as builder:
            client = GitHubDraftClient("test-token")
            self.assertIsNotNone(client.opener)
            builder.assert_called_once_with(NoRedirect)


if __name__ == "__main__":
    unittest.main()
