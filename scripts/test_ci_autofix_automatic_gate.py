"""Offline safety tests for the approved GitHub App QA draft workflow."""
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest

from scripts.ci_autofix_automatic_gate import (
    TRUSTED_TRIGGER, TRUSTED_WORKFLOW, execute_trusted_automatic_draft,
    main, select_candidate, verify_trusted_event,
)
from scripts.ci_autofix_pr_draft_plan import draft_pr_plan
from scripts.test_ci_autofix_pr_draft_plan import good_handoff, live
from scripts.test_ci_autofix_pr_draft_executor import FakeDraftClient
from scripts.ci_quality_report import REPO

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/autofix-qa-approved-draft.yml"
SHA = "a" * 40


def trusted():
    event = {
        "repository": {"full_name": REPO},
        "workflow_run": {
            "id": 123, "name": TRUSTED_TRIGGER, "conclusion": "success",
            "event": "push", "head_branch": "main",
            "head_sha": SHA, "head_repository": {"full_name": REPO},
        },
    }
    env = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_EVENT_NAME": "workflow_run",
        "GITHUB_WORKFLOW": TRUSTED_WORKFLOW,
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_REF": "refs/heads/main",
    }
    return event, env


class ApprovedAutofixTests(unittest.TestCase):
    def test_valid_main_push_and_reject_all_untrusted_sources(self):
        event, env = trusted()
        self.assertEqual(verify_trusted_event(event, env), SHA)
        variants = (
            ("fork", lambda e, n: e["workflow_run"]["head_repository"].update(
                full_name="attacker/other")),
            ("pr", lambda e, n: e["workflow_run"].update(event="pull_request")),
            ("branch", lambda e, n: e["workflow_run"].update(
                head_branch="untrusted")),
            ("failed", lambda e, n: e["workflow_run"].update(
                conclusion="failure")),
            ("wrong_workflow", lambda e, n: e["workflow_run"].update(
                name="fake-workflow")),
            ("wrong_repository", lambda e, n: e["repository"].update(
                full_name="attacker/other")),
            ("missing_sha", lambda e, n: e["workflow_run"].update(
                head_sha="not-a-sha")),
            ("no_run_id", lambda e, n: e["workflow_run"].update(id=0)),
            ("manual", lambda e, n: n.update(GITHUB_EVENT_NAME="workflow_dispatch")),
            ("wrong_runner", lambda e, n: n.update(
                GITHUB_WORKFLOW="other-workflow")),
            ("wrong_ref", lambda e, n: n.update(GITHUB_REF="refs/pull/2/merge")),
            ("no_actions", lambda e, n: n.update(GITHUB_ACTIONS="false")),
        )
        for label, change in variants:
            with self.subTest(label=label):
                e, n = deepcopy(event), dict(env)
                change(e, n)
                with self.assertRaises((PermissionError, ValueError)):
                    verify_trusted_event(e, n)

    def test_static_pinned_manifest_is_required_and_existing_branch_blocks(self):
        handoff = good_handoff()
        plan = draft_pr_plan(handoff, ROOT, live())
        self.assertTrue(select_candidate(plan, handoff, SHA, ROOT))
        for changes in (
            {"source_sha": "b" * 40},
            {"repository": "attacker/repo"},
            {"draft_only": False},
            {"eligible_for_automatic_remote_write": True},
            {"target_path": "app/src/main/AndroidManifest.xml"},
            {"draft_pr_body": "unreviewed patch"},
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    select_candidate({**plan, **changes}, handoff, SHA, ROOT)
        duplicate = draft_pr_plan(
            handoff, ROOT, live(duplicates=[261], branch_exists=True))
        self.assertFalse(select_candidate(duplicate, handoff, SHA, ROOT))
        self.assertFalse(select_candidate(
            draft_pr_plan(handoff, ROOT, live(branch_exists=True)),
            handoff, SHA, ROOT))

    def test_automatic_draft_transaction_remains_one_file_draft_without_merge(self):
        event, env = trusted()
        handoff = good_handoff()
        plan = draft_pr_plan(handoff, ROOT, live())
        client = FakeDraftClient()
        result = execute_trusted_automatic_draft(
            plan, handoff, event, env, ROOT, client)
        self.assertEqual(result["status"], "draft_pr_created_review_required")
        self.assertTrue(result["draft"])
        self.assertFalse(result["merged"])
        self.assertTrue(result["requires_human_review"])
        self.assertEqual(client.events.count("create_branch"), 1)
        self.assertEqual(client.events.count("patch_file"), 1)
        self.assertEqual(client.events.count("create_pr"), 1)
        self.assertFalse({"merge", "deploy", "delete_branch"}.
                         intersection(client.events))

    def test_remote_conflict_and_untrusted_event_perform_no_writes(self):
        event, env = trusted()
        handoff = good_handoff()
        plan = draft_pr_plan(handoff, ROOT, live())
        for mode in ("existing_pr", "stale_main", "event_pr",
                     "mismatched_patch"):
            with self.subTest(mode=mode):
                client = FakeDraftClient()
                e = deepcopy(event)
                candidate = deepcopy(plan)
                if mode == "existing_pr":
                    client.branch_exists = True
                    client.duplicate_pr_numbers = [261]
                elif mode == "stale_main":
                    client.main_sha = "b" * 40
                elif mode == "event_pr":
                    e["workflow_run"]["event"] = "pull_request"
                elif mode == "mismatched_patch":
                    candidate["preview_patch_sha256"] = "0" * 64
                with self.assertRaises((ValueError, PermissionError)):
                    execute_trusted_automatic_draft(
                        candidate, handoff, e, env, ROOT, client)
                self.assertFalse({"create_branch", "patch_file", "create_pr"}.
                                 intersection(client.events))

    def test_select_writes_only_validated_decision_not_token(self):
        event, env = trusted()
        handoff = good_handoff()
        plan = draft_pr_plan(handoff, ROOT, live())
        with TemporaryDirectory() as td:
            folder = Path(td)
            hfile, pfile, output = (
                folder / "handoff.json", folder / "manifest.json",
                folder / "github-output")
            hfile.write_text(json.dumps(handoff), encoding="utf-8")
            pfile.write_text(json.dumps(plan), encoding="utf-8")
            context = {**env, "GITHUB_EVENT_PATH": "offline-in-memory-event",
                       "GITHUB_OUTPUT": str(output)}
            argv = ["--phase", "select", "--checkout-root", str(ROOT),
                    "--handoff", str(hfile), "--manifest", str(pfile)]
            # Keep the mock event in memory: never persist event data to disk.
            with patch("scripts.ci_autofix_automatic_gate.read_event_file",
                       return_value=event):
                self.assertEqual(main(argv, env=context), 0)
                self.assertEqual(output.read_text(), "eligible=true\nsource_sha="
                                 + SHA + "\n")
                # A writer cannot be invoked from Termux or with only a PAT.
                with self.assertRaises(PermissionError):
                    main(["--phase", "write", *argv[2:]],
                         env={**context, "GITHUB_ACTIONS": "false",
                              "ATRIO_AUTOFIX_APP_TOKEN": "fake"})
                with self.assertRaises(PermissionError):
                    main(["--phase", "write", *argv[2:]], env=context)

    def test_workflow_privilege_and_provenance_contract(self):
        wf = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("  workflow_run:\n", wf)
        self.assertIn("    types: [completed]", wf)
        self.assertIn("    branches: [main]", wf)
        self.assertNotIn("pull_request_target", wf)
        self.assertNotIn("workflow_dispatch", wf)
        self.assertNotIn("secrets.ATRIO_QA_READ_TOKEN", wf)
        self.assertNotIn("secrets.GITHUB_TOKEN", wf)
        self.assertNotIn("write-all", wf)
        self.assertEqual(wf.count("persist-credentials: false"), 2)
        self.assertEqual(wf.count("ref: main"), 2)
        self.assertIn("github.event.workflow_run.event == 'push'", wf)
        self.assertIn("github.event.workflow_run.head_branch == 'main'", wf)
        self.assertIn("github.event.workflow_run.head_repository.full_name", wf)
        self.assertIn("cancel-in-progress: false", wf)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", wf)
        preflight = wf.split("  preflight:\n", 1)[1].split(
            "  write_draft:\n", 1)[0]
        writer = wf.split("  write_draft:\n", 1)[1]
        self.assertIn("      checks: read", preflight)
        self.assertIn("      actions: read", preflight)
        self.assertIn("      pull-requests: read", preflight)
        self.assertNotIn("contents: write", preflight)
        self.assertNotIn("secrets.", preflight)
        self.assertIn("      contents: read", writer)
        self.assertNotIn("      contents: write", writer)
        self.assertIn("    environment:\n      name: atrio-autofix-qa\n      deployment: false", writer)
        self.assertIn("actions/create-github-app-token@v3", writer)
        self.assertIn("permission-contents: write", writer)
        self.assertIn("permission-pull-requests: write", writer)
        self.assertIn("repositories: atrio-catolico-android", writer)
        self.assertIn("secrets.ATRIO_AUTOFIX_APP_PRIVATE_KEY", writer)
        self.assertIn("vars.ATRIO_AUTOFIX_APP_CLIENT_ID", writer)
        self.assertIn("ATRIO_AUTOFIX_APP_TOKEN:", writer)
        self.assertNotIn("GITHUB_TOKEN:", writer)
        self.assertNotIn("pull_request_target", writer)
        self.assertIn("needs.preflight.outputs.eligible == 'true'", writer)
        self.assertNotIn("firebase deploy", wf.lower())
        self.assertNotIn("wrangler deploy", wf.lower())


if __name__ == "__main__":
    unittest.main()
