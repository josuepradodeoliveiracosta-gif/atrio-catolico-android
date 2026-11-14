#!/usr/bin/env python3
"""Strict synthetic HTTP-envelope gate for Guardian V2 QA (NEVER a web server).

Takes already-collected headers/body as DATA, never opens a port, makes network
calls, reaches Firestore, or executes the plans returned by the offline contract.
The trust boundary for operator approval and actual principal authentication
still requires an independently reviewed server implementation in isolated QA.
"""
from __future__ import annotations

import json
import re

from scripts.guardian_v2_qa_idtoken_gate import QaIdentityConfig, authorize_intent
from scripts.guardian_v2_qa_mediator_contract import (
    QA_FIXTURE_PROJECT, simulate_qa_intent,
)
from scripts.guardian_v2_qa_broker_fixture import fixture_case_id

_ROUTES = {
    "/qa/v1/read-policy": "read_policy",
    "/qa/v1/propose-case": "propose_case",
    "/qa/v1/enable-nonpunitive": "enable_nonpunitive",
}
_TOKEN_HEADER = "authorization"
_CONTENT_HEADER = "content-type"
_FORBIDDEN_HEADERS = {
    "x-serverless-authorization", "x-caller-role", "x-caller-email",
    "x-trusted-principal", "x-service-account", "x-manual-approval",
}
_HEADER_NAME = re.compile(r"^[A-Za-z0-9-]{1,64}$")
_DENIED = {"decision": "SIMULATED_HTTP_DENY", "production_authorized": False}


def _pairs_no_duplicate_keys(pairs: list) -> dict:
    """Reject ambiguous JSON keys even if nested; not last-key-wins."""
    if len(pairs) > 24:
        raise ValueError("too_many_keys")
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError("duplicate_key")
        out[key] = value
    return out


def _parse_body(body: object) -> object:
    if type(body) is not bytes or not 2 <= len(body) <= 4096:
        return None
    try:
        parsed = json.loads(
            body.decode("utf-8", errors="strict"),
            object_pairs_hook=_pairs_no_duplicate_keys,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("constant")),
        )
    except (UnicodeError, ValueError, TypeError, RecursionError):
        return None
    return parsed if type(parsed) is dict else None


def _parse_headers(headers: object) -> tuple[str, str] | None:
    """A pair sequence, not a mapping: duplicates remain detectable."""
    if type(headers) not in (list, tuple) or not 2 <= len(headers) <= 32:
        return None
    found = {}
    for pair in headers:
        if type(pair) not in (tuple, list) or len(pair) != 2:
            return None
        key, value = pair
        if (type(key) is not str or not _HEADER_NAME.fullmatch(key)
                or type(value) is not str or len(value) > 16384):
            return None
        key = key.lower()
        if key in found or key in _FORBIDDEN_HEADERS:
            return None
        found[key] = value
    if _TOKEN_HEADER not in found or found.get(_CONTENT_HEADER) != "application/json":
        return None
    return found[_TOKEN_HEADER], found[_CONTENT_HEADER]


def inspect_qa_http_envelope(
    *, method: object, path: object, headers: object, body: object,
    config: QaIdentityConfig, approved_by_operator: bool = False,
    trusted_policy_snapshot: object = None,
) -> dict:
    """Offline-only inspection: success means no writes and no authorization.

    The operator approval and policy snapshot MUST be obtained independently;
    this function does not authenticate the approver, acquire data or implement
    a real Cloud Run handler. Never pass approval from user-controlled input.
    """
    if type(config) is not QaIdentityConfig:
        return dict(_DENIED)
    if method != "POST" or type(method) is not str:
        return dict(_DENIED)
    if type(path) is not str or path not in _ROUTES:
        return dict(_DENIED)
    checked_headers = _parse_headers(headers)
    if checked_headers is None:
        return dict(_DENIED)
    parsed = _parse_body(body)
    if parsed is None:
        return dict(_DENIED)
    operation = _ROUTES[path]
    if parsed.get("operation") != operation:
        return dict(_DENIED)
    # This rejects forged or malformed case IDs, but proves nothing about the
    # existence, owner, revision or quota of a real Firestore source.
    if operation == "propose_case":
        target = parsed.get("target_path")
        if (type(target) is not str or
                parsed.get("case_id") != fixture_case_id(target)):
            return dict(_DENIED)
    identity = authorize_intent(
        authorization=checked_headers[0], operation=operation, config=config,
    )
    if identity.get("decision") != "QA_VERIFIED_IDENTITY_INTENT_ONLY":
        return dict(_DENIED)
    if type(approved_by_operator) is not bool:
        return dict(_DENIED)
    proposal = simulate_qa_intent(
        project=QA_FIXTURE_PROJECT, trusted_role=identity["role"],
        request=parsed,
        manually_approved=(approved_by_operator if operation == "enable_nonpunitive"
                           else False),
        policy_snapshot=(trusted_policy_snapshot if operation == "enable_nonpunitive"
                         else None),
    )
    if proposal.get("decision") != "SIMULATED_ALLOW":
        return dict(_DENIED)
    # Never return a Firestore plan, document paths, claims or raw token.
    return {"decision": "SIMULATED_HTTP_ENVELOPE_ACCEPTED_NO_WRITE",
            "operation": operation, "role": identity["role"],
            "production_authorized": False}
