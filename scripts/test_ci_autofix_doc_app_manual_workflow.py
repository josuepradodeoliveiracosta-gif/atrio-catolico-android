"""Offline security contract for the owner-only QA document App write workflow.

This test reads the workflow as TEXT; it does not mint tokens or send requests.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/qa-doc-app-draft-manual.yml"
PRIVILEGED_AUTOMATIC = ROOT / ".github/workflows/autofix-qa-approved-draft.yml"
REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
OWNER = "josuepradodeoliveiracosta-gif"


class AppManualDocumentWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = WORKFLOW.read_text(encoding="utf-8")

    def test_only_one_manual_trigger_and_explicit_sha_confirmation(self):
        header = self.data.split("\npermissions:\n", 1)[0]
        self.assertIn("\non:\n  workflow_dispatch:\n", header)
        self.assertNotIn("\n  push:", header)
        self.assertNotIn("\n  pull_request:", header)
        self.assertNotIn("\n  workflow_run:", header)
        self.assertNotIn("\n  schedule:", header)
        self.assertIn("expected_main_sha:", header)
        self.assertIn("confirmation:", header)
        self.assertIn("required: true", header)
        self.assertIn("cancel-in-progress: false", self.data)

    def test_owner_and_main_and_exact_confirmation_gate_both_jobs(self):
        self.assertGreaterEqual(
            self.data.count("github.actor == '" + OWNER + "'"), 2)
        self.assertGreaterEqual(
            self.data.count("github.triggering_actor == '" + OWNER + "'"), 2)
        self.assertGreaterEqual(
            self.data.count("github.ref == 'refs/heads/main'"), 2)
        self.assertGreaterEqual(
            self.data.count(
                "inputs.confirmation == 'CREATE_ONE_ATRIO_DOCUMENT_QA_DRAFT_ONLY'"
            ), 2)
        self.assertIn("github.repository == '" + REPO + "'", self.data)
        self.assertIn("needs.validate.result == 'success'", self.data)

    def test_privileged_key_is_only_in_second_job_and_from_existing_env(self):
        first, second = self.data.split("\n  create_draft:\n", 1)
        self.assertNotIn("ATRIO_AUTOFIX_APP_PRIVATE_KEY", first)
        self.assertNotIn("ATRIO_QA_APP_TOKEN", first)
        self.assertNotIn("create-github-app-token", first)
        self.assertIn("name: atrio-autofix-qa", second)
        self.assertIn("deployment: false", second)
        self.assertEqual(self.data.count("ATRIO_AUTOFIX_APP_PRIVATE_KEY"), 1)
        self.assertEqual(self.data.count("actions/create-github-app-token@v3"), 1)
        self.assertIn("permission-contents: write", second)
        self.assertIn("permission-pull-requests: write", second)
        self.assertIn("repositories: atrio-catolico-android", second)
        self.assertNotIn("permissions:\n      contents: write", second)
        self.assertNotIn("permissions:\n      pull-requests: write", second)
        self.assertIn("contents: read", second)

    def test_no_sensitive_run_logs_or_auto_merge_deploy(self):
        self.assertNotIn("set -x", self.data)
        self.assertNotIn("echo \"$ATRIO_QA_APP_TOKEN\"", self.data)
        self.assertNotIn("print(os.environ", self.data)
        self.assertNotIn("git push", self.data)
        self.assertNotIn("gh pr merge", self.data)
        self.assertNotIn("firebase deploy", self.data)
        self.assertNotIn("cloudflare deploy", self.data)
        self.assertNotIn("wrangler deploy", self.data)
        self.assertNotIn("runs-on: self-hosted", self.data)

    def test_offline_suite_and_document_prehash_before_secret(self):
        first, second = self.data.split("\n  create_draft:\n", 1)
        secret_step = second.index("- name: Emitir token temporario da App")
        before_secret = second[:secret_step]
        self.assertIn("test \"$EXPECTED_SHA\" = \"$VERIFIED_SHA\"", before_secret)
        self.assertIn("test \"$VERIFIED_SHA\" = \"$EVENT_SHA\"", before_secret)
        self.assertIn("test \"$EVENT_SHA\" = \"$(git rev-parse HEAD)\"", before_secret)
        self.assertIn("ci_autofix_doc_candidate", before_secret)
        self.assertIn("scripts.test_ci_autofix_doc_live_writer", first)
        self.assertIn("scripts.test_ci_autofix_doc_app_manual_workflow", first)
        self.assertEqual(self.data.count("persist-credentials: false"), 2)

    def test_only_real_transaction_entrypoint_after_ephemeral_app_token(self):
        _, after_secret = self.data.split(
            "- name: Emitir token temporario da App", 1)
        self.assertIn("execute_manually_authorized_document_draft(", after_secret)
        self.assertIn("DocumentDraftAppTransport(os.environ[\"ATRIO_QA_APP_TOKEN\"])", after_secret)
        self.assertIn("result[\"draft\"] is not True", after_secret)
        self.assertIn("result[\"merged\"] is not False", after_secret)
        self.assertIn("result[\"remote_writes\"] != 3", after_secret)

    def test_existing_automatic_workflow_stays_unwired(self):
        other = PRIVILEGED_AUTOMATIC.read_text(encoding="utf-8")
        self.assertNotIn("ci_autofix_doc_live_writer", other)
        self.assertNotIn("qa-doc-app-draft-manual.yml", other)


if __name__ == "__main__":
    unittest.main()
