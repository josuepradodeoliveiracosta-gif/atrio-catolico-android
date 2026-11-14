"""Offline tests of proposed Google ID-token QA gate; no signed tokens or network."""
from copy import deepcopy
import time
import unittest
from unittest.mock import patch

from scripts import guardian_v2_qa_idtoken_gate as gate

PROJECT = "atrio-catolico-qa"
AUD = "https://guardian-qa-123.a.run.app"
TRIAGE = "qa-triage@" + PROJECT + ".iam.gserviceaccount.com"
ACTIVATION = "qa-activation@" + PROJECT + ".iam.gserviceaccount.com"
TOKEN = ".".join(["a" * 40, "b" * 140, "c" * 60])
SUB = "123456789012345678901"


def configuration():
    return gate.QaIdentityConfig(PROJECT, AUD, TRIAGE, ACTIVATION)


def claims(email=TRIAGE):
    now = int(time.time())
    return {"iss": "https://accounts.google.com", "aud": AUD,
            "email": email, "email_verified": True, "sub": SUB, "azp": SUB,
            "iat": now - 100, "exp": now + 1200}


def check(op="read_policy", identity=TRIAGE, *, token=TOKEN, config=None,
          change=None, verifier=None):
    proof = claims(identity)
    if change:
        proof.update(change)
    def stub(received, audience):
        if received != token or audience != AUD:
            raise AssertionError("verification_context_changed")
        return deepcopy(proof)
    with patch.object(gate, "verify_google_token",
                      side_effect=stub if verifier is None else verifier):
        return gate.authorize_intent(
            authorization="Bearer " + token, operation=op,
            config=configuration() if config is None else config)


class IdTokenQaGateTests(unittest.TestCase):
    def test_allowed_triage_operations_are_intents_not_firestore_writes(self):
        for op in ("read_policy", "propose_case"):
            decision = check(op)
            self.assertEqual(decision["decision"], "QA_VERIFIED_IDENTITY_INTENT_ONLY")
            self.assertEqual(decision["role"], "triage")
            self.assertEqual(decision["operation"], op)
            self.assertIs(decision["production_authorized"], False)
            self.assertNotIn("writes", decision)
            self.assertNotIn("token", decision)

    def test_activation_can_only_request_enable(self):
        result = check("enable_nonpunitive", ACTIVATION)
        self.assertEqual(result["role"], "activation")
        self.assertIs(result["production_authorized"], False)

    def test_cross_role_critical_operations_denied(self):
        for op, actor in (("enable_nonpunitive", TRIAGE),
                          ("read_policy", ACTIVATION),
                          ("propose_case", ACTIVATION)):
            self.assertEqual(check(op, actor), gate.DENY)

    def test_direct_firestore_or_unknown_operations_denied_without_verifier(self):
        for op in ("commit", "patch", "delete", "update_profile", "impersonate", None, 1):
            def never_called(*args):
                raise AssertionError("should_not_verify_unknown_operation")
            result = check(op, verifier=never_called)
            self.assertEqual(result, gate.DENY)

    def test_unauthorized_and_production_service_accounts_denied(self):
        for email in ("guardian-v2-writer@atrio-catolico.iam.gserviceaccount.com",
                      "qa-other@" + PROJECT + ".iam.gserviceaccount.com",
                      "qa-triage@" + PROJECT.upper() + ".iam.gserviceaccount.com",
                      "", None, "user@example.test"):
            self.assertEqual(check(identity=email), gate.DENY)

    def test_malformed_or_non_bearer_headers_never_reach_verifier(self):
        headers = (None, "", "Basic xx", "Bearer", "Bearer  ",
                   "Bearer " + "x" * 40,
                   "Bearer a.b.c", "Bearer " + TOKEN + " trailing",
                   "bearer " + TOKEN, "Bearer " + TOKEN + "\nX-Caller-Role: activation",
                   "Bearer " + TOKEN + "!", "Bearer " + "x" * 16385)
        for hdr in headers:
            with self.subTest(kind=str(hdr)[:16]):
                def never_called(*args):
                    raise AssertionError("invalid_header_reached_verifier")
                with patch.object(gate, "verify_google_token",
                                  side_effect=never_called) as mocked:
                    result = gate.authorize_intent(
                        authorization=hdr, operation="read_policy",
                        config=configuration())
                    self.assertEqual(result, gate.DENY)
                    mocked.assert_not_called()

    def test_no_unverified_claims_accepted_from_token_string(self):
        # The gate never decodes JWT payloads itself; verifier MUST return claims.
        for verifier in (lambda *_: None, lambda *_: {},
                         lambda *_: {"role": "triage"},
                         lambda *_: "triage"):
            self.assertEqual(check(verifier=verifier), gate.DENY)

    def test_google_verifier_failure_is_fail_closed_and_sanitized(self):
        def fail(*args):
            raise ValueError("sensitive-message-should-not-leak")
        result = check(verifier=fail)
        self.assertEqual(result, gate.DENY)
        self.assertNotIn("sensitive", str(result))

    def test_default_code_path_calls_real_verifier_function(self):
        with patch.object(gate, "verify_google_token", return_value=claims()) as verifier:
            result = gate.authorize_intent(authorization="Bearer " + TOKEN,
                                           operation="read_policy",
                                           config=configuration())
        self.assertEqual(result["decision"], "QA_VERIFIED_IDENTITY_INTENT_ONLY")
        verifier.assert_called_once_with(TOKEN, AUD)

    def test_rejects_bad_issuer_and_audience_independently(self):
        for change in ({"iss": "https://evil.example"},
                       {"iss": "accounts.google.com"},
                       {"aud": "https://different-qa.a.run.app"},
                       {"aud": None}):
            self.assertEqual(check(change=change), gate.DENY)

    def test_rejects_unverified_email_subject_or_authorized_party(self):
        for change in ({"email_verified": False}, {"email_verified": "true"},
                       {"sub": ""}, {"sub": "user@qa"},
                       {"azp": "99999999999999999999"}, {"azp": None}):
            self.assertEqual(check(change=change), gate.DENY)

    def test_rejects_invalid_or_overlong_lifetime(self):
        now = int(time.time())
        for change in ({"exp": now - 1}, {"iat": now + 3600},
                       {"iat": now - 10000}, {"iat": now - 100, "exp": now + 3800},
                       {"exp": "9999999999"}, {"iat": True},
                       {"exp": True}):
            self.assertEqual(check(change=change), gate.DENY)

    def test_configuration_rejects_production_or_fixture_projects(self):
        for project in ("atrio-catolico", "guardian-v2-qa-fixture", "", None, "QA-UPPER"):
            with self.assertRaises(ValueError):
                gate.QaIdentityConfig(project, AUD, TRIAGE, ACTIVATION)

    def test_configuration_enforces_distinct_qa_service_accounts(self):
        cases = [
            (TRIAGE, TRIAGE),
            (TRIAGE, "guardian-v2-writer@atrio-catolico.iam.gserviceaccount.com"),
            ("qa-triage@prod.iam.gserviceaccount.com", ACTIVATION),
            (None, ACTIVATION),
            (TRIAGE, "INVALID"),
        ]
        for left, right in cases:
            with self.assertRaises(ValueError):
                gate.QaIdentityConfig(PROJECT, AUD, left, right)

    def test_configuration_rejects_insecure_or_wrong_audience(self):
        for aud in ("http://guardian-qa.a.run.app",
                    "https://evil.example",
                    "https://guardian-qa.a.run.app.evil.com",
                    "https://guardian-qa.a.run.app/path",
                    "https://guardian-qa.a.run.app?role=triage",
                    "https://user@guardian-qa.a.run.app",
                    "", None):
            with self.assertRaises(ValueError):
                gate.QaIdentityConfig(PROJECT, aud, TRIAGE, ACTIVATION)

    def test_wrong_configuration_object_fail_closed(self):
        for value in (None, {}, "qa", 2):
            self.assertEqual(gate.authorize_intent(
                authorization="Bearer " + TOKEN, operation="read_policy",
                config=value), gate.DENY)


    def test_runtime_cannot_supply_a_fake_verifier_parameter(self):
        with self.assertRaises(TypeError):
            gate.authorize_intent(
                authorization="Bearer " + TOKEN,
                operation="read_policy",
                config=configuration(),
                verifier=lambda *_: claims())


if __name__ == "__main__":
    unittest.main()
