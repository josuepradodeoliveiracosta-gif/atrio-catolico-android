"""Offline broker fixture scenarios; no IAM, network, Firebase or deploy."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import unittest

from scripts.guardian_v2_qa_broker_fixture import (
    ACTIVATION_PRINCIPAL, TRIAGE_PRINCIPAL, TEST_REVISION,
    OfflineBrokerFixture, fixture_case_id,
)
from scripts.guardian_v2_qa_mediator_contract import QA_FIXTURE_PROJECT

T = TRIAGE_PRINCIPAL
A = ACTIVATION_PRINCIPAL


def case(target="posts/synthetic_post", **patch):
    request = {
        "operation": "propose_case",
        "case_id": fixture_case_id(target),
        "owner_uid": "synthetic_actor",
        "target_path": target,
        "source_update_time": TEST_REVISION,
        "status": "review",
    }
    return dict(request, **patch)


def activation(rev="2026-11-14T09:00:00Z"):
    return {"operation": "enable_nonpunitive", "expected_update_time": rev}


def call(broker, principal, request, approved=False):
    return broker.handle(trusted_principal=principal, request=request,
                         manually_approved=approved)


def activated(broker=None):
    fixture = broker or OfflineBrokerFixture()
    result = call(fixture, A, activation(), True)
    assert result["decision"] == "SIMULATED_ALLOW"
    return fixture


class BrokerOfflineTests(unittest.TestCase):
    def test_empty_fixture_has_no_writes(self):
        f = OfflineBrokerFixture()
        snap = f.snapshot()
        self.assertFalse(snap["policy"]["enabled"])
        self.assertEqual((snap["budget"], snap["cases"], snap["audits"], snap["notices"]),
                         (0, {}, {}, {}))
        self.assertEqual(snap["project"], QA_FIXTURE_PROJECT)

    def test_triage_reads_policy_without_writing(self):
        f = OfflineBrokerFixture()
        before = f.snapshot()
        result = call(f, T, {"operation": "read_policy"})
        self.assertEqual(result["decision"], "SIMULATED_ALLOW")
        self.assertEqual(result["policy"], before["policy"])
        self.assertEqual(f.snapshot(), before)
        self.assertFalse(result["production_authorized"])

    def test_triage_cannot_create_case_before_manual_activation(self):
        f = OfflineBrokerFixture()
        before = f.snapshot()
        self.assertEqual(call(f, T, case())["decision"], "SIMULATED_DENY")
        self.assertEqual(f.snapshot(), before)

    def test_manual_activation_updates_only_two_policy_flags(self):
        f = OfflineBrokerFixture()
        before = f.snapshot()
        result = call(f, A, activation(), True)
        after = f.snapshot()
        self.assertEqual(result["policy_update_mask"], ["enabled", "autonomousWriteEnabled"])
        self.assertTrue(after["policy"]["enabled"])
        self.assertTrue(after["policy"]["autonomous_write_enabled"])
        self.assertFalse(after["policy"]["emergency_stop"])
        self.assertFalse(after["policy"]["allow_hold"])
        self.assertNotEqual(after["policy"]["update_time"], before["policy"]["update_time"])
        self.assertEqual(after["budget"], 0)
        self.assertFalse(result["production_authorized"])

    def test_manual_activation_denied_without_approval(self):
        f = OfflineBrokerFixture()
        before = f.snapshot()
        self.assertEqual(call(f, A, activation())["decision"], "SIMULATED_DENY")
        self.assertEqual(f.snapshot(), before)

    def test_stale_revision_and_repeat_activation_are_denied(self):
        f = activated()
        before = f.snapshot()
        for req in (activation(), activation(before["policy"]["update_time"])):
            self.assertEqual(call(f, A, req, True)["decision"], "SIMULATED_DENY")
            self.assertEqual(f.snapshot(), before)

    def test_successful_case_is_atomic_synthetic_case_audit_notice_budget(self):
        f = activated()
        p = call(f, T, case())
        s = f.snapshot()
        cid = fixture_case_id("posts/synthetic_post")
        self.assertEqual(p["decision"], "SIMULATED_ALLOW")
        self.assertEqual(p["created"], ["case", "audit", "notice"])
        self.assertEqual(s["cases"][cid]["target"], "posts/synthetic_post")
        self.assertEqual(s["audits"][cid]["actor"], "guardian_v2")
        self.assertEqual(s["notices"][cid]["owner"], "synthetic_actor")
        self.assertEqual(s["budget"], 1)
        self.assertFalse(p["production_authorized"])

    def test_reply_case_is_supported_without_deleting_source(self):
        f = activated()
        p = call(f, T, case("posts/seed/replies/answer", status="warned"))
        self.assertEqual(p["decision"], "SIMULATED_ALLOW")
        self.assertEqual(f.snapshot()["budget"], 1)
        self.assertNotIn("delete", p)

    def test_wrong_owner_update_time_or_generated_case_id_is_denied(self):
        bad = ({"owner_uid": "different_actor"},
               {"source_update_time": "2026-11-14T10:00:01Z"},
               {"case_id": "guard_" + "a" * 32},
               {"case_id": "../../policy"})
        for patch in bad:
            with self.subTest(patch=patch):
                f = activated()
                before = f.snapshot()
                self.assertEqual(call(f, T, case(**patch))["decision"], "SIMULATED_DENY")
                self.assertEqual(f.snapshot(), before)

    def test_unknown_synthetic_source_is_denied_without_mutations(self):
        f = activated()
        before = f.snapshot()
        self.assertEqual(call(f, T, case("posts/not_in_fixture"))["decision"],
                         "SIMULATED_DENY")
        self.assertEqual(f.snapshot(), before)

    def test_duplicate_case_id_is_denied_and_budget_unchanged(self):
        f = activated()
        req = case()
        self.assertEqual(call(f, T, req)["decision"], "SIMULATED_ALLOW")
        before = f.snapshot()
        self.assertEqual(call(f, T, req)["decision"], "SIMULATED_DENY")
        self.assertEqual(f.snapshot(), before)

    def test_budget_cap_is_fail_closed_without_partial_writes(self):
        f = activated(OfflineBrokerFixture(max_cases=1))
        self.assertEqual(call(f, T, case())["decision"], "SIMULATED_ALLOW")
        before = f.snapshot()
        self.assertEqual(call(f, T, case("posts/another"))["decision"], "SIMULATED_DENY")
        self.assertEqual(f.snapshot(), before)
        self.assertEqual(before["budget"], 1)

    def test_cross_role_escalation_never_mutates_state(self):
        f = activated()
        before = f.snapshot()
        self.assertEqual(call(f, T, activation(before["policy"]["update_time"]), True)["decision"],
                         "SIMULATED_DENY")
        self.assertEqual(call(f, A, case(), True)["decision"], "SIMULATED_DENY")
        self.assertEqual(f.snapshot(), before)

    def test_forged_identity_fields_in_payload_are_denied(self):
        f = activated()
        before = f.snapshot()
        for extra in ({"principal": A}, {"trusted_role": "activation"},
                      {"service_account": "qa"}, {"caller_email": "qa@example.test"},
                      {"writes": []}, {"path": "guardian_config/policy"}):
            self.assertEqual(call(f, T, dict(case(), **extra))["decision"], "SIMULATED_DENY")
            self.assertEqual(f.snapshot(), before)

    def test_unrecognized_principals_and_payloads_denied(self):
        f = activated()
        before = f.snapshot()
        for identity in ("production-writer", "", None, 1, {"principal": T}):
            self.assertEqual(call(f, identity, case())["decision"], "SIMULATED_DENY")
        for body in (None, [], "case", {}, {"operation": "commit", "writes": []}):
            self.assertEqual(call(f, T, body)["decision"], "SIMULATED_DENY")
        self.assertEqual(f.snapshot(), before)

    def test_arbitrary_write_delete_and_policy_paths_are_denied(self):
        f = activated()
        before = f.snapshot()
        for principal in (T, A):
            for op in ("delete", "commit", "patch", "update_profile",
                       "clear_emergency_stop", "impersonate"):
                self.assertEqual(call(f, principal,
                                      {"operation": op, "path": "guardian_config/policy"},
                                      True)["decision"], "SIMULATED_DENY")
        self.assertEqual(f.snapshot(), before)

    def test_emergency_stop_or_hold_prevents_activation(self):
        for flag in ("emergency_stop", "allow_hold"):
            f = OfflineBrokerFixture(**{flag: True})
            before = f.snapshot()
            self.assertEqual(call(f, A, activation(), True)["decision"], "SIMULATED_DENY")
            self.assertEqual(f.snapshot(), before)

    def test_fixture_cannot_point_to_production_or_unsafe_budget(self):
        for project in ("atrio-catolico", "", None, "another-project"):
            with self.assertRaises(ValueError):
                OfflineBrokerFixture(project=project)
        for quota in (0, -1, 11, True, "2"):
            with self.assertRaises(ValueError):
                OfflineBrokerFixture(max_cases=quota)

    def test_snapshot_copy_cannot_change_backing_state(self):
        f = activated()
        original = f.snapshot()
        stolen = f.snapshot()
        stolen["policy"]["emergency_stop"] = True
        stolen["cases"]["guard_fake"] = {"evil": "yes"}
        stolen["budget"] = 999
        self.assertEqual(f.snapshot(), original)

    def test_concurrent_identical_proposals_only_one_succeeds(self):
        f = activated()
        with ThreadPoolExecutor(max_workers=8) as pool:
            decisions = list(pool.map(lambda _: call(f, T, case())["decision"], range(16)))
        self.assertEqual(decisions.count("SIMULATED_ALLOW"), 1)
        self.assertEqual(decisions.count("SIMULATED_DENY"), 15)
        self.assertEqual(f.snapshot()["budget"], 1)

    def test_every_reported_result_is_never_production_authorization(self):
        f = OfflineBrokerFixture()
        results = [call(f, T, case()), call(f, T, {"operation": "read_policy"}),
                   call(f, A, activation(), True), call(f, T, case())]
        self.assertTrue(all(result["production_authorized"] is False for result in results))


if __name__ == "__main__":
    unittest.main()
