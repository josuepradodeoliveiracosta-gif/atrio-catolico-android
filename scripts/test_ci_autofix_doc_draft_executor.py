"""Offline, zero-network contract tests for the future QA documentation writer."""
from pathlib import Path
import unittest

from scripts import ci_autofix_doc_draft_executor as writer
from scripts.ci_autofix_doc_candidate import _pinned_source, TARGET


ROOT = Path(__file__).resolve().parents[1]
BASE_SHA = "a" * 40


class DocDraftTransactionTests(unittest.TestCase):
    def setUp(self):
        self.source = _pinned_source(ROOT)
        self.client = writer.InMemoryDraftClient(BASE_SHA, self.source)
        self.before = (ROOT / TARGET).read_bytes()

    def tearDown(self):
        self.assertEqual((ROOT / TARGET).read_bytes(), self.before)

    def execute(self, client=None, sha=BASE_SHA, confirmation=writer.CONFIRMATION):
        return writer.simulate_approved_doc_draft(
            ROOT, sha, confirmation, self.client if client is None else client)

    def test_expected_transaction_never_reaches_github(self):
        result = self.execute()
        self.assertEqual(result["status"],
                         "simulated_draft_created_requires_human_review")
        self.assertTrue(result["draft"])
        self.assertFalse(result["merged"])
        self.assertFalse(result["production_access"])
        self.assertEqual(result["remote_writes"], 0)
        self.assertEqual(result["actual_pull_requests_created"], 0)
        self.assertEqual(result["simulated_pull_requests_created"], 1)
        self.assertEqual(self.client.events.count("create_branch"), 1)
        self.assertEqual(self.client.events.count("write_document"), 1)
        self.assertEqual(self.client.events.count("create_pr"), 1)
        self.assertEqual(self.client.branch_file.count("6. **Depois das integrações"), 1)

    def test_only_exact_in_memory_client_is_allowed(self):
        with self.assertRaises(PermissionError):
            self.execute(client=object())
        class Pretender(writer.InMemoryDraftClient):
            pass
        with self.assertRaises(PermissionError):
            self.execute(client=Pretender(BASE_SHA, self.source))
        self.assertEqual(self.client.events, [])

    def test_wrong_approval_rejects_before_any_activity(self):
        for wrong in ("", "autorizei", "CREATE_ATRIO_QA_DRAFT_PR_ONLY", None):
            with self.subTest(wrong=wrong), self.assertRaises(PermissionError):
                self.execute(confirmation=wrong)
        self.assertEqual(self.client.events, [])

    def test_bad_sha_or_main_drift_blocks_before_branch(self):
        with self.assertRaises(ValueError):
            self.execute(sha="not-a-sha")
        drift = writer.InMemoryDraftClient(BASE_SHA, self.source, fault="main_drift")
        with self.assertRaises(ValueError):
            self.execute(client=drift)
        self.assertNotIn("create_branch", drift.events)

    def test_existing_branch_blocks_before_creation(self):
        with self.assertRaises(ValueError):
            self.execute(client=writer.InMemoryDraftClient(
                BASE_SHA, self.source, fault="existing_branch"))
        self.assertNotIn("create_branch", self.client.events)

    def test_existing_pr_blocks_before_creation(self):
        existing = writer.InMemoryDraftClient(BASE_SHA, self.source, fault="existing_pr")
        with self.assertRaises(ValueError):
            self.execute(client=existing)
        self.assertNotIn("create_branch", existing.events)

    def test_mismatched_remote_document_blocks_before_creation(self):
        drift = writer.InMemoryDraftClient(BASE_SHA, self.source, fault="base_drift")
        with self.assertRaises(ValueError):
            self.execute(client=drift)
        self.assertNotIn("create_branch", drift.events)

    def test_unexpected_branch_response_does_not_write_file_or_pr(self):
        drift = writer.InMemoryDraftClient(BASE_SHA, self.source,
                                          fault="branch_response_wrong")
        with self.assertRaises(ValueError):
            self.execute(client=drift)
        self.assertNotIn("write_document", drift.events)
        self.assertNotIn("create_pr", drift.events)

    def test_post_creation_main_drift_leaves_branch_for_review(self):
        drift = writer.InMemoryDraftClient(BASE_SHA, self.source,
                                          fault="post_branch_main_drift")
        with self.assertRaises(ValueError):
            self.execute(client=drift)
        self.assertTrue(drift.branch_exists)
        self.assertNotIn("write_document", drift.events)
        self.assertNotIn("create_pr", drift.events)

    def test_branch_drift_blocks_before_document_update(self):
        drift = writer.InMemoryDraftClient(BASE_SHA, self.source,
                                          fault="branch_drift")
        with self.assertRaises(ValueError):
            self.execute(client=drift)
        self.assertNotIn("write_document", drift.events)

    def test_forged_write_response_fails_before_pr(self):
        drift = writer.InMemoryDraftClient(BASE_SHA, self.source,
                                          fault="write_response_wrong")
        with self.assertRaises(ValueError):
            self.execute(client=drift)
        self.assertTrue(drift.branch_exists)
        self.assertNotIn("create_pr", drift.events)

    def test_modified_file_after_write_fails_before_pr(self):
        drift = writer.InMemoryDraftClient(BASE_SHA, self.source,
                                          fault="write_corruption")
        with self.assertRaises(ValueError):
            self.execute(client=drift)
        self.assertNotIn("create_pr", drift.events)

    def test_extra_diff_fails_before_pr(self):
        drift = writer.InMemoryDraftClient(BASE_SHA, self.source,
                                          fault="extra_diff")
        with self.assertRaises(ValueError):
            self.execute(client=drift)
        self.assertNotIn("create_pr", drift.events)

    def test_not_draft_or_wrong_repo_are_rejected(self):
        for fault in ("not_draft", "wrong_repo"):
            with self.subTest(fault=fault):
                drift = writer.InMemoryDraftClient(BASE_SHA, self.source, fault=fault)
                with self.assertRaises(ValueError):
                    self.execute(client=drift)
                self.assertEqual(drift.events[-1], "create_pr")

    def test_invalid_local_source_or_absent_checkout_blocks_before_any_branch(self):
        with self.assertRaises((OSError, ValueError)):
            writer.simulate_approved_doc_draft(
                ROOT / "nonexistent-path", BASE_SHA, writer.CONFIRMATION, self.client)
        self.assertEqual(self.client.events, [])

    def test_no_write_workflow_or_cli_is_exposed(self):
        self.assertFalse(hasattr(writer, "main"))
        self.assertFalse(hasattr(writer, "GitHubDraftClient"))
        self.assertFalse(hasattr(writer, "create_github_token"))
        self.assertFalse(hasattr(writer, "deploy"))
        workflow = (ROOT / ".github/workflows/autofix-qa-approved-draft.yml").read_text(encoding="utf-8")
        self.assertNotIn("ci_autofix_doc_draft_executor", workflow)


if __name__ == "__main__":
    unittest.main()
