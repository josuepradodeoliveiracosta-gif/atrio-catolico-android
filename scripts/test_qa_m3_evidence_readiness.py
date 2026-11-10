"""Testes com respostas GitHub fictícias, sem rede ou credenciais."""
import unittest
from scripts.qa_m3_evidence_readiness import (
    CHECKS, REPO, URL_PREFIX, MAIN_SHA, PARENT_SHA, PARENT_BRANCH,
    fixed_paths, collect, summarize, markdown,
)

def fixture():
    state = {
        "/branches/main": {"commit": {"sha": MAIN_SHA}},
        "/pulls/193": {
            "number": 193, "state": "open", "draft": True,
            "head": {"sha": PARENT_SHA, "ref": PARENT_BRANCH},
            "base": {"ref": "main"},
        },
        "/issues/200": {"number": 200, "state": "open"},
    }
    for number, sha, run_id, name in CHECKS:
        state["/pulls/" + str(number)] = {
            "number": number, "state": "open", "draft": True,
            "head": {"sha": sha, "repo": {"full_name": REPO}},
            "base": {"ref": PARENT_BRANCH},
        }
        state["/actions/runs/" + str(run_id)] = {
            "id": run_id, "name": name, "event": "pull_request",
            "status": "completed", "conclusion": "success",
            "head_sha": sha, "repository": {"full_name": REPO},
        }
    return state


class QAEvidenceReadinessTests(unittest.TestCase):
    def safe(self, state=None):
        out = summarize(fixture() if state is None else state)
        self.assertEqual(out["status"], "NO_GO")
        self.assertFalse(out["qaDeployAuthorized"])
        self.assertFalse(out["prodDeployAuthorized"])
        self.assertFalse(out["mergeAuthorized"])
        self.assertFalse(out["policyApproved"])
        self.assertEqual(out["deletedCount"], 0)
        self.assertEqual(out["completedMilestones"], 2)
        return out

    def test_complete_pinned_qa_evidence_is_only_ready_for_human_review(self):
        report = self.safe()
        self.assertEqual(report["evidenceState"], "READY_FOR_HUMAN_REVIEW")
        self.assertEqual(report["checkedDraftPRs"], 8)
        self.assertEqual(report["validatedDraftPRs"], 8)
        self.assertEqual(report["issue200State"], "open")

    def test_failure_run_or_skipped_is_not_a_success(self):
        for status, conclusion in [
            ("completed", "failure"), ("completed", "skipped"),
            ("completed", "cancelled"), ("in_progress", None)
        ]:
            data = fixture()
            run_id = CHECKS[0][2]
            data["/actions/runs/" + str(run_id)]["status"] = status
            data["/actions/runs/" + str(run_id)]["conclusion"] = conclusion
            report = self.safe(data)
            self.assertEqual(report["validatedDraftPRs"], 7)
            self.assertEqual(report["evidenceState"], "EVIDENCE_INCOMPLETE")

    def test_run_success_for_old_commit_is_rejected(self):
        data = fixture()
        data["/actions/runs/" + str(CHECKS[1][2])]["head_sha"] = "0" * 40
        report = self.safe(data)
        self.assertIn("CI_NOT_VALID_FOR_PR:219", report["problems"])

    def test_external_repository_or_wrong_event_not_valid(self):
        data = fixture()
        data["/pulls/218"]["head"]["repo"]["full_name"] = "other/repo"
        data["/actions/runs/" + str(CHECKS[1][2])]["event"] = "workflow_dispatch"
        report = self.safe(data)
        self.assertIn("PR_STATE_OR_SHA_MISMATCH:218", report["problems"])
        self.assertIn("CI_NOT_VALID_FOR_PR:219", report["problems"])

    def test_pr_merge_or_un_draft_is_not_equivalent_to_review(self):
        data = fixture()
        data["/pulls/220"]["draft"] = False
        data["/pulls/221"]["state"] = "closed"
        report = self.safe(data)
        self.assertEqual(report["validatedDraftPRs"], 6)

    def test_parent_branch_movement_or_main_change_requires_rereview(self):
        data = fixture()
        data["/pulls/193"]["head"]["sha"] = "f" * 40
        data["/branches/main"]["commit"]["sha"] = "a" * 40
        report = self.safe(data)
        self.assertIn("PARENT_PR_193_MOVED_OR_NOT_DRAFT", report["problems"])
        self.assertIn("MAIN_SHA_REVIEW_REQUIRED", report["problems"])

    def test_closing_issue_never_authorizes_chat(self):
        data = fixture()
        data["/issues/200"]["state"] = "closed"
        report = self.safe(data)
        self.assertEqual(report["status"], "NO_GO")
        self.assertEqual(report["evidenceState"], "EVIDENCE_INCOMPLETE")

    def test_missing_api_responses_fail_closed(self):
        data = fixture()
        del data["/actions/runs/" + str(CHECKS[-1][2])]
        del data["/pulls/193"]
        report = self.safe(data)
        self.assertIn("CI_NOT_VALID_FOR_PR:225", report["problems"])
        self.assertIn("PARENT_PR_193_MOVED_OR_NOT_DRAFT", report["problems"])

    def test_collector_only_makes_pinned_gets(self):
        calls = []
        data = fixture()
        def fake_fetch(url):
            calls.append(url)
            return data[url.removeprefix(URL_PREFIX)]
        self.assertEqual(collect(fake_fetch), data)
        self.assertEqual(len(calls), 19)
        self.assertEqual(set(calls), {URL_PREFIX + p for p in fixed_paths()})

    def test_report_is_sanitized_and_does_not_copy_remote_content(self):
        data = fixture()
        secret = "pessoa-sintetica@invalid.test"
        data["/pulls/218"]["body"] = secret
        data["/pulls/218"]["author"] = {"login": secret}
        report = self.safe(data)
        combined = str(report) + markdown(report)
        self.assertNotIn(secret, combined)
        self.assertNotIn("Bearer", combined)
        self.assertIn("NO-GO", combined)

    def test_wrong_run_name_does_not_qualify(self):
        data = fixture()
        data["/actions/runs/" + str(CHECKS[3][2])]["name"] = "Another job"
        report = self.safe(data)
        self.assertIn("CI_NOT_VALID_FOR_PR:221", report["problems"])

    def test_empty_or_invalid_external_data_never_implies_go(self):
        for value in (None, [], {}, "false"):
            # Chamar o validador diretamente: o helper safe() usa None
            # como atalho para uma fixture valida, o que mascarava o teste.
            report = summarize(value)
            self.assertEqual(report["status"], "NO_GO")
            self.assertFalse(report["qaDeployAuthorized"])
            self.assertFalse(report["prodDeployAuthorized"])
            self.assertFalse(report["mergeAuthorized"])
            self.assertEqual(report["evidenceState"], "EVIDENCE_INCOMPLETE")
            self.assertEqual(report["validatedDraftPRs"], 0)


if __name__ == "__main__":
    unittest.main()
