"""Regressoes offline: assessor nunca habilita Rule real por dados declarados."""
import io
import json
from pathlib import Path
import unittest
from scripts.qa_firestore_m3_preflight import PIN, inspect, blob_hash, issue_state

ROOT = Path(__file__).resolve().parent.parent


class QaMilestoneThreeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = (ROOT / "firestore.rules").read_text()
        cls.candidates = {
            "standalone": (ROOT / "tests/security/qa-general.generated.rules").read_text(),
            "parity": (ROOT / "tests/security/qa-parity.generated.rules").read_text(),
        }

    def assess(self, **kwargs):
        return inspect(self.base, self.candidates, **kwargs)

    def test_versioned_rules_and_candidates_are_reviewable(self):
        x = self.assess()
        self.assertEqual(blob_hash(self.base), PIN)
        self.assertTrue(x["base_blob_matches_pin"])
        for c in x["candidates"].values():
            self.assertTrue(all(c["checks"].values()), c["checks"])
        self.assertEqual(x["status"], "NO_GO")
        self.assertFalse(x["deployment_authorized"])
        self.assertEqual((x["completed_milestones"], x["total_milestones"]), (2, 7))

    def test_mutated_main_or_open_permission_blocks(self):
        x = inspect(self.base+"//changed", self.candidates)
        self.assertIn("VERSIONED_MAIN_RULES_BLOB_CHANGED", x["blockers"])
        y = inspect(self.base, {
            **self.candidates,
            "standalone": self.candidates["standalone"]+"\nallow read, write: if true;"
        })
        self.assertIn("CANDIDATE_STANDALONE_REVIEW_REQUIRED", y["blockers"])

    def test_new_open_grant_inside_parity_delta_fails(self):
        injected = self.candidates["parity"].replace(
            "    // END QA PARITY ADDITIVE:",
            "    allow list: if true;\n    // END QA PARITY ADDITIVE:",
            1,
        )
        x = inspect(self.base, {**self.candidates, "parity": injected})
        self.assertFalse(x["candidates"]["parity"]["checks"]["no_literal_open_grants"])
        self.assertIn("CANDIDATE_PARITY_REVIEW_REQUIRED", x["blockers"])

    def test_wrong_qa_project_does_not_count_as_cloud_evidence(self):
        fake = {"project": "atrio-catolico", "mode": "READ_ONLY_TWO_GET",
                "firestoreRulesCurrentlyDenyAll": True, "safeToEnableChat": False,
                "productionContacted": False, "deployPerformed": False,
                "sha256": "a"*64}
        x = self.assess(qa_report=fake)
        self.assertFalse(x["imported_reports_NOT_authenticated"]["qa_deny_all_consistent"])
        self.assertIn("QA_CLOUD_DENY_ALL_NOT_EVIDENCED", x["blockers"])

    def test_provided_reports_and_closed_issue_never_authorize(self):
        qa = {"project": "atrio-catolico-qa-geral", "mode": "READ_ONLY_TWO_GET",
              "firestoreRulesCurrentlyDenyAll": True, "safeToEnableChat": False,
              "productionContacted": False, "deployPerformed": False, "sha256": "a"*64}
        x = self.assess(issue="closed", qa_report=qa)
        self.assertTrue(x["imported_reports_NOT_authenticated"]["qa_deny_all_consistent"])
        self.assertIn("ISSUE_200_CLOSED_DOES_NOT_PROVE_FORMAL_APPROVAL", x["blockers"])
        self.assertFalse(x["deployment_authorized"])
        self.assertEqual(x["status"], "NO_GO")

    def test_fixed_issue_endpoint_only_one_get(self):
        calls = []
        class Fake:
            def __enter__(self):
                raw = {"number": 200, "state": "open",
                       "repository_url": "https://api.github.com/repos/josuepradodeoliveiracosta-gif/atrio-catolico-android"}
                return io.BytesIO(json.dumps(raw).encode())
            def __exit__(self, *args):
                return False
        def opener(req, timeout):
            calls.append((req.full_url, timeout))
            return Fake()
        self.assertEqual(issue_state("mock-test-token", opener), "open")
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0][0].endswith("/issues/200"))
        self.assertEqual(calls[0][1], 15)

    def test_missing_or_mismatched_issue_fails_closed(self):
        self.assertEqual(issue_state(""), "unknown")
        self.assertIn("ISSUE_200_POLICY_STILL_OPEN_OR_UNKNOWN",
                      self.assess(issue="unknown")["blockers"])

    def test_report_has_no_rules_bodies_tokens_or_approval(self):
        x = self.assess()
        raw = json.dumps(x)
        self.assertNotIn("service cloud.firestore {", raw)
        self.assertNotIn("Bearer", raw)
        self.assertNotIn("deployment_authorized\": true", raw)


if __name__ == "__main__":
    unittest.main()
