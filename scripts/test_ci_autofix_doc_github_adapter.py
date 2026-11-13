"""Offline request-level tests for an authenticated-but-GET-only QA App adapter."""
import base64
import io
import json
from pathlib import Path
import unittest
from urllib.error import HTTPError

from scripts import ci_autofix_doc_github_adapter as adapter
from scripts.ci_autofix_doc_candidate import _pinned_source, TARGET, patch_static_source
from scripts.ci_autofix_doc_draft_executor import BASE, BRANCH, BODY_PREFIX, TITLE
from scripts.ci_quality_report import REPO
from scripts.qa_doc_test_fixture import pinned_doc_checkout


ROOT = Path(__file__).resolve().parents[1]
SHA = "a" * 40


class Response:
    def __init__(self, data, *, raw=False):
        self.data = data if raw else json.dumps(data).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, exc_traceback):
        pass

    def read(self, size=-1):
        return self.data[:size]


class OfflineGitHub:
    """Strict URL router; no network and never makes remote writes."""
    def __init__(self, *, fault=None, checkout_root=ROOT):
        self.source = _pinned_source(checkout_root)
        self.fault = fault
        self.requests = []

    def __call__(self, request, timeout):
        url = request.full_url
        self.requests.append((request.get_method(), url, timeout))
        if request.get_method() != "GET" or request.data is not None:
            raise AssertionError("TEST MUST NEVER EXECUTE A WRITE")
        if url.startswith(adapter.ROOT):
            path = url[len(adapter.ROOT):]
        elif url.startswith("https://api.github.com/"):
            path = url[len("https://api.github.com"):]
        else:
            raise AssertionError("URL has an unexpected host")
        if self.fault == "response_too_large" and path == adapter.GET_MAIN:
            return Response(b"z" * (adapter.MAX_REPLY + 1), raw=True)
        if self.fault == "invalid_json" and path == adapter.GET_MAIN:
            return Response(b"not json", raw=True)
        if self.fault == "forbidden_main" and path == adapter.GET_MAIN:
            raise HTTPError(url, 403, "denied", {}, io.BytesIO(b"secret"))
        if path == adapter.GET_INSTALLATION:
            if self.fault == "other_installation":
                return Response({"total_count": 2, "repositories": [
                    {"full_name": REPO}, {"full_name": "other/repo"}]})
            return Response({"total_count": 1, "repositories": [
                {"full_name": REPO}]})
        if path == adapter.GET_MAIN:
            return Response({"commit": {
                "sha": "b" * 40 if self.fault == "changed_main" else SHA}})
        if path == adapter.GET_BRANCH:
            if self.fault in ("existing_branch", "unexpected_branch"):
                ref = ("refs/heads/not-ours" if self.fault == "unexpected_branch"
                       else "refs/heads/" + BRANCH)
                return Response({"ref": ref, "object": {"sha": SHA}})
            if self.fault == "forbidden_branch":
                raise HTTPError(url, 403, "denied", {}, io.BytesIO(b"secret"))
            raise HTTPError(url, 404, "missing", {}, io.BytesIO(b""))
        if path == adapter.GET_PRS:
            if self.fault == "duplicate_pr":
                return Response([{"number": 26, "head": {"ref": BRANCH},
                                  "base": {"ref": BASE}}])
            if self.fault == "pr_page_full":
                return Response([
                    {"number": i+1, "head": {"ref": BRANCH},
                     "base": {"ref": BASE}} for i in range(5)])
            if self.fault == "wrong_pr_ref":
                return Response([{"number": 6, "head": {"ref": "wrong"},
                                  "base": {"ref": BASE}}])
            return Response([])
        if path == adapter.GET_BASE_FILE:
            source = self.source
            if self.fault == "remote_document_drift":
                source += "\n"
            if self.fault == "malformed_content":
                content = "!invalid!not+base64"
            else:
                content = base64.b64encode(source.encode("utf-8")).decode("ascii")
            sha = adapter._git_blob_sha(source.encode("utf-8"))
            if self.fault == "forged_blob":
                sha = "c" * 40
            return Response({
                "path": TARGET, "sha": sha, "type": "file",
                "encoding": "base64", "content": content,
            })
        raise AssertionError("unexpected fixed path: " + path)


class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.fixture = pinned_doc_checkout(ROOT)
        self.checkout = self.fixture.__enter__()
        self.addCleanup(self.fixture.__exit__, None, None, None)
        self.before = (self.checkout / TARGET).read_bytes()

    def tearDown(self):
        self.assertEqual((self.checkout / TARGET).read_bytes(), self.before)

    def reader(self, fault=None):
        fake = OfflineGitHub(fault=fault, checkout_root=self.checkout)
        return adapter.DocGitHubAppReader("hidden-test-token", opener=fake), fake

    def test_successful_get_only_preflight_revalidates_live_sha(self):
        client, fake = self.reader()
        report = adapter.read_only_preflight(self.checkout, SHA, client)
        self.assertEqual(report["status"],
                         "qa_document_authenticated_read_preflight_passed")
        self.assertEqual(report["source_blob_sha1"], adapter.SOURCE_BLOB_SHA1)
        self.assertEqual(report["remote_writes"], 0)
        self.assertEqual(report["actual_pull_requests_created"], 0)
        self.assertFalse(report["eligible_to_write_without_new_approval"])
        self.assertTrue(report["requires_new_explicit_approval"])
        self.assertNotIn("hidden-test-token", str(report))
        self.assertEqual(len(fake.requests), 8)
        self.assertEqual(sum(path.endswith(adapter.GET_MAIN)
                             for _, path, _ in fake.requests), 2)
        self.assertEqual(sum(path.endswith(adapter.GET_BRANCH)
                             for _, path, _ in fake.requests), 2)
        self.assertTrue(all(method == "GET" and timeout == 20
                            for method, _, timeout in fake.requests))
        self.assertIn("https://api.github.com/installation/repositories?per_page=2",
                      [url for _, url, _ in fake.requests])

    def test_missing_token_is_rejected(self):
        for token in ("", None, "x" * 4097, 12):
            with self.subTest(token_type=type(token)), self.assertRaises(
                    PermissionError):
                adapter.DocGitHubAppReader(token)

    def test_only_exact_read_endpoints_are_authorized(self):
        client, fake = self.reader()
        for path in ("/pulls", "/user", "/secrets",
                     "/contents/" + TARGET + "?ref=feature/test",
                     "/git/ref/heads/main", "/compare/main...qa"):
            with self.subTest(path=path), self.assertRaises(PermissionError):
                client._get(path)
        with self.assertRaises(PermissionError):
            client._get(adapter.GET_MAIN, absent_ok=True)
        self.assertEqual(fake.requests, [])

    def test_installation_must_be_exactly_one_repository(self):
        reader, _ = self.reader("other_installation")
        with self.assertRaises(ValueError):
            adapter.read_only_preflight(self.checkout, SHA, reader)

    def test_different_main_sha_is_blocked(self):
        reader, _ = self.reader("changed_main")
        with self.assertRaises(ValueError):
            adapter.read_only_preflight(self.checkout, SHA, reader)

    def test_existing_branch_and_closed_or_open_pr_block(self):
        for fault in ("existing_branch", "unexpected_branch", "duplicate_pr",
                      "pr_page_full", "wrong_pr_ref"):
            with self.subTest(fault=fault):
                reader, _ = self.reader(fault)
                with self.assertRaises(ValueError):
                    adapter.read_only_preflight(self.checkout, SHA, reader)

    def test_non404_for_fixed_branch_does_not_look_absent(self):
        for fault in ("forbidden_branch", "forbidden_main"):
            with self.subTest(fault=fault):
                reader, _ = self.reader(fault)
                with self.assertRaises(ValueError):
                    adapter.read_only_preflight(self.checkout, SHA, reader)

    def test_malformed_or_drifted_source_rejected(self):
        for fault in ("malformed_content", "remote_document_drift", "forged_blob"):
            with self.subTest(fault=fault):
                reader, _ = self.reader(fault)
                with self.assertRaises(ValueError):
                    adapter.read_only_preflight(self.checkout, SHA, reader)

    def test_body_length_and_json_are_bounded(self):
        for fault in ("response_too_large", "invalid_json"):
            with self.subTest(fault=fault):
                reader, _ = self.reader(fault)
                with self.assertRaises(ValueError):
                    adapter.read_only_preflight(self.checkout, SHA, reader)

    def test_no_network_request_is_made_by_planner(self):
        plan = adapter.draft_write_intents(self.checkout, SHA)
        self.assertEqual(plan["mode"], "frozen_intents_not_executable")
        self.assertEqual(plan["remote_writes"], 0)
        self.assertEqual(plan["actual_pull_requests_created"], 0)
        self.assertFalse(plan["can_dispatch_requests"])
        self.assertTrue(plan["requires_new_explicit_approval"])
        self.assertEqual(plan["intent_paths"], [
            "/git/refs", "/contents/" + TARGET, "/pulls",
        ])
        self.assertEqual([x["method"] for x in plan["intents"]],
                         ["POST", "PUT", "POST"])
        branch, contents, draft = [i["payload"] for i in plan["intents"]]
        self.assertEqual(branch, {
            "ref": "refs/heads/" + BRANCH, "sha": SHA,
        })
        self.assertEqual(contents["sha"], adapter.SOURCE_BLOB_SHA1)
        self.assertEqual(contents["branch"], BRANCH)
        decoded = base64.b64decode(contents["content"], validate=True).decode("utf-8")
        self.assertEqual(decoded, patch_static_source(_pinned_source(self.checkout)))
        self.assertEqual(draft, {
            "head": BRANCH, "base": BASE, "draft": True,
            "maintainer_can_modify": False, "title": TITLE,
            "body": BODY_PREFIX + SHA,
        })
        self.assertNotIn("Authorization", str(plan))
        self.assertNotIn("token", str(plan).lower())

    def test_bad_sha_rejected_before_plan(self):
        with self.assertRaises(ValueError):
            adapter.draft_write_intents(self.checkout, "bad-sha")

    def test_unapproved_http_methods_and_paths_cannot_be_planned(self):
        for method, path in (("DELETE", "/git/refs"), ("PUT", "/pulls"),
                             ("POST", "/repos/other/other"), ("PATCH", "/pulls/123")):
            with self.subTest(method=method, path=path):
                with self.assertRaises(ValueError):
                    adapter._intent(method, path, {})

    def test_no_writer_or_environment_secret_access(self):
        self.assertFalse(hasattr(adapter.DocGitHubAppReader, "create_branch"))
        self.assertFalse(hasattr(adapter.DocGitHubAppReader, "write_document"))
        self.assertFalse(hasattr(adapter.DocGitHubAppReader, "create_pr"))
        self.assertFalse(hasattr(adapter, "main"))
        self.assertFalse(hasattr(adapter, "execute"))
        privileged = (ROOT / ".github/workflows/autofix-qa-approved-draft.yml").read_text(encoding="utf-8")
        self.assertNotIn("ci_autofix_doc_github_adapter", privileged)


if __name__ == "__main__":
    unittest.main()
