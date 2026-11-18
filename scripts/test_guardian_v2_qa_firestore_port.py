"""SDK-surface contract tests; all documents and tokens are synthetic.

Uses fake Firestore client/decorator. This is NOT an Emulator or IAM test.
"""
from datetime import datetime, timezone
import sys
import types
import unittest
from unittest.mock import patch

from scripts import guardian_v2_qa_firestore_port as port
from scripts.guardian_v2_qa_idtoken_gate import QaIdentityConfig
from scripts.guardian_v2_qa_broker_fixture import fixture_case_id

PROJECT = "atrio-catolico-qa"
AUDIENCE = "https://guardian-v2-qa.run.app"
TRIAGE = "qa-triage@" + PROJECT + ".iam.gserviceaccount.com"
ACTIVATION = "qa-activation@" + PROJECT + ".iam.gserviceaccount.com"
STAMP = "2026-11-14T10:00:00Z"
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


class Snapshot:
    def __init__(self, data=None, stamp=None):
        self.exists = data is not None
        self.data = data
        self.update_time = stamp

    def to_dict(self):
        return None if self.data is None else dict(self.data)


class FakeRef:
    def __init__(self, client, path):
        self.client = client
        self.path = path

    def get(self, transaction=None):
        self.client.events.append(("read", self.path))
        return self.client.docs.get(self.path, Snapshot())


class FakeTx:
    def __init__(self, client):
        self.client = client
        self.ops = []

    def create(self, ref, fields):
        self.client.events.append(("create", ref.path))
        self.ops.append(("create", ref.path, fields))

    def set(self, ref, fields):
        self.client.events.append(("set", ref.path))
        self.ops.append(("set", ref.path, fields))

    def commit(self):
        if self.client.fail_commit:
            raise ConnectionError("synthetic network error")
        for op, path, fields in self.ops:
            if op == "create" and self.client.docs.get(path, Snapshot()).exists:
                raise ValueError("already exists")
        for _, path, fields in self.ops:
            self.client.docs[path] = Snapshot(fields)


class FakeClient:
    def __init__(self, project=PROJECT, database="(default)"):
        self.project = project
        self._database = database
        self.docs = {}
        self.events = []
        self.fail_commit = False

    def document(self, path):
        return FakeRef(self, path)

    def transaction(self):
        self.events.append(("transaction", ""))
        return FakeTx(self)


def fake_transactional(fn):
    def run(tx):
        out = fn(tx)
        tx.commit()
        return out
    return run


def config():
    return port.QaFirestoreScope(
        QaIdentityConfig(PROJECT, AUDIENCE, TRIAGE, ACTIVATION)
    )


def case_request(**changes):
    target = "posts/synthetic_post"
    data = {"operation": "propose_case", "target_path": target,
            "case_id": fixture_case_id(target), "owner_uid": "synthetic_actor",
            "status": "review", "source_update_time": STAMP}
    data.update(changes)
    return data


def seeded():
    client = FakeClient()
    client.docs["guardian_config/policy"] = Snapshot({
        "enabled": True, "autonomousWriteEnabled": True,
        "emergencyStop": False, "allowHold": False,
    })
    client.docs["posts/synthetic_post"] = Snapshot(
        {"uid": "synthetic_actor"}, datetime(2026, 11, 14, 10, tzinfo=timezone.utc))
    return client


class QaFirestorePortTests(unittest.TestCase):
    def setUp(self):
        self.client = seeded()
        self.auth = patch.object(port, "authorize_intent", return_value={
            "decision": "QA_VERIFIED_IDENTITY_INTENT_ONLY", "role": "triage",
            "operation": "propose_case", "production_authorized": False,
        })
        self.auth.start()
        self.addCleanup(self.auth.stop)
        fake_cloud = types.ModuleType("google.cloud")
        fake_cloud.firestore = types.SimpleNamespace(transactional=fake_transactional)
        modules = {"google": types.ModuleType("google"),
                   "google.cloud": fake_cloud,
                   "google.cloud.firestore": fake_cloud.firestore}
        self.sdk = patch.dict(sys.modules, modules)
        self.sdk.start()
        self.addCleanup(self.sdk.stop)

    def execute(self, request=None, client=None, scope=None):
        return port.execute_qa_firestore(
            client=self.client if client is None else client,
            scope=config() if scope is None else scope,
            authorization="Bearer synthetic-token",
            request=case_request() if request is None else request,
        )

    def test_real_sdk_shape_writes_four_atomic_effects_after_all_reads(self):
        answer = self.execute()
        self.assertEqual(answer["decision"], "QA_CASE_COMMITTED")
        events = self.client.events
        self.assertEqual(len([x for x in events if x[0] == "read"]), 6)
        self.assertEqual(len([x for x in events if x[0] in ("create", "set")]), 4)
        self.assertLess(max(i for i, e in enumerate(events) if e[0] == "read"),
                        min(i for i, e in enumerate(events) if e[0] in ("create", "set")))
        self.assertTrue(all(e[0] != "delete" for e in events))
        self.assertEqual(sum(v.exists for k, v in self.client.docs.items()
                             if k.startswith("guardian_cases/")), 1)

    def test_replay_does_not_create_second_case_or_exceed_budget(self):
        self.assertEqual(self.execute()["decision"], "QA_CASE_COMMITTED")
        first = self.client.docs["guardian_qa_budget/" + TODAY].to_dict()["used"]
        self.assertEqual(self.execute()["decision"], "QA_TRANSACTION_DENIED")
        self.assertEqual(self.client.docs["guardian_qa_budget/" + TODAY].to_dict()["used"], first)

    def test_malformed_role_and_project_cannot_start_transaction(self):
        with patch.object(port, "authorize_intent", return_value={"decision": "QA_IDENTITY_DENIED"}):
            self.assertEqual(self.execute()["decision"], "QA_TRANSACTION_DENIED")
        self.assertEqual(self.execute(client=FakeClient(project="atrio-catolico"))["decision"],
                         "QA_TRANSACTION_DENIED")
        self.assertEqual(self.execute(client=FakeClient(database="other"))["decision"],
                         "QA_TRANSACTION_DENIED")
        self.assertEqual(self.client.events, [])

    def test_rejects_invalid_request_before_any_document(self):
        for request in ({"operation": "enable_nonpunitive"},
                        dict(case_request(), extra="overreach"),
                        case_request(case_id="guard_" + "0" * 32),
                        case_request(target_path="users/victim/private/account"),
                        case_request(status="held"),
                        case_request(source_update_time="bad")):
            with self.subTest(request=request):
                self.assertEqual(self.execute(request=request)["decision"], "QA_TRANSACTION_DENIED")
        self.assertEqual(self.client.events, [])

    def test_source_owner_must_match_server_document(self):
        self.client.docs["posts/synthetic_post"].data["uid"] = "other"
        self.assertEqual(self.execute()["decision"], "QA_TRANSACTION_DENIED")
        self.assertFalse(any(x[0] == "create" for x in self.client.events))

    def test_source_timestamp_must_match_exact_revision(self):
        self.assertEqual(self.execute(request=case_request(
            source_update_time="2026-11-14T10:00:00.000000001Z"))["decision"],
            "QA_TRANSACTION_DENIED")

    def test_missing_source_fails_closed(self):
        del self.client.docs["posts/synthetic_post"]
        self.assertEqual(self.execute()["decision"], "QA_TRANSACTION_DENIED")

    def test_policy_stop_or_hold_fail_closed(self):
        for field in ("enabled", "autonomousWriteEnabled", "emergencyStop", "allowHold"):
            client = seeded()
            client.docs["guardian_config/policy"].data[field] = field in ("emergencyStop", "allowHold")
            self.assertEqual(self.execute(client=client)["decision"], "QA_TRANSACTION_DENIED")

    def test_existing_audit_or_notice_denies_transaction(self):
        for prefix in ("guardian_audit", "guardian_notices/synthetic_actor/items"):
            client = seeded()
            client.docs[f"{prefix}/{case_request()['case_id']}"] = Snapshot({"existing": True})
            self.assertEqual(self.execute(client=client)["decision"], "QA_TRANSACTION_DENIED")

    def test_budget_quota_is_shared_document_not_local_counter(self):
        day = "guardian_qa_budget/" + TODAY
        self.client.docs[day] = Snapshot({"used": 2})
        self.assertEqual(self.execute()["decision"], "QA_TRANSACTION_DENIED")
        self.assertEqual(self.client.docs[day].to_dict()["used"], 2)

    def test_budget_bool_or_negative_is_denied(self):
        for used in (True, -1, "0"):
            client = seeded()
            client.docs["guardian_qa_budget/" + TODAY] = Snapshot({"used": used})
            self.assertEqual(self.execute(client=client)["decision"], "QA_TRANSACTION_DENIED")

    def test_commit_error_is_unavailable_and_has_no_partial_writes(self):
        self.client.fail_commit = True
        result = self.execute()
        self.assertEqual(result["decision"], "QA_BACKEND_UNAVAILABLE")
        self.assertFalse(any(k.startswith("guardian_cases/") for k in self.client.docs))

    def test_read_policy_returns_bools_only_without_writes(self):
        self.client.events.clear()
        with patch.object(port, "authorize_intent", return_value={
            "decision": "QA_VERIFIED_IDENTITY_INTENT_ONLY", "role": "triage",
            "operation": "read_policy", "production_authorized": False,
        }):
            answer = self.execute(request={"operation": "read_policy"})
        self.assertEqual(answer, {"decision": "QA_POLICY_READ", "enabled": True,
                                  "production_authorized": False})
        self.assertEqual(self.client.events, [("read", "guardian_config/policy")])

    def test_identity_decision_must_be_bound_to_requested_operation(self):
        with patch.object(port, "authorize_intent", return_value={
            "decision": "QA_VERIFIED_IDENTITY_INTENT_ONLY", "role": "triage",
            "operation": "read_policy", "production_authorized": False,
        }):
            self.assertEqual(self.execute()["decision"], "QA_TRANSACTION_DENIED")
        self.assertEqual(self.client.events, [])

    def test_missing_sdk_reports_unavailable_not_iam_denial(self):
        with patch.dict(sys.modules, {"google.cloud": None}):
            self.assertEqual(self.execute()["decision"], "QA_BACKEND_UNAVAILABLE")

    def test_constructor_requires_bounded_scope(self):
        qa = config().identity
        for n in (0, True, 11, -1):
            with self.subTest(limit=n), self.assertRaises(ValueError):
                port.QaFirestoreScope(qa, daily_case_limit=n)
        with self.assertRaises(ValueError):
            port.QaFirestoreScope(qa, database="../production")


if __name__ == "__main__":
    unittest.main()
