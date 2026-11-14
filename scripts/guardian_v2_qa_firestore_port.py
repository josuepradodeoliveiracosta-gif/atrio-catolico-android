#!/usr/bin/env python3
"""Unpublished Firestore SDK port for Guardian V2 isolated QA.

No server, deploy, credentials, IAM grants or production migration. This code
uses the real Firestore transaction API ONLY when a trusted caller explicitly
invokes it with an isolated QA client. Unit tests replace the SDK with fakes.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from scripts.guardian_v2_qa_idtoken_gate import QaIdentityConfig, authorize_intent
from scripts.guardian_v2_qa_mediator_contract import QA_FIXTURE_PROJECT, simulate_qa_intent
from scripts.guardian_v2_qa_broker_fixture import fixture_case_id

_DENY = {"decision": "QA_TRANSACTION_DENIED", "production_authorized": False}
_UNAVAILABLE = {"decision": "QA_BACKEND_UNAVAILABLE", "production_authorized": False}


class _Rejected(Exception):
    """A known business precondition failed; never emit details to callers."""


@dataclass(frozen=True)
class QaFirestoreScope:
    identity: QaIdentityConfig
    database: str = "(default)"
    daily_case_limit: int = 2

    def __post_init__(self):
        if type(self.identity) is not QaIdentityConfig:
            raise ValueError("independent_qa_identity_required")
        if (type(self.database) is not str or
                not (self.database == "(default)" or
                     (3 <= len(self.database) <= 63 and
                      self.database[0].isalnum() and
                      self.database.replace("-", "").isalnum()))):
            raise ValueError("qa_database_required")
        if type(self.daily_case_limit) is not int or not 1 <= self.daily_case_limit <= 10:
            raise ValueError("bounded_qa_quota_required")


def _client_matches_scope(client, scope):
    """Defense in depth; identity isolation also requires external IAM proof."""
    return (getattr(client, "project", None) == scope.identity.qa_project
            and getattr(client, "_database", None) == scope.database)


def _revision_parts(value):
    """Exact UTC seconds and nanoseconds (do not silently drop precision)."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return None
        utc = value.astimezone(timezone.utc)
        nanos = getattr(value, "nanosecond", utc.microsecond * 1000)
        return (int(utc.replace(microsecond=0).timestamp()), nanos)
    if type(value) is str:
        from scripts.guardian_v2_qa_mediator_contract import REVISION
        if not REVISION.fullmatch(value):
            return None
        head, dot, fraction = value[:-1].partition(".")
        try:
            utc = datetime.strptime(head, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
        except ValueError:
            return None
        return (int(utc.timestamp()), int((fraction if dot else "").ljust(9, "0")))
    return None


def _policy_enabled(snapshot):
    if not snapshot.exists:
        return False
    p = snapshot.to_dict()
    return (type(p) is dict and
            p.get("enabled") is True and
            p.get("autonomousWriteEnabled") is True and
            p.get("emergencyStop") is False and
            p.get("allowHold") is False)


def execute_qa_firestore(*, client, scope, authorization, request):
    """QA-only endpoint *core*, not an HTTP server or an external IAM proof.

    Activation is deliberately unimplemented: an operator approval channel and
    independently authenticated identities are still missing. Caller has no
    access to arbitrary Firestore operations or direct document names.
    """
    if (type(scope) is not QaFirestoreScope or not _client_matches_scope(client, scope)
            or type(request) is not dict or
            request.get("operation") not in ("read_policy", "propose_case")):
        return dict(_DENY)
    operation = request["operation"]
    identity = authorize_intent(
        authorization=authorization, operation=operation, config=scope.identity,
    )
    if (identity.get("decision") != "QA_VERIFIED_IDENTITY_INTENT_ONLY"
            or identity.get("role") != "triage"
            or identity.get("operation") != operation
            or identity.get("production_authorized") is not False):
        return dict(_DENY)
    # Strict existing request schema; it is a validator, NOT an IAM decision.
    plan = simulate_qa_intent(
        project=QA_FIXTURE_PROJECT, trusted_role="triage", request=request,
    )
    if plan.get("decision") != "SIMULATED_ALLOW":
        return dict(_DENY)
    try:
        policy_ref = client.document("guardian_config/policy")
        if operation == "read_policy":
            snapshot = policy_ref.get()
            return {"decision": "QA_POLICY_READ", "enabled": _policy_enabled(snapshot),
                    "production_authorized": False}

        target = request["target_path"]
        case_id = fixture_case_id(target)
        if request["case_id"] != case_id:
            return dict(_DENY)
        owner = request["owner_uid"]
        case_ref = client.document("guardian_cases/" + case_id)
        audit_ref = client.document("guardian_audit/" + case_id)
        notice_ref = client.document("guardian_notices/" + owner + "/items/" + case_id)
        source_ref = client.document(target)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        budget_ref = client.document("guardian_qa_budget/" + today)
        from google.cloud import firestore  # optional until isolated QA is provisioned

        @firestore.transactional
        def apply(tx):
            # All Firestore reads must precede any write; retries re-check state.
            policy = policy_ref.get(transaction=tx)
            source = source_ref.get(transaction=tx)
            existing_case = case_ref.get(transaction=tx)
            existing_audit = audit_ref.get(transaction=tx)
            existing_notice = notice_ref.get(transaction=tx)
            budget = budget_ref.get(transaction=tx)
            if not _policy_enabled(policy) or not source.exists:
                raise _Rejected()
            source_data = source.to_dict()
            if (type(source_data) is not dict or
                    source_data.get("uid") != owner or
                    _revision_parts(source.update_time) is None or
                    _revision_parts(source.update_time) !=
                    _revision_parts(request["source_update_time"]) or
                    existing_case.exists or existing_audit.exists or existing_notice.exists):
                raise _Rejected()
            current = budget.to_dict() if budget.exists else {"used": 0}
            if (type(current) is not dict or
                    type(current.get("used")) is not int or
                    not 0 <= current["used"] < scope.daily_case_limit):
                raise _Rejected()
            # Server-derived, limited, nonpunitive fields only. No delete/hold.
            tx.create(case_ref, {"sourcePath": target, "ownerUid": owner,
                                 "status": request["status"], "sourceUpdateTime":
                                 request["source_update_time"], "source": "guardian_v2_qa"})
            tx.create(audit_ref, {"caseId": case_id, "event": request["status"],
                                  "actor": "guardian_v2_qa"})
            tx.create(notice_ref, {"caseId": case_id, "action": "review",
                                   "title": "Revisão em andamento"})
            tx.set(budget_ref, {"used": current["used"] + 1})
            return {"decision": "QA_CASE_COMMITTED", "production_authorized": False}

        return apply(client.transaction())
    except _Rejected:
        return dict(_DENY)
    except Exception:
        # Credential errors, unavailable SDK, contention failures and network
        # errors are NOT evidence of a genuine IAM 403 denial.
        return dict(_UNAVAILABLE)
