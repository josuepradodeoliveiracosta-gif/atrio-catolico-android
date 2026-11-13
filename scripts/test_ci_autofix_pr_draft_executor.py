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
from urllib.error import HTTPError

import scripts.ci_autofix_draft_readonly_audit as readonly_audit
import scripts.ci_autofix_pr_draft_executor as executor_module

from scripts.ci_autofix_pr_draft_executor import (
    CONFIRMATION, GitHubDraftClient, GitHubDraftReader, QA_TARGET,
    draft_transaction_preview, execute_manually_approved_draft,
    validate_draft_manifest, verify_existing_qa_draft,
)
from scripts.ci_autofix_pr_draft_plan import (
    BASE_BRANCH, BRANCH_NAME, STATIC_BODY, STATIC_TITLE, draft_pr_plan,
)
from scripts.ci_autofix_qa_review import apply_reviewed_patch, qa_patch_state
from scripts.test_ci_autofix_pr_draft_plan import good_handoff, live
from scripts.ci_quality_report import NoRedirect, REPO

from scripts.ci_autofix_test_checkout import ROOT, REAL_ROOT
SHA = "a" * 40
COMMIT = "c" * 40
BLOB = "b" * 40


def reviewed():
    return draft_pr_plan(good_handoff(), ROOT, live())


def historical_writer_test_fixture():
    """Simulate pre-#261 main only for in-memory HTTP writer tests.

    The real writer still verifies the live checkout, which must reject the
    already-applied patch. This mock redirects only its extra local source
    proof to our exact-hash historical checkout, never a remote operation.
    """
    pinned = executor_module._pinned_source
    # Before mocking, validate the fixture's original content, all static
    # edits, sandbox rollback and hash against the reviewed recipe.
    pinned(ROOT)

    def source_for_test(checkout_root):
        if Path(checkout_root).resolve() == REAL_ROOT.resolve():
            return pinned(ROOT)
        return pinned(checkout_root)

    return patch.object(executor_module, "_pinned_source",
                        side_effect=source_for_test)


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
            proc = subprocess.run(cmd, cwd=REAL_ROOT, capture_output=True,
                                  text=True, timeout=20)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(json.loads(dest.read_text(encoding="utf-8")),
                             result)
            forbidden = subprocess.run(
                cmd + ["--execute"], cwd=REAL_ROOT, capture_output=True,
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

    def test_remote_rejections_stop_transaction_without_retry_or_cleanup(self):
        """An HTTP refusal at any stage must never trigger retries or deletion.

        The outcome of a failed remote write may be ambiguous; leave an
        already-created branch intact for human inspection.
        """
        stages = (
            ("base_file", []),
            ("create_branch", ["create_branch"]),
            ("branch_ref", ["create_branch"]),
            ("patch_file", ["create_branch", "patch_file"]),
            ("branch_file", ["create_branch", "patch_file"]),
            ("compare", ["create_branch", "patch_file"]),
            ("create_pr", ["create_branch", "patch_file", "create_pr"]),
        )
        before = (ROOT / QA_TARGET).read_bytes()
        for stage, expected_writes in stages:
            for status in (403, 422):
                with self.subTest(stage=stage, status=status):
                    api = FakeDraftClient()

                    def rejected(*args, **kwargs):
                        api.events.append(stage)
                        raise HTTPError(
                            "https://api.github.com/repos/" + REPO,
                            status, "simulated refusal", {}, None)

                    setattr(api, stage, rejected)
                    with self.assertRaises(HTTPError) as caught:
                        execute_manually_approved_draft(
                            reviewed(), ROOT, api, SHA, CONFIRMATION)
                    self.assertEqual(caught.exception.code, status)
                    self.assertEqual(api.events.count(stage), 1)
                    actual_writes = [
                        event for event in api.events
                        if event in ("create_branch", "patch_file", "create_pr")
                    ]
                    self.assertEqual(actual_writes, expected_writes)
                    self.assertNotIn("delete_branch", api.events)
                    self.assertNotIn("merge", api.events)
                    self.assertEqual(
                        (ROOT / QA_TARGET).read_bytes(), before)

    def test_http_writer_does_not_retry_refused_requests(self):
        """A low-level 403/422 cannot cause another HTTP request."""
        for status in (403, 422):
            for operation in ("create_branch", "patch_file", "create_pr"):
                with self.subTest(status=status, operation=operation):
                    requests = []

                    def refused(req, timeout):
                        requests.append((req.get_method(), req.full_url))
                        raise HTTPError(
                            req.full_url, status, "simulated", {}, None)

                    client = GitHubDraftClient("offline-test-token", refused)
                    with self.assertRaises(HTTPError):
                        if operation == "create_branch":
                            client.create_branch(SHA)
                        elif operation == "patch_file":
                            patched = apply_reviewed_patch(
                                (ROOT / QA_TARGET).read_text(
                                    encoding="utf-8"))
                            with historical_writer_test_fixture():
                                client.patch_file(BLOB, patched)
                        else:
                            client.create_pr(SHA)
                    self.assertEqual(len(requests), 1)
                    self.assertTrue(requests[0][1].startswith(
                        "https://api.github.com/repos/" + REPO + "/"))

    def test_existing_qa_draft_read_only_reconciles_approved_remote_state(self):
        """Read an already-created QA PR without invoking any write method."""
        class ExistingDraftClient(FakeDraftClient):
            def __init__(self):
                super().__init__()
                self.branch_exists = True
                self.branch_sha = COMMIT
                self.duplicate_pr_numbers = [261]
                self.written_source = apply_reviewed_patch(self.remote_source)
                self.pr_data = {
                    "number": 261, "state": "open", "draft": True,
                    "merged_at": None,
                    "head": {"ref": BRANCH_NAME, "sha": COMMIT,
                             "repo": {"full_name": REPO}},
                    "base": {"ref": BASE_BRANCH, "sha": SHA,
                             "repo": {"full_name": REPO}},
                }
            def get_pr(self, number):
                self.events.append("get_pr")
                self.assert_expected_number(number)
                return deepcopy(self.pr_data)
            @staticmethod
            def assert_expected_number(number):
                if number != 261:
                    raise ValueError("unexpected PR")

        api = ExistingDraftClient()
        original = (ROOT / QA_TARGET).read_bytes()
        result = verify_existing_qa_draft(ROOT, api, SHA, COMMIT, 261)
        self.assertEqual(result["status"],
                         "existing_qa_draft_verified_read_only")
        self.assertEqual(result["remote_writes"], 0)
        self.assertFalse(result["automatic_merge_or_deploy"])
        self.assertEqual(result["pr_number"], 261)
        self.assertEqual(result["head_sha"], COMMIT)
        self.assertEqual(result["only_file"], QA_TARGET)
        self.assertEqual(api.events, [
            "live", "base_file", "branch_ref", "branch_file",
            "compare", "get_pr", "live", "branch_ref"])
        self.assertEqual((ROOT / QA_TARGET).read_bytes(), original)
        forbidden_writes = {"create_branch", "patch_file", "create_pr",
                            "merge", "delete_branch"}
        self.assertFalse(forbidden_writes.intersection(api.events))

        failures = (
            ("stale_main", lambda a: setattr(a, "main_sha", "d" * 40)),
            ("no_branch", lambda a: setattr(a, "branch_exists", False)),
            ("duplicate", lambda a: setattr(a, "duplicate_pr_numbers",
                                             [261, 262])),
            ("wrong_branch_sha", lambda a: setattr(a, "branch_sha", "d" * 40)),
            ("changed_file", lambda a: setattr(a, "written_source",
                                                "unapproved patch")),
            ("extra_file", lambda a: setattr(a, "extra_diff", True)),
            ("pr_not_draft", lambda a: a.pr_data.update(draft=False)),
            ("pr_wrong_head", lambda a: a.pr_data["head"].update(
                sha="d" * 40)),
            ("pr_wrong_repo", lambda a: a.pr_data["head"]["repo"].update(
                full_name="untrusted/other")),
            ("pr_wrong_base", lambda a: a.pr_data["base"].update(
                sha="d" * 40)),
            ("pr_merged", lambda a: a.pr_data.update(
                merged_at="2026-11-12T19:00:00Z")),
        )
        for label, change in failures:
            with self.subTest(case=label):
                other = ExistingDraftClient()
                change(other)
                with self.assertRaises(ValueError):
                    verify_existing_qa_draft(ROOT, other, SHA, COMMIT, 261)
                self.assertFalse(forbidden_writes.intersection(other.events))
        for bad_number in (True, 0, -1, "261", 10 ** 12):
            with self.subTest(number=bad_number):
                other = ExistingDraftClient()
                with self.assertRaises(ValueError):
                    verify_existing_qa_draft(
                        ROOT, other, SHA, COMMIT, bad_number)
                self.assertEqual(other.events, [])

        late = ExistingDraftClient()
        original_live = late.live_context
        def late_drift():
            value = original_live()
            if late.events.count("live") == 2:
                value["duplicate_pr_numbers"] = [261, 999]
            return value
        late.live_context = late_drift
        with self.assertRaises(ValueError):
            verify_existing_qa_draft(ROOT, late, SHA, COMMIT, 261)
        self.assertNotIn("create_pr", late.events)

    def test_manual_readonly_cli_refuses_ci_missing_or_unsafe_token(self):
        """Never reuse GITHUB_TOKEN or any event-triggered Actions credential."""
        argv = [
            "--checkout-root", str(ROOT),
            "--base-sha", SHA, "--head-sha", COMMIT,
            "--pr-number", "261",
        ]
        cases = (
            {},
            {"GITHUB_TOKEN": "unrelated-ci-token"},
            {"ATRIO_QA_READ_TOKEN": "test-only", "GITHUB_ACTIONS": "true"},
            {"ATRIO_QA_READ_TOKEN": "test-only", "GITHUB_ACTIONS": " 1 "},
            {"ATRIO_QA_READ_TOKEN": "test-only", "CI": "yes"},
            {"ATRIO_QA_READ_TOKEN": "test-only", "GITHUB_RUN_ID": "123"},
            {"ATRIO_QA_READ_TOKEN": "test-only", "GITHUB_EVENT_NAME": "push"},
            {"ATRIO_QA_READ_TOKEN": "fake\ncredential"},
            {"ATRIO_QA_READ_TOKEN": " "},
        )
        for env in cases:
            with self.subTest(keys=sorted(env)):
                stdout, stderr = io.StringIO(), io.StringIO()
                with patch.object(
                        readonly_audit, "verify_existing_qa_draft"
                ) as verifier:
                    code = readonly_audit.main(
                        argv, environ=env, stdout=stdout, stderr=stderr)
                self.assertEqual(code, 2)
                self.assertEqual(stdout.getvalue(), "")
                self.assertIn("Nenhuma escrita remota", stderr.getvalue())
                self.assertNotIn("credential", stderr.getvalue())
                verifier.assert_not_called()

    def test_manual_readonly_cli_uses_get_only_reader_and_redacts_token(self):
        """Only the explicit read-token env is used; output has no secret."""
        argv = [
            "--checkout-root", str(ROOT),
            "--base-sha", SHA, "--head-sha", COMMIT,
            "--pr-number", "261",
        ]
        secret = "synthetic-readonly-token-never-real"
        def approved(root, reader, base, head, pr_number):
            self.assertEqual(root, str(ROOT))
            self.assertIs(type(reader), GitHubDraftReader)
            self.assertEqual(reader.token, secret)
            self.assertFalse(hasattr(reader, "_write"))
            self.assertFalse(hasattr(reader, "create_pr"))
            self.assertEqual((base, head, pr_number), (SHA, COMMIT, 261))
            return {
                "status": "existing_qa_draft_verified_read_only",
                "repository": REPO, "pr_number": 261,
                "base_sha": SHA, "head_sha": COMMIT,
                "branch": BRANCH_NAME, "draft": True,
                "only_file": QA_TARGET, "patch_sha256": "a" * 64,
                "remote_writes": 0, "automatic_merge_or_deploy": False,
                "human_review_required": True,
            }
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(readonly_audit, "verify_existing_qa_draft",
                          side_effect=approved) as verifier:
            code = readonly_audit.main(
                argv, environ={"ATRIO_QA_READ_TOKEN": secret},
                opener=lambda req, timeout: self.fail("network not allowed"),
                stdout=stdout, stderr=stderr)
        self.assertEqual(code, 0)
        self.assertEqual(verifier.call_count, 1)
        self.assertEqual(stderr.getvalue(), "")
        data = json.loads(stdout.getvalue())
        self.assertEqual(data["status"], "existing_qa_draft_verified_read_only")
        self.assertEqual(data["mode"], "manually_invoked_get_only_audit")
        self.assertFalse(data["credential_scope_independently_verified"])
        self.assertFalse(data["writer_executed"])
        self.assertEqual(data["remote_writes"], 0)
        self.assertNotIn(secret, stdout.getvalue())

        approved_fields = {
            "status": "existing_qa_draft_verified_read_only",
            "repository": REPO, "pr_number": 261,
            "base_sha": SHA, "head_sha": COMMIT,
            "branch": BRANCH_NAME, "draft": True,
            "only_file": QA_TARGET, "patch_sha256": "a" * 64,
            "remote_writes": 0, "automatic_merge_or_deploy": False,
            "human_review_required": True,
        }
        for changes in (
            {"remote_writes": 1},
            {"remote_writes": False},
            {"status": "unexpected"},
            {"repository": "attacker/other"},
            {"pr_number": 262},
            {"branch": "main"},
            {"patch_sha256": "invalid"},
            {"human_review_required": False},
            {"extra_secret": secret},
        ):
            rejected = {**approved_fields, **changes}
            output, errors = io.StringIO(), io.StringIO()
            with patch.object(readonly_audit, "verify_existing_qa_draft",
                              return_value=rejected):
                code = readonly_audit.main(
                    argv, environ={"ATRIO_QA_READ_TOKEN": secret},
                    stdout=output, stderr=errors)
            self.assertEqual(code, 2)
            self.assertEqual(output.getvalue(), "")
            self.assertNotIn(secret, errors.getvalue())

    def test_readonly_cli_never_echoes_unknown_secret_arguments(self):
        """A copied command-line credential must not reach stderr."""
        secret = "synthetic-secret-do-not-echo"
        base = [
            "--checkout-root", str(ROOT),
            "--base-sha", SHA, "--head-sha", COMMIT,
            "--pr-number", "261",
        ]
        for argv in (
            base + ["--token", secret],
            base + ["--unknown=" + secret],
            base[:-1] + [secret],
        ):
            with self.subTest(argv_shape=len(argv)):
                output, errors = io.StringIO(), io.StringIO()
                with patch.object(readonly_audit, "verify_existing_qa_draft"
                                  ) as verifier:
                    code = readonly_audit.main(
                        argv,
                        environ={"ATRIO_QA_READ_TOKEN": "fake-read-only-token"},
                        stdout=output, stderr=errors)
                self.assertEqual(code, 2)
                self.assertEqual(output.getvalue(), "")
                self.assertNotIn(secret, errors.getvalue())
                self.assertIn("Nenhuma escrita remota", errors.getvalue())
                verifier.assert_not_called()

    def test_get_only_reader_has_no_write_methods(self):
        """The verifier should never need the privileged writer class."""
        reader = GitHubDraftReader("offline-read-only-placeholder",
                                   lambda req, timeout: io.BytesIO(b"{}"))
        for name in ("_write", "create_branch", "patch_file", "create_pr",
                     "delete_branch", "merge"):
            self.assertFalse(hasattr(reader, name), name)
        self.assertIsInstance(
            GitHubDraftClient("offline-writer-placeholder",
                              lambda req, timeout: io.BytesIO(b"{}")),
            GitHubDraftReader)

    def test_real_get_only_reader_reconciles_pr_via_offline_http(self):
        """The actual read client uses only reviewed GET paths, no writes."""
        original = (ROOT / QA_TARGET).read_text(encoding="utf-8")
        approved = apply_reviewed_patch(original)
        prefix = "https://api.github.com/repos/" + REPO
        touched = []

        def opener(req, timeout):
            self.assertEqual(timeout, 20)
            self.assertEqual(req.get_method(), "GET")
            self.assertIsNone(req.data)
            self.assertTrue(req.full_url.startswith(prefix + "/"))
            path = req.full_url[len(prefix):]
            touched.append(path)
            if path == "/branches/main":
                response = {"commit": {"sha": SHA}}
            elif path == "/pulls?state=open&per_page=10&page=1":
                response = [{
                    "state": "open", "number": 261,
                    "head": {"ref": BRANCH_NAME,
                             "repo": {"full_name": REPO}},
                    "base": {"ref": BASE_BRANCH},
                }]
            elif path == "/git/ref/heads/" + BRANCH_NAME:
                response = {"ref": "refs/heads/" + BRANCH_NAME,
                            "object": {"sha": COMMIT}}
            elif path == "/contents/" + QA_TARGET + "?ref=main":
                response = {"type": "file", "path": QA_TARGET,
                            "sha": BLOB, "encoding": "base64",
                            "content": base64.b64encode(
                                original.encode("utf-8")).decode("ascii")}
            elif path == "/contents/" + QA_TARGET + "?ref=" + BRANCH_NAME:
                response = {"type": "file", "path": QA_TARGET,
                            "encoding": "base64",
                            "content": base64.b64encode(
                                approved.encode("utf-8")).decode("ascii")}
            elif path == "/compare/" + SHA + "..." + BRANCH_NAME:
                response = {"ahead_by": 1, "behind_by": 0,
                            "files": [{"filename": QA_TARGET,
                                       "status": "modified"}]}
            elif path == "/pulls/261":
                response = {
                    "number": 261, "state": "open", "draft": True,
                    "merged_at": None,
                    "head": {"ref": BRANCH_NAME, "sha": COMMIT,
                             "repo": {"full_name": REPO}},
                    "base": {"ref": BASE_BRANCH, "sha": SHA,
                             "repo": {"full_name": REPO}},
                }
            else:
                self.fail("unrecognized read-only endpoint: " + path)
            return io.BytesIO(json.dumps(response).encode("utf-8"))

        reader = GitHubDraftReader("offline-token-without-write", opener)
        before = (ROOT / QA_TARGET).read_bytes()
        result = verify_existing_qa_draft(ROOT, reader, SHA, COMMIT, 261)
        self.assertEqual(result["pr_number"], 261)
        self.assertEqual(result["status"],
                         "existing_qa_draft_verified_read_only")
        self.assertEqual(result["remote_writes"], 0)
        self.assertEqual((ROOT / QA_TARGET).read_bytes(), before)
        self.assertEqual(touched.count("/branches/main"), 2)
        self.assertEqual(
            touched.count("/pulls?state=open&per_page=10&page=1"), 2)
        self.assertEqual(touched.count(
            "/git/ref/heads/" + BRANCH_NAME), 4)
        self.assertEqual(touched.count("/pulls/261"), 1)
        self.assertEqual(len(touched), 12)

    def test_existing_qa_draft_client_reads_only_numbered_pr(self):
        seen = []
        def opener(req, timeout):
            seen.append((req.get_method(), req.full_url, timeout))
            return io.BytesIO(b'{"number":261,"state":"open","draft":true}')
        client = GitHubDraftClient("offline-placeholder", opener)
        for bad in (True, 0, -1, "261", 10 ** 12):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                client.get_pr(bad)
        self.assertEqual(seen, [])
        data = client.get_pr(261)
        self.assertTrue(data["draft"])
        self.assertEqual(seen, [
            ("GET", "https://api.github.com/repos/" + REPO +
             "/pulls/261", 20)])

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
        with historical_writer_test_fixture():
            client.patch_file(BLOB, patched)
        client.create_pr(SHA)
        # A known-good complete PR descriptor must also pass the low-level
        # guard; otherwise the negative cases could all pass vacuously.
        client._write("POST", "/pulls", valid_pr)
        self.assertEqual([x[0] for x in calls], ["PUT", "POST", "POST"])
        self.assertEqual(calls[0][1]["branch"], BRANCH_NAME)
        self.assertTrue(calls[1][1]["draft"])
        self.assertEqual(calls[2][1], valid_pr)

    def test_full_draft_transaction_uses_only_in_memory_http(self):
        """Exercise real request serialization without using GitHub or network."""
        original = (ROOT / QA_TARGET).read_bytes()
        expected_patch = apply_reviewed_patch(original.decode("utf-8"))
        state = {"main": SHA, "branch": None, "written": None, "pr": None}
        requests = []
        prefix = "https://api.github.com/repos/" + REPO

        def opener(req, timeout):
            self.assertEqual(timeout, 20)
            self.assertTrue(req.full_url.startswith(prefix + "/"))
            method, path = req.get_method(), req.full_url[len(prefix):]
            requests.append((method, path))
            payload = json.loads(req.data) if req.data is not None else None
            if method == "GET" and path == "/branches/main":
                answer = {"commit": {"sha": state["main"]}}
            elif method == "GET" and path == "/pulls?state=open&per_page=10&page=1":
                answer = []
            elif method == "GET" and path == "/git/ref/heads/" + BRANCH_NAME:
                if state["branch"] is None:
                    raise HTTPError(req.full_url, 404, "missing branch", {}, None)
                answer = {"ref": "refs/heads/" + BRANCH_NAME,
                          "object": {"sha": state["branch"]}}
            elif method == "GET" and path == "/contents/" + QA_TARGET + "?ref=main":
                answer = {"type": "file", "path": QA_TARGET, "sha": BLOB,
                          "encoding": "base64",
                          "content": base64.b64encode(original).decode("ascii")}
            elif method == "POST" and path == "/git/refs":
                self.assertIsNone(state["branch"])
                self.assertEqual(payload, {"ref": "refs/heads/" + BRANCH_NAME,
                                           "sha": SHA})
                state["branch"] = SHA
                answer = {"ref": payload["ref"], "object": {"sha": SHA}}
            elif method == "PUT" and path == "/contents/" + QA_TARGET:
                self.assertEqual(state["branch"], SHA)
                self.assertEqual(payload["branch"], BRANCH_NAME)
                self.assertEqual(payload["sha"], BLOB)
                state["written"] = base64.b64decode(
                    payload["content"], validate=True).decode("utf-8")
                self.assertEqual(state["written"], expected_patch)
                state["branch"] = COMMIT
                answer = {"commit": {"sha": COMMIT},
                          "content": {"path": QA_TARGET}}
            elif method == "GET" and path == (
                    "/contents/" + QA_TARGET + "?ref=" + BRANCH_NAME):
                self.assertEqual(state["branch"], COMMIT)
                answer = {"type": "file", "path": QA_TARGET,
                          "encoding": "base64",
                          "content": base64.b64encode(
                              state["written"].encode("utf-8")).decode("ascii")}
            elif method == "GET" and path == (
                    "/compare/" + SHA + "..." + BRANCH_NAME):
                answer = {"ahead_by": 1, "behind_by": 0,
                          "files": [{"filename": QA_TARGET, "status": "modified"}]}
            elif method == "POST" and path == "/pulls":
                self.assertEqual(state["branch"], COMMIT)
                self.assertTrue(payload["draft"])
                self.assertEqual(payload["head"], BRANCH_NAME)
                self.assertEqual(payload["base"], BASE_BRANCH)
                state["pr"] = payload
                answer = {"number": 123, "state": "open", "draft": True,
                          "merged_at": None,
                          "head": {"ref": BRANCH_NAME, "sha": COMMIT,
                                   "repo": {"full_name": REPO}},
                          "base": {"ref": BASE_BRANCH, "sha": SHA,
                                   "repo": {"full_name": REPO}}}
            else:
                self.fail("unexpected fake HTTP endpoint: " + method + " " + path)
            return io.BytesIO(json.dumps(answer).encode("utf-8"))

        client = GitHubDraftClient("offline-placeholder-not-a-secret", opener)
        with historical_writer_test_fixture():
            result = execute_manually_approved_draft(
                reviewed(), ROOT, client, SHA, CONFIRMATION)
        self.assertEqual(result["status"], "draft_pr_created_review_required")
        self.assertEqual(result["head_sha"], COMMIT)
        self.assertTrue(result["draft"])
        self.assertFalse(result["automatic_merge_or_deploy"])
        self.assertEqual(state["main"], SHA)
        self.assertEqual(state["branch"], COMMIT)
        self.assertEqual(state["written"], expected_patch)
        self.assertTrue(state["pr"]["draft"])
        self.assertEqual([path for method, path in requests if method != "GET"],
                         ["/git/refs", "/contents/" + QA_TARGET, "/pulls"])
        self.assertEqual((ROOT / QA_TARGET).read_bytes(), original)

    def test_real_writer_rejects_reapplying_patch_after_pr261(self):
        """No test fixture may bypass the real writer's runtime fail-closed gate."""
        if qa_patch_state(REAL_ROOT) != "already_applied":
            self.skipTest("reviewed patch has not landed on main")
        patched = apply_reviewed_patch(
            (ROOT / QA_TARGET).read_text(encoding="utf-8"))
        client = GitHubDraftClient(
            "offline-synthetic-token",
            lambda req, timeout: self.fail("writer must not send HTTP"))
        with self.assertRaisesRegex(
                ValueError, "arquivo QA divergente do hash revisado"):
            client.patch_file(BLOB, patched)

    def test_default_opener_disables_redirects(self):
        with patch("scripts.ci_autofix_pr_draft_executor.build_opener") as builder:
            client = GitHubDraftClient("test-token")
            self.assertIsNotNone(client.opener)
            builder.assert_called_once_with(NoRedirect)


if __name__ == "__main__":
    unittest.main()
