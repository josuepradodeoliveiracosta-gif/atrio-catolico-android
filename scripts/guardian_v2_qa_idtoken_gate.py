#!/usr/bin/env python3
"""QA ID-token gate: verified caller identity -> permitted *intent* only.

NOT a server, not an IAM/Firestore security boundary, not a deployment.
The default verifier requires google-auth and Google's public certificates;
offline tests supply a synthetic verifier and NEVER contact Google.
No production role, token, Firestore write, or deployment is authorized here.
"""
from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Mapping
import re
import time
from urllib.parse import urlsplit

PRODUCTION_PROJECTS = frozenset({"atrio-catolico", "guardian-v2-qa-fixture"})
PROJECT = re.compile(r"^[a-z][a-z0-9-]{5,29}$")
SA_LOCAL = re.compile(r"^[a-z][a-z0-9-]{4,29}$")
SUBJECT = re.compile(r"^[0-9]{10,30}$")
TOKEN_PART = re.compile(r"^[A-Za-z0-9_-]+$")
ROUTES = {
    "triage": frozenset({"read_policy", "propose_case"}),
    "activation": frozenset({"enable_nonpunitive"}),
}
DENY = {"decision": "QA_IDENTITY_DENIED", "production_authorized": False}


@dataclass(frozen=True)
class QaIdentityConfig:
    """Requires independently verified QA-specific project and accounts."""
    qa_project: str
    audience: str
    triage_service_account: str
    activation_service_account: str

    def __post_init__(self):
        project = self.qa_project
        if (type(project) is not str or not PROJECT.fullmatch(project)
                or project in PRODUCTION_PROJECTS):
            raise ValueError("qa_project_required")
        uri = urlsplit(self.audience) if type(self.audience) is str else None
        if (uri is None or uri.scheme != "https" or not uri.hostname
                or not uri.hostname.endswith(".run.app")
                or uri.username is not None or uri.password is not None
                or uri.port is not None or uri.path not in ("", "/")
                or uri.query or uri.fragment
                or uri.netloc != uri.hostname
                or len(self.audience) > 256):
            raise ValueError("qa_audience_required")
        for email in (self.triage_service_account, self.activation_service_account):
            if type(email) is not str:
                raise ValueError("qa_service_account_required")
            suffix = "@" + project + ".iam.gserviceaccount.com"
            if not email.endswith(suffix) or not SA_LOCAL.fullmatch(email[:-len(suffix)]):
                raise ValueError("qa_service_account_required")
        if self.triage_service_account == self.activation_service_account:
            raise ValueError("distinct_qa_principals_required")


def verify_google_token(token: str, audience: str) -> Mapping:
    """Real signature/audience/lifetime verification; requires google-auth.

    Invoked only on explicit use. On any dependency/network/certificate error,
    authorize_intent fails closed. Never decode JWT claims without verifying.
    """
    from google.auth.transport.requests import Request
    from google.oauth2.id_token import verify_oauth2_token

    return verify_oauth2_token(token, Request(), audience=audience)


def authorize_intent(*, authorization: object, operation: object,
                     config: QaIdentityConfig) -> dict:
    """Check exact QA account identity and route; never execute an operation.

    The production-callable interface intentionally does NOT accept a custom
    verifier: tests replace the module verifier using unittest.mock only.
    Never trust caller-supplied identity headers or request-body roles.
    """
    if type(config) is not QaIdentityConfig:
        return dict(DENY)
    if type(operation) is not str or operation not in ROUTES["triage"] | ROUTES["activation"]:
        return dict(DENY)
    if type(authorization) is not str or len(authorization) > 16384:
        return dict(DENY)
    if not authorization.startswith("Bearer ") or authorization.count(" ") != 1:
        return dict(DENY)
    token = authorization[len("Bearer "):]
    parts = token.split(".")
    if (len(token) < 100 or len(token) > 8192
            or len(parts) != 3 or any(not TOKEN_PART.fullmatch(p) for p in parts)):
        return dict(DENY)
    try:
        claims = verify_google_token(token, config.audience)
    except Exception:
        # Never emit token, claim contents, certificate errors or identities.
        return dict(DENY)
    if not isinstance(claims, Mapping):
        return dict(DENY)
    now = int(time.time())
    iat = claims.get("iat")
    exp = claims.get("exp")
    azp = claims.get("azp")
    sub = claims.get("sub")
    if (claims.get("iss") != "https://accounts.google.com"
            or claims.get("aud") != config.audience
            or claims.get("email_verified") is not True
            or type(sub) is not str or not SUBJECT.fullmatch(sub)
            or azp != sub
            or type(iat) is not int or type(exp) is not int
            or not (now - 3700 <= iat <= now + 60 < exp <= iat + 3700)):
        return dict(DENY)
    email = claims.get("email")
    if email == config.triage_service_account:
        role = "triage"
    elif email == config.activation_service_account:
        role = "activation"
    else:
        return dict(DENY)
    if operation not in ROUTES[role]:
        return dict(DENY)
    return {"decision": "QA_VERIFIED_IDENTITY_INTENT_ONLY",
            "role": role, "operation": operation,
            "production_authorized": False}
