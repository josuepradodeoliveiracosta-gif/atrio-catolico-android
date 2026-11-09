"""No real APK or network: Android SDK is mocked to test fail-closed QA."""
import hashlib
from pathlib import Path
import tempfile
import unittest

from scripts.chat_qa_apk_identity import CERT_PROD_SHA256, QaPreflightError, qa_apk_preflight


class ChatQaApkIdentityTests(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.apk = Path(t.name, "fixture.apk")
        self.apk.write_bytes(b"synthetic QA fixture, not a real Android APK")
        self.sha = hashlib.sha256(self.apk.read_bytes()).hexdigest()
        self.project = "atrio-catolico-qa-geral"
        self.package = "br.com.atriocatolico.chatqa"
        self.cert = "c" * 64
        self.firebase_app_id = "1:123456789:android:abcdef123456"
        self.sender_id = "123456789"
        self.sdk = t.name

    def sdk_runner(self, args):
        if args[1] == "verify":
            return "Signer #1 certificate SHA-256 digest: " + self.cert
        if args[1] == "manifest":
            return {
                "application-id": self.package,
                "version-code": "73",
                "version-name": "0.19.10",
                "debuggable": "true",
            }[args[2]]
        if args[1] == "resources":
            name = args[args.index("--name") + 1]
            return {"project_id": '"' + self.project + '"',
                    "google_app_id": '"' + self.firebase_app_id + '"',
                    "gcm_defaultSenderId": '"' + self.sender_id + '"'}[name]
        raise AssertionError("unexpected command")

    def run_preflight(self, **overrides):
        data = {"sdk": self.sdk, "expected_project": "atrio-catolico-qa-geral",
                "expected_package": "br.com.atriocatolico.chatqa",
                "expected_cert": "c" * 64, "expected_hash": self.sha,
                "expected_firebase_app_id": "1:123456789:android:abcdef123456",
                "runner": self.sdk_runner}
        data.update(overrides)
        return qa_apk_preflight(self.apk, **data)

    def check_denied(self, **overrides):
        with self.assertRaises(QaPreflightError):
            self.run_preflight(**overrides)

    def test_approved_identity_has_no_claim_of_full_network_isolation(self):
        result = self.run_preflight()
        self.assertEqual(result["result"], "qa_apk_identity_only")
        self.assertTrue(result["qa_signer_matches"])
        self.assertTrue(result["firebase_app_id_matches_qa"])
        self.assertTrue(result["firebase_sender_matches_qa"])
        self.assertFalse(result["runtime_network_isolation_verified"])
        self.assertFalse(result["worker_endpoints_audited"])
        self.assertFalse(result["physical_chat_tests_verified"])
        self.assertNotIn(self.project, str(result))

    def test_outro_projeto_qa_rejeitado(self):
        self.check_denied(expected_project="atrio-catolico-qa-v2")

    def test_non_qa_project_is_rejected_even_if_not_production(self):
        self.check_denied(expected_project="other-atrio-project")

    def test_qa_substring_is_not_an_explicit_marker(self):
        self.check_denied(expected_project="squad-atrio-test")

    def test_unapproved_alternate_package_is_rejected(self):
        self.check_denied(expected_package="br.com.atriocatolico.chatqa2")

    def test_production_project_is_rejected(self):
        self.check_denied(expected_project="atrio-catolico")

    def test_production_package_is_rejected(self):
        self.check_denied(expected_package="br.com.atriocatolico")

    def test_production_signer_is_rejected(self):
        self.check_denied(expected_cert=CERT_PROD_SHA256)

    def test_wrong_signer_is_rejected(self):
        self.check_denied(expected_cert="a" * 64)

    def test_wrong_apk_digest_is_rejected(self):
        self.check_denied(expected_hash="0" * 64)

    def test_resource_project_mismatch_is_rejected(self):
        self.project = "different-qa-project"
        self.check_denied()

    def test_apk_package_mismatch_is_rejected(self):
        self.package = "com.some.other.app"
        self.check_denied()

    def test_non_debuggable_is_rejected(self):
        original = self.sdk_runner
        def modified(args):
            if args[1:3] == ["manifest", "debuggable"]:
                return "false"
            return original(args)
        self.check_denied(runner=modified)

    def test_missing_firebase_resource_is_rejected(self):
        original = self.sdk_runner
        def modified(args):
            if args[1] == "resources" and args[args.index("--name")+1] == "project_id":
                return ""
            return original(args)
        self.check_denied(runner=modified)

    def test_firebase_app_id_from_another_project_is_rejected(self):
        self.firebase_app_id = "1:999999999:android:abcdef123456"
        self.check_denied()

    def test_wrong_approved_firebase_app_id_is_rejected(self):
        self.check_denied(expected_firebase_app_id="1:999999999:android:abcdef123456")

    def test_web_firebase_app_id_is_rejected(self):
        self.check_denied(expected_firebase_app_id="1:123456789:web:abcdef123456")

    def test_missing_firebase_app_id_is_rejected(self):
        self.firebase_app_id = ""
        self.check_denied()

    def test_wrong_fcm_sender_is_rejected(self):
        self.sender_id = "999999999"
        self.check_denied()

    def test_missing_fcm_sender_is_rejected(self):
        self.sender_id = ""
        self.check_denied()

    def test_altered_apk_is_rejected(self):
        self.apk.write_bytes(b"changed")
        self.check_denied()


if __name__ == "__main__":
    unittest.main()
