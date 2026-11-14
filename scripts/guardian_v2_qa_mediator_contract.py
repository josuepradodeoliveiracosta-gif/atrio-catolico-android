#!/usr/bin/env python3
"""OFFLINE authorization-contract simulator; never a deployed IAM boundary.

This module makes no HTTP calls, receives no tokens, and never accesses Firestore.
The caller role and approval flag below are TRUSTED TEST FIXTURES, not request
headers. A future mediator must authenticate ID tokens at its own boundary,
verify audience/issuer/principal, and revoke the caller's direct Firestore IAM.
"""
from __future__ import annotations

import re

QA_FIXTURE_PROJECT = "guardian-v2-qa-fixture"
PRODUCTION_PROJECT = "atrio-catolico"
IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
CASE_ID = re.compile(r"^guard_[0-9a-f]{32}$")
TARGET = re.compile(r"^posts/[A-Za-z0-9_-]{1,128}(?:/replies/[A-Za-z0-9_-]{1,128})?$")
REVISION = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$")


def _exact(value: object, keys: set[str]) -> bool:
    return type(value) is dict and set(value) == keys


def _safe_revision(value: object) -> bool:
    return type(value) is str and bool(REVISION.fullmatch(value))


def _deny() -> dict:
    return {"decision": "SIMULATED_DENY", "production_authorized": False}


def simulate_qa_intent(
    *, project: str, trusted_role: str, request: object,
    manually_approved: bool = False, policy_snapshot: object = None,
) -> dict:
    """Simulate a hypothetical broker's strict intent envelope, without I/O.

    An IAM or API decision CANNOT be inferred from SIMULATED_ALLOW. The role is
    supplied by the test harness, not extracted from an untrusted HTTP request.
    """
    if (project != QA_FIXTURE_PROJECT or project == PRODUCTION_PROJECT or
            trusted_role not in ("triage", "activation") or
            type(request) is not dict):
        return _deny()

    operation = request.get("operation")
    if trusted_role == "triage" and operation == "read_policy":
        if not _exact(request, {"operation"}):
            return _deny()
        return {
            "decision": "SIMULATED_ALLOW",
            "production_authorized": False,
            "plan": {"operation": "read_only", "relative_path": "guardian_config/policy"},
        }

    if trusted_role == "triage" and operation == "propose_case":
        if not _exact(request, {"operation", "case_id", "owner_uid", "target_path",
                                "source_update_time", "status"}):
            return _deny()
        case_id, owner, target, version, status = (
            request[k] for k in ("case_id", "owner_uid", "target_path",
                                 "source_update_time", "status")
        )
        if (not isinstance(case_id, str) or not CASE_ID.fullmatch(case_id) or
                not isinstance(owner, str) or not IDENTIFIER.fullmatch(owner) or
                not isinstance(target, str) or not TARGET.fullmatch(target) or
                not _safe_revision(version) or status not in ("review", "warned")):
            return _deny()
        # A privileged mediator must compute the actual Firestore transaction,
        # policy freshness, source version, quotas, and write gates server-side.
        # This plan deliberately does not expose Firestore commit() or raw writes.
        return {
            "decision": "SIMULATED_ALLOW",
            "production_authorized": False,
            "plan": {
                "operation": "server_derived_case_transaction",
                "case": "guardian_cases/" + case_id,
                "audit": "guardian_audit/" + case_id,
                "notice": "guardian_notices/" + owner + "/items/" + case_id,
            },
            "requires": ["source_version_verify", "policy_cas", "daily_budget_cas",
                         "server_validate_case_and_no_delete"],
        }

    if trusted_role == "activation" and operation == "enable_nonpunitive":
        if not _exact(request, {"operation", "expected_update_time"}):
            return _deny()
        if type(manually_approved) is not bool or not manually_approved:
            return _deny()
        stamp = request.get("expected_update_time")
        if not _safe_revision(stamp) or not _exact(policy_snapshot, {
            "update_time", "enabled", "autonomous_write_enabled",
            "emergency_stop", "allow_hold",
        }):
            return _deny()
        if (policy_snapshot["update_time"] != stamp or
                any(type(policy_snapshot[k]) is not bool for k in (
                    "enabled", "autonomous_write_enabled", "emergency_stop", "allow_hold")) or
                policy_snapshot["emergency_stop"] or policy_snapshot["allow_hold"]):
            return _deny()
        # The client cannot supply fields, document paths or arbitrary patches.
        return {
            "decision": "SIMULATED_ALLOW",
            "production_authorized": False,
            "plan": {
                "operation": "server_derived_policy_cas",
                "relative_path": "guardian_config/policy",
                "update_mask": ["enabled", "autonomousWriteEnabled"],
                "fields": {"enabled": True, "autonomousWriteEnabled": True},
                "precondition": "snapshot_version_match",
            },
            "requires": ["verified_distinct_service_principal", "separate_manual_approval"],
        }

    return _deny()
