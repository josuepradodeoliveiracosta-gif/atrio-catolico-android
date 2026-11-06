"""Regressoes offline da identidade do APK historico sem segredos."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts.ota_apk_preflight import PreflightError
from scripts.ota_baseline_0200 import (
    HISTORICAL_APK_SHA256, HISTORICAL_VERSION_CODE, verify_historical_baseline
)
from scripts.ota_release_cert import PINNED_OFFICIAL_CERT_SHA256

def stub(args):
    if "apksigner" in args[0]:
        return "Signer #1 certificate SHA-256 digest: " + PINNED_OFFICIAL_CERT_SHA256
    return {
        "application-id": "br.com.atriocatolico", "version-code": "35",
        "version-name": "0.20.0", "debuggable": "false"
    }[args[2]]

class BaselineTests(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.apk = Path(t.name, "app-release.apk")
        self.apk.write_bytes(b"fixture, nao e um APK real")
        self.sdk = t.name
    def verify(self, runner=stub):
        return verify_historical_baseline(self.apk, sdk=self.sdk, runner=runner)
    def test_hash_and_signer_pinned(self):
        with patch("scripts.ota_baseline_0200.file_sha256", return_value=HISTORICAL_APK_SHA256):
            result = self.verify()
        self.assertEqual(result["versionCode"], HISTORICAL_VERSION_CODE)
        self.assertEqual(result["certificate_sha256"], PINNED_OFFICIAL_CERT_SHA256)
        self.assertFalse(result["release_authorized"])
        self.assertFalse(result["physical_ota_tested"])
    def test_changed_apk_rejected_before_reading_signer(self):
        calls = []
        def record(args):
            calls.append(args)
            return stub(args)
        with self.assertRaisesRegex(PreflightError, "SHA-256"):
            self.verify(record)
        self.assertEqual(calls, [])
    def test_wrong_signer_rejected(self):
        def other(args):
            if "apksigner" in args[0]:
                return "Signer #1 certificate SHA-256 digest: " + "f" * 64
            return stub(args)
        with patch("scripts.ota_baseline_0200.file_sha256", return_value=HISTORICAL_APK_SHA256):
            with self.assertRaisesRegex(PreflightError, "Certificado divergente"):
                self.verify(other)
    def test_wrong_code_rejected(self):
        def other(args):
            return "36" if args[2] == "version-code" else stub(args)
        with patch("scripts.ota_baseline_0200.file_sha256", return_value=HISTORICAL_APK_SHA256):
            with self.assertRaisesRegex(PreflightError, "Versao historica"):
                self.verify(other)
    def test_wrong_package_or_debuggable_rejected(self):
        for field, value in [("application-id", "br.com.estranho"), ("debuggable", "true")]:
            def other(args):
                return value if len(args)>2 and args[2]==field else stub(args)
            with self.subTest(field=field):
                with patch("scripts.ota_baseline_0200.file_sha256", return_value=HISTORICAL_APK_SHA256):
                    with self.assertRaises(PreflightError):
                        self.verify(other)
    def test_missing_apk_rejected(self):
        self.apk.unlink()
        with self.assertRaisesRegex(PreflightError, "ausente"):
            self.verify()

if __name__ == "__main__":
    unittest.main()
