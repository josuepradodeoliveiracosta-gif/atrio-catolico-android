"""Offline security contract for one-time GitHub App installation smoke."""
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts import ci_autofix_app_token_readonly_smoke as smoke


class Reply:
    def __init__(self, value):
        self.payload = json.dumps(value).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, limit):
        return self.payload[:limit]


class TokenSmokeTests(unittest.TestCase):
    def good_context(self):
        return {
            "GITHUB_ACTIONS": "true",
            "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_REPOSITORY": smoke.REPO,
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_ACTOR": smoke.OWNER,
            "GITHUB_WORKFLOW": smoke.WORKFLOW_NAME,
        }

    def fixtures(self):
        return {
            smoke.INVENTORY: {
                "total_count": 1,
                "repositories": [{"full_name": smoke.REPO}],
            },
            smoke.SOURCE: {"type": "file", "path": smoke.SOURCE_FILE},
            smoke.PULLS: [],
        }

    def opener(self, fixtures, calls):
        def open_request(request, timeout):
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(timeout, 15)
            self.assertTrue(request.full_url.startswith(smoke.API_HOST + "/"))
            self.assertEqual(request.get_header("Authorization"), "Bearer dummy-secret")
            endpoint = request.full_url[len(smoke.API_HOST):]
            self.assertIn(endpoint, smoke.ALLOWED_ENDPOINTS)
            calls.append(endpoint)
            return Reply(fixtures[endpoint])
        return open_request

    def test_exact_three_gets_and_scope_success(self):
        calls = []
        proof = smoke.verify_installation_token(
            "dummy-secret", self.opener(self.fixtures(), calls))
        self.assertEqual(calls, [smoke.INVENTORY, smoke.SOURCE, smoke.PULLS])
        self.assertEqual(proof["remote_writes"], 0)
        self.assertTrue(proof["repository_scope_verified"])
        self.assertTrue(proof["contents_read_verified"])
        self.assertTrue(proof["pull_requests_read_verified"])

    def test_wrong_or_many_repositories_blocks_before_other_gets(self):
        for repos in ([], [{"full_name": "attacker/other"}],
                      [{"full_name": smoke.REPO}, {"full_name": "other/r"}]):
            with self.subTest(repos=repos):
                fixtures = self.fixtures()
                fixtures[smoke.INVENTORY] = {
                    "total_count": len(repos), "repositories": repos}
                calls = []
                with self.assertRaises(PermissionError):
                    smoke.verify_installation_token(
                        "dummy-secret", self.opener(fixtures, calls))
                self.assertEqual(calls, [smoke.INVENTORY])

    def test_inconsistent_inventory_count_rejected(self):
        fixtures = self.fixtures()
        fixtures[smoke.INVENTORY]["total_count"] = 2
        with self.assertRaises(PermissionError):
            smoke.verify_installation_token(
                "dummy-secret", self.opener(fixtures, []))

    def test_invalid_content_or_pr_response_blocks(self):
        for endpoint, wrong in ((smoke.SOURCE, {"type": "dir", "path": smoke.SOURCE_FILE}),
                                (smoke.PULLS, {"not": "a list"}),
                                (smoke.PULLS, [{}, {}])):
            with self.subTest(endpoint=endpoint):
                fixtures = self.fixtures()
                fixtures[endpoint] = wrong
                with self.assertRaises(ValueError):
                    smoke.verify_installation_token(
                        "dummy-secret", self.opener(fixtures, []))

    def test_no_unapproved_paths_or_invalid_token(self):
        for endpoint in ("/user", "/repos/other/other", "/installation/token",
                         "/repos/" + smoke.REPO + "/issues"):
            with self.subTest(endpoint=endpoint):
                with self.assertRaises(ValueError):
                    smoke.read_only_get(endpoint, "dummy-secret", self.fail)
        for bad in ("", "\nsecret", "secret\r", "  token", "x" * 4097, 123, None):
            with self.subTest(bad_type=type(bad).__name__):
                with self.assertRaises(PermissionError):
                    smoke.read_only_get(smoke.INVENTORY, bad, self.fail)

    def test_manual_main_owner_context_only(self):
        base = self.good_context()
        smoke.verify_context(base)
        changes = {
            "GITHUB_ACTIONS": "false",
            "GITHUB_EVENT_NAME": "pull_request",
            "GITHUB_REPOSITORY": "other/repo",
            "GITHUB_REF": "refs/heads/feature/unsafe",
            "GITHUB_ACTOR": "other-user",
            "GITHUB_WORKFLOW": "untrusted",
        }
        for key, value in changes.items():
            with self.subTest(key=key):
                candidate = dict(base)
                candidate[key] = value
                with self.assertRaises(PermissionError):
                    smoke.verify_context(candidate)

    def test_no_redirect_forwarding(self):
        self.assertIsNone(smoke.NoRedirect().redirect_request(None, None, 302,
                                                               "Moved", {},
                                                               "https://evil.example"))

    def test_workflow_contract_never_uses_write_scope_or_pr_trigger(self):
        root = Path(__file__).resolve().parent.parent
        path = root / ".github/workflows/qa-autofix-app-token-smoke.yml"
        content = path.read_text(encoding="utf-8")
        self.assertIn("  workflow_dispatch:", content)
        self.assertNotIn("  pull_request:", content)
        self.assertNotIn("  push:", content)
        self.assertNotIn("  workflow_run:", content)
        self.assertIn("github.ref == 'refs/heads/main'", content)
        self.assertIn("github.actor == '" + smoke.OWNER + "'", content)
        self.assertIn("      name: atrio-autofix-qa", content)
        self.assertIn("      deployment: false", content)
        self.assertIn("permission-contents: read", content)
        self.assertIn("permission-pull-requests: read", content)
        self.assertNotIn("permission-contents: write", content)
        self.assertNotIn("permission-pull-requests: write", content)
        self.assertNotIn("skip-token-revoke: true", content)
        self.assertNotIn("persist-credentials: true", content)
        self.assertIn("python3 -m scripts.ci_autofix_app_token_readonly_smoke", content)

    def test_main_hides_client_response_errors(self):
        env = self.good_context()
        env["ATRIO_APP_SMOKE_TOKEN"] = "dummy-secret"
        with patch.object(smoke, "verify_installation_token", side_effect=ValueError("sensitive-api-body")):
            with self.assertRaisesRegex(RuntimeError, "sem exibir dados confidenciais") as caught:
                smoke.main(env)
        self.assertNotIn("sensitive-api-body", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
