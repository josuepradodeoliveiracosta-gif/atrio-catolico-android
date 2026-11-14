"""Offline adversarial tests for a synthetic QA HTTP-envelope parser.

No socket, HTTP client, Firebase, Google identity verification or real token.
"""
import json
from unittest import TestCase, main
from unittest.mock import patch
import time

from scripts import guardian_v2_qa_http_envelope as http
from scripts import guardian_v2_qa_idtoken_gate as identity
from scripts.guardian_v2_qa_broker_fixture import fixture_case_id

_PROJECT = "atrio-catolico-qa"
_AUDIENCE = "https://guardiao-qa-a.run.app"
_TRIAGE = "qa-triage@" + _PROJECT + ".iam.gserviceaccount.com"
_ACTIVATION = "qa-activation@" + _PROJECT + ".iam.gserviceaccount.com"
_TOKEN = ".".join(["a" * 40, "b" * 140, "c" * 60])
_POLICY = {"update_time": "2026-11-14T09:00:00Z",
           "enabled": False, "autonomous_write_enabled": False,
           "emergency_stop": False, "allow_hold": False}


def qa_config():
    return identity.QaIdentityConfig(_PROJECT, _AUDIENCE, _TRIAGE, _ACTIVATION)


def claim(email):
    now = int(time.time())
    sub = "123456789012345678901"
    return {"iss": "https://accounts.google.com",
            "aud": _AUDIENCE, "email_verified": True,
            "email": email, "sub": sub, "azp": sub,
            "iat": now - 60, "exp": now + 900}


def request(path="/qa/v1/read-policy", body=None, principal=_TRIAGE,
            headers=None, method="POST", approved=False, policy=None, config=None):
    envelope = {"operation": "read_policy"} if body is None else body
    payload = json.dumps(envelope, separators=(",", ":")).encode() if type(envelope) is dict else envelope
    pairs = ([("Authorization", "Bearer " + _TOKEN),
              ("Content-Type", "application/json")] if headers is None else headers)
    with patch.object(identity, "verify_google_token", return_value=claim(principal)) as verify:
        result = http.inspect_qa_http_envelope(
            method=method, path=path, headers=pairs, body=payload,
            config=qa_config() if config is None else config,
            approved_by_operator=approved,
            trusted_policy_snapshot=policy)
    return result, verify.call_count


def case_request(**updates):
    target = "posts/synthetic_post"
    case = {"operation": "propose_case", "case_id": fixture_case_id(target),
            "owner_uid": "synthetic_actor", "target_path": target,
            "source_update_time": "2026-11-14T10:00:00Z", "status": "review"}
    case.update(updates)
    return case


class QaHttpEnvelopeTests(TestCase):
    def assertDenied(self, **kwargs):
        result, _ = request(**kwargs)
        self.assertEqual(result, {"decision": "SIMULATED_HTTP_DENY",
                                  "production_authorized": False})
        return result

    def test_synthetic_triage_read_returns_no_write_without_policy_contents(self):
        result, count = request()
        self.assertEqual(count, 1)
        self.assertEqual(result, {
            "decision": "SIMULATED_HTTP_ENVELOPE_ACCEPTED_NO_WRITE",
            "role": "triage", "operation": "read_policy",
            "production_authorized": False})

    def test_synthetic_case_proposal_only_returns_no_write(self):
        result, count = request(path="/qa/v1/propose-case", body=case_request())
        self.assertEqual(count, 1)
        self.assertEqual(result["decision"], "SIMULATED_HTTP_ENVELOPE_ACCEPTED_NO_WRITE")
        self.assertEqual(result["operation"], "propose_case")
        self.assertNotIn("plan", result)
        self.assertNotIn("case", result)
        self.assertNotIn("token", result)
        self.assertFalse(result["production_authorized"])

    def test_activation_needs_independent_approval_and_fresh_policy(self):
        body = {"operation": "enable_nonpunitive",
                "expected_update_time": _POLICY["update_time"]}
        self.assertDenied(path="/qa/v1/enable-nonpunitive", body=body,
                          principal=_ACTIVATION, policy=_POLICY)
        result, count = request(path="/qa/v1/enable-nonpunitive", body=body,
                                principal=_ACTIVATION, policy=_POLICY, approved=True)
        self.assertEqual(count, 1)
        self.assertEqual(result["operation"], "enable_nonpunitive")
        self.assertFalse(result["production_authorized"])
        self.assertNotIn("plan", result)

    def test_activation_denied_for_stale_policy_emergency_and_hold(self):
        base = {"operation": "enable_nonpunitive",
                "expected_update_time": _POLICY["update_time"]}
        for policy in (None, {}, dict(_POLICY, emergency_stop=True),
                       dict(_POLICY, allow_hold=True),
                       dict(_POLICY, update_time="2026-11-14T09:00:01Z")):
            with self.subTest(policy=policy):
                self.assertDenied(path="/qa/v1/enable-nonpunitive", body=base,
                                  principal=_ACTIVATION, approved=True, policy=policy)

    def test_client_supplied_approval_cannot_grant_activation(self):
        base = {"operation": "enable_nonpunitive",
                "expected_update_time": _POLICY["update_time"],
                "approved_by_operator": True}
        self.assertDenied(path="/qa/v1/enable-nonpunitive", body=base,
                          principal=_ACTIVATION, approved=True, policy=_POLICY)

    def test_cross_identity_routes_are_denied(self):
        self.assertDenied(path="/qa/v1/read-policy", principal=_ACTIVATION)
        self.assertDenied(path="/qa/v1/propose-case", body=case_request(),
                          principal=_ACTIVATION)
        self.assertDenied(path="/qa/v1/enable-nonpunitive", body={
            "operation": "enable_nonpunitive",
            "expected_update_time": _POLICY["update_time"]},
            principal=_TRIAGE, approved=True, policy=_POLICY)

    def test_any_non_post_method_or_unknown_route_is_rejected_before_auth(self):
        for method in ("GET", "PATCH", "DELETE", "post", "", None, 1):
            result, calls = request(method=method)
            self.assertEqual(result["decision"], "SIMULATED_HTTP_DENY")
            self.assertEqual(calls, 0)
        for path in ("/", "/qa/v1/commit", "/qa/v1/read-policy?role=triage",
                     "/qa/v1/read-policy/", "/qa/v1/enable-nonpunitive/../commit",
                     "", None):
            result, calls = request(path=path)
            self.assertEqual(result["decision"], "SIMULATED_HTTP_DENY")
            self.assertEqual(calls, 0)

    def test_route_operation_mismatch_is_denied_before_auth(self):
        for payload in ({"operation": "delete"}, {"operation": "propose_case"},
                        {"operation": "enable_nonpunitive"}, {"role": "triage"}):
            result, count = request(body=payload)
            self.assertEqual(result["decision"], "SIMULATED_HTTP_DENY")
            self.assertEqual(count, 0)

    def test_case_hash_cannot_be_forged_even_if_well_formed(self):
        for update in ({"case_id": "guard_" + "a" * 32},
                       {"target_path": "posts/some_other_id"},
                       {"case_id": "../../../guardian_config/policy"}):
            result, count = request(path="/qa/v1/propose-case",
                                    body=case_request(**update))
            self.assertEqual(result["decision"], "SIMULATED_HTTP_DENY")
            self.assertEqual(count, 0)

    def test_case_owner_status_and_extras_are_validated_by_contract(self):
        for update in ({"owner_uid": "a/b"}, {"status": "deleted"},
                       {"writes": []}, {"caller_email": _ACTIVATION},
                       {"target_path": "guardian_config/policy"}):
            self.assertDenied(path="/qa/v1/propose-case",
                              body=case_request(**update))

    def test_header_must_be_sequence_of_pairs_not_ambiguous_mapping(self):
        for headers in (None, {}, [], [("Content-Type", "application/json")],
                        [("Authorization", "Bearer " + _TOKEN)],
                        [("authorization", "Bearer " + _TOKEN), ("content-type", "text/plain")],
                        [["Authorization"], ("Content-Type", "application/json")]):
            if headers is None:
                continue  # request() uses this for its standard valid headers
            result, count = request(headers=headers)
            self.assertEqual(result["decision"], "SIMULATED_HTTP_DENY")
            self.assertEqual(count, 0)

    def test_duplicate_authorization_or_content_type_is_denied(self):
        pairs = [("Authorization", "Bearer " + _TOKEN),
                 ("Content-Type", "application/json")]
        for extra in (("authorization", "Bearer " + _TOKEN),
                      ("content-type", "application/json")):
            result, count = request(headers=pairs + [extra])
            self.assertEqual(result["decision"], "SIMULATED_HTTP_DENY")
            self.assertEqual(count, 0)

    def test_untrusted_identity_headers_are_not_accepted(self):
        for header in ("X-Serverless-Authorization", "X-Caller-Role",
                       "X-Caller-Email", "X-Trusted-Principal",
                       "X-Service-Account", "X-Manual-Approval"):
            result, count = request(headers=[
                ("Authorization", "Bearer " + _TOKEN),
                ("Content-Type", "application/json"),
                (header, "activation")])
            self.assertEqual(result["decision"], "SIMULATED_HTTP_DENY")
            self.assertEqual(count, 0)

    def test_header_injection_and_malformed_names_fail_closed(self):
        for name in ("Authorization\r\nX-Caller-Role", " Authorization",
                     "Autho rization", "", "ü-header"):
            result, count = request(headers=[
                (name, "Bearer " + _TOKEN),
                ("Content-Type", "application/json")])
            self.assertEqual(result["decision"], "SIMULATED_HTTP_DENY")
            self.assertEqual(count, 0)

    def test_body_requires_utf8_bytes_valid_json_and_single_object(self):
        inputs = (None, "", b"", b"[]", b"null", b"123", b"\xff",
                  b'{"operation":"read_policy",', b"NaN", b" " * 4097)
        for body in inputs:
            result, count = request(body=body)
            self.assertEqual(result["decision"], "SIMULATED_HTTP_DENY")
            self.assertEqual(count, 0)

    def test_duplicate_json_keys_in_any_depth_are_rejected(self):
        for raw in (b'{"operation":"read_policy","operation":"read_policy"}',
                    b'{"operation":"read_policy","metadata":{"x":1,"x":2}}'):
            result, count = request(body=raw)
            self.assertEqual(result["decision"], "SIMULATED_HTTP_DENY")
            self.assertEqual(count, 0)

    def test_json_nonstandard_constants_are_rejected(self):
        for raw in (b'{"operation":"read_policy","x":NaN}',
                    b'{"operation":"read_policy","x":Infinity}'):
            result, count = request(body=raw)
            self.assertEqual(result["decision"], "SIMULATED_HTTP_DENY")
            self.assertEqual(count, 0)

    def test_invalid_token_cannot_proceed_even_with_good_body(self):
        result, count = request(headers=[
            ("Authorization", "Bearer invalid"),
            ("Content-Type", "application/json")])
        self.assertEqual(result["decision"], "SIMULATED_HTTP_DENY")
        self.assertEqual(count, 1)

    def test_wrong_qa_identity_is_rejected(self):
        self.assertDenied(principal="guardian-v2-writer@atrio-catolico.iam.gserviceaccount.com")
        self.assertDenied(principal="some-other@" + _PROJECT + ".iam.gserviceaccount.com")

    def test_no_real_server_database_or_external_state_is_created(self):
        # The entire test talks to a pure function; no HTTP listener, cloud or
        # persistence is available, and the result contains no write plan.
        result, _ = request()
        self.assertNotIn("firestore", str(result).lower())
        self.assertNotIn("approved", str(result).lower())
        self.assertFalse(result["production_authorized"])


if __name__ == "__main__":
    main()
