"""Synthetic shared-ledger concurrency and rollback tests. No network or IAM."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import unittest

from scripts.guardian_v2_qa_broker_fixture import (
    ACTIVATION_PRINCIPAL, TRIAGE_PRINCIPAL, TEST_REVISION, fixture_case_id,
)
from scripts.guardian_v2_qa_shared_ledger import (
    SharedQaLedger, IndependentQaMediator,
)


def activation(revision="2026-11-14T09:00:00Z"):
    return {"operation": "enable_nonpunitive", "expected_update_time": revision}


def case(path="posts/synthetic_post", **patch):
    return dict({
        "operation": "propose_case", "target_path": path,
        "case_id": fixture_case_id(path),
        "owner_uid": "synthetic_actor",
        "source_update_time": TEST_REVISION, "status": "review",
    }, **patch)


def clients(store=None):
    ledger = store or SharedQaLedger()
    return ledger, (
        IndependentQaMediator(ledger, trusted_principal=TRIAGE_PRINCIPAL),
        IndependentQaMediator(ledger, trusted_principal=TRIAGE_PRINCIPAL),
        IndependentQaMediator(ledger, trusted_principal=ACTIVATION_PRINCIPAL),
    )


def ready(store=None):
    ledger, (first, second, activate) = clients(store)
    approved = activate.handle(activation(), manually_approved=True)
    assert approved["decision"] == "SIMULATED_ALLOW"
    return ledger, first, second, activate


class SharedLedgerQaTests(unittest.TestCase):
    def test_starts_disabled_with_zero_writes(self):
        ledger, _ = clients()
        snapshot = ledger.snapshot()
        self.assertFalse(snapshot["policy"]["enabled"])
        self.assertEqual(snapshot["budget_used"], 0)
        self.assertEqual(snapshot["cases"], {})
        self.assertEqual(snapshot["audits"], {})
        self.assertEqual(snapshot["notices"], {})
        self.assertEqual(snapshot["policy_revision"], 0)

    def test_read_only_policy_does_not_modify_any_state(self):
        ledger, (triage, _, _) = clients()
        before = ledger.snapshot()
        result = triage.handle({"operation": "read_policy"})
        self.assertEqual(result["decision"], "SIMULATED_ALLOW")
        self.assertEqual(result["policy"], before["policy"])
        self.assertEqual(ledger.snapshot(), before)

    def test_case_denied_before_activation_without_side_effects(self):
        ledger, (triage, _, _) = clients()
        before = ledger.snapshot()
        self.assertEqual(triage.handle(case())["decision"], "SIMULATED_DENY")
        self.assertEqual(ledger.snapshot(), before)

    def test_manual_activation_updates_exactly_two_flags_and_revision(self):
        ledger, (triage, _, activate) = clients()
        before = ledger.snapshot()
        result = activate.handle(activation(), manually_approved=True)
        after = ledger.snapshot()
        self.assertEqual(result["changed_fields"], ["enabled", "autonomousWriteEnabled"])
        self.assertTrue(after["policy"]["enabled"])
        self.assertTrue(after["policy"]["autonomous_write_enabled"])
        self.assertEqual(after["policy"]["emergency_stop"], before["policy"]["emergency_stop"])
        self.assertEqual(after["policy"]["allow_hold"], before["policy"]["allow_hold"])
        self.assertNotEqual(after["policy"]["update_time"], before["policy"]["update_time"])
        self.assertEqual(after["policy_revision"], 1)
        self.assertEqual(after["budget_used"], 0)
        self.assertIs(result["production_authorized"], False)

    def test_activation_requires_independent_approval(self):
        ledger, (_, _, activate) = clients()
        initial = ledger.snapshot()
        for approved in (False, 1, None, "true"):
            self.assertEqual(activate.handle(activation(), manually_approved=approved)["decision"],
                             "SIMULATED_DENY")
            self.assertEqual(ledger.snapshot(), initial)

    def test_activation_replay_denied_across_independent_calls(self):
        ledger, _, _, activate = ready()
        before = ledger.snapshot()
        for replay in (activation(), activation(before["policy"]["update_time"])):
            self.assertEqual(activate.handle(replay, manually_approved=True)["decision"],
                             "SIMULATED_DENY")
        self.assertEqual(ledger.snapshot(), before)

    def test_case_audit_notice_and_budget_are_single_synthetic_commit(self):
        ledger, triage, _, _ = ready()
        accepted = triage.handle(case())
        snapshot = ledger.snapshot()
        key = case()["case_id"]
        self.assertEqual(accepted["decision"], "SIMULATED_ALLOW")
        self.assertEqual(accepted["created"], ["case", "audit", "notice"])
        self.assertEqual(snapshot["budget_used"], 1)
        self.assertEqual(set(snapshot["cases"]), {key})
        self.assertEqual(set(snapshot["audits"]), {key})
        self.assertEqual(set(snapshot["notices"]), {key})
        self.assertIs(accepted["production_authorized"], False)

    def test_second_mediator_cannot_replay_case(self):
        ledger, first, second, _ = ready()
        self.assertEqual(first.handle(case())["decision"], "SIMULATED_ALLOW")
        before = ledger.snapshot()
        self.assertEqual(second.handle(case())["decision"], "SIMULATED_DENY")
        self.assertEqual(ledger.snapshot(), before)

    def test_two_independent_mediators_share_budget(self):
        ledger, first, second, _ = ready(SharedQaLedger(max_cases=1))
        self.assertEqual(first.handle(case())["decision"], "SIMULATED_ALLOW")
        before = ledger.snapshot()
        self.assertEqual(second.handle(case("posts/another"))["decision"], "SIMULATED_DENY")
        self.assertEqual(ledger.snapshot(), before)

    def test_fault_before_commit_leaves_all_collections_unchanged(self):
        ledger, first, _, _ = ready()
        before = ledger.snapshot()
        ledger.fail_next_commit_for_test()
        self.assertEqual(first.handle(case())["decision"], "SIMULATED_DENY")
        self.assertEqual(ledger.snapshot(), before)
        self.assertEqual(first.handle(case())["decision"], "SIMULATED_ALLOW")

    def test_fault_on_activation_does_not_enable_policy(self):
        ledger, (_, _, activate) = clients()
        initial = ledger.snapshot()
        ledger.fail_next_commit_for_test()
        self.assertEqual(activate.handle(activation(), manually_approved=True)["decision"],
                         "SIMULATED_DENY")
        self.assertEqual(ledger.snapshot(), initial)
        self.assertEqual(activate.handle(activation(), manually_approved=True)["decision"],
                         "SIMULATED_ALLOW")

    def test_cannot_swap_roles_between_clients(self):
        ledger, first, _, activate = ready()
        before = ledger.snapshot()
        self.assertEqual(first.handle(activation(before["policy"]["update_time"]),
                                      manually_approved=True)["decision"], "SIMULATED_DENY")
        self.assertEqual(activate.handle(case(), manually_approved=True)["decision"],
                         "SIMULATED_DENY")
        self.assertEqual(ledger.snapshot(), before)

    def test_forged_role_and_generic_firestore_commands_denied(self):
        ledger, first, _, _ = ready()
        before = ledger.snapshot()
        for payload in (
            dict(case(), principal=ACTIVATION_PRINCIPAL),
            dict(case(), role="activation"),
            dict(case(), writes=[]),
            {"operation": "commit", "writes": []},
            {"operation": "delete", "path": "guardian_config/policy"},
            {"operation": "patch", "path": "users/somebody"},
            None, "case", [], {},
        ):
            self.assertEqual(first.handle(payload)["decision"], "SIMULATED_DENY")
        self.assertEqual(ledger.snapshot(), before)

    def test_stale_source_wrong_owner_and_forged_id_are_denied(self):
        ledger, first, _, _ = ready()
        before = ledger.snapshot()
        for patch in ({"source_update_time": "2026-11-14T10:00:01Z"},
                      {"owner_uid": "different_actor"},
                      {"case_id": "guard_" + "0" * 32},
                      {"case_id": "../../policy"},
                      {"target_path": "posts/not_in_fixture"}):
            self.assertEqual(first.handle(case(**patch))["decision"], "SIMULATED_DENY")
            self.assertEqual(ledger.snapshot(), before)

    def test_invalid_policy_flags_stop_activation(self):
        for flag in ("emergency_stop", "allow_hold"):
            ledger, (_, _, activate) = clients(SharedQaLedger(**{flag: True}))
            before = ledger.snapshot()
            self.assertEqual(activate.handle(activation(), manually_approved=True)["decision"],
                             "SIMULATED_DENY")
            self.assertEqual(ledger.snapshot(), before)

    def test_bad_project_and_budget_are_rejected_before_any_state(self):
        for project in ("atrio-catolico", "another-project", None, ""):
            with self.assertRaises(ValueError):
                SharedQaLedger(project=project)
        for max_cases in (0, 11, -1, True, "2"):
            with self.assertRaises(ValueError):
                SharedQaLedger(max_cases=max_cases)

    def test_defensive_snapshots_cannot_modify_shared_ledger(self):
        ledger, first, _, _ = ready()
        before = ledger.snapshot()
        copied = ledger.snapshot()
        copied["policy"]["emergency_stop"] = True
        copied["cases"]["guard_fake"] = {"status": "deleted"}
        copied["budget_used"] = 999
        self.assertEqual(ledger.snapshot(), before)
        self.assertEqual(first.handle(case())["decision"], "SIMULATED_ALLOW")

    def test_two_clients_16_concurrent_proposals_produce_only_one_case(self):
        ledger, first, second, _ = ready()
        def propose(index):
            client = first if index % 2 else second
            return client.handle(case())["decision"]
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(propose, range(16)))
        self.assertEqual(results.count("SIMULATED_ALLOW"), 1)
        self.assertEqual(results.count("SIMULATED_DENY"), 15)
        snapshot = ledger.snapshot()
        self.assertEqual(snapshot["budget_used"], 1)
        self.assertEqual((len(snapshot["cases"]), len(snapshot["audits"]),
                          len(snapshot["notices"])), (1, 1, 1))


if __name__ == "__main__":
    unittest.main()
