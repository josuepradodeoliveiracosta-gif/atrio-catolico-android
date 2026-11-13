"""No-network tests: manually gated one-document GitHub App draft writer."""
import base64
import io
import json
from pathlib import Path
import unittest
from urllib.error import HTTPError

from scripts import ci_autofix_doc_live_writer as live
from scripts.ci_autofix_doc_candidate import _pinned_source, patch_static_source, _git_blob_sha, TARGET
from scripts.ci_autofix_doc_draft_executor import BRANCH, BASE
from scripts.ci_autofix_doc_github_adapter import ROOT, GET_BRANCH, GET_BASE_FILE, GET_INSTALLATION, GET_MAIN, GET_PRS, SOURCE_BLOB_SHA1
from scripts.ci_quality_report import REPO

ROOT_DIR = Path(__file__).resolve().parents[1]
BASE_SHA = "a" * 40
COMMIT_SHA = "c" * 40


class Response:
    def __init__(self, body, status=200, *, raw=False):
        self.status = status
        self.data = body if raw else json.dumps(body).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, size=-1):
        return self.data[:size]


class FakeGitHub:
    """A stateful fake API. No API calls ever leave this test process."""

    def __init__(self, fault=None):
        self.fault = fault
        self.source = _pinned_source(ROOT_DIR)
        self.patched = patch_static_source(self.source)
        self.main = BASE_SHA
        self.branch = False
        self.branch_sha = None
        self.branch_doc = None
        self.pr = None
        self.calls = []

    def pr_object(self):
        return {
            "number": 567, "state": "open",
            "draft": self.fault != "non_draft",
            "merged_at": None,
            "head": {"ref": BRANCH, "sha": self.branch_sha,
                     "repo": {"full_name": REPO if self.fault != "wrong_pr_repo" else "malicious/other"}},
            "base": {"ref": BASE, "sha": BASE_SHA,
                     "repo": {"full_name": REPO}},
        }

    def _payload(self, req):
        return json.loads(req.data) if req.data is not None else None

    def __call__(self, req, timeout):
        assert timeout == 20
        method, url = req.get_method(), req.full_url
        payload = self._payload(req)
        self.calls.append((method, url))
        if self.fault == "http_403" and method == "GET" and url.endswith(GET_MAIN):
            raise HTTPError(url, 403, "denied", {}, io.BytesIO(b"private content"))
        if url == "https://api.github.com" + GET_INSTALLATION and method == "GET":
            if self.fault == "multi_repo":
                return Response({"total_count": 2, "repositories": [
                    {"full_name": REPO}, {"full_name": "other/repo"}]})
            return Response({"total_count": 1, "repositories": [{"full_name": REPO}]})
        assert url.startswith(ROOT), "Unexpected GitHub host"
        path = url[len(ROOT):]
        if method == "GET":
            if path == GET_MAIN:
                new_main = self.main
                if self.fault == "stale_main":
                    new_main = "b" * 40
                if self.fault == "main_drift_after_branch" and self.branch:
                    new_main = "b" * 40
                return Response({"commit": {"sha": new_main}})
            if path == GET_BRANCH:
                if not self.branch and self.fault != "existing_branch":
                    raise HTTPError(url, 404, "not found", {}, io.BytesIO(b""))
                sha = self.branch_sha or BASE_SHA
                return Response({"ref": "refs/heads/" + BRANCH, "object": {"sha": sha}})
            if path == GET_PRS:
                if self.fault == "prior_closed_pr":
                    return Response([{"number": 100, "head": {"ref": BRANCH},
                                      "base": {"ref": BASE}}])
                if self.fault == "competing_pr_after_branch" and self.branch:
                    return Response([{"number": 901, "head": {"ref": BRANCH},
                                      "base": {"ref": BASE}}])
                if self.pr is None:
                    return Response([])
                return Response([{"number": 567, "head": {"ref": BRANCH},
                                  "base": {"ref": BASE}}])
            if path in (GET_BASE_FILE, live.BRANCH_DOCUMENT):
                if path == GET_BASE_FILE:
                    source = self.source
                    if self.fault == "base_drift":
                        source += "\n"
                else:
                    source = self.branch_doc
                    if self.fault == "branch_read_drift" and self.branch_sha == BASE_SHA:
                        source += "\n"
                    if self.fault == "corrupted_written_file" and self.branch_sha == COMMIT_SHA:
                        source += "\n"
                assert source is not None
                data = source.encode("utf-8")
                return Response({
                    "path": TARGET, "sha": _git_blob_sha(data), "encoding": "base64",
                    "content": base64.b64encode(data).decode("ascii"), "type": "file",
                })
            if path.startswith("/compare/"):
                assert path == "/compare/" + BASE_SHA + live.COMPARE_SUFFIX
                files = [{"filename": TARGET, "status": "modified",
                          "changes": 3, "additions": 3, "deletions": 3}]
                if self.fault == "extra_diff":
                    files.append({"filename": "app/src/main/Forbidden.kt", "status": "modified"})
                return Response({"status": "ahead", "ahead_by": 1,
                                 "behind_by": 0, "total_commits": 1, "files": files})
            if path == "/pulls/567":
                assert self.pr is not None
                if self.fault == "readback_non_draft":
                    x = dict(self.pr)
                    x["draft"] = False
                    return Response(x)
                return Response(self.pr)
            raise AssertionError("Unexpected GET path: " + path)
        if method == "POST" and path == "/git/refs":
            assert not self.branch, "unsafe duplicate branch"
            assert payload == {"ref": "refs/heads/" + BRANCH, "sha": BASE_SHA}
            self.branch = True
            self.branch_sha = BASE_SHA
            self.branch_doc = self.source
            if self.fault == "unexpected_branch_reply":
                return Response({"ref": "refs/heads/surprise", "object": {"sha": BASE_SHA}}, status=201)
            if self.fault == "bad_branch_json":
                return Response(b"this is not JSON", status=201, raw=True)
            return Response({"ref": "refs/heads/" + BRANCH,
                             "object": {"sha": BASE_SHA}}, status=201)
        if method == "PUT" and path == "/contents/" + TARGET:
            assert self.branch and self.branch_sha == BASE_SHA
            assert payload["branch"] == BRANCH
            assert payload["sha"] == SOURCE_BLOB_SHA1
            assert base64.b64decode(payload["content"]).decode("utf-8") == self.patched
            if self.fault == "put_http_422":
                raise HTTPError(url, 422, "invalid", {}, io.BytesIO(b"sensitive"))
            self.branch_doc = self.patched
            self.branch_sha = COMMIT_SHA
            if self.fault == "unexpected_write_reply":
                return Response({"content": {"sha": "b" * 40, "path": TARGET},
                                 "commit": {"sha": COMMIT_SHA}})
            if self.fault == "put_redirect":
                return Response({}, status=302)
            return Response({"content": {"sha": _git_blob_sha(self.patched.encode("utf-8")),
                                          "path": TARGET},
                             "commit": {"sha": COMMIT_SHA},
                             }, status=200)
        if method == "POST" and path == "/pulls":
            assert self.branch and self.branch_sha == COMMIT_SHA
            assert payload["head"] == BRANCH and payload["base"] == BASE
            assert payload["draft"] is True
            assert payload["maintainer_can_modify"] is False
            self.pr = self.pr_object()
            return Response(self.pr, status=201)
        raise AssertionError("Unexpected write method/path")


class LiveWriteTests(unittest.TestCase):
    def setUp(self):
        self.before = (ROOT_DIR / TARGET).read_bytes()

    def tearDown(self):
        self.assertEqual((ROOT_DIR / TARGET).read_bytes(), self.before)

    def execute(self, fault=None, approval=live.APPROVAL, sha=BASE_SHA):
        fake = FakeGitHub(fault=fault)
        client = live.DocumentDraftAppTransport("unit-test-fake-token", opener=fake)
        try:
            result = live.execute_manually_authorized_document_draft(
                ROOT_DIR, sha, approval, client)
            return fake, result
        except Exception as exc:
            self.last_fake = fake
            raise exc

    def test_valid_transaction_rechecks_every_step_with_three_writes(self):
        fake, result = self.execute()
        self.assertEqual(result["status"],
                         "real_document_draft_created_requires_human_review")
        self.assertEqual(result["remote_writes"], 3)
        self.assertEqual(result["pr_number"], 567)
        self.assertEqual(result["main_sha"], BASE_SHA)
        self.assertEqual(result["branch_commit_sha"], COMMIT_SHA)
        self.assertTrue(result["draft"])
        self.assertFalse(result["merged"])
        self.assertFalse(result["production_access"])
        writes = [(m, p[len(ROOT):]) for m, p in fake.calls if m != "GET"]
        self.assertEqual(writes, [
            ("POST", "/git/refs"),
            ("PUT", "/contents/" + TARGET),
            ("POST", "/pulls"),
        ])
        self.assertGreaterEqual(sum(m == "GET" for m, _ in fake.calls), 20)
        self.assertNotIn("unit-test-fake-token", str(result))
        self.assertEqual(fake.branch_doc, fake.patched)

    def test_confirmation_and_expected_client_block_before_network(self):
        for approval in (None, "", "Prossiga", "CREATE_ATRIO_QA_DRAFT_PR_ONLY"):
            with self.subTest(approval=approval), self.assertRaises(PermissionError):
                self.execute(approval=approval)
            self.assertEqual(self.last_fake.calls, [])
        with self.assertRaises(PermissionError):
            live.execute_manually_authorized_document_draft(
                ROOT_DIR, BASE_SHA, live.APPROVAL, object())

    def test_sha_invalid_blocks_without_calls(self):
        with self.assertRaises(ValueError):
            self.execute(sha="untrusted")
        self.assertEqual(self.last_fake.calls, [])

    def test_token_required_and_unexpected_methods_rejected(self):
        with self.assertRaises(PermissionError):
            live.DocumentDraftAppTransport("")
        fake = FakeGitHub()
        client = live.DocumentDraftAppTransport("unit-test-fake-token", opener=fake)
        for method, path in (("DELETE", "/git/refs"), ("PATCH", "/pulls"),
                             ("POST", "/repos/other"), ("GET", "/users/test"),
                             ("GET", "/repos/other/other")):
            with self.subTest(method=method, path=path), self.assertRaises(PermissionError):
                client._request(method, path)
        self.assertEqual(fake.calls, [])

    def test_cannot_send_intent_without_private_transaction_gate(self):
        fake = FakeGitHub()
        client = live.DocumentDraftAppTransport("unit-test-fake-token", opener=fake)
        plan = live.draft_write_intents(ROOT_DIR, BASE_SHA)
        with self.assertRaises(PermissionError):
            client._send_reviewed(plan, 0, gate=object())
        with self.assertRaises(PermissionError):
            client._request("POST", "/git/refs", plan["intents"][0]["payload"])
        self.assertEqual(fake.calls, [])

    def test_preflight_blocks_unsafe_remote_conditions_before_write(self):
        for fault in ("multi_repo", "stale_main", "existing_branch",
                      "prior_closed_pr", "base_drift", "http_403"):
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                self.execute(fault=fault)
            self.assertFalse(self.last_fake.branch)
            self.assertFalse(any(m != "GET" for m, _ in self.last_fake.calls))

    def test_unexpected_branch_reply_leaves_branch_without_document_write(self):
        for fault in ("unexpected_branch_reply", "bad_branch_json"):
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                self.execute(fault=fault)
            self.assertTrue(self.last_fake.branch)
            self.assertEqual(self.last_fake.branch_sha, BASE_SHA)
            self.assertIsNone(self.last_fake.pr)
            self.assertEqual(sum(m != "GET" for m, _ in self.last_fake.calls), 1)

    def test_new_branch_must_be_read_back_without_drift(self):
        for fault in ("branch_read_drift", "main_drift_after_branch",
                      "competing_pr_after_branch"):
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                self.execute(fault=fault)
            self.assertTrue(self.last_fake.branch)
            self.assertIsNone(self.last_fake.pr)
            self.assertFalse(any(m == "PUT" for m, _ in self.last_fake.calls))

    def test_failed_or_corrupt_file_update_never_creates_pr(self):
        for fault in ("put_http_422", "unexpected_write_reply", "put_redirect",
                      "corrupted_written_file", "extra_diff"):
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                self.execute(fault=fault)
            self.assertTrue(self.last_fake.branch)
            self.assertIsNone(self.last_fake.pr)
            self.assertFalse(any(m == "POST" and p.endswith("/pulls")
                                 for m, p in self.last_fake.calls))

    def test_fake_pr_not_draft_or_wrong_repo_is_rejected(self):
        for fault in ("non_draft", "wrong_pr_repo", "readback_non_draft"):
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                self.execute(fault=fault)
            self.assertIsNotNone(self.last_fake.pr)
            self.assertEqual(sum(m == "POST" and p.endswith("/pulls")
                                 for m, p in self.last_fake.calls), 1)

    def test_source_branch_and_workflow_are_untouched(self):
        workflow = (ROOT_DIR / ".github/workflows/autofix-qa-approved-draft.yml").read_text(encoding="utf-8")
        self.assertNotIn("ci_autofix_doc_live_writer", workflow)
        self.assertNotIn("ci_autofix_doc_live_writer", (ROOT_DIR / "scripts/ci_autofix_doc_draft_executor.py").read_text(encoding="utf-8"))
        self.assertFalse(hasattr(live, "main"))
        self.assertEqual(_git_blob_sha(self.before), SOURCE_BLOB_SHA1)


if __name__ == "__main__":
    unittest.main()
