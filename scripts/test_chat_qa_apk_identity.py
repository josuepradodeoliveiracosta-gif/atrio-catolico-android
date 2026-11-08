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
        self.project = "qa-atrio-conversas-2026"
        self.package = "br.com.atriocatolico.chatqa"
        self.cert = "c" * 64
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
                    "google_app_id": '"1:123456:android:qa"'}[name]
        raise AssertionError("unexpected command")

    def run_preflight(self, **overrides):
        data = {"sdk": self.sdk, "expected_project": "qa-atrio-conversas-2026",
                "expected_package": "br.com.atriocatolico.chatqa",
                "expected_cert": "c" * 64, "expected_hash": self.sha,
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
        self.assertFalse(result["runtime_network_isolation_verified"])
        self.assertFalse(result["worker_endpoints_audited"])
        self.assertFalse(result["physical_chat_tests_verified"])
        self.assertNotIn(self.project, str(result))

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

    def test_altered_apk_is_rejected(self):
        self.apk.write_bytes(b"changed")
        self.check_denied()


if __name__ == "__main__":
    unittest.main()
