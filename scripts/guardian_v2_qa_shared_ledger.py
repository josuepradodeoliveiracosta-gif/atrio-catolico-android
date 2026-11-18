"""Offline shared-store transaction *model* for Guardian V2 QA.

Not Firestore, not cross-process concurrency, not IAM, not deployable.
Distinct mediator objects share ONE Python ledger with an RLock. All mutations
are staged and committed as a unit, allowing tests of rollback and replay.
No SDK, network, HTTP listener, tokens, or persistence are included.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from threading import RLock

from scripts.guardian_v2_qa_broker_fixture import (
    ACTIVATION_PRINCIPAL, TRIAGE_PRINCIPAL, TEST_REVISION, fixture_case_id,
)
from scripts.guardian_v2_qa_mediator_contract import QA_FIXTURE_PROJECT, simulate_qa_intent

_ROLES = {TRIAGE_PRINCIPAL: "triage", ACTIVATION_PRINCIPAL: "activation"}
_START = datetime(2026, 11, 14, 9, 0, 0, tzinfo=timezone.utc)
_DENY = {"decision": "SIMULATED_DENY", "production_authorized": False}


def _deny():
    return dict(_DENY)


def _allow(operation, **facts):
    return {"decision": "SIMULATED_ALLOW", "production_authorized": False,
            "operation": operation, **facts}


class SharedQaLedger:
    """An exclusively synthetic in-process transactional backend for tests."""

    def __init__(self, *, project=QA_FIXTURE_PROJECT, max_cases=2,
                 emergency_stop=False, allow_hold=False):
        if (project != QA_FIXTURE_PROJECT
                or type(max_cases) is not int or not 1 <= max_cases <= 10
                or type(emergency_stop) is not bool or type(allow_hold) is not bool):
            raise ValueError("qa_fixture_only")
        self._lock = RLock()
        self._max_cases = max_cases
        self._state = {
            "project": project,
            "policy": {
                "update_time": "2026-11-14T09:00:00Z",
                "enabled": False,
                "autonomous_write_enabled": False,
                "emergency_stop": emergency_stop,
                "allow_hold": allow_hold,
            },
            "sources": {
                "posts/synthetic_post": {
                    "owner_uid": "synthetic_actor", "update_time": TEST_REVISION,
                },
                "posts/seed/replies/answer": {
                    "owner_uid": "synthetic_actor", "update_time": TEST_REVISION,
                },
                "posts/another": {
                    "owner_uid": "synthetic_actor", "update_time": TEST_REVISION,
                },
            },
            "cases": {}, "audits": {}, "notices": {},
            "budget_used": 0, "max_cases": max_cases, "policy_revision": 0,
        }
        self._fail_next_commit = False

    def snapshot(self):
        """Defensive copy: callers never obtain the live backing objects."""
        with self._lock:
            return deepcopy(self._state)

    def fail_next_commit_for_test(self):
        """Inject an exclusively local commit fault, not a Firestore fault."""
        with self._lock:
            self._fail_next_commit = True

    def apply(self, *, trusted_principal, request, manually_approved=False):
        role = (_ROLES.get(trusted_principal)
                if type(trusted_principal) is str else None)
        if role is None or type(manually_approved) is not bool:
            return _deny()
        with self._lock:
            # Every caller has to re-evaluate the latest shared state.
            current = self._state
            policy = current["policy"]
            decision = simulate_qa_intent(
                project=QA_FIXTURE_PROJECT,
                trusted_role=role, request=request,
                manually_approved=manually_approved,
                policy_snapshot=policy,
            )
            if decision["decision"] != "SIMULATED_ALLOW":
                return _deny()
            operation = request["operation"]
            if operation == "read_policy" and role == "triage":
                return {**_allow(operation), "policy": deepcopy(policy)}
            # Prepare writes on a private copy: no half-written ledger on error.
            draft = deepcopy(current)
            if operation == "enable_nonpunitive" and role == "activation":
                if policy["enabled"] or policy["autonomous_write_enabled"]:
                    return _deny()
                draft["policy_revision"] += 1
                next_stamp = (_START + timedelta(seconds=draft["policy_revision"]))
                draft["policy"]["update_time"] = (
                    next_stamp.isoformat().replace("+00:00", "Z")
                )
                draft["policy"]["enabled"] = True
                draft["policy"]["autonomous_write_enabled"] = True
                facts = {"changed_fields": ["enabled", "autonomousWriteEnabled"]}
            elif operation == "propose_case" and role == "triage":
                if not (policy["enabled"] and policy["autonomous_write_enabled"]
                        and not policy["emergency_stop"] and not policy["allow_hold"]):
                    return _deny()
                path = request["target_path"]
                owner = request["owner_uid"]
                case_id = request["case_id"]
                source = draft["sources"].get(path)
                if (source is None or source["owner_uid"] != owner
                        or source["update_time"] != request["source_update_time"]
                        or fixture_case_id(path) != case_id
                        or case_id in draft["cases"]
                        or draft["budget_used"] >= self._max_cases):
                    return _deny()
                draft["cases"][case_id] = {
                    "owner": source["owner_uid"], "target": path,
                    "status": request["status"],
                }
                draft["audits"][case_id] = {
                    "event": request["status"], "actor": "guardian_v2",
                }
                draft["notices"][case_id] = {
                    "case_id": case_id, "owner": source["owner_uid"],
                }
                draft["budget_used"] += 1
                facts = {"created": ["case", "audit", "notice"],
                         "budget_used": draft["budget_used"]}
            else:
                return _deny()
            if self._fail_next_commit:
                self._fail_next_commit = False
                return _deny()  # The draft is abandoned with zero changes.
            self._state = draft
            return _allow(operation, **facts)


class IndependentQaMediator:
    """Separate local mediator clients sharing a single synthetic ledger."""

    def __init__(self, ledger, *, trusted_principal):
        if (type(ledger) is not SharedQaLedger or
                type(trusted_principal) is not str or trusted_principal not in _ROLES):
            raise ValueError("synthetic_client_only")
        self._ledger = ledger
        self._principal = trusted_principal

    def handle(self, request, *, manually_approved=False):
        # The principal is fixed at synthetic construction, never in request.
        return self._ledger.apply(
            trusted_principal=self._principal, request=request,
            manually_approved=manually_approved,
        )
