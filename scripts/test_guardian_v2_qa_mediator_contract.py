"""Pure negative policy scenarios. No IAM or Firebase permission probe."""
import unittest

from scripts.guardian_v2_qa_mediator_contract import (
    PRODUCTION_PROJECT, QA_FIXTURE_PROJECT, simulate_qa_intent,
)

CASE = {
    "operation": "propose_case",
    "case_id": "guard_" + "a" * 32,
    "owner_uid": "synthetic_actor",
    "target_path": "posts/synthetic_post",
    "source_update_time": "2026-11-14T10:00:00Z",
    "status": "review",
}
POLICY = {
    "update_time": "2026-11-14T09:00:00Z",
    "enabled": False,
    "autonomous_write_enabled": False,
    "emergency_stop": False,
    "allow_hold": False,
}
ACTIVATE = {"operation": "enable_nonpunitive", "expected_update_time": POLICY["update_time"]}


def evaluate(role, payload, **kwargs):
    return simulate_qa_intent(project=QA_FIXTURE_PROJECT, trusted_role=role,
                              request=payload, **kwargs)


class QaMediatorContractTests(unittest.TestCase):
    def test_triage_can_simulate_read_policy(self):
        p = evaluate("triage", {"operation": "read_policy"})
        self.assertEqual(p["decision"], "SIMULATED_ALLOW")
        self.assertFalse(p["production_authorized"])
        self.assertEqual(p["plan"]["relative_path"], "guardian_config/policy")

    def test_triage_valid_case_is_only_an_intent_not_direct_firestore_commit(self):
        p = evaluate("triage", CASE)
        self.assertEqual(p["decision"], "SIMULATED_ALLOW")
        self.assertFalse(p["production_authorized"])
        self.assertIn("daily_budget_cas", p["requires"])
        self.assertEqual(p["plan"]["case"], "guardian_cases/" + CASE["case_id"])
        self.assertNotIn("writes", p["plan"])

    def test_reply_target_can_be_synthetic(self):
        case = dict(CASE, target_path="posts/seed/replies/answer", status="warned")
        self.assertEqual(evaluate("triage", case)["decision"], "SIMULATED_ALLOW")

    def test_activation_simulates_two_fields_only_with_approval_and_policy_snapshot(self):
        p = evaluate("activation", ACTIVATE, manually_approved=True, policy_snapshot=POLICY)
        self.assertEqual(p["decision"], "SIMULATED_ALLOW")
        self.assertFalse(p["production_authorized"])
        self.assertEqual(p["plan"]["fields"], {"enabled": True,
                                                 "autonomousWriteEnabled": True})
        self.assertEqual(p["plan"]["update_mask"], ["enabled", "autonomousWriteEnabled"])

    def test_triage_cannot_activate_policy(self):
        self.assertEqual(evaluate("triage", ACTIVATE,
                                  manually_approved=True, policy_snapshot=POLICY)["decision"],
                         "SIMULATED_DENY")

    def test_activation_cannot_propose_cases_or_read_policy(self):
        for payload in (CASE, {"operation": "read_policy"}):
            self.assertEqual(evaluate("activation", payload)["decision"], "SIMULATED_DENY")

    def test_both_cannot_delete_or_write_direct_firestore(self):
        for role in ("triage", "activation"):
            for operation in ("delete", "commit", "patch", "create_profile", "budget_update",
                              "disable_emergency_stop", "impersonate_other_principal"):
                with self.subTest(role=role, operation=operation):
                    self.assertEqual(evaluate(role, {"operation": operation})["decision"],
                                     "SIMULATED_DENY")

    def test_project_is_locked_to_qa_fixture_and_never_production(self):
        for project in (PRODUCTION_PROJECT, "different-qa", "", None):
            p = simulate_qa_intent(project=project, trusted_role="triage", request=CASE)
            self.assertEqual(p["decision"], "SIMULATED_DENY")
            self.assertFalse(p["production_authorized"])

    def test_body_supplied_identity_and_extra_fields_never_grant_authority(self):
        for role in ("triage", "activation"):
            for extra in ({"role": "activation"}, {"caller_email": "fake@qa"},
                          {"writes": []}, {"path": "guardian_config/policy"},
                          {"method": "PATCH"}):
                payload = dict(CASE if role == "triage" else ACTIVATE, **extra)
                p = evaluate(role, payload, manually_approved=True, policy_snapshot=POLICY)
                self.assertEqual(p["decision"], "SIMULATED_DENY")

    def test_triage_cannot_choose_document_path_or_malformed_case_id(self):
        for patch in (
            {"case_id": "../../guardian_config"},
            {"owner_uid": "user/secret"},
            {"target_path": "guardian_config/policy"},
            {"target_path": "posts/synthetic_post/replies/../../policy"},
            {"status": "deleted"},
            {"source_update_time": "not-a-version"},
        ):
            self.assertEqual(evaluate("triage", dict(CASE, **patch))["decision"],
                             "SIMULATED_DENY")

    def test_activation_requires_manual_approval_and_fresh_policy_version(self):
        for approved, snap, req in (
            (False, POLICY, ACTIVATE),
            (1, POLICY, ACTIVATE),
            (True, None, ACTIVATE),
            (True, dict(POLICY, update_time="2026-11-14T09:00:01Z"), ACTIVATE),
            (True, POLICY, dict(ACTIVATE, expected_update_time="bad")),
        ):
            self.assertEqual(evaluate("activation", req, manually_approved=approved,
                                      policy_snapshot=snap)["decision"], "SIMULATED_DENY")

    def test_emergency_stop_and_allow_hold_block_activation(self):
        for patch in ({"emergency_stop": True}, {"allow_hold": True},
                      {"emergency_stop": 0}, {"enabled": 1}):
            p = evaluate("activation", ACTIVATE, manually_approved=True,
                         policy_snapshot=dict(POLICY, **patch))
            self.assertEqual(p["decision"], "SIMULATED_DENY")

    def test_malformed_or_missing_payload_is_denied(self):
        for role in ("triage", "activation", "unknown", ""):
            for req in (None, "case", [], {}, {"operation": "read_policy", "role": "triage"}):
                self.assertEqual(evaluate(role, req)["decision"], "SIMULATED_DENY")

    def test_every_success_is_explicitly_simulated_not_production_authorization(self):
        candidates = [evaluate("triage", CASE),
                      evaluate("triage", {"operation": "read_policy"}),
                      evaluate("activation", ACTIVATE, manually_approved=True,
                               policy_snapshot=POLICY)]
        self.assertTrue(all(x["decision"] == "SIMULATED_ALLOW" and
                            x["production_authorized"] is False for x in candidates))


if __name__ == "__main__":
    unittest.main()
